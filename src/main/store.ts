// Persistência em JSON com escrita atômica (temp + fsync + rename) no userData. Node puro.
//
//   config.json  → { schemaVersion, settings, routines, secrets }   (secrets = senha SMTP cifrada)
//   state.json   → { schemaVersion, routines: { [id]: { lastAttemptSlot, lastRunAt } }, window, pausedByTray }
//
// Ao carregar, tudo passa por `migrate*`: campos ausentes recebem os padrões (DEFAULT_SETTINGS /
// createDefaultRoutine), tipos errados são corrigidos e campos legados (doc 01 §4) são convertidos.
// Arquivo corrompido é preservado como "*.corrupt-<ts>" e o app tenta o "*.bak" da sessão anterior.

import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppSettings,
  AttachLog,
  BackupMode,
  Destination,
  Filters,
  ID,
  Retention,
  Routine,
  RoutineColor,
  RoutineNotification,
  Schedule,
  ScheduleKind,
  SmtpPreset,
  SmtpSecurity,
  SmtpSettings,
  SourceItem,
  ThemePreference,
  TimeWindow,
  VerifyMode
} from '@shared/types'
import { DEFAULT_EXCLUDES, DEFAULT_NOTIFICATION, DEFAULT_SETTINGS, createDefaultRoutine } from '@shared/defaults'
import { parseTime } from '@shared/schedule'
import { errCode, writeJsonAtomic } from './engine/fsutil'

export const CONFIG_SCHEMA_VERSION = 1
export const STATE_SCHEMA_VERSION = 1

export type StoredRoutine = Omit<Routine, 'lastRun'>

export interface ConfigData {
  schemaVersion: number
  settings: AppSettings
  routines: StoredRoutine[]
  secrets: {
    /** Senha SMTP cifrada com safeStorage (base64). */
    smtpPassword?: string
  }
}

export interface RoutineState {
  /** Último horário agendado já tratado (executado, recuperado ou perdido). ISO. */
  lastAttemptSlot: string | null
  lastRunAt: string | null
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface StateData {
  schemaVersion: number
  routines: Record<ID, RoutineState>
  window?: WindowState
  /** Rotinas pausadas pelo item "Pausar todas" da bandeja (para "Retomar" só elas). */
  pausedByTray?: ID[]
}

/* ------------------------------------------------------------------ */
/* Coerção de tipos                                                    */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>

export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def)
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def)
function int(v: unknown, def: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n)))
}
const oneOf = <T extends string>(v: unknown, list: readonly T[], def: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : def
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []
const isoOr = (v: unknown, def: string): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : def)

/** Copia chaves desconhecidas com valores primitivos (compatibilidade com versões futuras). */
function extraPrimitives(raw: Obj, known: readonly string[]): Obj {
  const out: Obj = {}
  for (const [k, v] of Object.entries(raw)) {
    if (known.includes(k)) continue
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v
  }
  return out
}

export const newId = (): string => randomUUID()

/* ------------------------------------------------------------------ */
/* Configurações                                                       */
/* ------------------------------------------------------------------ */

const THEMES: readonly ThemePreference[] = ['light', 'dark', 'system']
const PRESETS: readonly SmtpPreset[] = ['gmail', 'office365', 'hostinger', 'locaweb', 'uol', 'kinghost', 'hostgator', 'custom']
const SECURITIES: readonly SmtpSecurity[] = ['ssl', 'starttls', 'none']
const SETTINGS_KEYS = [
  'theme',
  'launchAtLogin',
  'closeToTray',
  'desktopNotifications',
  'clientName',
  'computerAlias',
  'companyName',
  'historyDays',
  'smtp',
  'trayHintShown'
] as const

export function migrateSmtp(raw: unknown): SmtpSettings {
  const d = DEFAULT_SETTINGS.smtp
  const r = isObj(raw) ? raw : {}
  return {
    preset: oneOf(r.preset, PRESETS, d.preset),
    host: str(r.host, d.host).trim(),
    port: int(r.port, d.port, 1, 65535),
    security: oneOf(r.security === 'tls' ? 'ssl' : r.security, SECURITIES, d.security),
    user: str(r.user ?? r.username, d.user).trim(),
    hasPassword: bool(r.hasPassword, false),
    fromName: str(r.fromName, d.fromName),
    fromEmail: str(r.fromEmail, d.fromEmail).trim(),
    replyTo: str(r.replyTo, d.replyTo).trim(),
    allowInvalidCert: bool(r.allowInvalidCert, d.allowInvalidCert),
    timeoutSec: int(r.timeoutSec, d.timeoutSec, 5, 300)
  }
}

