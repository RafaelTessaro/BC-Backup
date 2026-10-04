// Executor das rotinas no main: fila global (1 por vez), motor no utilityProcess, histórico,
// e-mail consolidado (com fila de saída) e impedimento de suspensão durante o backup.

import { app, powerSaveBlocker } from 'electron'
import type {
  DestinationResult,
  ID,
  LogEntry,
  RunProgress,
  RunRecord,
  RunSummary,
  RunTrigger
} from '@shared/types'
import { startEngineJob } from './engine-host'
import { withTimeout, errMessage } from './engine/fsutil'
import type { JobResult, JobSpec } from './engine/types'
import { toSummary, type HistoryStore } from './history'
import { log } from './logger'
import { decideRunEmail } from './mail/compose'
import type { Outbox } from './mail/outbox'
import { sendMail, smtpErrorMessage } from './mail/smtp'
import { RunQueue, type QueueItem } from './run-queue'
import type { AppStore, StoredRoutine } from './store'

export interface RunnerDeps {
  store: AppStore
  history: HistoryStore
  outbox(): Outbox | null
  nextRunFor(routineId: ID): string | null
  getSmtpPassword(): Promise<string>
  info: { version: string; hostname: string }
  emitProgress(p: RunProgress): void
  onFinished(summary: RunSummary): void
  onQueueChange(): void
}

interface LiveRun {
  item: QueueItem
  routine: StoredRoutine
  startedAt: string
  progress: RunProgress
  log: LogEntry[]
  /** "Mover": arquivos já apagados da origem (contagem exata; o log ao vivo tem limite). */
  moved: number
  /** Registro final, já montado enquanto o e-mail é enviado (fase "notifying"). */
  record?: RunRecord
}

const MAX_LIVE_LOG = 5000

/** "Mover": o motor parou sem devolver o relatório; as linhas "Movido:" recebidas dizem o que saiu. */
function movedNotice(moved: number): string {
  return moved
    ? `A execução parou antes de terminar; ${moved === 1 ? '1 arquivo já tinha sido apagado' : `${moved.toLocaleString('pt-BR')} arquivos já tinham sido apagados`} da origem (veja o log).`
    : 'Nada foi apagado da origem.'
}

function userDataPath(): string | undefined {
  try {
    return app.getPath('userData')
  } catch {
    return undefined
  }
}

export class RunManager {
  private readonly queue: RunQueue
  private live: LiveRun | null = null
  /** shutdown() começou: nenhuma execução nova (o app está fechando). */
  private closing = false

  constructor(private readonly d: RunnerDeps) {
    this.queue = new RunQueue(
      (item, signal) => this.execute(item, signal),
      () => this.d.onQueueChange()
    )
  }

  /** Enfileira (manual, agendada…). Rotina já na fila/rodando → devolve o runId existente. */
  enqueue(routineId: ID, trigger: RunTrigger): { runId: ID; added: boolean } | null {
    const routine = this.d.store.getRoutine(routineId)
    if (!routine) return null
    if (this.closing) {
      log.info(`Rotina "${routine.name}" não iniciada (${trigger}): o BC Backup está fechando.`)
      return null
    }
    if (this.queue.isBusy(routineId) && trigger !== 'manual') {
      log.info(`Rotina "${routine.name}" ignorada (${trigger}): execução anterior em andamento.`)
    }
    const res = this.queue.enqueue(routineId, routine.name, trigger)
    if (res.added) {
      const queued = this.queue.queued.find((q) => q.runId === res.runId)
      if (queued) this.d.emitProgress(this.queuedProgress(queued))
    }
    return res
  }

  isBusy(routineId: ID): boolean {
    return this.queue.isBusy(routineId)
  }

  get isClosing(): boolean {
    return this.closing
  }

  get runningRoutineId(): ID | null {
    return this.queue.running?.routineId ?? null
  }

  get liveProgress(): RunProgress | null {
    return this.live ? { ...this.live.progress } : null
  }

  private queuedProgress(q: QueueItem): RunProgress {
    const routine = this.d.store.getRoutine(q.routineId)
    return {
      runId: q.runId,
      routineId: q.routineId,
      routineName: q.routineName,
      phase: 'queued',
      filesTotal: 0,
      filesDone: 0,
      bytesTotal: 0,
      bytesDone: 0,
      speed: 0,
      destinationIndex: 0,
      destinationCount: routine
        ? Math.max(1, routine.destinations.filter((x) => x.enabled !== false).length)
        : 1,
      startedAt: q.enqueuedAt
    }
  }

