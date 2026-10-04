// Revisão (QA #3): handlers IPC reais (src/main/ipc.ts) com o electron simulado e o AppStore de verdade.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS } from '@shared/api'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { buildExport } from '../src/main/config-io'
import { AppStore, migrateRoutine, type StoredRoutine } from '../src/main/store'
import { makeRoutine, tempDir } from './helpers'

const handlers = new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown>>()
const dialogs = vi.hoisted(() => ({ openPath: '' }))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(ch, fn),
    removeHandler: (ch: string) => handlers.delete(ch)
  },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn(), openExternal: vi.fn() },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [dialogs.openPath] }),
    showSaveDialog: async () => ({ canceled: true })
  },
  BrowserWindow: class {},
  app: { isPackaged: false, getAppPath: () => '', getPath: () => '' },
  nativeTheme: {},
  screen: {},
  safeStorage: {}
}))
vi.mock('../src/main/paths', () => ({ isAppUrl: (url: string) => url === 'app://ui' }))
vi.mock('../src/main/window', () => ({ getWindow: () => null, applyTheme: () => {}, windowAction: () => {} }))
vi.mock('../src/main/tray-panel', () => ({ hideTrayPanel: () => {} }))

const { registerIpc } = await import('../src/main/ipc')
const event = { senderFrame: { parent: null, url: 'app://ui' } }
const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!(event, ...args)

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-review-ipc-'))
  handlers.clear()
})
afterEach(() => cleanup())

function ctxFor(store: AppStore) {
  return {
    store,
    history: { latestByRoutine: () => new Map() },
    runner: { isBusy: () => false, dropQueued: async () => false },
    scheduler: { nextRuns: () => ({}) },
    info: { dataPath: join(dir, 'dados') },
    version: '0.1.0',
    hostname: 'PC',
    routinesChanged: vi.fn(),
    settingsChanged: vi.fn(async () => {}),
    withLastRun: (r: StoredRoutine) => r
  } as never
}

async function storeWithSavedPassword(): Promise<AppStore> {
  const store = await AppStore.open(dir)
  await store.updateSettings({
    smtp: {
      ...DEFAULT_SETTINGS.smtp,
      host: 'smtp.gmail.com',
      port: 465,
      security: 'ssl',
      user: 'tecnico@gmail.com',
      fromEmail: 'tecnico@gmail.com',
      hasPassword: true
    }
  })
  await store.setSmtpPassword('a1:senha-cifrada')
  return store
}

async function exportFileWithSmtp(smtp: Partial<typeof DEFAULT_SETTINGS.smtp>): Promise<string> {
  const settings = { ...DEFAULT_SETTINGS, smtp: { ...DEFAULT_SETTINGS.smtp, ...smtp } }
  const file = join(dir, 'exportado.json')
  await writeFile(file, JSON.stringify(buildExport(settings, [], '0.1.0')))
  return file
}

describe('importar configurações: a senha SMTP salva não vai para outro servidor', () => {
  it('arquivo com outro servidor/usuário → a senha salva é descartada', async () => {
    const store = await storeWithSavedPassword()
    registerIpc(ctxFor(store))
    dialogs.openPath = await exportFileWithSmtp({
      host: 'smtp.outro-provedor.example',
      port: 587,
      user: 'alguem@outro.example',
      fromEmail: 'alguem@outro.example'
    })
    const res = (await call(IPC_CHANNELS.settingsImport)) as { ok: boolean }
    expect(res.ok).toBe(true)
    expect(store.settings.smtp.host).toBe('smtp.outro-provedor.example')
    expect(store.config.data.secrets.smtpPassword).toBeUndefined()
    expect(store.settings.smtp.hasPassword).toBe(false)
  })

  it('arquivo com o mesmo servidor e usuário → a senha salva continua', async () => {
    const store = await storeWithSavedPassword()
    registerIpc(ctxFor(store))
    dialogs.openPath = await exportFileWithSmtp({
      host: 'smtp.gmail.com',
      port: 465,
      security: 'ssl',
      user: 'tecnico@gmail.com',
      fromEmail: 'tecnico@gmail.com',
      fromName: 'Outro nome'
    })
    await call(IPC_CHANNELS.settingsImport)
    expect(store.config.data.secrets.smtpPassword).toBe('a1:senha-cifrada')
    expect(store.settings.smtp.hasPassword).toBe(true)
    expect(store.settings.smtp.fromName).toBe('Outro nome')
  })
})

