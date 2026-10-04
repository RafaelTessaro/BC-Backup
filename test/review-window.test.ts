// Revisão (QA #3): janela principal (src/main/window.ts) com o BrowserWindow simulado.
// A interface caiu (falta de memória, GPU, bug): a janela não pode ficar em branco para sempre — fechar
// para a bandeja e abrir de novo mostrava a MESMA janela morta até sair do app.
import { describe, expect, it, vi } from 'vitest'

type Handler = (...a: unknown[]) => void

const h = vi.hoisted(() => ({ windows: [] as FakeWin[] }))

class FakeEmitter {
  handlers = new Map<string, Handler[]>()
  on(ev: string, fn: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn])
    return this
  }
  once(ev: string, fn: Handler) {
    return this.on(ev, fn)
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of this.handlers.get(ev) ?? []) fn(...a)
  }
}

class FakeWin extends FakeEmitter {
  destroyed = false
  visible = false
  webContents = Object.assign(new FakeEmitter(), {
    isDestroyed: () => this.destroyed,
    isLoading: () => false,
    send: () => {},
    setWindowOpenHandler: () => {},
    reload: vi.fn()
  })
  constructor() {
    super()
    h.windows.push(this)
  }
  isDestroyed = () => this.destroyed
  destroy = () => {
    this.destroyed = true
    this.emit('closed')
  }
  isVisible = () => this.visible
  isMinimized = () => false
  show = () => {
    this.visible = true
  }
  hide = () => {
    this.visible = false
  }
  focus = () => {}
  restore = () => {}
  loadURL = async () => {}
  loadFile = async () => {}
  setBackgroundColor = () => {}
  setTitleBarOverlay = () => {}
  getNormalBounds = () => ({ x: 0, y: 0, width: 1200, height: 780 })
  isMaximized = () => false
}

vi.mock('electron', () => ({
  app: { isPackaged: true, quit: () => {}, dock: undefined },
  BrowserWindow: FakeWin,
  nativeTheme: { shouldUseDarkColors: false },
  screen: { getAllDisplays: () => [] },
  shell: { openExternal: async () => {} }
}))
vi.mock('../src/main/paths', () => ({
  devRendererUrl: () => null,
  isAppUrl: () => true,
  preloadPath: () => '',
  rendererIndexPath: () => '',
  resourcePath: () => null
}))
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, flush: async () => {} }
}))

const { getWindow, initWindow, showWindow } = await import('../src/main/window')

describe('interface da janela principal caiu', () => {
  it('a janela é recriada (não fica em branco para sempre)', () => {
    initWindow({
      getState: () => undefined,
      saveState: () => {},
      closeToTray: () => true,
      onHiddenToTray: () => {}
    })
    const first = showWindow() as unknown as FakeWin
    first.show()
    first.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    // Ao abrir de novo (agora ou pelo ícone da bandeja), é uma interface nova — ou a mesma recarregada.
    const again = showWindow() as unknown as FakeWin
    expect(again !== first || first.webContents.reload.mock.calls.length > 0).toBe(true)
    expect(getWindow()).not.toBeNull()
  })

  it('saída normal do processo (clean-exit) não recria nada', () => {
    const w = getWindow() as unknown as FakeWin
    const count = h.windows.length
    w.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 })
    expect(h.windows.length).toBe(count)
    expect(w.webContents.reload).not.toHaveBeenCalled()
  })

  it('caiu de novo logo depois: descarta a janela (sem laço de recargas) e a próxima abertura cria outra', () => {
    const w = getWindow() as unknown as FakeWin
    w.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(w.destroyed).toBe(true)
    const fresh = showWindow() as unknown as FakeWin
    expect(fresh).not.toBe(w)
    expect(fresh.destroyed).toBe(false)
  })
})
