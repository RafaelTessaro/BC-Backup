// Cálculo puro dos horários de uma rotina ("slots"). Usado pelo agendador (main)
// e pela interface (pré-visualização "Próximas execuções" no editor).
//
// Todo agendamento por relógio vira uma lista de slots por dia:
//   daily    → `times` em todos os dias
//   weekly   → `times` nos `weekdays`
//   interval → a cada `intervalMinutes`, a partir de window.start (ou 00:00) até window.end (ou 23:59),
//              nos `weekdays` (vazio = todos)
// manual e startup não têm slots.

import type { Schedule } from './types'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY_SCAN_LIMIT = 8

export function parseTime(hhmm: string): { h: number; m: number } | null {
  const match = TIME_RE.exec(hhmm.trim())
  if (!match) return null
  return { h: Number(match[1]), m: Number(match[2]) }
}

function minutesOf(hhmm: string | undefined, fallback: number): number {
  const t = hhmm ? parseTime(hhmm) : null
  return t ? t.h * 60 + t.m : fallback
}

function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  return d
}

function addDays(day: Date, n: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n)
}

export function isClockSchedule(schedule: Schedule): boolean {
  return schedule.kind === 'daily' || schedule.kind === 'weekly' || schedule.kind === 'interval'
}

function dayAllowed(schedule: Schedule, day: Date): boolean {
  if (schedule.kind === 'daily') return true
  if (schedule.kind === 'interval' && schedule.weekdays.length === 0) return true
  return schedule.weekdays.includes(day.getDay())
}

/** Minutos do dia (ordenados, sem repetição) em que a rotina dispara. */
export function slotMinutes(schedule: Schedule): number[] {
  if (schedule.kind === 'daily' || schedule.kind === 'weekly') {
    const set = new Set<number>()
    for (const t of schedule.times) {
      const p = parseTime(t)
      if (p) set.add(p.h * 60 + p.m)
    }
    return [...set].sort((a, b) => a - b)
  }
  if (schedule.kind === 'interval') {
    const step = Math.max(5, Math.floor(schedule.intervalMinutes || 60))
    const start = minutesOf(schedule.window?.start, 0)
    const end = minutesOf(schedule.window?.end, 23 * 60 + 59)
    const out: number[] = []
    if (end < start) return out
    for (let m = start; m <= end; m += step) out.push(m)
    return out
  }
  return []
}

/** Slots de um dia específico (datas locais). */
export function slotsForDay(schedule: Schedule, day: Date): Date[] {
  if (!isClockSchedule(schedule) || !dayAllowed(schedule, day)) return []
  return slotMinutes(schedule).map((m) => atMinutes(day, m))
}

/** Próximo slot estritamente depois de `after` (null para manual/startup ou agenda vazia). */
export function nextRunAt(schedule: Schedule, after: Date): Date | null {
  if (!isClockSchedule(schedule)) return null
  for (let offset = 0; offset <= DAY_SCAN_LIMIT; offset++) {
    const day = addDays(after, offset)
    for (const slot of slotsForDay(schedule, day)) {
      if (slot.getTime() > after.getTime()) return slot
    }
  }
  return null
}

/** Último slot em ou antes de `at` (null se não houver nos últimos dias). */
export function lastSlotAtOrBefore(schedule: Schedule, at: Date): Date | null {
  if (!isClockSchedule(schedule)) return null
  for (let offset = 0; offset <= DAY_SCAN_LIMIT; offset++) {
    const day = addDays(at, -offset)
    const slots = slotsForDay(schedule, day)
    for (let i = slots.length - 1; i >= 0; i--) {
      if (slots[i].getTime() <= at.getTime()) return slots[i]
    }
  }
  return null
}

/** Lista as próximas `count` execuções (pré-visualização). */
export function upcomingRuns(schedule: Schedule, from: Date, count = 3): Date[] {
  const out: Date[] = []
  let cursor = from
  for (let i = 0; i < count; i++) {
    const next = nextRunAt(schedule, cursor)
    if (!next) break
    out.push(next)
    cursor = next
  }
  return out
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
export const WEEKDAY_LONG = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function describeDays(weekdays: number[]): string | null {
  const days = [...new Set(weekdays)].sort((a, b) => a - b)
  if (days.length === 0 || days.length === 7) return null
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Seg a Sex'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Sáb e Dom'
  return joinPt(days.map((d) => WEEKDAY_SHORT[d]))
}

function describeInterval(minutes: number): string {
  if (minutes < 60) return `A cada ${minutes} min`
  const h = minutes / 60
  if (h === 1) return 'A cada hora'
  return Number.isInteger(h) ? `A cada ${h} horas` : `A cada ${minutes} min`
}

/** Resumo legível em pt-BR, ex.: "Seg, Qua e Sex às 18:00". */
export function describeSchedule(schedule: Schedule): string {
  const times = slotMinutes({ ...schedule, kind: 'daily' }).map(
    (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  )
  const timeText = times.length ? joinPt(times) : '—'
  switch (schedule.kind) {
    case 'manual':
      return 'Somente manual'
    case 'startup':
      return schedule.startupDelayMinutes > 0
        ? `Ao iniciar o computador (+${schedule.startupDelayMinutes} min)`
        : 'Ao iniciar o computador'
    case 'interval': {
      let text = describeInterval(Math.max(5, schedule.intervalMinutes || 60))
      if (schedule.window) text += `, das ${schedule.window.start} às ${schedule.window.end}`
      const days = describeDays(schedule.weekdays)
      return days ? `${text} · ${days}` : text
    }
    case 'daily':
      return `Todo dia às ${timeText}`
    case 'weekly': {
      const days = describeDays(schedule.weekdays)
      return days ? `${days} às ${timeText}` : `Todo dia às ${timeText}`
    }
  }
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}
