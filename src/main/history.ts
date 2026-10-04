// Histórico de execuções. Node puro.
//
//   history.ndjson    → um RunRecord (sem o log) por linha, só acrescentado; a última linha de
//                       um id vence (assim o status do e-mail pode ser atualizado depois).
//                       Compactado ao abrir, ao podar e ao crescer demais.
//   runs/<id>.json    → log completo da execução (LogEntry[]), lido só no detalhe.
// Registros mais antigos que `historyDays` são podados (junto com o log).

import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HistoryQuery } from '@shared/api'
import type { ID, LogEntry, RunRecord, RunSummary } from '@shared/types'
import { errCode, renameRetry, writeJsonAtomic } from './engine/fsutil'
import { isObj } from './store'

export type StoredRun = Omit<RunRecord, 'log'>

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/

export function toSummary(r: StoredRun | RunRecord): RunSummary {
  const s: RunSummary = {
    id: r.id,
    routineId: r.routineId,
    routineName: r.routineName,
    status: r.status,
    trigger: r.trigger,
    startedAt: r.startedAt,
    filesTotal: r.filesTotal,
    filesCopied: r.filesCopied,
    filesSkipped: r.filesSkipped,
    bytesTotal: r.bytesTotal,
    bytesCopied: r.bytesCopied,
    warnings: r.warnings,
    errors: r.errors,
    destinationCount: r.destinationCount
  }
  if (r.finishedAt !== undefined) s.finishedAt = r.finishedAt
  if (r.durationMs !== undefined) s.durationMs = r.durationMs
  if (r.email !== undefined) s.email = r.email
  if (r.errorMessage !== undefined) s.errorMessage = r.errorMessage
  return s
}

function isStoredRun(v: unknown): v is StoredRun {
  return (
    isObj(v) &&
    typeof v.id === 'string' &&
    typeof v.routineId === 'string' &&
    typeof v.startedAt === 'string' &&
    typeof v.status === 'string'
  )
}

function stripLog(r: RunRecord): StoredRun {
  const { log: _log, ...rest } = r
  return rest
}

export class HistoryStore {
  private runs = new Map<ID, StoredRun>()
  private sorted: StoredRun[] | null = null
  private lines = 0
  private chain: Promise<unknown> = Promise.resolve()

  private constructor(readonly dir: string) {}

  get file(): string {
    return join(this.dir, 'history.ndjson')
  }

  get logsDir(): string {
    return join(this.dir, 'runs')
  }