  /** Execução em andamento primeiro, depois as da fila (phase 'queued'). */
  active(): RunProgress[] {
    const out: RunProgress[] = []
    if (this.live) out.push({ ...this.live.progress })
    else if (this.queue.running) out.push(this.queuedProgress(this.queue.running))
    for (const q of this.queue.queued) out.push(this.queuedProgress(q))
    return out
  }

  /** Registro parcial de uma execução em andamento/na fila (para runs.get). */
  activeRecord(runId: ID): RunRecord | null {
    if (this.live && this.live.item.runId === runId) {
      const p = this.live.progress
      return {
        id: runId,
        routineId: this.live.routine.id,
        routineName: this.live.routine.name,
        status: 'running',
        trigger: this.live.item.trigger,
        startedAt: this.live.startedAt,
        filesTotal: p.filesTotal,
        filesCopied: p.filesDone,
        filesSkipped: 0,
        bytesTotal: p.bytesTotal,
        bytesCopied: p.bytesDone,
        warnings: this.live.log.filter((l) => l.level === 'warn').length,
        errors: this.live.log.filter((l) => l.level === 'error').length,
        destinationCount: p.destinationCount,
        destinations: [],
        log: [...this.live.log]
      }
    }
    const q = this.queue.queued.find((x) => x.runId === runId)
    if (!q) return null
    return {
      id: runId,
      routineId: q.routineId,
      routineName: q.routineName,
      status: 'queued',
      trigger: q.trigger,
      startedAt: q.enqueuedAt,
      filesTotal: 0,
      filesCopied: 0,
      filesSkipped: 0,
      bytesTotal: 0,
      bytesCopied: 0,
      warnings: 0,
      errors: 0,
      destinationCount: this.queuedProgress(q).destinationCount,
      destinations: [],
      log: []
    }
  }

  /** Cancela por routineId ou runId. Da fila: registra como cancelada no histórico. */
  /**
   * Rotina pausada: tira da fila a execução que ainda não começou (registrada como cancelada). O que
   * já está rodando continua — pausar é sobre o futuro; para interromper existe "Parar".
   */
  async dropQueued(routineId: ID): Promise<boolean> {
    if (this.queue.running?.routineId === routineId) return false
    if (!this.queue.queued.some((q) => q.routineId === routineId)) return false
    return this.cancel(routineId)
  }

  async cancel(idOrRunId: ID): Promise<boolean> {
    const res = this.queue.cancel(idOrRunId)
    if (!res) return false
    if (res.state === 'queued') {
      const now = new Date().toISOString()
      const routine = this.d.store.getRoutine(res.item.routineId)
      const record: RunRecord = {
        id: res.item.runId,
        routineId: res.item.routineId,
        routineName: res.item.routineName,
        status: 'cancelled',
        trigger: res.item.trigger,
        startedAt: res.item.enqueuedAt,
        finishedAt: now,
        durationMs: 0,
        filesTotal: 0,
        filesCopied: 0,
        filesSkipped: 0,
        bytesTotal: 0,
        bytesCopied: 0,
        warnings: 0,
        errors: 0,
        destinationCount: routine ? routine.destinations.filter((x) => x.enabled !== false).length : 0,
        email: 'skipped',
        destinations: [],
        log: [{ t: now, level: 'warn', message: 'Execução cancelada antes de começar (estava na fila).' }]
      }
      await this.d.history.add(record).catch((e) => log.error('Falha ao gravar histórico', e))
      this.d.onFinished(toSummary(record))
    }
    return true
  }

  /** Cancela tudo e espera terminar (ao sair do app). */
  async shutdown(timeoutMs = 8000): Promise<void> {
    this.closing = true
    for (const q of this.queue.clearQueued())
      log.info(`Execução na fila descartada ao sair: ${q.routineName}`)
    const running = this.queue.running
    if (running) this.queue.cancel(running.runId)
    const done = await withTimeout(this.queue.idle(), timeoutMs).then(
      () => true,
      () => false
    )
    // Não terminou a tempo (motor apagando a cópia parcial numa pasta de rede lenta, servidor de
    // e-mail sem resposta): o app fecha mesmo assim, mas a execução não pode sumir do histórico.
    const live = this.live
    if (!done && live) {
      await this.d.history
        .add(this.unfinishedRecord(live))
        .catch((e) => log.error('Falha ao gravar o histórico', e))
    }
  }