export function migrateSettings(raw: unknown): AppSettings {
  const d = DEFAULT_SETTINGS
  const r = isObj(raw) ? raw : {}
  return {
    ...(extraPrimitives(r, SETTINGS_KEYS) as Partial<AppSettings>),
    theme: oneOf(r.theme, THEMES, d.theme),
    launchAtLogin: bool(r.launchAtLogin ?? r.startWithSystem, d.launchAtLogin),
    closeToTray: bool(r.closeToTray, d.closeToTray),
    desktopNotifications: bool(r.desktopNotifications, d.desktopNotifications),
    clientName: str(r.clientName, d.clientName),
    computerAlias: str(r.computerAlias, d.computerAlias),
    companyName: str(r.companyName, d.companyName),
    historyDays: int(r.historyDays, d.historyDays, 7, 3650),
    smtp: migrateSmtp(r.smtp),
    trayHintShown: bool(r.trayHintShown, d.trayHintShown)
  }
}

/* ------------------------------------------------------------------ */
/* Rotinas                                                             */
/* ------------------------------------------------------------------ */

const COLORS: readonly RoutineColor[] = ['blue', 'sky', 'emerald', 'amber', 'rose', 'violet', 'slate']
const KINDS: readonly ScheduleKind[] = ['manual', 'daily', 'weekly', 'interval', 'startup']
const VERIFY: readonly VerifyMode[] = ['none', 'quick', 'full']
const ATTACH: readonly AttachLog[] = ['never', 'onFailure', 'always']
const ROUTINE_KEYS = [
  'id',
  'name',
  'description',
  'color',
  'enabled',
  'sources',
  'destinations',
  'mode',
  'zipLevel',
  'filters',
  'verify',
  'schedule',
  'retention',
  'notification',
  'createdAt',
  'updatedAt',
  'lastRun'
] as const

function migrateSources(v: unknown): SourceItem[] {
  if (!Array.isArray(v)) return []
  const out: SourceItem[] = []
  for (const s of v) {
    const r: Obj = typeof s === 'string' ? { path: s } : isObj(s) ? s : {}
    const path = str(r.path).trim()
    if (!path) continue
    const item: SourceItem = { id: str(r.id) || newId(), path, kind: r.kind === 'file' ? 'file' : 'folder' }
    const label = str(r.label).trim()
    if (label) item.label = label
    out.push(item)
  }
  return out
}

function migrateDestinations(v: unknown): Destination[] {
  if (!Array.isArray(v)) return []
  const out: Destination[] = []
  for (const s of v) {
    const r: Obj = typeof s === 'string' ? { path: s } : isObj(s) ? s : {}
    const path = str(r.path).trim()
    if (!path) continue
    const item: Destination = { id: str(r.id) || newId(), path, enabled: bool(r.enabled, true) }
    const label = str(r.label).trim()
    if (label) item.label = label
    out.push(item)
  }
  return out
}

function migrateFilters(v: unknown): Filters {
  const r = isObj(v) ? v : {}
  const max = r.maxFileSizeMB
  return {
    include: strArr(r.include),
    exclude: Array.isArray(r.exclude) ? strArr(r.exclude) : [...DEFAULT_EXCLUDES],
    skipHiddenAndSystem: bool(r.skipHiddenAndSystem ?? r.skipHidden, true),
    maxFileSizeMB: typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : null
  }
}

function validTime(t: string): boolean {
  return parseTime(t) !== null
}

function migrateWindow(v: unknown): TimeWindow | null {
  if (!isObj(v)) return null
  const start = str(v.start).trim()
  const end = str(v.end).trim()
  return validTime(start) && validTime(end) ? { start, end } : null
}

