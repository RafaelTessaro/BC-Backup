import { describe, expect, it } from 'vitest'
import type { Schedule } from '@shared/types'
import {
  describeSchedule,
  lastSlotAtOrBefore,
  nextRunAt,
  slotMinutes,
  slotsForDay,
  upcomingRuns
} from '@shared/schedule'

const base: Schedule = {
  kind: 'daily',
  times: ['18:00'],
  weekdays: [],
  intervalMinutes: 60,
  window: null,
  startupDelayMinutes: 5,
  catchUpMissed: true
}
const d = (y: number, m: number, day: number, h = 0, min = 0) => new Date(y, m - 1, day, h, min, 0, 0)

describe('agendamento diário', () => {
  it('próximo horário no mesmo dia ou no dia seguinte', () => {
    const s = { ...base, times: ['18:00', '12:30'] }
    expect(nextRunAt(s, d(2026, 10, 5, 9))).toEqual(d(2026, 10, 5, 12, 30))
    expect(nextRunAt(s, d(2026, 10, 5, 12, 30))).toEqual(d(2026, 10, 5, 18))
    expect(nextRunAt(s, d(2026, 10, 5, 18))).toEqual(d(2026, 10, 6, 12, 30))
  })
  it('ignora horários inválidos e repetidos', () => {
    expect(slotMinutes({ ...base, times: ['25:00', '08:00', '08:00', 'abc'] })).toEqual([480])
  })
  it('agenda vazia → sem próxima execução', () => {
    expect(nextRunAt({ ...base, times: [] }, d(2026, 10, 5))).toBeNull()
  })
})

describe('agendamento semanal', () => {
  it('respeita os dias da semana (Seg/Qua)', () => {
    const s: Schedule = { ...base, kind: 'weekly', weekdays: [1, 3], times: ['18:30', '12:00'] }
    // 09/10/2026 é sexta → próxima é segunda 12/10 12:00
    expect(nextRunAt(s, d(2026, 10, 9, 19))).toEqual(d(2026, 10, 12, 12))
    expect(upcomingRuns(s, d(2026, 10, 12, 12), 3)).toEqual([
      d(2026, 10, 12, 18, 30),
      d(2026, 10, 14, 12),
      d(2026, 10, 14, 18, 30)
    ])
  })
  it('sem dias marcados nunca dispara', () => {
    expect(nextRunAt({ ...base, kind: 'weekly', weekdays: [] }, d(2026, 10, 5))).toBeNull()
  })
})

describe('agendamento por intervalo', () => {
  it('janela 08:00–18:00 a cada 2 h', () => {
    const s: Schedule = {
      ...base,
      kind: 'interval',
      intervalMinutes: 120,
      window: { start: '08:00', end: '18:00' }
    }
    expect(slotMinutes(s)).toEqual([480, 600, 720, 840, 960, 1080])
    expect(nextRunAt(s, d(2026, 10, 5, 17))).toEqual(d(2026, 10, 5, 18))
    expect(nextRunAt(s, d(2026, 10, 5, 18))).toEqual(d(2026, 10, 6, 8))
    expect(nextRunAt(s, d(2026, 10, 5, 3))).toEqual(d(2026, 10, 5, 8))
  })
  it('sem janela começa às 00:00 e cobre o dia todo', () => {
    const s: Schedule = { ...base, kind: 'interval', intervalMinutes: 360 }
    expect(slotMinutes(s)).toEqual([0, 360, 720, 1080])
  })
  it('filtra pelos dias da semana quando informados', () => {
    const s: Schedule = { ...base, kind: 'interval', intervalMinutes: 720, weekdays: [6] } // só sábado
    expect(slotsForDay(s, d(2026, 10, 5))).toEqual([])
    expect(slotsForDay(s, d(2026, 10, 10))).toEqual([d(2026, 10, 10, 0), d(2026, 10, 10, 12)])
  })
  it('intervalo mínimo de 5 minutos', () => {
    expect(
      slotMinutes({ ...base, kind: 'interval', intervalMinutes: 1, window: { start: '10:00', end: '10:12' } })
    ).toEqual([600, 605, 610])
  })
})

describe('lastSlotAtOrBefore (recuperação de backup atrasado)', () => {
  it('vários horários perdidos colapsam no mais recente', () => {
    const s = { ...base, times: ['02:00'] }
    expect(lastSlotAtOrBefore(s, d(2026, 10, 4, 9))).toEqual(d(2026, 10, 4, 2))
    expect(lastSlotAtOrBefore(s, d(2026, 10, 4, 2))).toEqual(d(2026, 10, 4, 2))
    expect(lastSlotAtOrBefore(s, d(2026, 10, 4, 1, 59))).toEqual(d(2026, 10, 3, 2))
  })
  it('manual e startup não têm horários', () => {
    expect(lastSlotAtOrBefore({ ...base, kind: 'manual' }, d(2026, 10, 4))).toBeNull()
    expect(nextRunAt({ ...base, kind: 'startup' }, d(2026, 10, 4))).toBeNull()
  })
})

describe('describeSchedule', () => {
  it('resumos em pt-BR', () => {
    expect(describeSchedule({ ...base, times: ['22:00'] })).toBe('Todo dia às 22:00')
    expect(describeSchedule({ ...base, kind: 'weekly', weekdays: [1, 3, 5], times: ['23:30'] })).toBe(
      'Seg, Qua e Sex às 23:30'
    )
    expect(describeSchedule({ ...base, kind: 'weekly', weekdays: [1, 2, 3, 4, 5], times: ['18:00'] })).toBe(
      'Seg a Sex às 18:00'
    )
    expect(
      describeSchedule({
        ...base,
        kind: 'interval',
        intervalMinutes: 240,
        window: { start: '08:00', end: '20:00' }
      })
    ).toBe('A cada 4 horas, das 08:00 às 20:00')
    expect(describeSchedule({ ...base, kind: 'interval', intervalMinutes: 30 })).toBe('A cada 30 min')
    expect(describeSchedule({ ...base, kind: 'manual' })).toBe('Somente manual')
    expect(describeSchedule({ ...base, kind: 'startup', startupDelayMinutes: 5 })).toBe(
      'Ao iniciar o computador (+5 min)'
    )
  })
})
