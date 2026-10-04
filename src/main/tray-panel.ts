// Painel da bandeja (docs/research/05-painel-da-bandeja.md §7): janela 360×480 sem moldura, opaca
// em `surface-raised`, pré-criada oculta e reutilizada (fechar = esconder), ancorada ao ícone.
// Fecha ao perder o foco (light-dismiss do Fluent), com Esc, num novo clique no ícone, ao abrir o
// app, ao trocar de monitor/DPI, ao bloquear a tela ou suspender.
//
// Corrida do clique (§8.1): no Windows o Electron emite `click`/`right-click` no mouse-down. Com o
// painel aberto, clicar no ícone tira o foco do painel (blur → esconde) e logo em seguida chega o
// `click`, que o reabriria. Por isso um esconder causado por blur grava `hiddenAt`, e um clique nos
// 300 ms seguintes é ignorado.

import { release } from 'node:os'
import { app, BrowserWindow, screen, type Rectangle, type WebContents } from 'electron'
import { IPC_EVENTS } from '@shared/api'
import { log } from './logger'
import { devRendererUrl, isAppUrl, preloadPath, rendererTrayPath } from './paths'
import { focusTrayIcon } from './tray'
import { placePanel } from './tray-position'
import { currentResolvedTheme, isQuitting, setQuitting, type ResolvedTheme } from './window'

export const PANEL_SIZE = { width: 360, height: 480 }
/** `surface-raised` dos dois temas: também é o fundo da janela (sem flash ao mostrar). */
const PANEL_BG: Record<ResolvedTheme, string> = { light: '#FFFFFF', dark: '#18191D' }
/** O clique no ícone que acabou de causar o blur não reabre o painel. */
const REOPEN_GUARD_MS = 300
/** Blur logo depois do show (o Explorer ainda processando o clique): devolve o foco ao painel. */
const BLUR_GRACE_MS = 150
/** Depois de cair 2 vezes, o clique no ícone volta a abrir o menu nativo. */
const MAX_CRASHES = 2

let panel: BrowserWindow | null = null
let ready = false
let pendingShow: (() => void) | null = null
let shownAt = 0
let hiddenAt = 0
let crashes = 0
let loadFailed = false

/** Windows 11 desenha cantos, borda e sombra (DWM); nos demais o painel desenha a própria borda. */
function osTag(): 'win11' | 'win10' | 'mac' | 'linux' {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'win32') return Number(release().split('.')[2] ?? 0) >= 22000 ? 'win11' : 'win10'
  return 'linux'
}

/** O painel pode ser usado? (false depois de 2 quedas ou se a página não carregou.) */
export function trayPanelUsable(): boolean {
  return crashes < MAX_CRASHES && !loadFailed
}

function livePanel(): BrowserWindow | null {
  return panel && !panel.isDestroyed() ? panel : null
}

export function isTrayPanelVisible(): boolean {
  return !!livePanel()?.isVisible()
}

/** WebContents do painel (para eventos), ou null se ele não existe. */
export function trayPanelContents(): WebContents | null {
  const w = livePanel()
  return w && !w.webContents.isDestroyed() ? w.webContents : null
}

