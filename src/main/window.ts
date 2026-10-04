// Janela principal (design §6): 1200×780 (mín. 960×640), sem moldura com controles nativos
// (titleBarOverlay no Windows/Linux, hiddenInset no macOS), cor de fundo do tema resolvido,
// lembra tamanho/posição e fecha para a bandeja.

import {
  app,
  BrowserWindow,
  nativeTheme,
  screen,
  shell,
  type BrowserWindowConstructorOptions
} from 'electron'
import { IPC_EVENTS } from '@shared/api'
import type { WindowState } from './store'
import { devRendererUrl, isAppUrl, preloadPath, rendererIndexPath, resourcePath } from './paths'
import { log } from './logger'

export type ResolvedTheme = 'light' | 'dark'

/** Tokens do design (06-identidade-preto-verde §3): bg + text-secondary para os símbolos. */
export const THEME_COLORS: Record<ResolvedTheme, { bg: string; symbol: string }> = {
  light: { bg: '#F8FAF9', symbol: '#46524D' },
  dark: { bg: '#0A0D0C', symbol: '#A3AEA9' }
}

export const TITLEBAR_HEIGHT = 40
const DEFAULT_SIZE = { width: 1200, height: 780 }
const MIN_SIZE = { width: 960, height: 640 }

export interface WindowDeps {
  getState(): WindowState | undefined
  saveState(s: WindowState): void
  closeToTray(): boolean
  /** Chamado quando a janela é escondida para a bandeja pelo botão fechar. */
  onHiddenToTray(): void
}

let win: BrowserWindow | null = null
let deps: WindowDeps | null = null
let quitting = false
let resolved: ResolvedTheme = 'light'
let pendingRoute: string | null = null
let loaded = false

export function setQuitting(v = true): void {
  quitting = v
}

export function isQuitting(): boolean {
  return quitting
}

export function getWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function currentResolvedTheme(): ResolvedTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

export function initWindow(d: WindowDeps): void {
  deps = d
  resolved = currentResolvedTheme()
}

/** Envia um evento para a interface (se a janela existir). */
export function sendToRenderer(channel: string, payload?: unknown): void {
  const w = getWindow()
  if (!w || w.webContents.isDestroyed()) return
  w.webContents.send(channel, payload)
}

function boundsVisible(b: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea
    const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    return ix >= 120 && iy >= 80
  })
}

function persistBounds(): void {
  const w = getWindow()
  if (!w || !deps) return
  const b = w.getNormalBounds()
  deps.saveState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() })
}

export function applyTheme(theme: ResolvedTheme): void {
  resolved = theme
  const w = getWindow()
  if (!w) return
  const c = THEME_COLORS[theme]
  w.setBackgroundColor(c.bg)
  if (process.platform !== 'darwin') {
    try {
      w.setTitleBarOverlay({ color: c.bg, symbolColor: c.symbol, height: TITLEBAR_HEIGHT })
    } catch (e) {
      log.warn('setTitleBarOverlay falhou', e)
    }
  }
}

function createWindow(): BrowserWindow {
  const state = deps?.getState()
  const colors = THEME_COLORS[resolved]
  const opts: BrowserWindowConstructorOptions = {
    width: Math.max(MIN_SIZE.width, state?.width ?? DEFAULT_SIZE.width),
    height: Math.max(MIN_SIZE.height, state?.height ?? DEFAULT_SIZE.height),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'BC Backup',
    backgroundColor: colors.bg,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
      navigateOnDragDrop: false
    }
  }
  if (
    state?.x !== undefined &&
    state.y !== undefined &&
    boundsVisible({ x: state.x, y: state.y, width: opts.width!, height: opts.height! })
  ) {
    opts.x = state.x
    opts.y = state.y
  } else {
    opts.center = true
  }
  if (process.platform === 'darwin') {
    opts.titleBarStyle = 'hiddenInset'
  } else {
    opts.titleBarStyle = 'hidden'
    opts.titleBarOverlay = { color: colors.bg, symbolColor: colors.symbol, height: TITLEBAR_HEIGHT }
    const icon = resourcePath(process.platform === 'win32' ? 'icon.ico' : 'icon.png')
    if (icon) opts.icon = icon
  }

  const w = new BrowserWindow(opts)
  loaded = false

  w.once('ready-to-show', () => {
    // maximize() numa janela oculta a mostra no Windows: só depois de pronta.
    if (state?.maximized) w.maximize()
    w.show()
    if (process.platform === 'darwin') void app.dock?.show()
  })

  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistBounds, 600)
  }
  w.on('resize', scheduleSave)
  w.on('move', scheduleSave)
  w.on('maximize', scheduleSave)
  w.on('unmaximize', scheduleSave)

  w.on('close', (e) => {
    persistBounds()
    if (quitting) return
    if (process.platform === 'darwin' || deps?.closeToTray()) {
      e.preventDefault()
      w.hide()
      if (process.platform === 'darwin') app.dock?.hide()
      deps?.onHiddenToTray()
    } else {
      // "Minimizar para a bandeja ao fechar" desligado: fechar = sair do app.
      quitting = true
      setImmediate(() => app.quit())
    }
  })
  // Nunca bloquear logoff/desligamento do Windows.
  w.on('query-session-end', () => {
    quitting = true
  })
  w.on('closed', () => {
    if (win === w) win = null
  })

  const wc = w.webContents
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  wc.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.on('did-finish-load', () => {
    loaded = true
    applyTheme(currentResolvedTheme())
    const route = pendingRoute
    if (route) {
      pendingRoute = null
      // A interface (React) assina os eventos logo após carregar: envia de novo para garantir.
      setTimeout(() => sendToRenderer(IPC_EVENTS.navigate, route), 300)
      setTimeout(() => sendToRenderer(IPC_EVENTS.navigate, route), 1500)
    }
  })
  wc.on('render-process-gone', (_e, details) => {
    log.error('Processo da interface encerrado', details.reason)
  })
  if (!app.isPackaged) {
    // Atalho de desenvolvimento: F12 abre as ferramentas do Chromium.
    wc.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools()
    })
  }

  const dev = devRendererUrl()
  if (dev) void w.loadURL(dev)
  else void w.loadFile(rendererIndexPath())
  return w
}

/** Mostra (criando se preciso) e foca a janela. */
export function showWindow(): BrowserWindow {
  let w = getWindow()
  if (!w) {
    w = createWindow()
    win = w
    return w
  }
  if (w.isMinimized()) w.restore()
  if (!w.isVisible()) {
    w.show()
    if (process.platform === 'darwin') void app.dock?.show()
  }
  w.focus()
  return w
}

/** Mostra a janela e pede para a interface abrir uma rota (ROUTES.*). */
export function navigate(route: string): void {
  const w = showWindow()
  if (!loaded || w.webContents.isLoading()) pendingRoute = route
  else sendToRenderer(IPC_EVENTS.navigate, route)
}

export function windowAction(action: 'minimize' | 'maximize' | 'close'): void {
  const w = getWindow()
  if (!w) return
  if (action === 'minimize') w.minimize()
  else if (action === 'maximize') {
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  } else w.close()
}

export function isWindowFocused(): boolean {
  const w = getWindow()
  return !!w && w.isVisible() && w.isFocused()
}
