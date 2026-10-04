// Serviços do processo principal (store, histórico, agendador, executor, e-mail) e a cola
// entre eles. Criado uma vez em index.ts depois do `app.whenReady()`.

import { app, nativeTheme } from 'electron'
import { hostname as osHostname } from 'node:os'
import { join } from 'node:path'
import { IPC_EVENTS } from '@shared/api'
import type { AppInfo, AppSettings, Routine, RunProgress, RunSummary } from '@shared/types'
import { formatDateTime } from '@shared/format'
import { summarizeHealth } from '@shared/health'
import { setAutoStart } from './autostart'
import { broadcast } from './broadcast'
import { HistoryStore } from './history'
import { log } from './logger'
import { Outbox } from './mail/outbox'
import { sendMail, smtpErrorMessage } from './mail/smtp'
import { notifyRunFinished } from './notify'
import { RunManager } from './runner'
import { Scheduler } from './scheduler'
import { openSecret, weakSecretStorage } from './secrets'
import { AppStore, type StoredRoutine } from './store'
import { updateTray, type TrayModel } from './tray'
import { applyPanelTheme } from './tray-panel'
import { applyTheme, currentResolvedTheme, isWindowFocused, navigate } from './window'

export interface AppContext {
  store: AppStore
  history: HistoryStore
  scheduler: Scheduler
  runner: RunManager
  outbox: Outbox | null
  info: AppInfo
  version: string
  hostname: string
  withLastRun(r: StoredRoutine): Routine
  routinesWithLastRun(): Routine[]
  /** Rotinas mudaram: avisa a interface, reavalia o agendador e atualiza a bandeja. */
  routinesChanged(): void
  /** Configurações mudaram: aplica efeitos (tema, autostart, histórico) e avisa a interface. */
  settingsChanged(prev?: AppSettings): Promise<void>
  getSmtpPassword(): Promise<string>
  refreshTray(): void
}

function relDay(d: Date, now = new Date()): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86_400_000)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (diff === 0) return `hoje, ${time}`
  if (diff === 1) return `amanhã, ${time}`
  if (diff === -1) return `ontem, ${time}`
  return formatDateTime(d)
}

const STATUS_MARK: Record<string, string> = { success: '✓', warning: '⚠', failed: '✕', cancelled: '–' }

