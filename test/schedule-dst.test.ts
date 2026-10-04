// Horário de verão: roda num fuso com DST (cada arquivo de teste roda em processo próprio).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Schedule } from '@shared/types'
import { lastSlotAtOrBefore, nextRunAt, upcomingRuns } from '@shared/schedule'

const base: Schedule = {
  kind: 'daily',
  times: ['02:30'],
  weekdays: [],
  intervalMinutes: 60,
  window: null,
  startupDelayMinutes: 0,
  catchUpMissed: true
}

const prevTz = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = prevTz
})

describe('DST (America/New_York)', () => {
  it('fuso aplicado', () => {
    // Em janeiro NY está em UTC−5.
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(300)
  })

  it('primavera: 02:30 não existe em 08/03/2026 → avança para um horário válido, sem pular o dia', () => {
    const next = nextRunAt(base, new Date(2026, 2, 8, 0, 0))
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(8)
    expect(next!.getHours()).toBe(3)
    // E o dia seguinte volta ao normal.
    expect(nextRunAt(base, next!)).toEqual(new Date(2026, 2, 9, 2, 30))
  })

  it('outono: 01:30 de 01/11/2026 dispara uma vez só (primeira ocorrência)', () => {
    const s = { ...base, times: ['01:30'] }
    const runs = upcomingRuns(s, new Date(2026, 9, 31, 23, 0), 3)
    expect(runs.map((r) => [r.getDate(), r.getHours(), r.getMinutes()])).toEqual([
      [1, 1, 30],
      [2, 1, 30],
      [3, 1, 30]
    ])
    // A diferença entre as duas primeiras é de 25 h (dia com hora repetida).
    expect(runs[1].getTime() - runs[0].getTime()).toBe(25 * 3_600_000)
  })

  it('intervalo de 1 h atravessa a troca sem loop', () => {
    const s: Schedule = { ...base, kind: 'interval', intervalMinutes: 60 }
    const runs = upcomingRuns(s, new Date(2026, 2, 8, 0, 0), 4)
    expect(runs.length).toBe(4)
    for (let i = 1; i < runs.length; i++) expect(runs[i].getTime()).toBeGreaterThan(runs[i - 1].getTime())
    expect(lastSlotAtOrBefore(s, new Date(2026, 2, 8, 4, 10))).toEqual(new Date(2026, 2, 8, 4, 0))
  })
})
