// Revisão (QA #3): modelo da bandeja montado em src/main/context.ts (textos pt-BR).
import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunRecord } from '@shared/types'
import type { TrayModel } from '../src/main/tray'
import { makeRoutine } from './helpers'

const h = vi.hoisted(() => ({ models: [] as TrayModel[], dir: '' }))
h.dir = mkdtempSync(join(tmpdir(), 'bcb-review-ctx-'))
afterAll(() => rmSync(h.dir, { recursive: true, force: true }))

vi.mock('electron', () => ({
  app: { getPath: () => h.dir, getVersion: () => '0.1.0', isPackaged: false },
  nativeTheme: { themeSource: 'system' },
  powerSaveBlocker: { start: () => 1, isStarted: () => false, stop: () => {} },
  Notification: { isSupported: () => false },
  safeStorage: { getSelectedStorageBackend: () => 'dpapi' }
}))
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, flush: async () => {} }
}))
vi.mock('../src/main/engine-host', () => ({
  // Backup que fica rodando (o teste só olha a bandeja durante a execução).
  startEngineJob: () => ({ result: new Promise(() => {}), cancel: () => {} })
}))
vi.mock('../src/main/tray', () => ({ updateTray: (m: TrayModel) => h.models.push(m) }))
vi.mock('../src/main/tray-panel', () => ({ applyPanelTheme: () => {} }))
vi.mock('../src/main/broadcast', () => ({ broadcast: () => {} }))
vi.mock('../src/main/autostart', () => ({ setAutoStart: async () => {}, startedHidden: () => false }))
vi.mock('../src/main/window', () => ({
  applyTheme: () => {},
  currentResolvedTheme: () => 'light',
  isWindowFocused: () => true,
  navigate: () => {}
}))

const { createContext } = await import('../src/main/context')

const failedRun = (routineId: string, id: string): RunRecord => ({
  id,
  routineId,
  routineName: routineId,
  status: 'failed',
  trigger: 'schedule',
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  finishedAt: new Date(Date.now() - 3_500_000).toISOString(),
  filesTotal: 0,
  filesCopied: 0,
  filesSkipped: 0,
  bytesTotal: 0,
  bytesCopied: 0,
  warnings: 0,
  errors: 1,
  destinationCount: 1,
  destinations: [],
  log: []
})

describe('bandeja: linha de rotinas com falha durante uma execução', () => {
  it('singular/plural em pt-BR (sem "rotina(s)")', async () => {
    const ctx = await createContext()
    for (const id of ['a', 'b', 'c'])
      await ctx.store.upsertRoutine(makeRoutine({ id, name: id.toUpperCase() }))
    await ctx.history.add(failedRun('a', 'run-a'))
    ctx.runner.enqueue('c', 'manual')
    await vi.waitFor(() => expect(ctx.runner.liveProgress).not.toBeNull())
    ctx.refreshTray()
    const lines = h.models.at(-1)!.statusLines
    expect(lines.join(' | ')).not.toMatch(/\(s\)/)
    expect(lines).toContain('1 rotina com falha')
    await ctx.history.add(failedRun('b', 'run-b'))
    ctx.refreshTray()
    expect(h.models.at(-1)!.statusLines).toContain('2 rotinas com falha')
    ctx.scheduler.stop()
  })
})

describe('state.json perdido (corrompido/apagado)', () => {
  it('a última execução do histórico serve de âncora: não "recupera" um horário que já rodou', async () => {
    const ctx = await createContext()
    const now = Date.now()
    const slot = new Date(now - 60 * 60_000)
    const hhmm = `${String(slot.getHours()).padStart(2, '0')}:${String(slot.getMinutes()).padStart(2, '0')}`
    const r = makeRoutine({
      id: 'diaria',
      name: 'Diária',
      createdAt: new Date(now - 30 * 86_400_000).toISOString(),
      schedule: { ...makeRoutine().schedule, kind: 'daily', times: [hhmm], catchUpMissed: true }
    })
    await ctx.store.upsertRoutine(r)
    // Rodou no horário (há 59 min) — mas o estado com o "último horário tratado" se perdeu.
    await ctx.history.add({
      ...failedRun('diaria', 'run-diaria'),
      status: 'success',
      errors: 0,
      startedAt: new Date(slot.getTime() + 60_000).toISOString(),
      finishedAt: new Date(slot.getTime() + 120_000).toISOString()
    })
    expect(ctx.store.routineState('diaria').lastAttemptSlot).toBeNull()
    ctx.scheduler.start()
    const next = Date.parse(ctx.scheduler.nextRuns().diaria!)
    ctx.scheduler.stop()
    // Sem recuperação marcada para daqui a ~3 min: o próximo é o horário de amanhã.
    expect(next - now).toBeGreaterThan(60 * 60_000)
  })
})