describe('duplicar rotina com nome longo', () => {
  it('a cópia nunca fica com o mesmo nome da original (limite de 60 caracteres)', async () => {
    const store = await AppStore.open(dir)
    const name = 'Backup diário do servidor de arquivos da contabilidade - SP1'.padEnd(60, 'x')
    expect(name.length).toBe(60)
    await store.upsertRoutine(
      makeRoutine({
        id: 'r1',
        name,
        sources: [{ id: 's', path: join(dir, 'origem'), kind: 'folder' }],
        destinations: [{ id: 'd', path: join(dir, 'destino') }]
      })
    )
    registerIpc(ctxFor(store))
    const copy1 = (await call(IPC_CHANNELS.routinesDuplicate, 'r1')) as StoredRoutine
    const copy2 = (await call(IPC_CHANNELS.routinesDuplicate, 'r1')) as StoredRoutine
    const names = store.routines().map((r) => r.name.toLocaleLowerCase('pt-BR'))
    expect(new Set(names).size).toBe(3)
    for (const c of [copy1, copy2]) {
      expect(c.name.length).toBeLessThanOrEqual(60)
      expect(c.name).toMatch(/\(cópia( \d+)?\)$/)
    }
    // E a cópia pode ser salva de novo pelo editor (o nome não colide com a original).
    await expect(call(IPC_CHANNELS.routinesSave, { ...copy1, description: 'editada' })).resolves.toBeTruthy()
  })

  it('nome curto continua "X (cópia)", "X (cópia 2)"…', async () => {
    const store = await AppStore.open(dir)
    await store.upsertRoutine(migrateRoutine({ ...makeRoutine({ id: 'r1', name: 'Docs' }) }))
    registerIpc(ctxFor(store))
    const a = (await call(IPC_CHANNELS.routinesDuplicate, 'r1')) as StoredRoutine
    const b = (await call(IPC_CHANNELS.routinesDuplicate, 'r1')) as StoredRoutine
    expect([a.name, b.name]).toEqual(['Docs (cópia)', 'Docs (cópia 2)'])
  })
})

describe('mensagens de exportar/importar em pt-BR (singular/plural)', () => {
  it('importar 1 rotina com "Mover" ligado', async () => {
    const store = await AppStore.open(dir)
    registerIpc(ctxFor(store))
    const routine = makeRoutine({
      id: 'x',
      name: 'ERP',
      moveSources: { enabled: true, minAgeMinutes: 30, warnIfEmpty: true }
    })
    const file = join(dir, 'uma.json')
    await writeFile(file, JSON.stringify(buildExport(DEFAULT_SETTINGS, [routine], '0.1.0')))
    dialogs.openPath = file
    const res = (await call(IPC_CHANNELS.settingsImport)) as { ok: boolean; message: string }
    expect(res.ok).toBe(true)
    expect(res.message).not.toMatch(/\(s\)/)
    expect(res.message).toContain('1 rotina')
    expect(res.message).toContain('"Mover" foi desligado em 1 rotina:')
  })
})

describe('"Retomar" da bandeja respeita a rotina retomada pelo editor e pausada de novo à parte', () => {
  it('salvar no editor com a rotina ativa tira ela da lista "pausadas pela bandeja"', async () => {
    const store = await AppStore.open(dir)
    const r = makeRoutine({
      id: 'r1',
      name: 'ERP',
      enabled: false,
      sources: [{ id: 's', path: join(dir, 'origem'), kind: 'folder' }],
      destinations: [{ id: 'd', path: join(dir, 'destino') }]
    })
    await store.upsertRoutine(r)
    store.state.data.pausedByTray = ['r1'] // pausada por "Pausar todas"
    registerIpc(ctxFor(store))
    await call(IPC_CHANNELS.routinesSave, { ...r, enabled: true }) // retomada pelo editor
    await call(IPC_CHANNELS.routinesSetEnabled, 'r1', false) // pausada à parte pelo usuário
    expect(store.state.data.pausedByTray ?? []).not.toContain('r1')
  })
})