  static async open(dir: string, historyDays: number, now = new Date()): Promise<HistoryStore> {
    const h = new HistoryStore(dir)
    await mkdir(h.logsDir, { recursive: true })
    let text = ''
    try {
      text = await readFile(h.file, 'utf8')
    } catch (e) {
      if (errCode(e) !== 'ENOENT') throw e
    }
    let bad = 0
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      h.lines++
      try {
        const v: unknown = JSON.parse(line)
        if (isStoredRun(v)) h.runs.set(v.id, v)
        else bad++
      } catch {
        bad++ // linha truncada (queda de energia no meio do append): ignora
      }
    }
    const pruned = h.pruneMemory(historyDays, now)
    if (bad || pruned.length || h.lines > h.runs.size) await h.compact()
    await h.removeLogs(pruned)
    return h
  }

  /** Serializa operações de escrita (append/compactação nunca se cruzam). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn)
    this.chain = p.catch(() => {})
    return p
  }

  private logPath(id: ID): string | null {
    return SAFE_ID.test(id) ? join(this.logsDir, `${id}.json`) : null
  }

  async add(record: RunRecord): Promise<void> {
    const meta = stripLog(record)
    this.runs.set(meta.id, meta)
    this.sorted = null
    const lp = this.logPath(meta.id)
    await this.serial(async () => {
      if (lp) await writeJsonAtomic(lp, record.log ?? [], false)
      await appendFile(this.file, `${JSON.stringify(meta)}\n`, 'utf8')
      this.lines++
    })
    if (this.lines > Math.max(200, this.runs.size * 2)) await this.compact()
  }

  /** Atualiza campos de um registro (ex.: e-mail enviado pela fila de saída). */
  async update(id: ID, patch: Partial<StoredRun>, appendLog?: LogEntry[]): Promise<StoredRun | null> {
    const cur = this.runs.get(id)
    if (!cur) return null
    const next: StoredRun = { ...cur, ...patch, id }
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k]
    this.runs.set(id, next)
    this.sorted = null
    await this.serial(async () => {
      await appendFile(this.file, `${JSON.stringify(next)}\n`, 'utf8')
      this.lines++
      if (appendLog?.length) {
        const lp = this.logPath(id)
        if (lp) {
          const log = await this.readLog(id)
          await writeJsonAtomic(lp, [...log, ...appendLog], false)
        }
      }
    })
    return next
  }

  private async readLog(id: ID): Promise<LogEntry[]> {
    const lp = this.logPath(id)
    if (!lp) return []
    try {
      const v: unknown = JSON.parse(await readFile(lp, 'utf8'))
      return Array.isArray(v) ? (v as LogEntry[]) : []
    } catch {
      return []
    }
  }

  async get(id: ID): Promise<RunRecord | null> {
    const meta = this.runs.get(id)
    if (!meta) return null
    return { ...meta, destinations: meta.destinations ?? [], log: await this.readLog(id) }
  }

  getMeta(id: ID): StoredRun | undefined {
    return this.runs.get(id)
  }

  /** Todos os registros, do mais novo para o mais antigo. */
  records(): StoredRun[] {
    if (!this.sorted) {
      this.sorted = [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    }
    return this.sorted
  }

  list(query: HistoryQuery = {}): RunSummary[] {
    let out = this.records()
    if (query.routineId) out = out.filter((r) => r.routineId === query.routineId)
    if (query.status) out = out.filter((r) => r.status === query.status)
    const limit = typeof query.limit === 'number' && query.limit > 0 ? Math.floor(query.limit) : undefined
    if (limit) out = out.slice(0, limit)
    return out.map(toSummary)
  }

  /** Última execução de cada rotina. */
  latestByRoutine(): Map<ID, RunSummary> {
    const map = new Map<ID, RunSummary>()
    for (const r of this.records()) if (!map.has(r.routineId)) map.set(r.routineId, toSummary(r))
    return map
  }

  private pruneMemory(historyDays: number, now: Date): ID[] {
    const cutoff = now.getTime() - Math.max(1, historyDays) * 86_400_000
    const removed: ID[] = []
    for (const [id, r] of this.runs) {
      const t = Date.parse(r.startedAt)
      if (Number.isFinite(t) && t < cutoff) {
        this.runs.delete(id)
        removed.push(id)
      }
    }
    if (removed.length) this.sorted = null
    return removed
  }

  private async removeLogs(ids: ID[]): Promise<void> {
    for (const id of ids) {
      const lp = this.logPath(id)
      if (lp) await rm(lp, { force: true }).catch(() => {})
    }
  }

  async prune(historyDays: number, now = new Date()): Promise<number> {
    const removed = this.pruneMemory(historyDays, now)
    if (removed.length) {
      await this.compact()
      await this.removeLogs(removed)
    }
    return removed.length
  }

  /** Apaga todo o histórico, exceto os ids informados (ex.: execuções em andamento). */
  async clear(keep: ID[] = []): Promise<void> {
    const keepSet = new Set(keep)
    const removed = [...this.runs.keys()].filter((id) => !keepSet.has(id))
    for (const id of removed) this.runs.delete(id)
    this.sorted = null
    await this.compact()
    await this.removeLogs(removed)
  }

  /** Reescreve o NDJSON só com a versão final de cada registro. */
  compact(): Promise<void> {
    return this.serial(async () => {
      const body = [...this.runs.values()]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .map((r) => JSON.stringify(r))
        .join('\n')
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, body ? `${body}\n` : '', 'utf8')
      await renameRetry(tmp, this.file)
      this.lines = this.runs.size
    })
  }

  async flush(): Promise<void> {
    await this.chain.catch(() => {})
  }
}