export async function createContext(): Promise<AppContext> {
  const userData = app.getPath('userData')
  const version = app.getVersion()
  const hostname = osHostname()
  const store = await AppStore.open(userData)
  const history = await HistoryStore.open(userData, store.settings.historyDays)

  const holder: { ctx?: AppContext } = {}
  let trayTimer: NodeJS.Timeout | null = null
  let lastTrayAt = 0

  const getSmtpPassword = async (): Promise<string> => {
    const enc = store.config.data.secrets.smtpPassword
    if (!enc) return ''
    return openSecret(enc, (value) => {
      store.config.data.secrets.smtpPassword = value
      void store.config.save().catch(() => {})
    })
  }

  const withLastRun = (r: StoredRoutine): Routine => {
    const last = history.latestByRoutine().get(r.id)
    return last ? { ...r, lastRun: last } : { ...r }
  }

  const buildTrayModel = (): TrayModel => {
    const routines = store.routines()
    const live = runner.liveProgress
    const active = runner.active()
    // Mesma regra do painel da bandeja e do hero do Painel (src/shared/health.ts).
    const withRuns = routines.map(withLastRun)
    const health = summarizeHealth(withRuns, active)
    const nextRuns = scheduler.nextRuns()
    let next: { at: string; name: string } | null = null
    for (const r of routines) {
      const at = nextRuns[r.id]
      if (at && (!next || at < next.at)) next = { at, name: r.name }
    }
    const statusLines: string[] = []
    let tooltip: string
    let state: TrayModel['state'] = 'idle'
    const failingCount = withRuns.filter((r) => r.enabled && r.lastRun?.status === 'failed').length
    switch (health.kind) {
      case 'running': {
        state = 'running'
        const p = live ?? health.run!
        const frac = p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : 0
        const pct = Math.min(
          100,
          Math.floor(((p.destinationIndex + frac) / Math.max(1, p.destinationCount)) * 100)
        )
        const busyText = p.phase === 'scanning' ? 'preparando…' : `${pct} %`
        statusLines.push(`Em execução: ${p.routineName} — ${busyText}`)
        tooltip = `Backup em andamento: ${p.routineName} (${busyText})`
        break
      }
      case 'queued':
        state = 'running'
        tooltip = `Backup na fila: ${health.run!.routineName}`
        break
      case 'failed':
        state = 'error'
        tooltip =
          health.count === 1
            ? `O último backup de "${health.routine!.name}" falhou`
            : `${health.count} rotinas com falha`
        break
      case 'warning':
        state = 'warning'
        tooltip =
          health.count === 1
            ? `O último backup de "${health.routine!.name}" teve avisos`
            : `${health.count} rotinas com avisos`
        break
      case 'empty':
        tooltip = 'Nenhuma rotina criada'
        break
      case 'paused':
        tooltip = 'Rotinas pausadas'
        break
      default:
        tooltip = next ? `Tudo protegido · próximo ${relDay(new Date(next.at))}` : 'Tudo protegido'
    }
    if (health.kind !== 'running') {
      const last = history.records().find((r) => r.status !== 'running' && r.status !== 'queued')
      statusLines.push(
        last
          ? `Último backup: ${relDay(new Date(last.finishedAt ?? last.startedAt))} ${STATUS_MARK[last.status] ?? ''}`.trim()
          : 'Nenhum backup executado ainda'
      )
    }
    statusLines.push(next ? `Próximo: ${relDay(new Date(next.at))} — ${next.name}` : 'Nenhum backup agendado')
    const queued = active.filter((p) => p.phase === 'queued').length
    if (queued) statusLines.push(`Na fila: ${queued}`)
    if (failingCount && health.kind === 'running') statusLines.push(`${failingCount} rotina(s) com falha`)
    return {
      state,
      tooltip,
      statusLines,
      anyEnabled: routines.some((r) => r.enabled),
      routines: [...routines]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map((r) => ({ id: r.id, name: r.name, busy: runner.isBusy(r.id) }))
    }
  }

  const refreshTray = () => {
    try {
      updateTray(buildTrayModel())
    } catch (e) {
      log.warn('Falha ao atualizar a bandeja', e)
    }
    lastTrayAt = Date.now()
  }
  /** Atualização da bandeja limitada (o progresso chega até 4×/s). */
  const refreshTrayThrottled = () => {
    if (trayTimer) return
    const wait = Math.max(0, 2000 - (Date.now() - lastTrayAt))
    trayTimer = setTimeout(() => {
      trayTimer = null
      refreshTray()
    }, wait)
  }

  const scheduler = new Scheduler({
    routines: () => store.routines(),
    getLastAttempt: (id) => store.routineState(id).lastAttemptSlot,
    setLastAttempt: (id, iso) => store.setRoutineState(id, { lastAttemptSlot: iso }),
    enqueue: (id, trigger) => {
      runner.enqueue(id, trigger)
    },
    onMissed: (r, slot) =>
      log.info(`Backup atrasado não executado (recuperação desligada): "${r.name}" de ${slot.toISOString()}`)
  })

  const runner: RunManager = new RunManager({
    store,
    history,
    outbox: () => holder.ctx?.outbox ?? null,
    nextRunFor: (id) => {
      const r = store.getRoutine(id)
      return r ? scheduler.nextRunFor(r) : null
    },
    getSmtpPassword,
    info: { version, hostname },
    emitProgress: (p: RunProgress) => {
      broadcast(IPC_EVENTS.progress, p)
      refreshTrayThrottled()
    },
    onFinished: (summary: RunSummary) => {
      broadcast(IPC_EVENTS.runFinished, summary)
      broadcast(IPC_EVENTS.routinesChanged)
      refreshTray()
      if (store.settings.desktopNotifications && !isWindowFocused()) notifyRunFinished(summary, navigate)
    },
    onQueueChange: () => refreshTray()
  })

  let outbox: Outbox | null = null
  try {
    outbox = await Outbox.open({
      file: join(userData, 'outbox.json'),
      send: async (mail) => {
        const s = store.settings.smtp
        await sendMail(s, s.hasPassword ? await getSmtpPassword() : '', mail)
      },
      errorMessage: (e) => smtpErrorMessage(e, store.settings.smtp),
      onSent: async (item) => {
        await history.update(item.runId, { email: 'sent', emailError: undefined }, [
          {
            t: new Date().toISOString(),
            level: 'info',
            message: 'E-mail enviado (nova tentativa da fila de saída).'
          }
        ])
        broadcast(IPC_EVENTS.routinesChanged)
      },
      onExpired: async (item, lastError) => {
        await history.update(item.runId, { email: 'failed', emailError: lastError }, [
          {
            t: new Date().toISOString(),
            level: 'error',
            message: `E-mail não enviado após 24 horas de tentativas: ${lastError}`
          }
        ])
        broadcast(IPC_EVENTS.routinesChanged)
      }
    })
  } catch (e) {
    log.error('Fila de e-mail indisponível', e)
  }

  const info: AppInfo = {
    name: 'BC Backup',
    version,
    platform: process.platform,
    dataPath: userData,
    logsPath: join(userData, 'logs'),
    hostname
  }

  const ctx: AppContext = {
    store,
    history,
    scheduler,
    runner,
    outbox,
    info,
    version,
    hostname,
    withLastRun,
    routinesWithLastRun: () => store.routines().map(withLastRun),
    routinesChanged: () => {
      broadcast(IPC_EVENTS.routinesChanged)
      scheduler.tick()
      refreshTray()
    },
    settingsChanged: async (prev) => {
      const s = store.settings
      if (!prev || prev.theme !== s.theme) {
        nativeTheme.themeSource = s.theme
        applyTheme(currentResolvedTheme())
        applyPanelTheme(currentResolvedTheme())
      }
      if (!prev || prev.launchAtLogin !== s.launchAtLogin) await setAutoStart(s.launchAtLogin)
      if (prev && prev.historyDays !== s.historyDays) await history.prune(s.historyDays).catch(() => 0)
      broadcast(IPC_EVENTS.settingsChanged, s)
      refreshTray()
    },
    getSmtpPassword,
    refreshTray
  }

  if (weakSecretStorage())
    log.warn('Sem chaveiro do sistema: a senha SMTP fica apenas ofuscada (basic_text).')
  holder.ctx = ctx
  return ctx
}
