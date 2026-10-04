// Revisão (QA #3): ciclo de vida do processo principal (src/main/index.ts) com o electron simulado.
// Segunda instância (duplo clique no atalho, ou o usuário abrindo o app enquanto o início "--hidden"
// do login ainda carrega): a janela não pode abrir antes de os handlers IPC existirem.
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const listeners = new Map<string, (...a: unknown[]) => void>()
  let readyResolve!: () => void
  const ready = new Promise<void>((r) => (readyResolve = r))
  let ctxResolve!: (v: unknown) => void
  const ctxPromise = new Promise((r) => (ctxResolve = r))
  const order: string[] = []
  return { listeners, ready, readyResolve, ctxPromise, ctxResolve, order, isReady: false }
})

vi.mock('electron', () => {
  const emitter = { on: () => {} }
  return {
    app: {
      setPath: () => {},
      getPath: () => '/tmp/bcb-review-index',
      getVersion: () => '0.1.0',
      requestSingleInstanceLock: () => true,
      setAppUserModelId: () => {},
      on: (ev: string, fn: (...a: unknown[]) => void) => h.listeners.set(ev, fn),
      whenReady: () => h.ready,
      isReady: () => h.isReady,
      isPackaged: false,
      quit: () => {},
      exit: () => {},
      dock: { hide: () => {} }
    },
    dialog: { showErrorBox: () => {} },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
    nativeTheme: { on: () => {}, themeSource: 'system' },
    powerMonitor: emitter,
    screen: emitter,
    session: {
      defaultSession: {
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
        setSpellCheckerEnabled: () => {},
        setSpellCheckerLanguages: () => {}
      }
    }
  }
})
vi.mock('../src/main/logger', () => ({
  initLogger: () => {},
  log: { info: () => {}, warn: () => {}, error: () => {}, flush: async () => {} }
}))
vi.mock('../src/main/context', () => ({ createContext: () => h.ctxPromise }))
vi.mock('../src/main/ipc', () => ({ registerIpc: () => h.order.push('registerIpc') }))
vi.mock('../src/main/window', () => ({
  applyTheme: () => {},
  currentResolvedTheme: () => 'light',
  initWindow: () => {},
  navigate: () => {},
  setQuitting: () => {},
  showWindow: () => h.order.push('showWindow')
}))
vi.mock('../src/main/tray', () => ({
  createTray: () => {},
  destroyTray: () => {},
  TRAY_USES_PANEL: false,
  trayIconBounds: () => null
}))
vi.mock('../src/main/tray-panel', () => ({
  applyPanelTheme: () => {},
  createTrayPanel: () => {},
  hideTrayPanel: () => {},
  toggleTrayPanel: () => true
}))
vi.mock('../src/main/autostart', () => ({
  HIDDEN_FLAG: '--hidden',
  setAutoStart: async () => {},
  startedHidden: () => true // início pela inicialização do sistema
}))
vi.mock('../src/main/app-actions', () => ({
  confirmQuit: async () => {},
  openMain: () => {},
  setAllEnabled: async () => {}
}))
vi.mock('../src/main/notify', () => ({ showNotification: () => {} }))
vi.mock('../src/main/broadcast', () => ({ broadcast: () => {} }))
vi.mock('../src/main/paths', () => ({ isAppUrl: () => true }))

await import('../src/main/index')

describe('segunda instância durante o início', () => {
  it('a janela só abre depois do IPC registrado (e abre, mesmo com o início "--hidden")', async () => {
    h.isReady = true
    h.readyResolve()
    await new Promise((r) => setTimeout(r, 10))
    // O contexto (config, histórico) ainda está carregando — disco lento no login.
    h.listeners.get('second-instance')!({}, ['bc-backup.exe'])
    expect(h.order).toEqual([])
    h.ctxResolve({
      store: { settings: { theme: 'system', launchAtLogin: false, historyDays: 180 }, state: { data: {} } },
      history: { prune: async () => 0 },
      scheduler: { start: () => {}, tick: () => {} },
      outbox: null,
      runner: {},
      refreshTray: () => {}
    })
    await vi.waitFor(() => expect(h.order).toContain('showWindow'))
    expect(h.order).toEqual(['registerIpc', 'showWindow'])
  })
})
