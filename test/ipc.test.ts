// Handlers IPC reais (src/main/ipc.ts) com o electron simulado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/api'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { StoredRoutine } from '../src/main/store'
import { makeRoutine, tempDir } from './helpers'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const openPath = vi.fn(async (_p: string) => '')

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch)
  },
  shell: { openPath: (p: string) => openPath(p), showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: {},
  BrowserWindow: class {},
  app: { isPackaged: false, getAppPath: () => '', getPath: () => '' },
  nativeTheme: {},
  screen: {},
  safeStorage: {}
}))
vi.mock('../src/main/paths', () => ({ isAppUrl: (url: string) => url === 'app://ui' }))

const { registerIpc } = await import('../src/main/ipc')
const event = { senderFrame: { parent: null, url: 'app://ui' } }
const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!(event, ...args)

/** Store mínimo: a gravação do config.json fica "presa" até `release()` (como um disco lento). */
function fakeStore(routines: StoredRoutine[]) {
  const state = new Map<string, { lastAttemptSlot: string | null; lastRunAt: string | null }>()
  let release = () => {}
  const store = {
    settings: DEFAULT_SETTINGS,
    config: { data: { secrets: {} } },
    state: { data: { routines: {}, pausedByTray: undefined as string[] | undefined }, save: async () => {} },
    routines: () => routines,
    getRoutine: (id: string) => routines.find((r) => r.id === id),
    routineState: (id: string) => state.get(id) ?? { lastAttemptSlot: null, lastRunAt: null },
    setRoutineState: (id: string, patch: { lastAttemptSlot?: string | null }) => {
      state.set(id, { lastAttemptSlot: null, lastRunAt: null, ...state.get(id), ...patch })
    },
    async upsertRoutine(r: StoredRoutine) {
      const i = routines.findIndex((x) => x.id === r.id)
      if (i >= 0) routines[i] = r
      else routines.push(r)
      await new Promise<void>((res) => (release = res))
    },
    release: () => release()
  }
  return store
}

function fakeCtx(store: ReturnType<typeof fakeStore>) {
  return {
    store,
    history: { latestByRoutine: () => new Map() },
    runner: { isBusy: () => false },
    scheduler: { nextRuns: () => ({}) },
    routinesChanged: vi.fn(),
    withLastRun: (r: StoredRoutine) => r
  } as never
}

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-ipc-'))
  handlers.clear()
  openPath.mockClear()
})
afterEach(() => cleanup())

describe('agenda alterada: o horário "antigo" nunca é visto pelo agendador com a âncora velha', () => {
  it('routines.save grava lastAttemptSlot ANTES de a rotina nova ficar visível', async () => {
    const old = makeRoutine({
      id: 'r1',
      sources: [{ id: 's', path: join(dir, 'a'), kind: 'folder' }],
      destinations: [{ id: 'd', path: join(dir, 'b') }]
    })
    const store = fakeStore([old])
    registerIpc(fakeCtx(store))
    const input = { ...old, schedule: { ...old.schedule, times: ['09:00'] } }
    const pending = call(IPC_CHANNELS.routinesSave, input)
    // Enquanto o config.json ainda grava, um tick do agendador pode rodar: ele já enxerga a agenda nova…
    await vi.waitFor(() => expect(store.getRoutine('r1')!.schedule.times).toEqual(['09:00']))
    // …então a âncora já precisa ter sido reiniciada.
    expect(store.routineState('r1').lastAttemptSlot).not.toBeNull()
    store.release()
    await pending
  })

  it('routines.setEnabled (retomar) idem', async () => {
    const old = makeRoutine({ id: 'r1', enabled: false })
    const store = fakeStore([old])
    registerIpc(fakeCtx(store))
    const pending = call(IPC_CHANNELS.routinesSetEnabled, 'r1', true)
    await vi.waitFor(() => expect(store.getRoutine('r1')!.enabled).toBe(true))
    expect(store.routineState('r1').lastAttemptSlot).not.toBeNull()
    store.release()
    await pending
  })

  it('routines.duplicate idem', async () => {
    const store = fakeStore([makeRoutine({ id: 'r1' })])
    registerIpc(fakeCtx(store))
    const pending = call(IPC_CHANNELS.routinesDuplicate, 'r1')
    await vi.waitFor(() => expect(store.routines().length).toBe(2))
    expect(store.routineState(store.routines()[1].id).lastAttemptSlot).not.toBeNull()
    store.release()
    await pending
  })
})

