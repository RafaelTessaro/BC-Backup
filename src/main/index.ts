// Processo principal do BC Backup: instância única, janela, bandeja, agendador e IPC.
//
// Variáveis/flags suportadas:
//   --hidden               inicia só na bandeja (usado pela inicialização com o sistema)
//   BC_USER_DATA_DIR=<dir> pasta de dados isolada (E2E/testes); também aceita BC_USER_DATA
//   BC_ENGINE_INPROCESS=1  roda o motor de backup no processo principal (depuração)
//   BC_DEBUG=1             log informativo também no console

import { join, resolve } from 'node:path'
import {
  app,
  dialog,
  Menu,
  nativeTheme,
  powerMonitor,
  session,
  type MenuItemConstructorOptions
} from 'electron'
import { IPC_EVENTS } from '@shared/api'
import { ROUTES } from '@shared/routes'
import { HIDDEN_FLAG, setAutoStart, startedHidden } from './autostart'
import { createContext, type AppContext } from './context'
import { registerIpc } from './ipc'
import { initLogger, log } from './logger'
import { isAppUrl } from './paths'
import { showNotification } from './notify'
import { createTray, destroyTray } from './tray'
import {
  applyTheme,
  currentResolvedTheme,
  getWindow,
  initWindow,
  navigate,
  sendToRenderer,
  setQuitting,
  showWindow
} from './window'

const APP_ID = 'com.bcbackup.app' // igual ao appId do electron-builder (AUMID do atalho do NSIS)

// Pasta de dados isolada: precisa vir ANTES do lock de instância única (o lock é por userData).
const userDataOverride = process.env.BC_USER_DATA_DIR || process.env.BC_USER_DATA
if (userDataOverride) app.setPath('userData', resolve(userDataOverride))

let ctx: AppContext | null = null
let shuttingDown = false
let readyToQuit = false

process.on('unhandledRejection', (e) => log.error('Promessa rejeitada sem tratamento', e))
process.on('uncaughtException', (e) => log.error('Exceção não tratada', e))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  // Em dev no Windows, o AUMID precisa ser o executável para as notificações aparecerem.
  app.setAppUserModelId(app.isPackaged || process.platform !== 'win32' ? APP_ID : process.execPath)

  app.on('second-instance', (_e, argv) => {
    if (app.isReady() && !argv.includes(HIDDEN_FLAG)) showWindow()
  })
  // Continua rodando na bandeja sem janelas.
  app.on('window-all-closed', () => {})
  app.on('activate', () => {
    if (app.isReady()) showWindow()
  })
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault())
  })
  app.on('before-quit', (e) => {
    setQuitting(true)
    if (readyToQuit || !ctx) return
    e.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    void shutdown().finally(() => {
      readyToQuit = true
      app.quit()
    })
  })

  app
    .whenReady()
    .then(start)
    .catch((e) => {
      log.error('Falha ao iniciar', e)
      dialog.showErrorBox(
        'BC Backup',
        `Não foi possível iniciar o BC Backup.\n\n${e instanceof Error ? e.message : String(e)}`
      )
      app.exit(1)
    })
}

function macMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'BC Backup',
      submenu: [
        { role: 'about', label: 'Sobre o BC Backup' },
        { type: 'separator' },
        { label: 'Configurações…', accelerator: 'Cmd+,', click: () => navigate(ROUTES.settings) },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar o BC Backup' },
        { role: 'hideOthers', label: 'Ocultar os outros' },
        { role: 'unhide', label: 'Mostrar todos' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair do BC Backup' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' }
      ]
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'close', label: 'Fechar' }
      ]
    }
  ]
  return Menu.buildFromTemplate(template)
}

