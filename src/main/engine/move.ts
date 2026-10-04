// "Mover": apagar da origem depois de copiar (docs/research/04-mover-apos-copiar.md). Node puro.
//
// Este módulo só tem as peças que decidem SE um arquivo pode entrar (elegibilidade) e SE ele pode
// sair (porta de exclusão). A orquestração fica em job.ts:
//   varredura → elegíveis (idade ≥ minAge por max(mtime, ctime, birthtime) + teste de uso exclusivo)
//   → cópia + verificação completa em TODOS os destinos → porta → exclusão arquivo a arquivo.
// Pastas nunca são apagadas (não existe rmdir aqui) e a exclusão é permanente (unlink).

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import { lstat, open, unlink } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import picomatch from 'picomatch'
import type { MovePreview } from '@shared/api'
import type { Filters, MoveSources } from '@shared/types'
import { MOVE_MIN_AGE_RANGE, MOVE_NEVER } from '@shared/defaults'
import type { EngineHooks } from './copy'
import { errCode, sleep } from './fsutil'
import { emptyWalkStats, makeFilter, walk, type FileFilter, type FileItem, type WalkIssue } from './walk'

/** `UV_FS_O_EXLOCK`: no Windows o libuv abre com share = 0 (falha com EBUSY se alguém usa o arquivo). */
export const UV_FS_O_EXLOCK = 0x10000000
/** Tentativas do teste de uso exclusivo (antivírus abre e fecha rápido). */
export const PROBE_ATTEMPTS = 3
export const PROBE_RETRY_MS = 2000
/** Data de alteração "no futuro" além desta folga = relógio errado. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000

export function clampMinAge(n: number): number {
  const v = Number.isFinite(n) ? Math.round(n) : 30
  return Math.min(MOVE_MIN_AGE_RANGE.max, Math.max(MOVE_MIN_AGE_RANGE.min, v))
}

/* ------------------------------------------------------------------ */
/* Filtro                                                              */
/* ------------------------------------------------------------------ */

export interface MoveFilter extends FileFilter {
  /** Arquivos ignorados por MOVE_NEVER (programas, atalhos, temporários). */
  readonly neverCount: number
}

/**
 * Filtros da rotina + MOVE_NEVER (sempre sem diferenciar maiúsculas: "SETUP.EXE" também fica de fora).
 * Pastas que combinam com MOVE_NEVER (ex.: "~temp") também são ignoradas — não mover é o lado seguro.
 */
export function makeMoveFilter(
  filters: Partial<Filters> | undefined,
  platform = process.platform
): MoveFilter {
  const base = makeFilter(filters, platform)
  const never = picomatch(MOVE_NEVER, { dot: true, nocase: true })
  let neverCount = 0
  return {
    get neverCount() {
      return neverCount
    },
    dirExcluded: (rel, name) => never(rel) || base.dirExcluded(rel, name),
    fileVerdict: (rel, name, size) => {
      const v = base.fileVerdict(rel, name, size)
      if (v === 'ok' && never(rel)) {
        neverCount++
        return 'excluded'
      }
      return v
    }
  }
}

/* ------------------------------------------------------------------ */
/* Elegibilidade                                                       */
/* ------------------------------------------------------------------ */

/** Momento da última alteração conhecida: max(mtime, ctime, birthtime). */
export function lastChangeMs(item: Pick<FileItem, 'mtime' | 'ctime' | 'birthtime'>): number {
  return Math.max(item.mtime.getTime(), item.ctime.getTime(), item.birthtime?.getTime() ?? 0)
}

/** Motivo para adiar pela idade (null = idade suficiente). Cópia/extração mantém o mtime antigo: por isso ctime/birthtime. */
export function ageProblem(
  item: Pick<FileItem, 'mtime' | 'ctime' | 'birthtime'>,
  nowMs: number,
  minAgeMinutes: number
): string | null {
  const t = lastChangeMs(item)
  if (!Number.isFinite(t) || t > nowMs + FUTURE_TOLERANCE_MS) return 'Data no futuro (confira o relógio)'
  const ageMin = (nowMs - t) / 60_000
  if (ageMin < minAgeMinutes) {
    return ageMin < 1
      ? 'Alterado há menos de 1 min, pode estar sendo gravado'
      : `Alterado há ${Math.floor(ageMin)} min, pode estar sendo gravado`
  }
  return null
}

export interface ProbeOptions {
  hooks?: EngineHooks
  signal?: AbortSignal
  platform?: NodeJS.Platform
  attempts?: number
  retryMs?: number
}

/**
 * Teste de uso exclusivo. Windows: abre com `O_RDONLY | UV_FS_O_EXLOCK` (share = 0) e fecha na hora;
 * se QUALQUER outro processo tiver o arquivo aberto, falha com EBUSY. Tenta de novo (antivírus).
 * macOS/Linux não têm trava obrigatória: lá só o gancho de teste participa e a proteção é a idade.
 * Devolve null (livre) ou o código do erro (EBUSY, EPERM, EACCES, ENOENT…).
 */
