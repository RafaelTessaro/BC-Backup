// Serviços do processo principal (store, histórico, agendador, executor, e-mail) e a cola
// entre eles. Criado uma vez em index.ts depois do `app.whenReady()`.

import { app, nativeTheme } from 'electron'
import { hostname as osHostname } from 'node:os'
import { join } from 'node:path'
import { IPC_EVENTS } from '@shared/api'
import type { AppInfo, AppSettings, Routine, RunProgress, RunSummary } from '@shared/types'
import { formatDateTime } from '@shared/format'
import { setAutoStart } from './autostart'
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
import { applyTheme, currentResolvedTheme, isWindowFocused, navigate, sendToRenderer } from './window'

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
    const latest = history.latestByRoutine()
    const live = runner.liveProgress
    const active = runner.active()
    const enabled = routines.filter((r) => r.enabled)
    const failing = enabled.filter((r) => latest.get(r.id)?.status === 'failed')
    const nextRuns = scheduler.nextRuns()
    let next: { at: string; name: string } | null = null
    for (const r of routines) {
      const at = nextRuns[r.id]
      if (at && (!next || at < next.at)) next = { at, name: r.name }
    }
    const statusLines: string[] = []
    let tooltip: string
    let state: TrayModel['state'] = 'idle'
    if (live) {
      state = 'running'
      const frac = live.bytesTotal > 0 ? live.bytesDone / live.bytesTotal : 0
      const pct = Math.min(100, Math.floor(((live.destinationIndex + frac) / Math.max(1, live.destinationCount)) * 100))
      const busyText = live.phase === 'scanning' ? 'preparando…' : `${pct} %`
      statusLines.push(`Em execução: ${live.routineName} — ${busyText}`)
      tooltip = `Backup em andamento: ${live.routineName} (${busyText})`
    } else if (failing.length) {
      state = 'error'
      tooltip = failing.length === 1 ? `O último backup de "${failing[0].name}" falhou` : `${failing.length} rotinas com falha`
    } else if (!routines.length) {
      tooltip = 'Nenhuma rotina criada'
    } else if (!enabled.length) {
      tooltip = 'Rotinas pausadas'
    } else {
      tooltip = next ? `Tudo protegido · próximo ${relDay(new Date(next.at))}` : 'Tudo protegido'
    }
    if (!live) {
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
    if (failing.length && live) statusLines.push(`${failing.length} rotina(s) com falha`)
    return {
      state,
      tooltip,
      statusLines,
      anyEnabled: enabled.length > 0,
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
    onMissed: (r, slot) => log.info(`Backup atrasado não executado (recuperação desligada): "${r.name}" de ${slot.toISOString()}`)
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
      sendToRenderer(IPC_EVENTS.progress, p)
      refreshTrayThrottled()
    },
    onFinished: (summary: RunSummary) => {
      sendToRenderer(IPC_EVENTS.runFinished, summary)
      sendToRenderer(IPC_EVENTS.routinesChanged)
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
          { t: new Date().toISOString(), level: 'info', message: 'E-mail enviado (nova tentativa da fila de saída).' }
        ])
        sendToRenderer(IPC_EVENTS.routinesChanged)
      },
      onExpired: async (item, lastError) => {
        await history.update(item.runId, { email: 'failed', emailError: lastError }, [
          { t: new Date().toISOString(), level: 'error', message: `E-mail não enviado após 24 horas de tentativas: ${lastError}` }
        ])
        sendToRenderer(IPC_EVENTS.routinesChanged)
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
      sendToRenderer(IPC_EVENTS.routinesChanged)
      scheduler.tick()
      refreshTray()
    },
    settingsChanged: async (prev) => {
      const s = store.settings
      if (!prev || prev.theme !== s.theme) {
        nativeTheme.themeSource = s.theme
        applyTheme(currentResolvedTheme())
      }
      if (!prev || prev.launchAtLogin !== s.launchAtLogin) await setAutoStart(s.launchAtLogin)
      if (prev && prev.historyDays !== s.historyDays) await history.prune(s.historyDays).catch(() => 0)
      sendToRenderer(IPC_EVENTS.settingsChanged, s)
      refreshTray()
    },
    getSmtpPassword,
    refreshTray
  }

  if (weakSecretStorage()) log.warn('Sem chaveiro do sistema: a senha SMTP fica apenas ofuscada (basic_text).')
  holder.ctx = ctx
  return ctx
}