export function migrateSchedule(v: unknown): Schedule {
  const d = createDefaultRoutine().schedule
  const r = isObj(v) ? v : {}
  // Formato legado (doc 01 §4): `type` em vez de `kind`; 'weekly' com os 7 dias = diário.
  const kind = oneOf(r.kind ?? r.type, KINDS, d.kind)
  const times = [...new Set(strArr(r.times).filter(validTime))].sort().slice(0, 6)
  const weekdays = Array.isArray(r.weekdays)
    ? [...new Set(r.weekdays.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : [...d.weekdays]
  return {
    kind,
    times: times.length || Array.isArray(r.times) ? times : [...d.times],
    weekdays,
    intervalMinutes: int(r.intervalMinutes, d.intervalMinutes, 5, 24 * 60),
    window: migrateWindow(r.window),
    startupDelayMinutes: int(r.startupDelayMinutes, d.startupDelayMinutes, 0, 24 * 60),
    catchUpMissed: bool(r.catchUpMissed, d.catchUpMissed)
  }
}

function migrateRetention(v: unknown): Retention {
  const d = createDefaultRoutine().retention
  const r = isObj(v) ? v : {}
  const days = r.days ?? r.keepDays
  // keepDays 0 (legado) = nunca apagar.
  if (days === 0) return { enabled: false, days: d.days, minKeep: int(r.minKeep, d.minKeep, 0, 1000) }
  return {
    enabled: bool(r.enabled, d.enabled),
    days: int(days, d.days, 1, 3650),
    minKeep: int(r.minKeep, d.minKeep, 0, 1000)
  }
}

function migrateNotification(v: unknown): RoutineNotification {
  const d = DEFAULT_NOTIFICATION
  const r = isObj(v) ? v : {}
  const n: RoutineNotification = {
    enabled: bool(r.enabled, d.enabled),
    recipients: strArr(r.recipients ?? r.to),
    bcc: strArr(r.bcc),
    onSuccess: bool(r.onSuccess, d.onSuccess),
    onWarning: bool(r.onWarning, d.onWarning),
    onFailure: bool(r.onFailure, d.onFailure),
    attachLog: oneOf(r.attachLog, ATTACH, d.attachLog)
  }
  const clientName = str(r.clientName)
  if (clientName) n.clientName = clientName
  return n
}

/**
 * Normaliza uma rotina vinda do disco, do renderer ou de um arquivo importado.
 * Nunca lança: campos inválidos recebem o padrão. `id` ausente → novo id.
 */
export function migrateRoutine(raw: unknown, now: Date = new Date()): StoredRoutine {
  const r = isObj(raw) ? raw : {}
  const d = createDefaultRoutine()
  const nowIso = now.toISOString()
  const createdAt = isoOr(r.createdAt, nowIso)
  const mode: BackupMode = r.mode === 'zip' ? 'zip' : 'copy'
  const routine: StoredRoutine = {
    ...(extraPrimitives(r, ROUTINE_KEYS) as Partial<StoredRoutine>),
    id: str(r.id).trim() || newId(),
    name: str(r.name).trim().slice(0, 120),
    description: str(r.description, d.description ?? ''),
    color: oneOf(r.color, COLORS, d.color ?? 'blue'),
    enabled: bool(r.enabled, true),
    sources: migrateSources(r.sources),
    destinations: migrateDestinations(r.destinations),
    mode,
    zipLevel: int(r.zipLevel, d.zipLevel, 0, 9),
    filters: migrateFilters(r.filters),
    verify: oneOf(r.verify, VERIFY, d.verify),
    schedule: migrateSchedule(r.schedule),
    retention: migrateRetention(r.retention),
    notification: migrateNotification(r.notification),
    createdAt,
    updatedAt: isoOr(r.updatedAt, createdAt)
  }
  return routine
}

export function migrateConfig(raw: unknown): ConfigData {
  const r = isObj(raw) ? raw : {}
  const secrets = isObj(r.secrets) ? r.secrets : {}
  const routines: StoredRoutine[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(r.routines) ? r.routines : []) {
    if (!isObj(item)) continue
    const routine = migrateRoutine(item)
    if (seen.has(routine.id)) routine.id = newId()
    seen.add(routine.id)
    routines.push(routine)
  }
  const smtpPassword = typeof secrets.smtpPassword === 'string' && secrets.smtpPassword ? secrets.smtpPassword : undefined
  const settings = migrateSettings(r.settings)
  settings.smtp.hasPassword = !!smtpPassword
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    settings,
    routines,
    secrets: smtpPassword ? { smtpPassword } : {}
  }
}

export function migrateState(raw: unknown): StateData {
  const r = isObj(raw) ? raw : {}
  const routines: Record<ID, RoutineState> = {}
  if (isObj(r.routines)) {
    for (const [id, v] of Object.entries(r.routines)) {
      if (!isObj(v)) continue
      routines[id] = {
        lastAttemptSlot: typeof v.lastAttemptSlot === 'string' ? v.lastAttemptSlot : null,
        lastRunAt: typeof v.lastRunAt === 'string' ? v.lastRunAt : null
      }
    }
  }
  const out: StateData = { schemaVersion: STATE_SCHEMA_VERSION, routines }
  if (isObj(r.window)) {
    const w = r.window
    out.window = {
      width: int(w.width, 1200, 400, 10000),
      height: int(w.height, 780, 300, 10000),
      maximized: bool(w.maximized, false)
    }
    if (typeof w.x === 'number' && typeof w.y === 'number') {
      out.window.x = Math.round(w.x)
      out.window.y = Math.round(w.y)
    }
  }
  const paused = strArr(r.pausedByTray)
  if (paused.length) out.pausedByTray = paused
  return out
}

/* ------------------------------------------------------------------ */
/* Arquivo JSON com gravação serializada                              */
/* ------------------------------------------------------------------ */

export class JsonFile<T> {
  private dirty = false
  private running: Promise<void> | null = null

  private constructor(
    readonly file: string,
    public data: T
  ) {}

  /** Carrega e migra. Arquivo corrompido vira "*.corrupt-<ts>" e tentamos o "*.bak". */
  static async load<T>(file: string, migrate: (raw: unknown) => T, opts: { backup?: boolean } = {}): Promise<JsonFile<T>> {
    let raw: unknown = undefined
    let loadedMain = false
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
      loadedMain = true
    } catch (e) {
      if (errCode(e) !== 'ENOENT') {
        await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {})
        try {
          raw = JSON.parse(await readFile(`${file}.bak`, 'utf8'))
        } catch {
          raw = undefined
        }
      }
    }
    const jf = new JsonFile(file, migrate(raw))
    if (loadedMain && opts.backup) await copyFile(file, `${file}.bak`).catch(() => {})
    return jf
  }

  /** Agenda uma gravação; rajadas são agrupadas e as gravações nunca se sobrepõem. */
  save(): Promise<void> {
    this.dirty = true
    if (!this.running) {
      this.running = this.loop().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  /** Espera as gravações pendentes. */
  async flush(): Promise<void> {
    while (this.running) await this.running.catch(() => {})
  }

  private async loop(): Promise<void> {
    while (this.dirty) {
      this.dirty = false
      await writeJsonAtomic(this.file, this.data)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Store do app                                                        */
/* ------------------------------------------------------------------ */

export class AppStore {
  private constructor(
    readonly dir: string,
    readonly config: JsonFile<ConfigData>,
    readonly state: JsonFile<StateData>
  ) {}

  static async open(dir: string): Promise<AppStore> {
    const config = await JsonFile.load(join(dir, 'config.json'), migrateConfig, { backup: true })
    const state = await JsonFile.load(join(dir, 'state.json'), migrateState)
    return new AppStore(dir, config, state)
  }

  get settings(): AppSettings {
    const s = this.config.data.settings
    return { ...s, smtp: { ...s.smtp, hasPassword: !!this.config.data.secrets.smtpPassword } }
  }

  routines(): StoredRoutine[] {
    return this.config.data.routines
  }

  getRoutine(id: ID): StoredRoutine | undefined {
    return this.config.data.routines.find((r) => r.id === id)
  }

  async upsertRoutine(routine: StoredRoutine): Promise<void> {
    const list = this.config.data.routines
    const i = list.findIndex((r) => r.id === routine.id)
    if (i >= 0) list[i] = routine
    else list.push(routine)
    await this.config.save()
  }

  async removeRoutine(id: ID): Promise<boolean> {
    const list = this.config.data.routines
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) return false
    list.splice(i, 1)
    delete this.state.data.routines[id]
    await Promise.all([this.config.save(), this.state.save()])
    return true
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const cur = this.config.data.settings
    this.config.data.settings = migrateSettings({ ...cur, ...patch, smtp: patch.smtp ?? cur.smtp })
    await this.config.save()
    return this.settings
  }

  async setSmtpPassword(encrypted: string | undefined): Promise<void> {
    if (encrypted) this.config.data.secrets.smtpPassword = encrypted
    else delete this.config.data.secrets.smtpPassword
    this.config.data.settings.smtp.hasPassword = !!encrypted
    await this.config.save()
  }

  routineState(id: ID): RoutineState {
    return this.state.data.routines[id] ?? { lastAttemptSlot: null, lastRunAt: null }
  }

  setRoutineState(id: ID, patch: Partial<RoutineState>): void {
    this.state.data.routines[id] = { ...this.routineState(id), ...patch }
    void this.state.save().catch(() => {})
  }

  async flush(): Promise<void> {
    await Promise.all([this.config.flush(), this.state.flush()])
  }
}
