// Ajustes do líder após a revisão (QA #3 listou como "decisão de produto"):
// 1) cancelada não esconde a falha anterior; 2) pausar tira da fila; 3) "Ao ligar o computador" só
// quando o app iniciou com o sistema.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunRecord, RunSummary, Schedule } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { JobResult } from '../src/main/engine/types'
import { HistoryStore } from '../src/main/history'
import { Scheduler, type SchedRoutine } from '../src/main/scheduler'
import { makeRoutine, tempDir } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bcb-lead-fixes' },
  powerSaveBlocker: { start: () => 1, isStarted: () => false, stop: () => {} }
}))
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, flush: async () => {} }
}))
vi.mock('../src/main/engine-host', () => ({
  // Motor que nunca termina: a 1ª execução fica "rodando" e as demais esperam na fila.
  startEngineJob: () => ({ result: new Promise<JobResult>(() => {}), cancel: () => {} })
}))

function rec(id: string, minutesAgo: number, status: RunRecord['status']): RunRecord {
  const startedAt = new Date(Date.now() - minutesAgo * 60_000)
  return {
    id,
    routineId: 'rot-1',
    routineName: 'Financeiro',
    status,
    trigger: 'schedule',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + 60_000).toISOString(),
    durationMs: 60_000,
    filesTotal: 1,
    filesCopied: 1,
    filesSkipped: 0,
    bytesTotal: 1,
    bytesCopied: 1,
    warnings: 0,
    errors: 0,
    destinationCount: 1,
    destinations: [],
    log: []
  }
}

describe('último resultado da rotina', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-lead-'))
  })
  afterEach(() => cleanup())

  it('uma execução cancelada não esconde a falha anterior', async () => {
    const h = await HistoryStore.open(dir, 180)
    await h.add(rec('falhou', 60, 'failed'))
    await h.add(rec('parada', 10, 'cancelled'))
    expect(h.latestByRoutine().get('rot-1')?.id).toBe('parada') // âncora do agendador continua igual
    expect(h.latestOutcomeByRoutine().get('rot-1')?.status).toBe('failed')
  })

  it('cancelada depois de um sucesso → sucesso; só canceladas → a mais recente', async () => {
    const h = await HistoryStore.open(dir, 180)
    await h.add(rec('ok', 60, 'success'))
    await h.add(rec('parada', 10, 'cancelled'))
    expect(h.latestOutcomeByRoutine().get('rot-1')?.id).toBe('ok')
    const other = await tempDir('bcb-lead-b-')
    const h2 = await HistoryStore.open(other.dir, 180)
    await h2.add(rec('c1', 30, 'cancelled'))
    await h2.add(rec('c2', 5, 'cancelled'))
    expect(h2.latestOutcomeByRoutine().get('rot-1')?.id).toBe('c2')
    await other.cleanup()
  })
})

describe('pausar tira da fila o que ainda não começou', () => {
  it('a execução na fila vira "cancelada"; a que está rodando continua', async () => {
    const { RunManager } = await import('../src/main/runner')
    const a = makeRoutine({ id: 'a', name: 'Rodando' })
    const b = makeRoutine({ id: 'b', name: 'Na fila' })
    const records: RunRecord[] = []
    const runner = new RunManager({
      store: {
        settings: DEFAULT_SETTINGS,
        getRoutine: (id: string) => [a, b].find((r) => r.id === id),
        setRoutineState: () => {}
      } as never,
      history: { add: async (r: RunRecord) => void records.push(structuredClone(r)) } as never,
      outbox: () => null,
      nextRunFor: () => null,
      getSmtpPassword: async () => '',
      info: { version: '0.1.0', hostname: 'pc' },
      emitProgress: () => {},
      onFinished: (_s: RunSummary) => {},
      onQueueChange: () => {}
    })
    runner.enqueue('a', 'schedule')
    await vi.waitFor(() => expect(runner.liveProgress?.routineId).toBe('a'))
    runner.enqueue('b', 'schedule')
    expect(await runner.dropQueued('a')).toBe(false) // rodando: pausar não interrompe
    expect(await runner.dropQueued('b')).toBe(true)
    expect(records.map((r) => [r.routineId, r.status])).toEqual([['b', 'cancelled']])
    expect(await runner.dropQueued('b')).toBe(false) // nada mais na fila
  })
})

describe('"Ao ligar o computador"', () => {
  const startup: Schedule = {
    kind: 'startup',
    times: [],
    weekdays: [],
    intervalMinutes: 60,
    window: null,
    startupDelayMinutes: 1,
    catchUpMissed: false
  }
  const r: SchedRoutine = {
    id: 'boot',
    name: 'Ao ligar',
    enabled: true,
    schedule: startup,
    createdAt: '2026-01-01T00:00:00.000Z'
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function run(systemStart: boolean): string[] {
    const runs: string[] = []
    const s = new Scheduler({
      routines: () => [r],
      getLastAttempt: () => null,
      setLastAttempt: () => {},
      enqueue: (id, t) => runs.push(`${id}:${t}`),
      isSystemStart: () => systemStart
    })
    s.start()
    vi.advanceTimersByTime(2 * 60_000)
    s.stop()
    return runs
  }

  it('roda quando o app iniciou com o sistema', () => {
    expect(run(true)).toEqual(['boot:startup'])
  })

  it('não roda quando o usuário abre o app no meio do dia', () => {
    expect(run(false)).toEqual([])
  })
})
