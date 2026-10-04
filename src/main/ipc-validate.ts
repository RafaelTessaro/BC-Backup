// Validação dos argumentos que chegam do renderer (nunca confie no que vem pela ponte IPC).
// Node puro. Erros são lançados com mensagem em pt-BR.

import type { HistoryQuery, RoutineInput } from '@shared/api'
import type { AppSettings, Filters, RunStatus, SmtpInput } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { isObj, migrateRoutine, migrateSmtp } from './store'
import { isAbsolutePath } from './validate'

export class IpcArgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IpcArgError'
  }
}

export function asId(v: unknown, what = 'id'): string {
  if (typeof v !== 'string' || !v.trim() || v.length > 200) throw new IpcArgError(`Parâmetro inválido: ${what}.`)
  return v
}

export function asString(v: unknown, what: string, max = 10_000): string {
  if (typeof v !== 'string' || v.length > max) throw new IpcArgError(`Parâmetro inválido: ${what}.`)
  return v
}

export function asBool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw new IpcArgError(`Parâmetro inválido: ${what}.`)
  return v
}

export function asAbsPath(v: unknown, what = 'caminho'): string {
  const s = asString(v, what, 4096).trim()
  if (!s || !isAbsolutePath(s)) throw new IpcArgError(`Caminho inválido: ${s || '(vazio)'}`)
  return s
}

export function asPathList(v: unknown, what = 'origens'): string[] {
  if (!Array.isArray(v) || v.length > 1000) throw new IpcArgError(`Parâmetro inválido: ${what}.`)
  return v.map((p) => asAbsPath(p, what))
}

export function asOptionalObject(v: unknown, what: string): Record<string, unknown> {
  if (v === undefined || v === null) return {}
  if (!isObj(v)) throw new IpcArgError(`Parâmetro inválido: ${what}.`)
  return v
}

export function asFilters(v: unknown): Filters | undefined {
  if (v === undefined || v === null) return undefined
  if (!isObj(v)) throw new IpcArgError('Parâmetro inválido: filtros.')
  // migrateRoutine normaliza os filtros (padrões, tipos).
  return migrateRoutine({ filters: v }).filters
}

const RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'success', 'warning', 'failed', 'cancelled']

export function asHistoryQuery(v: unknown): HistoryQuery {
  const o = asOptionalObject(v, 'consulta')
  const q: HistoryQuery = {}
  if (o.routineId !== undefined) q.routineId = asId(o.routineId, 'routineId')
  if (o.status !== undefined) {
    if (typeof o.status !== 'string' || !(RUN_STATUSES as readonly string[]).includes(o.status)) {
      throw new IpcArgError('Parâmetro inválido: status.')
    }
    q.status = o.status as RunStatus
  }
  if (o.limit !== undefined) {
    if (typeof o.limit !== 'number' || !Number.isFinite(o.limit) || o.limit < 0) throw new IpcArgError('Parâmetro inválido: limit.')
    q.limit = Math.floor(o.limit)
  }
  return q
}

/** Normaliza a rotina enviada pelo editor (estrutura/tipos); regras de negócio ficam em validate.ts. */
export function asRoutineInput(v: unknown): RoutineInput & { id: string } {
  if (!isObj(v)) throw new IpcArgError('Parâmetro inválido: rotina.')
  const r = migrateRoutine(v)
  const { createdAt: _c, updatedAt: _u, ...input } = r
  return input
}

/**
 * Versão "solta" para validação: mantém horários/janela como digitados para que
 * `validateRoutine` consiga apontar o horário inválido (a normalização os descartaria).
 */
export function asRoutineForValidation(v: unknown): RoutineInput & { id?: string } {
  if (!isObj(v)) throw new IpcArgError('Parâmetro inválido: rotina.')
  const base = asRoutineInput(v)
  const out: RoutineInput & { id?: string } = { ...base }
  if (!(typeof v.id === 'string' && v.id.trim())) delete out.id
  const sch = isObj(v.schedule) ? v.schedule : null
  if (sch) {
    out.schedule = {
      ...base.schedule,
      times: Array.isArray(sch.times) ? sch.times.filter((t): t is string => typeof t === 'string') : base.schedule.times,
      window: isObj(sch.window)
        ? { start: String(sch.window.start ?? ''), end: String(sch.window.end ?? '') }
        : base.schedule.window,
      intervalMinutes: typeof sch.intervalMinutes === 'number' ? sch.intervalMinutes : base.schedule.intervalMinutes
    }
  }
  const ret = isObj(v.retention) ? v.retention : null
  if (ret) {
    out.retention = {
      ...base.retention,
      days: typeof ret.days === 'number' ? ret.days : base.retention.days,
      minKeep: typeof ret.minKeep === 'number' ? ret.minKeep : base.retention.minKeep
    }
  }
  return out
}

type SettingsPatch = Partial<Omit<AppSettings, 'smtp'>>

const PATCH_TYPES: Record<string, 'string' | 'boolean' | 'number'> = {
  launchAtLogin: 'boolean',
  closeToTray: 'boolean',
  desktopNotifications: 'boolean',
  trayHintShown: 'boolean',
  clientName: 'string',
  computerAlias: 'string',
  companyName: 'string',
  historyDays: 'number'
}

export function asSettingsPatch(v: unknown): SettingsPatch {
  if (!isObj(v)) throw new IpcArgError('Parâmetro inválido: configurações.')
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === 'smtp') throw new IpcArgError('Use settings.saveSmtp para alterar o e-mail.')
    if (k === 'theme') {
      if (val !== 'light' && val !== 'dark' && val !== 'system') throw new IpcArgError('Tema inválido.')
      out.theme = val
      continue
    }
    const t = PATCH_TYPES[k]
    if (t) {
      if (typeof val !== t || (t === 'number' && !Number.isFinite(val as number))) {
        throw new IpcArgError(`Valor inválido para "${k}".`)
      }
      if (t === 'string' && (val as string).length > 500) throw new IpcArgError(`Texto longo demais em "${k}".`)
      out[k] = val
      continue
    }
    // Campo desconhecido (versão mais nova da interface): aceita só valores primitivos.
    if (val === null || ['string', 'number', 'boolean'].includes(typeof val)) out[k] = val
  }
  if (typeof out.historyDays === 'number') out.historyDays = Math.min(3650, Math.max(7, Math.round(out.historyDays)))
  return out as SettingsPatch
}

export function asSmtpInput(v: unknown): SmtpInput {
  if (!isObj(v)) throw new IpcArgError('Parâmetro inválido: e-mail.')
  const { hasPassword: _h, ...smtp } = migrateSmtp({ ...DEFAULT_SETTINGS.smtp, ...v })
  const out: SmtpInput = { ...smtp }
  if (v.password !== undefined) {
    if (typeof v.password !== 'string' || v.password.length > 1000) throw new IpcArgError('Senha inválida.')
    out.password = v.password
  }
  return out
}