/** Cria o painel oculto (uma vez). Devolve null se ele não pode ser usado. */
export function createTrayPanel(): BrowserWindow | null {
  const existing = livePanel()
  if (existing) return existing
  if (!trayPanelUsable()) return null

  const w = new BrowserWindow({
    ...PANEL_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    roundedCorners: true, // Windows 11 / macOS: cantos de 8 px (thickFrame no padrão = sombra do DWM)
    title: 'BC Backup — resumo',
    backgroundColor: PANEL_BG[currentResolvedTheme()],
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false,
      devTools: !app.isPackaged
    }
  })
  panel = w
  ready = false
  pendingShow = null
  w.setAlwaysOnTop(true, 'pop-up-menu')
  if (process.platform === 'darwin') {
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  }

  w.once('ready-to-show', () => {
    ready = true
    const show = pendingShow
    pendingShow = null
    show?.()
  })
  w.on('blur', () => {
    if (w.isDestroyed() || !w.isVisible()) return
    if (Date.now() - shownAt < BLUR_GRACE_MS) {
      setTimeout(() => {
        if (!w.isDestroyed() && w.isVisible() && !w.isFocused()) w.focus()
      }, 0)
      return
    }
    hideTrayPanel({ reason: 'blur' })
  })
  // Alt+F4 e afins: só esconde (o painel é reutilizado). Ao sair do app, fecha de verdade.
  w.on('close', (e) => {
    if (isQuitting()) return
    e.preventDefault()
    hideTrayPanel()
  })
  // Nunca bloquear logoff/desligamento do Windows (o 'close' acima seria cancelado).
  w.on('query-session-end', () => setQuitting(true))
  w.on('closed', () => {
    if (panel === w) {
      panel = null
      ready = false
      pendingShow = null
    }
  })

  const wc = w.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  wc.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.on('render-process-gone', (_e, d) => {
    crashes++
    log.error(`Painel da bandeja caiu (${d.reason}); tentativa ${crashes} de ${MAX_CRASHES}.`)
    if (!w.isDestroyed()) w.destroy()
  })
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 = navegação abortada (não é falha)
    loadFailed = true
    log.error(`Painel da bandeja não carregou (${code} ${desc}): ${url}`)
    if (!w.isDestroyed()) w.destroy()
  })
  if (!app.isPackaged) {
    // F12: ferramentas do Chromium em janela separada (360 px não comportam o painel acoplado).
    wc.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown' || input.key !== 'F12') return
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      else wc.openDevTools({ mode: 'detach' })
    })
  }

  const os = osTag()
  const dev = devRendererUrl()
  const load = dev
    ? w.loadURL(new URL(`tray.html?os=${os}`, dev.endsWith('/') ? dev : `${dev}/`).toString())
    : w.loadFile(rendererTrayPath(), { query: { os } })
  load.catch((e: unknown) => log.warn('Falha ao carregar o painel da bandeja', e))
  return w
}

/**
 * Clique no ícone: mostra o painel junto dele (ou esconde, se já está aberto).
 * Devolve false se o painel não pode ser usado — quem chamou mostra o menu nativo.
 */
export function toggleTrayPanel(trayBounds?: Rectangle | null): boolean {
  const w = createTrayPanel()
  if (!w) return false
  if (w.isVisible()) {
    hideTrayPanel()
    return true
  }
  if (Date.now() - hiddenAt < REOPEN_GUARD_MS) return true // este clique foi o que fechou (blur)
  // Posição calculada no clique (o cursor é a âncora quando o ícone está no "^").
  const b = placePanel({
    trayBounds,
    cursor: screen.getCursorScreenPoint(),
    displays: screen.getAllDisplays(),
    size: PANEL_SIZE,
    platform: process.platform
  })
  const show = (): void => {
    if (w.isDestroyed()) return
    w.setBounds(b) // com tamanho (não setPosition): inteiros e sem reescala ao trocar de monitor
    if (process.platform === 'darwin') app.focus({ steal: true })
    w.show()
    w.focus() // o blur só dispara numa janela que recebeu foco (showInactive quebraria o light-dismiss)
    const now = w.getBounds()
    if (now.width !== b.width || now.height !== b.height || now.x !== b.x || now.y !== b.y) w.setBounds(b) // DPI misto
    shownAt = Date.now()
    if (!w.webContents.isDestroyed()) w.webContents.send(IPC_EVENTS.trayShown)
  }
  if (ready && !w.webContents.isLoading()) show()
  else pendingShow = show
  return true
}

/** Esconde o painel. `restoreFocus` devolve o teclado à área de notificação (Esc no Windows). */
export function hideTrayPanel(opts: { restoreFocus?: boolean; reason?: 'blur' } = {}): void {
  pendingShow = null
  const w = livePanel()
  if (!w || !w.isVisible()) return
  w.hide()
  if (opts.reason === 'blur') hiddenAt = Date.now()
  if (opts.restoreFocus) focusTrayIcon()
}

/** Tema efetivo mudou: troca o fundo da janela (o CSS do painel acompanha sozinho). */
export function applyPanelTheme(theme: ResolvedTheme): void {
  livePanel()?.setBackgroundColor(PANEL_BG[theme])
}
