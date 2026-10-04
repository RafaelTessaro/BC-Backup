// Revisão (QA #3): agendador (src/main/scheduler.ts) com relógio simulado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunTrigger, Schedule } from '@shared/types'
import { Scheduler, type SchedRoutine } from '../src/main/scheduler'

const daily2am: Schedule = {
  kind: 'daily',
  times: ['02:00'],
  weekdays: [],
  intervalMinutes: 60,
  window: null,
  startupDelayMinutes: 5,
  catchUpMissed: true
}
const routine: SchedRoutine = {
  id: 'r1',
  name: 'Rotina',
  enabled: true,
  schedule: daily2am,
  createdAt: '2026-01-01T00:00:00.000Z'
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('recuperação pendente quando o app fecha antes dela', () => {
  it('o horário perdido continua pendente no próximo início (não some)', async () => {
    vi.setSystemTime(new Date(2026, 9, 4, 8, 0))
    // Estado "persistido" entre as duas sessões do app.
    const slots = new Map([['r1', new Date(2026, 9, 3, 2, 0).toISOString()]])
    const runs: string[] = []
    const make = () =>
      new Scheduler({
        routines: () => [routine],
        getLastAttempt: (id) => slots.get(id) ?? null,
        setLastAttempt: (id, iso) => slots.set(id, iso),
        enqueue: (id, t: RunTrigger) => runs.push(`${id}:${t}`)
      })
    // PC ligado às 08:00 (o backup das 02:00 não rodou): recuperação marcada para 08:03…
    const first = make()
    first.start()
    await vi.advanceTimersByTimeAsync(60_000)
    // …mas o usuário sai do app (ou ele é reiniciado) às 08:01.
    first.stop()
    expect(runs).toEqual([])

    vi.setSystemTime(new Date(2026, 9, 4, 8, 30))
    const second = make()
    second.start()
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 100)
    second.stop()
    expect(runs).toEqual(['r1:catch-up'])
  })
})
