// Cálculo puro da próxima execução de uma rotina. Usado pelo agendador (main)
// e pela interface (pré-visualização "Próximas execuções" no editor).

import type { Schedule } from './types'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseTime(hhmm: string): { h: number; m: number } | null {
  const match = TIME_RE.exec(hhmm.trim())
  if (!match) return null
  return { h: Number(match[1]), m: Number(match[2]) }
}

function atTime(day: Date, h: number, m: number): Date {
  const d = new Date(day)
  d.setHours(h, m, 0, 0)
  return d
}

/**
 * Próximo horário estritamente depois de `after`.
 * - `lastRunAt` só é usado pelo modo `interval` (conta N horas desde a última execução).
 * - `manual` e `startup` não têm próxima execução por relógio → null.
 */
export function nextRunAt(schedule: Schedule, after: Date, lastRunAt?: Date | null): Date | null {
  switch (schedule.kind) {
    case 'manual':
    case 'startup':
      return null

    case 'interval': {
      const hours = Math.max(1, Math.floor(schedule.everyHours || 1))
      const step = hours * 3_600_000
      if (!lastRunAt) {
        // Nunca rodou: primeira execução em alguns instantes.
        return new Date(after.getTime() + 60_000)
      }
      let next = lastRunAt.getTime() + step
      if (next <= after.getTime()) next = after.getTime() + 60_000
      return new Date(next)
    }

    case 'daily':
    case 'weekly': {
      const times = schedule.times
        .map(parseTime)
        .filter((t): t is { h: number; m: number } => t !== null)
        .sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m))
      if (times.length === 0) return null

      const days = schedule.kind === 'weekly' ? new Set(schedule.weekdays) : null
      if (days && days.size === 0) return null

      // Procura nos próximos 8 dias (cobre a semana inteira + hoje).
      for (let offset = 0; offset <= 8; offset++) {
        const day = new Date(after)
        day.setDate(after.getDate() + offset)
        if (days && !days.has(day.getDay())) continue
        for (const t of times) {
          const candidate = atTime(day, t.h, t.m)
          if (candidate.getTime() > after.getTime()) return candidate
        }
      }
      return null
    }
  }
}

/** Lista as próximas `count` execuções (pré-visualização). */
export function upcomingRuns(schedule: Schedule, from: Date, count = 3): Date[] {
  const out: Date[] = []
  let cursor = from
  let last: Date | null = null
  for (let i = 0; i < count; i++) {
    const next = nextRunAt(schedule, cursor, schedule.kind === 'interval' ? (last ?? cursor) : null)
    if (!next) break
    out.push(next)
    last = next
    cursor = next
  }
  return out
}

/**
 * Houve algum horário agendado entre `since` (exclusivo) e `now` (inclusivo)?
 * Usado para "executar backups perdidos" quando o computador estava desligado.
 */
export function missedRunBetween(schedule: Schedule, since: Date, now: Date): Date | null {
  if (schedule.kind === 'interval') {
    const hours = Math.max(1, Math.floor(schedule.everyHours || 1))
    const due = since.getTime() + hours * 3_600_000
    return due <= now.getTime() ? new Date(due) : null
  }
  const next = nextRunAt(schedule, since)
  return next && next.getTime() <= now.getTime() ? next : null
}

const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Resumo legível em pt-BR, ex.: "Seg, Qua e Sex às 18:00". */
export function describeSchedule(schedule: Schedule): string {
  const times = schedule.times.filter((t) => parseTime(t)).sort()
  const timeText = times.length ? joinPt(times.map((t) => t)) : '—'
  switch (schedule.kind) {
    case 'manual':
      return 'Somente manual'
    case 'startup':
      return schedule.startupDelayMinutes > 0
        ? `Ao iniciar o computador (+${schedule.startupDelayMinutes} min)`
        : 'Ao iniciar o computador'
    case 'interval':
      return schedule.everyHours === 1 ? 'A cada hora' : `A cada ${schedule.everyHours} horas`
    case 'daily':
      return `Todos os dias às ${timeText}`
    case 'weekly': {
      const days = [...schedule.weekdays].sort((a, b) => a - b)
      if (days.length === 7) return `Todos os dias às ${timeText}`
      const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
      const dayText = isWeekdays ? 'Seg a Sex' : joinPt(days.map((d) => WEEKDAY_SHORT[d]))
      return `${dayText} às ${timeText}`
    }
  }
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}