  /** Registro de uma execução que não terminou antes de o app fechar. */
  private unfinishedRecord(live: LiveRun): RunRecord {
    const now = new Date().toISOString()
    if (live.record) {
      // O backup já tinha terminado; faltava o e-mail.
      const r: RunRecord = { ...live.record, log: [...live.record.log] }
      if (!r.email) {
        r.email = 'failed'
        r.emailError = 'O BC Backup foi fechado antes de enviar o e-mail.'
        r.log.push({ t: now, level: 'warn', message: `E-mail não enviado: ${r.emailError}` })
      }
      return r
    }
    const p = live.progress
    const record: RunRecord = {
      id: live.item.runId,
      routineId: live.routine.id,
      routineName: live.routine.name,
      status: 'cancelled',
      trigger: live.item.trigger,
      startedAt: live.startedAt,
      finishedAt: now,
      durationMs: Math.max(0, Date.parse(now) - Date.parse(live.startedAt)),
      filesTotal: p.filesTotal,
      filesCopied: 0,
      filesSkipped: 0,
      bytesTotal: p.bytesTotal,
      bytesCopied: 0,
      warnings: 0,
      errors: 0,
      destinationCount: live.routine.destinations.filter((x) => x.enabled !== false).length,
      email: 'skipped',
      destinations: [],
      log: [
        ...live.log,
        { t: now, level: 'warn', message: 'O BC Backup foi fechado antes de a execução terminar.' }
      ]
    }
    if (live.routine.moveSources?.enabled) record.notice = movedNotice(live.moved)
    return record
  }

  private async execute(item: QueueItem, signal: AbortSignal): Promise<void> {
    const routine = this.d.store.getRoutine(item.routineId)
    if (!routine) return
    const startedAt = new Date().toISOString()
    const destinationCount = routine.destinations.filter((x) => x.enabled !== false).length
    const live: LiveRun = {
      item,
      routine,
      startedAt,
      log: [],
      moved: 0,
      progress: {
        runId: item.runId,
        routineId: routine.id,
        routineName: routine.name,
        phase: 'scanning',
        filesTotal: 0,
        filesDone: 0,
        bytesTotal: 0,
        bytesDone: 0,
        speed: 0,
        destinationIndex: 0,
        destinationCount: Math.max(1, destinationCount),
        startedAt
      }
    }
    this.live = live
    this.d.emitProgress({ ...live.progress })
    let blocker: number | null
    try {
      blocker = powerSaveBlocker.start('prevent-app-suspension')
    } catch {
      blocker = null
    }
    log.info(`Iniciando "${routine.name}" (${item.trigger}) — run ${item.runId}`)

    const spec: JobSpec = {
      runId: item.runId,
      // Toda execução relê e compara o conteúdo no destino, qualquer que seja o valor gravado.
      routine: { ...structuredClone(routine), verify: 'full' },
      trigger: item.trigger,
      startedAt,
      appVersion: this.d.info.version,
      hostname: this.d.info.hostname,
      // "Mover" recusa uma origem que contenha (ou esteja dentro de) a pasta de dados do app.
      dataPath: userDataPath()
    }
    let result: JobResult
    const job = startEngineJob(spec, (ev) => {
      if (ev.type === 'progress') {
        live.progress = { ...ev.progress, startedAt }
        this.d.emitProgress({ ...live.progress })
      } else {
        // "Mover": cada exclusão vai também para o log do aplicativo na hora. O histórico só é
        // gravado no fim (depois do e-mail); se o motor, o app ou o PC caírem antes, ainda fica o
        // registro do que saiu da origem.
        if (ev.entry.message.startsWith('Movido: ')) {
          live.moved++
          log.info(`[${routine.name}] ${ev.entry.message}`)
        }
        if (live.log.length < MAX_LIVE_LOG) live.log.push(ev.entry)
      }
    })
    const onAbort = () => job.cancel()
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) job.cancel()
    try {
      result = await job.result
    } catch (e) {
      const now = new Date().toISOString()
      const cancelled = signal.aborted
      const message = cancelled ? 'Execução cancelada.' : errMessage(e)
      result = {
        status: cancelled ? 'cancelled' : 'failed',
        errorMessage: cancelled ? undefined : message,
        finishedAt: now,
        filesTotal: live.progress.filesTotal,
        bytesTotal: live.progress.bytesTotal,
        filesCopied: 0,
        bytesCopied: 0,
        filesSkipped: 0,
        warnings: 0,
        errors: cancelled ? 0 : 1,
        destinations: [],
        log: [...live.log, { t: now, level: cancelled ? 'warn' : 'error', message }]
      }
      if (!cancelled) log.error(`Motor falhou em "${routine.name}"`, e)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }

