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
  screen,
  session,
  type MenuItemConstructorOptions,
  type Rectangle
} from 'electron'
import { IPC_EVENTS } from '@shared/api'
import { ROUTES } from '@shared/routes'
import { confirmQuit, openMain, setAllEnabled } from './app-actions'
import { HIDDEN_FLAG, setAutoStart, startedHidden } from './autostart'
import { broadcast } from './broadcast'
import { createContext, type AppContext } from './context'
import { registerIpc } from './ipc'
import { initLogger, log } from './logger'
import { isAppUrl } from './paths'
import { showNotification } from './notify'
import { createTray, destroyTray, TRAY_USES_PANEL, trayIconBounds } from './tray'
import { applyPanelTheme, createTrayPanel, hideTrayPanel, toggleTrayPanel } from './tray-panel'
import { applyTheme, currentResolvedTheme, initWindow, navigate, setQuitting, showWindow } from './window'

const APP_ID = 'com.bcbackup.app' // igual ao appId do electron-builder (AUMID do atalho do NSIS)

// Pasta de dados isolada: precisa vir ANTES do lock de instância única (o lock é por userData).
const userDataOverride = process.env.BC_USER_DATA_DIR || process.env.BC_USER_DATA
if (userDataOverride) app.setPath('userData', resolve(userDataOverride))

let ctx: AppContext | null = null
let shuttingDown = false
let readyToQuit = false
/** start() terminou (IPC registrado): antes disso a janela abriria sem resposta da ponte. */
let started = false
/** Pedido de janela (segunda instância) que chegou durante o início. */
let showWhenStarted = false

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
    if (argv.includes(HIDDEN_FLAG)) return
    // Ainda carregando (ex.: início "--hidden" do login com o disco ocupado): abre ao terminar.
    if (!started) showWhenStarted = true
    else showWindow()
  })
  // Continua rodando na bandeja sem janelas.
  app.on('window-all-closed', () => {})
  app.on('activate', () => {
    if (started) showWindow()
    // macOS também emite no primeiro lançamento: lá o start() decide se a janela aparece.
    else if (process.platform !== 'darwin') showWhenStarted = true
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
        .then(() => broadcast(IPC_EVENTS.settingsChanged, store.settings))
        .catch(() => {})
    },
    confirmQuitIfBusy: () => {
      if (!c.runner.liveProgress) return false
      void confirmQuit(c)
      return true
    }
  })
  nativeTheme.on('updated', () => {
    // O renderer também avisa via app.setResolvedTheme; aqui cobre a janela oculta e o painel.
    applyTheme(currentResolvedTheme())
    applyPanelTheme(currentResolvedTheme())
  })

  registerIpc(c)

  createTray({
    open: () => openMain(),
    runNow: (id) => {
      c.runner.enqueue(id, 'manual')
      c.refreshTray()
    },
    pauseAll: () => void setAllEnabled(c, false),
    resumeAll: () => void setAllEnabled(c, true),
    settings: () => openMain(ROUTES.settings),
    quit: () => void confirmQuit(c),
    togglePanel: (bounds) => toggleTrayPanel(bounds),
    hidePanel: () => hideTrayPanel()
  })
  c.refreshTray()
  // Painel da bandeja: some ao trocar de monitor/DPI, ao bloquear a tela ou suspender (light-dismiss).
  screen.on('display-metrics-changed', () => hideTrayPanel())
  screen.on('display-added', () => hideTrayPanel())
  screen.on('display-removed', () => hideTrayPanel())
  powerMonitor.on('lock-screen', () => hideTrayPanel())
  powerMonitor.on('suspend', () => hideTrayPanel())
  if (process.env.BC_E2E === '1') {
    // Gancho só para os testes E2E (app.evaluate): simula o clique no ícone da bandeja.
    // Sem retângulo, usa o do ícone de verdade (Windows/macOS) ou cai no cursor.
    ;(globalThis as { __bcTrayToggle?: (b?: Rectangle) => boolean }).__bcTrayToggle = (b) =>
      toggleTrayPanel(b ?? trayIconBounds())
  }

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

  started = true
  if (!startedHidden() || showWhenStarted) showWindow()
  else if (process.platform === 'darwin') app.dock?.hide()
  // Pré-cria o painel oculto DEPOIS da janela principal: o primeiro clique no ícone já o encontra
  // pronto (sem tela branca). No Linux o painel não é usado (menu nativo).
  if (TRAY_USES_PANEL) setTimeout(() => createTrayPanel(), 1500)
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
