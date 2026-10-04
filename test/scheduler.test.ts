import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunTrigger, Schedule } from '@shared/types'
import { Scheduler, decideSlot, type SchedRoutine } from '../src/main/scheduler'
import { RunQueue } from '../src/main/run-queue'

const daily2am: Schedule = {
  kind: 'daily',
  times: ['02:00'],
  weekdays: [],
  intervalMinutes: 60,
  window: null,
  startupDelayMinutes: 5,
  catchUpMissed: true
}
const routine = (patch: Partial<SchedRoutine> = {}): SchedRoutine => ({
  id: 'r1',
  name: 'Rotina',
  enabled: true,
  schedule: daily2am,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...patch
})

describe('decideSlot (puro)', () => {
  const at = (h: number, m = 0, day = 4) => new Date(2026, 9, day, h, m)
  it('no horário (≤ 2 min de atraso) → run', () => {
    expect(decideSlot(routine(), null, at(2, 1))).toEqual({ kind: 'run', slot: at(2) })
  })
  it('atrasado com recuperação → catch-up; sem → missed', () => {
    expect(decideSlot(routine(), null, at(9))).toEqual({ kind: 'catch-up', slot: at(2) })
    expect(decideSlot(routine({ schedule: { ...daily2am, catchUpMissed: false } }), null, at(9)).kind).toBe(
      'missed'
    )
  })
  it('horário já tratado → none', () => {
    expect(decideSlot(routine(), at(2).toISOString(), at(9)).kind).toBe('none')
  })
  it('rotina nova não dispara horários anteriores à criação', () => {
    expect(decideSlot(routine({ createdAt: at(3).toISOString() }), null, at(9)).kind).toBe('none')
  })
  it('pausada, manual e startup → none', () => {
    expect(decideSlot(routine({ enabled: false }), null, at(2)).kind).toBe('none')
    expect(decideSlot(routine({ schedule: { ...daily2am, kind: 'manual' } }), null, at(2)).kind).toBe('none')
    expect(decideSlot(routine({ schedule: { ...daily2am, kind: 'startup' } }), null, at(2)).kind).toBe('none')
  })
})

describe('Scheduler (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function setup(routines: SchedRoutine[], slots = new Map<string, string>()) {
    const runs: string[] = []
    const missed: string[] = []
    const s = new Scheduler({
      routines: () => routines,
      getLastAttempt: (id) => slots.get(id) ?? null,
      setLastAttempt: (id, iso) => slots.set(id, iso),
      enqueue: (id, t: RunTrigger) => runs.push(`${id}:${t}`),
      onMissed: (r) => missed.push(r.id)
    })
    return { s, runs, missed, slots }
  }

  it('3 dias desligado → UMA recuperação ~3 min depois; depois o próximo horário no tempo certo', async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 9, 0))
    const { s, runs, slots } = setup([routine()], new Map([['r1', new Date(2026, 9, 1, 2, 0).toISOString()]]))
    s.start()
    expect(slots.get('r1')).toBe(new Date(2026, 9, 4, 2, 0).toISOString()) // consumido antes de executar
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(runs).toEqual([])
    expect(s.nextRuns().r1).toBe(new Date(2026, 9, 4, 9, 3).toISOString())
    await vi.advanceTimersByTimeAsync(60_000 + 10)
    expect(runs).toEqual(['r1:catch-up'])
    await vi.advanceTimersByTimeAsync(17 * 3_600_000) // → 05/10 02:03
    expect(runs).toEqual(['r1:catch-up', 'r1:schedule'])
    s.stop()
  })

  it('tick a cada ≤ 30 s: dispara no horário mesmo sem resume', async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 1, 59, 0))
    const { s, runs } = setup([routine()])
    s.start()
    await vi.advanceTimersByTimeAsync(70_000)
    expect(runs).toEqual(['r1:schedule'])
    // Não repete o mesmo horário.
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(runs).toEqual(['r1:schedule'])
    s.stop()
  })

  it('sem recuperação → registra como perdido e não executa', async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 9, 0))
    const { s, runs, missed } = setup(
      [routine({ schedule: { ...daily2am, catchUpMissed: false } })],
      new Map([['r1', '2026-09-30T00:00:00.000Z']])
    )
    s.start()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(runs).toEqual([])
    expect(missed).toEqual(['r1'])
    s.stop()
  })

  it('pausada nunca roda pelo agendador; recuperação pendente é descartada ao pausar', async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 9, 0))
    const list = [routine()]
    const { s, runs } = setup(list, new Map([['r1', '2026-09-30T00:00:00.000Z']]))
    s.start()
    list[0] = { ...list[0], enabled: false }
    s.tick()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(runs).toEqual([])
    expect(s.nextRuns().r1).toBeNull()
    s.stop()
  })

  it('"ao iniciar" roda uma vez após o atraso', async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 9, 0))
    const { s, runs } = setup([
      routine({ schedule: { ...daily2am, kind: 'startup', startupDelayMinutes: 5 } })
    ])
    s.start()
    expect(s.nextRuns().r1).toBe(new Date(2026, 9, 4, 9, 5).toISOString())
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(runs).toEqual([])
    await vi.advanceTimersByTimeAsync(60_000 + 10)
    expect(runs).toEqual(['r1:startup'])
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(runs).toEqual(['r1:startup'])
    expect(s.nextRuns().r1).toBeNull()
    s.stop()
  })

  it('nextRuns para diário e manual', () => {
    vi.setSystemTime(new Date(2026, 9, 4, 9, 0))
    const { s } = setup([routine(), routine({ id: 'm', schedule: { ...daily2am, kind: 'manual' } })])
    expect(s.nextRuns()).toEqual({ r1: new Date(2026, 9, 5, 2, 0).toISOString(), m: null })
  })
})

describe('RunQueue', () => {
  it('no máximo 1 por vez, sem repetir a mesma rotina; cancela da fila', async () => {
    const order: string[] = []
    const releases: Array<() => void> = []
    const q = new RunQueue(
      (item) =>
        new Promise<void>((resolve) => {
          order.push(`start:${item.routineId}`)
          releases.push(() => {
            order.push(`end:${item.routineId}`)
            resolve()
          })
        })
    )
    const a = q.enqueue('a', 'A', 'manual')
    expect(a.added).toBe(true)
    expect(q.enqueue('a', 'A', 'schedule')).toEqual({ runId: a.runId, added: false })
    q.enqueue('b', 'B', 'schedule')
    const c = q.enqueue('c', 'C', 'schedule')
    await Promise.resolve()
    expect(q.running?.routineId).toBe('a')
    expect(q.queued.map((x) => x.routineId)).toEqual(['b', 'c'])
    expect(q.cancel(c.runId)?.state).toBe('queued')
    releases.shift()!()
    await vi.waitFor(() => expect(q.running?.routineId).toBe('b'))
    releases.shift()!()
    await q.idle()
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    expect(q.running).toBeNull()
  })

  it('cancelar a execução em andamento aborta o sinal', async () => {
    let aborted = false
    const q = new RunQueue(
      (_item, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true
            resolve()
          })
        })
    )
    q.enqueue('a', 'A', 'manual')
    await Promise.resolve()
    expect(q.cancel('a')?.state).toBe('running')
    await q.idle()
    expect(aborted).toBe(true)
    // Depois de terminar, pode enfileirar de novo.
    expect(q.cancel('a')).toBeNull()
  })
})