    const finishedAt = result.finishedAt || new Date().toISOString()
    const record: RunRecord = {
      id: item.runId,
      routineId: routine.id,
      routineName: routine.name,
      status: result.status,
      trigger: item.trigger,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      filesTotal: result.filesTotal,
      filesCopied: result.filesCopied,
      filesSkipped: result.filesSkipped,
      bytesTotal: result.bytesTotal,
      bytesCopied: result.bytesCopied,
      warnings: result.warnings,
      errors: result.errors,
      destinationCount,
      destinations: result.destinations as DestinationResult[],
      log: result.log
    }
    if (result.errorMessage) record.errorMessage = result.errorMessage
    if (result.move) {
      record.move = result.move
      record.filesMoved = result.filesMoved ?? result.move.removedCount
      record.bytesMoved = result.bytesMoved ?? result.move.removedBytes
      if (result.move.notice) record.notice = result.move.notice
    } else if (routine.moveSources?.enabled) {
      // O motor parou sem devolver o relatório: as linhas "Movido:" recebidas dizem o que já tinha
      // sido apagado (contadas na chegada: o log ao vivo para em MAX_LIVE_LOG linhas).
      record.notice = movedNotice(live.moved)
    }

    // E-mail consolidado (um por execução).
    live.progress = { ...live.progress, phase: 'notifying', currentFile: undefined, etaMs: undefined }
    live.record = record
    await this.handleEmail(record, routine)

    try {
      await this.d.history.add(record)
    } catch (e) {
      log.error('Falha ao gravar o histórico', e)
    }
    this.d.store.setRoutineState(routine.id, { lastRunAt: finishedAt })
    this.live = null
    if (blocker !== null && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
    log.info(`Fim de "${routine.name}": ${record.status}`)
    this.d.emitProgress({ ...live.progress, phase: 'done' })
    this.d.onFinished(toSummary(record))
  }

  private async handleEmail(record: RunRecord, routine: StoredRoutine): Promise<void> {
    const settings = this.d.store.settings
    const add = (level: LogEntry['level'], message: string) =>
      record.log.push({ t: new Date().toISOString(), level, message })
    let decision
    try {
      decision = decideRunEmail({
        run: record,
        routine,
        settings,
        hostname: this.d.info.hostname,
        appVersion: this.d.info.version,
        nextRunAt: this.d.nextRunFor(routine.id)
      })
    } catch (e) {
      record.email = 'failed'
      record.emailError = `Erro ao montar o e-mail: ${errMessage(e)}`
      add('error', record.emailError)
      return
    }
    if (decision.status !== 'send') {
      record.email = decision.status
      if (decision.status === 'not_configured' && routine.notification.enabled)
        add('warn', `E-mail não enviado: ${decision.reason}`)
      return
    }
    if (this.live) this.d.emitProgress({ ...this.live.progress, phase: 'notifying' })
    const smtp = settings.smtp
    const to = [...decision.mail.to, ...(decision.mail.bcc ?? []).map((b) => `${b} (cópia oculta)`)].join(
      ', '
    )
    try {
      const password = smtp.hasPassword ? await this.d.getSmtpPassword() : ''
      await withTimeout(sendMail(smtp, password, decision.mail), 120_000, 'Tempo esgotado ao enviar o e-mail')
      record.email = 'sent'
      add('info', `E-mail enviado para ${to}.`)
    } catch (e) {
      const message = smtpErrorMessage(e, smtp)
      record.email = 'queued'
      record.emailError = message
      add('warn', `Falha ao enviar o e-mail: ${message} Nova tentativa a cada 15 minutos por até 24 horas.`)
      const outbox = this.d.outbox()
      if (outbox)
        await outbox.add(record.id, decision.mail, message).catch((err) => log.error('Fila de e-mail', err))
      else record.email = 'failed'
    }
  }
}
