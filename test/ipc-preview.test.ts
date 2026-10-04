// system.previewMove: pastas proibidas para "Mover" (raiz do disco, sistema, perfil) nem são examinadas
// (a prévia abre arquivos em modo exclusivo e mostra nomes — não deve fazer isso fora da pasta do ERP).
import { describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { IPC_CHANNELS } from '@shared/api'
import { DEFAULT_SETTINGS } from '@shared/defaults'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const previewMove = vi.fn(async (sources: string[]) => ({ sources }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch)
  },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: {},
  BrowserWindow: class {},
  app: { isPackaged: false, getAppPath: () => '', getPath: () => '' },
  nativeTheme: {},
  screen: {},
  safeStorage: {}
}))
vi.mock('../src/main/paths', () => ({ isAppUrl: (url: string) => url === 'app://ui' }))
vi.mock('../src/main/engine/move', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  previewMove: (sources: string[]) => previewMove(sources)
}))

const { registerIpc } = await import('../src/main/ipc')
const event = { senderFrame: { parent: null, url: 'app://ui' } }

describe('system.previewMove', () => {
  it('descarta raiz do disco e pasta pessoal; mantém a pasta do ERP', async () => {
    registerIpc({
      store: { settings: DEFAULT_SETTINGS, routines: () => [] },
      info: { dataPath: '/tmp/bc-dados' }
    } as never)
    const erp = '/srv/erp/Backup'
    await handlers.get(IPC_CHANNELS.systemPreviewMove)!(event, ['/', homedir(), erp], undefined, {
      enabled: true,
      minAgeMinutes: 30,
      warnIfEmpty: true
    })
    expect(previewMove).toHaveBeenCalledWith([erp])
  })
})
