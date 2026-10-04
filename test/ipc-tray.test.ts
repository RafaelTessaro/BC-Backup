// Handlers IPC do painel da bandeja (tray.*) com o electron e as ações do app simulados.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '@shared/api'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const actions = {
  openMain: vi.fn((_route?: string) => {}),
  setAllEnabled: vi.fn(async (_enabled: boolean) => {}),
  confirmQuit: vi.fn(async () => {}),
  hideTrayPanel: vi.fn((_opts: unknown) => {})
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch)
  },
  shell: {},
  dialog: {},
  BrowserWindow: class {},
  app: { isPackaged: false, getAppPath: () => '', getPath: () => '' },
  nativeTheme: {},
  screen: {},
  safeStorage: {}
}))
vi.mock('../src/main/paths', () => ({ isAppUrl: (url: string) => url === 'app://ui' }))
vi.mock('../src/main/app-actions', () => ({
  openMain: (route?: string) => actions.openMain(route),
  setAllEnabled: (_c: unknown, enabled: boolean) => actions.setAllEnabled(enabled),
  confirmQuit: () => actions.confirmQuit()
}))
vi.mock('../src/main/tray-panel', () => ({
  hideTrayPanel: (o: unknown) => actions.hideTrayPanel(o)
}))

const { registerIpc } = await import('../src/main/ipc')
const fromUi = { senderFrame: { parent: null, url: 'app://ui' } }
const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!(fromUi, ...args)

beforeEach(() => {
  handlers.clear()
  for (const f of Object.values(actions)) f.mockClear()
  registerIpc({ store: {}, history: {}, runner: {}, scheduler: {} } as never)
})

describe('tray.* (painel da bandeja)', () => {
  it('openMain: sem rota abre o Painel; com rota, só rotas da interface', async () => {
    await call(IPC_CHANNELS.trayOpenMain)
    expect(actions.openMain).toHaveBeenLastCalledWith(undefined)
    await call(IPC_CHANNELS.trayOpenMain, '/historico/run-1')
    expect(actions.openMain).toHaveBeenLastCalledWith('/historico/run-1')
    await expect(call(IPC_CHANNELS.trayOpenMain, 'https://exemplo.com')).rejects.toThrow(/rota/)
    await expect(call(IPC_CHANNELS.trayOpenMain, `/${'x'.repeat(300)}`)).rejects.toThrow(/rota/)
    await expect(call(IPC_CHANNELS.trayOpenMain, 42)).rejects.toThrow(/rota/)
    expect(actions.openMain).toHaveBeenCalledTimes(2)
  })

  it('hide: restoreFocus só quando pedido', async () => {
    await call(IPC_CHANNELS.trayHide)
    expect(actions.hideTrayPanel).toHaveBeenLastCalledWith({ restoreFocus: false })
    await call(IPC_CHANNELS.trayHide, { restoreFocus: true })
    expect(actions.hideTrayPanel).toHaveBeenLastCalledWith({ restoreFocus: true })
    await expect(call(IPC_CHANNELS.trayHide, 'sim')).rejects.toThrow(/opções/)
  })

  it('setAllPaused: pausar = desativar todas; exige booleano', async () => {
    await call(IPC_CHANNELS.traySetAllPaused, true)
    expect(actions.setAllEnabled).toHaveBeenLastCalledWith(false)
    await call(IPC_CHANNELS.traySetAllPaused, false)
    expect(actions.setAllEnabled).toHaveBeenLastCalledWith(true)
    await expect(call(IPC_CHANNELS.traySetAllPaused, 'true')).rejects.toThrow(/pausar/)
  })

  it('quit pede confirmação; remetente desconhecido é recusado', async () => {
    await call(IPC_CHANNELS.trayQuit)
    expect(actions.confirmQuit).toHaveBeenCalledTimes(1)
    const evil = { senderFrame: { parent: null, url: 'https://malicioso.example' } }
    await expect(handlers.get(IPC_CHANNELS.trayQuit)!(evil)).rejects.toThrow(/não autorizado/)
    expect(actions.confirmQuit).toHaveBeenCalledTimes(1)
  })
})