describe('app.openPath', () => {
  it('abre pasta; recusa executável (não chega no shell.openPath)', async () => {
    registerIpc(fakeCtx(fakeStore([])))
    await call(IPC_CHANNELS.appOpenPath, dir)
    expect(openPath).toHaveBeenCalledTimes(1)
    await writeFile(join(dir, 'setup.exe'), 'MZ')
    await expect(call(IPC_CHANNELS.appOpenPath, join(dir, 'setup.exe'))).rejects.toThrow(/pastas/)
    expect(openPath).toHaveBeenCalledTimes(1)
  })

  it('remetente que não é a nossa interface é recusado', async () => {
    registerIpc(fakeCtx(fakeStore([])))
    const h = handlers.get(IPC_CHANNELS.appOpenPath)!
    await expect(h({ senderFrame: { parent: null, url: 'https://evil.example' } }, dir)).rejects.toThrow(
      /não autorizado/
    )
    await expect(h({ senderFrame: { parent: {}, url: 'app://ui' } }, dir)).rejects.toThrow(/não autorizado/)
    expect(openPath).not.toHaveBeenCalled()
  })
})

describe('senha SMTP salva não vaza para outro servidor', () => {
  function smtpStore() {
    const store = fakeStore([]) as ReturnType<typeof fakeStore> & Record<string, unknown>
    let secret: string | undefined = 'sealed'
    store.settings = {
      ...DEFAULT_SETTINGS,
      smtp: { ...DEFAULT_SETTINGS.smtp, host: 'smtp.gmail.com', port: 465, user: 'tecnico@gmail.com', hasPassword: true }
    }
    store.config = { data: { secrets: { smtpPassword: secret } } } as never
    store.setSmtpPassword = async (v: string | undefined) => {
      secret = v
      ;(store.config as { data: { secrets: { smtpPassword?: string } } }).data.secrets.smtpPassword = v
    }
    store.updateSettings = async (patch: { smtp?: typeof DEFAULT_SETTINGS.smtp }) => {
      store.settings = { ...store.settings, ...patch }
    }
    return { store, secret: () => secret }
  }
  const ctxWith = (store: ReturnType<typeof fakeStore>, getSmtpPassword = vi.fn(async () => 'segredo')) =>
    ({ ...(fakeCtx(store) as object), settingsChanged: vi.fn(), getSmtpPassword, hostname: 'PC', version: '0.1.0' }) as never

  it('testar com outro host sem digitar a senha é recusado (a senha salva não é usada)', async () => {
    const { store } = smtpStore()
    const getSmtpPassword = vi.fn(async () => 'segredo')
    registerIpc(ctxWith(store, getSmtpPassword))
    const res = (await call(IPC_CHANNELS.settingsTestSmtp, {
      ...store.settings.smtp,
      host: 'smtp.atacante.example',
      to: 'eu@example.com'
    })) as { ok: boolean; message: string }
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/senha novamente/)
    expect(getSmtpPassword).not.toHaveBeenCalled()
  })

  it('salvar com outro usuário sem senha nova apaga a senha antiga', async () => {
    const { store, secret } = smtpStore()
    registerIpc(ctxWith(store))
    await call(IPC_CHANNELS.settingsSaveSmtp, { ...store.settings.smtp, user: 'outro@gmail.com' })
    expect(secret()).toBeUndefined()
    expect(store.settings.smtp.hasPassword).toBe(false)
  })

  it('salvar só o nome do remetente mantém a senha', async () => {
    const { store, secret } = smtpStore()
    registerIpc(ctxWith(store))
    await call(IPC_CHANNELS.settingsSaveSmtp, { ...store.settings.smtp, fromName: 'TecnoSul' })
    expect(secret()).toBe('sealed')
    expect(store.settings.smtp.hasPassword).toBe(true)
  })
})