async function confirmQuit(c: AppContext): Promise<void> {
  const busy = c.runner.liveProgress
  const opts = {
    type: 'question' as const,
    buttons: ['Sair', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Sair do BC Backup',
    message: 'Sair do BC Backup?',
    detail:
      'Os backups agendados não serão executados enquanto o BC Backup estiver fechado.' +
      (busy ? `\n\nO backup "${busy.routineName}" está em andamento e será cancelado.` : '')
  }
  const w = getWindow()
  const res = w && w.isVisible() ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
  if (res.response !== 0) return
  setQuitting(true)
  app.quit()
}

async function setAllEnabled(c: AppContext, enabled: boolean): Promise<void> {
  const { store } = c
  const now = new Date().toISOString()
  if (!enabled) {
    const ids = store
      .routines()
      .filter((r) => r.enabled)
      .map((r) => r.id)
    for (const id of ids) {
      const r = store.getRoutine(id)
      if (r) await store.upsertRoutine({ ...r, enabled: false, updatedAt: now })
    }
    store.state.data.pausedByTray = ids
  } else {
    const remembered = (store.state.data.pausedByTray ?? []).filter((id) => store.getRoutine(id))
    const ids = remembered.length ? remembered : store.routines().map((r) => r.id)
    for (const id of ids) {
      const r = store.getRoutine(id)
      if (!r || r.enabled) continue
      await store.upsertRoutine({ ...r, enabled: true, updatedAt: now })
      store.setRoutineState(id, { lastAttemptSlot: now })
    }
    delete store.state.data.pausedByTray
  }
  await store.state.save().catch(() => {})
  c.routinesChanged()
}

async function start(): Promise<void> {
  initLogger(join(app.getPath('userData'), 'logs'))
  log.info(`BC Backup ${app.getVersion()} iniciando (userData: ${app.getPath('userData')})`)

  // Segurança: nenhuma permissão de navegador (câmera, notificações web, etc.), exceto gravar
  // texto na área de transferência ("Copiar log") a partir da nossa interface.
  const allowed = (perm: string, wc: Electron.WebContents | null) =>
    perm === 'clipboard-sanitized-write' && !!wc && !wc.isDestroyed() && isAppUrl(wc.getURL())
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowed(perm, wc)))
  session.defaultSession.setPermissionCheckHandler((wc, perm) => allowed(perm, wc))
  // Sem download de dicionários do corretor (o app não precisa falar com a internet à toa).
  session.defaultSession.setSpellCheckerEnabled(false)
  if (process.platform === 'linux') {
    try {
      session.defaultSession.setSpellCheckerLanguages([])
    } catch {
      // sem suporte: ignora
    }
  }

  const c = await createContext()
  ctx = c
  const { store } = c
  nativeTheme.themeSource = store.settings.theme
  Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null)

  initWindow({
    getState: () => store.state.data.window,
    saveState: (s) => {
      store.state.data.window = s
      void store.state.save().catch(() => {})
    },
    closeToTray: () => store.settings.closeToTray,
    onHiddenToTray: () => {
      if (store.settings.trayHintShown) return
      showNotification(
        'O BC Backup continua rodando na bandeja',
        'Os backups agendados continuam funcionando. Clique no ícone perto do relógio para abrir.',
        () => showWindow()
      )
      void store
        .updateSettings({ trayHintShown: true })
        .then(() => sendToRenderer(IPC_EVENTS.settingsChanged, store.settings))
        .catch(() => {})
    }
  })
  nativeTheme.on('updated', () => {
    // O renderer também avisa via app.setResolvedTheme; aqui cobre a janela oculta.
    applyTheme(currentResolvedTheme())
  })

  registerIpc(c)

  createTray({
    open: () => showWindow(),
    runNow: (id) => {
      c.runner.enqueue(id, 'manual')
      c.refreshTray()
    },
    pauseAll: () => void setAllEnabled(c, false),
    resumeAll: () => void setAllEnabled(c, true),
    settings: () => navigate(ROUTES.settings),
    quit: () => void confirmQuit(c)
  })
  c.refreshTray()

  c.scheduler.start()
  c.outbox?.start()
  powerMonitor.on('resume', () => {
    log.info('Computador acordou: reavaliando agendamentos.')
    c.scheduler.tick()
    void c.outbox?.processDue()
  })
  powerMonitor.on('unlock-screen', () => c.scheduler.tick())

  void setAutoStart(store.settings.launchAtLogin)
  setInterval(() => void c.history.prune(store.settings.historyDays).catch(() => 0), 6 * 3_600_000).unref()

  if (!startedHidden()) showWindow()
  else if (process.platform === 'darwin') app.dock?.hide()
  log.info(`Pronto${startedHidden() ? ' (oculto na bandeja)' : ''}.`)
}

async function shutdown(): Promise<void> {
  const c = ctx
  if (!c) return
  log.info('Encerrando…')
  c.scheduler.stop()
  c.outbox?.stop()
  try {
    await c.runner.shutdown(8000)
  } catch (e) {
    log.warn('Falha ao cancelar execuções', e)
  }
  await Promise.all([c.store.flush(), c.history.flush()]).catch(() => {})
  destroyTray()
  await log.flush()
}
