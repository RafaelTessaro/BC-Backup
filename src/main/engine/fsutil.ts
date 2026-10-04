// Utilitários de sistema de arquivos usados pelo motor de backup e pela persistência.
// Node puro (sem electron) — testável com vitest.

import { mkdir, open, rename, rm, stat, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Códigos que o Windows devolve quando antivírus/indexador seguram o arquivo por instantes. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

export function errCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export function isAbortError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    ((e as { name?: string }).name === 'AbortError' || errCode(e) === 'ABORT_ERR')
  )
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Rejeita com `message` (code ETIMEDOUT) se a promessa não terminar em `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, message = 'Tempo esgotado'): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code: 'ETIMEDOUT' })), ms)
    timer.unref?.()
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/**
 * rename com novas tentativas (≈10, backoff exponencial até 2 s): no Windows o antivírus
 * costuma segurar arquivos recém-gravados e o rename falha com EPERM/EBUSY por alguns instantes.
 */
export async function renameRetry(from: string, to: string, attempts = 10, baseDelayMs = 50): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to)
      return
    } catch (e) {
      if (!RENAME_RETRY_CODES.has(errCode(e)) || i >= attempts - 1) throw e
      await sleep(Math.min(baseDelayMs * 2 ** i, 2000))
    }
  }
}

/** Grava JSON de forma atômica: arquivo temporário + fsync + rename. */
export async function writeJsonAtomic(file: string, data: unknown, pretty = true): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await renameRetry(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

export interface SpaceInfo {
  total: number
  free: number
}

/** Espaço total/livre do volume que contém `p` (livre já descontando cota). */
export async function diskSpaceOf(p: string, timeoutMs = 5000): Promise<SpaceInfo> {
  const s = await withTimeout(statfs(p), timeoutMs, 'O disco não respondeu a tempo')
  return { total: Number(s.blocks) * Number(s.bsize), free: Number(s.bavail) * Number(s.bsize) }
}

const RESERVED_WIN = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/**
 * Nome seguro para pasta/arquivo no Windows (e nos outros sistemas):
 * troca <>:"/\|?* e caracteres de controle por "_", remove ponto/espaço final
 * e prefixa "_" em nomes reservados (CON, PRN, AUX, NUL, COMn, LPTn).
 */
export function sanitizeName(name: string, fallback = 'Rotina', maxLength = 80): string {
  // eslint-disable-next-line no-control-regex
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  s = s.replace(/[. ]+$/, '').trim()
  if (s.length > maxLength) s = s.slice(0, maxLength).replace(/[. ]+$/, '').trim()
  if (!s) s = fallback
  if (RESERVED_WIN.test(s)) s = `_${s}`
  return s
}

/** Tamanho em bytes de um texto JSON (útil para limitar logs). */
export function jsonSize(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8')
}