export async function probeExclusive(
  item: FileItem,
  stage: 'scan' | 'delete',
  opts: ProbeOptions = {}
): Promise<string | null> {
  const platform = opts.platform ?? process.platform
  const attempts = Math.max(1, opts.attempts ?? PROBE_ATTEMPTS)
  for (let i = 0; ; i++) {
    try {
      await opts.hooks?.beforeProbe?.(item, stage)
      if (platform === 'win32') {
        const fh = await open(item.abs, fsConstants.O_RDONLY | UV_FS_O_EXLOCK)
        await fh.close()
      }
      return null
    } catch (e) {
      const code = errCode(e) || 'EUNKNOWN'
      if (code === 'EBUSY' && i < attempts - 1) {
        await sleep(opts.retryMs ?? PROBE_RETRY_MS, opts.signal)
        continue
      }
      return code
    }
  }
}

/** Motivo pt-BR para um arquivo não elegível pelo teste de uso. */
export function probeReason(code: string): string {
  switch (code) {
    case 'EBUSY':
      return 'Em uso por outro programa'
    case 'EPERM':
    case 'EACCES':
      return 'Sem permissão'
    default:
      return `Não foi possível conferir se está em uso (${code})`
  }
}

/* ------------------------------------------------------------------ */
/* Hash e exclusão                                                     */
/* ------------------------------------------------------------------ */

/** sha256 do arquivo (releitura da origem quando há um destino só). */
export async function sha256File(
  path: string,
  signal?: AbortSignal
): Promise<{ hash: string; bytes: number }> {
  const h = createHash('sha256')
  let bytes = 0
  await pipeline(
    createReadStream(path, { highWaterMark: 1 << 20 }),
    new Writable({
      write(chunk: Buffer, _e, cb) {
        h.update(chunk)
        bytes += chunk.length
        cb()
      }
    }),
    signal ? { signal } : {}
  )
  return { hash: h.digest('hex'), bytes }
}

/** O arquivo continua exatamente como na varredura? (arquivo comum, mesmo tamanho, mtime e ctime) */
export async function unchangedSinceScan(item: FileItem): Promise<'same' | 'changed' | 'gone' | string> {
  try {
    const st = await lstat(item.abs)
    if (!st.isFile() || st.isSymbolicLink()) return 'changed'
    if (st.size !== item.size || st.mtimeMs !== item.mtimeMs || st.ctimeMs !== item.ctimeMs) return 'changed'
    return 'same'
  } catch (e) {
    const code = errCode(e)
    return code === 'ENOENT' ? 'gone' : code || 'EUNKNOWN'
  }
}

/** unlink de UM arquivo (nunca pastas). Devolve null (apagado) ou o código do erro. */
export async function removeFile(item: FileItem, hooks?: EngineHooks): Promise<string | null> {
  try {
    await hooks?.beforeUnlink?.(item)
    await unlink(item.abs)
    return null
  } catch (e) {
    return errCode(e) || 'EUNKNOWN'
  }
}

/** Motivo pt-BR quando o unlink falha. */
export function unlinkReason(code: string): string {
  switch (code) {
    case 'EBUSY':
      return 'Em uso por outro programa; será apagado numa próxima execução'
    case 'EPERM':
    case 'EACCES':
      return 'Sem permissão para apagar: ajuste a permissão da pasta para o usuário do BC Backup'
    default:
      return `Não foi possível apagar (${code})`
  }
}

/* ------------------------------------------------------------------ */
/* Prévia (editor)                                                     */
/* ------------------------------------------------------------------ */

const PREVIEW_NAMES = 10

/**
 * O que seria movido agora: mesmas regras do motor (filtros + MOVE_NEVER, idade, teste de uso numa
 * tentativa só). Para no tempo limite (resultado parcial). Origens que não são pastas são ignoradas.
 */
export async function previewMove(
  sources: string[],
  filters: Partial<Filters> | undefined,
  move: Pick<MoveSources, 'minAgeMinutes'>,
  opts: { timeoutMs?: number; now?: Date; platform?: NodeJS.Platform } = {}
): Promise<MovePreview> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 4000)
  const nowMs = (opts.now ?? new Date()).getTime()
  const minAge = clampMinAge(move.minAgeMinutes)
  const out: MovePreview = { files: 0, bytes: 0, names: [], waiting: 0, waitingItems: [], partial: false }
  const issues: WalkIssue[] = []
  try {
    for (const src of sources) {
      const filter = makeMoveFilter(filters, opts.platform)
      try {
        for await (const f of walk(src, filter, issues, emptyWalkStats(), ac.signal)) {
          if (f.abs === src) break // origem do tipo arquivo: "Mover" só funciona com pastas
          let reason = ageProblem(f, nowMs, minAge)
          if (!reason) {
            const code = await probeExclusive(f, 'scan', { attempts: 1, platform: opts.platform })
            if (code === 'ENOENT') continue
            if (code) reason = probeReason(code)
          }
          if (reason) {
            out.waiting++
            if (out.waitingItems.length < PREVIEW_NAMES) out.waitingItems.push({ name: f.rel, reason })
          } else {
            out.files++
            out.bytes += f.size
            if (out.names.length < PREVIEW_NAMES) out.names.push(f.rel)
          }
        }
      } catch {
        if (ac.signal.aborted) {
          out.partial = true
          break
        }
        // origem inexistente: ignora
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return out
}
