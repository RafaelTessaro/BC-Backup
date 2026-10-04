// Cópia em modo "pasta": streaming arquivo a arquivo, preservando a data de modificação.
// Node puro.

import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rm, stat, utimes } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SkippedFile } from '@shared/types'
import { errCode } from './fsutil'
import type { FileItem } from './walk'
import { skipReason } from './walk'
import type { ProgressTracker } from './progress'

/** Erros da ORIGEM que viram aviso (arquivo pulado), não falha. */
export const SKIPPABLE_SOURCE = new Set([
  'EBUSY',
  'EPERM',
  'EACCES',
  'ENOENT',
  'ELOOP',
  'EINVAL',
  'ENAMETOOLONG',
  'EIO'
])

/** Ganchos usados só nos testes (simular arquivo em uso etc.). */
export interface EngineHooks {
  /** Chamado antes de abrir cada arquivo de origem; pode lançar um erro com `code`. */
  beforeOpen?: (item: FileItem) => void | Promise<void>
  /**
   * "Mover": chamado antes do teste de uso exclusivo (na varredura e de novo antes de apagar);
   * pode lançar um erro com `code` (EBUSY simula outro programa com o arquivo aberto).
   */
  beforeProbe?: (item: FileItem, stage: 'scan' | 'delete') => void | Promise<void>
  /** Depois da cópia e antes da verificação de um destino (ex.: corromper a cópia). */
  beforeVerify?: (outputPath: string, destinationIndex: number) => void | Promise<void>
  /** Depois de terminar cada destino (ex.: alterar a origem entre a cópia e a exclusão). */
  afterDestination?: (destinationIndex: number) => void | Promise<void>
  /** "Mover": antes de cada exclusão da origem; pode lançar um erro com `code`. */
  beforeUnlink?: (item: FileItem) => void | Promise<void>
}

export interface CopiedFile {
  item: FileItem
  /** Bytes efetivamente gravados. */
  bytes: number
  /** sha256 do conteúdo lido (só com verificação completa). */
  hash?: string
  /** false = o destino não aceitou preservar a data (alguns compartilhamentos de rede). */
  mtimeSet: boolean
}

export interface CopyTreeResult {
  copied: CopiedFile[]
  bytes: number
  skipped: SkippedFile[]
}

/** Erro do lado do DESTINO: aborta aquele destino. */
export class DestinationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'DestinationError'
  }
}

export function destPathFor(root: string, rel: string): string {
  return join(root, ...rel.split('/'))
}

/**
 * Copia um arquivo. Lança erro com `side` = 'src' (problema na origem → pular) ou
 * 'dst' (problema no destino → falha do destino).
 */
export async function copyOne(
  item: FileItem,
  destRoot: string,
  onBytes: (n: number) => void,
  signal: AbortSignal,
  hash: boolean,
  hooks?: EngineHooks,
  madeDirs?: Set<string>
): Promise<CopiedFile> {
  const dst = destPathFor(destRoot, item.rel)
  // Abre a origem primeiro: arquivo em uso/sem permissão é detectado aqui, antes de criar o destino.
  let fh
  try {
    await hooks?.beforeOpen?.(item)
    fh = await open(item.abs, 'r')
  } catch (e) {
    throw Object.assign(e as Error, { side: 'src' })
  }
  let side: 'src' | 'dst' | null = null
  let written = 0
  const hasher: Hash | null = hash ? createHash('sha256') : null
  try {
    try {
      const parent = dirname(dst)
      if (!madeDirs?.has(parent)) {
        await mkdir(parent, { recursive: true })
        madeDirs?.add(parent)
      }
    } catch (e) {
      throw Object.assign(e as Error, { side: 'dst' })
    }
    const rs = fh.createReadStream({ highWaterMark: 1 << 20, autoClose: false })
    const ws = createWriteStream(dst, { flags: 'wx' })
    rs.once('error', () => (side ??= 'src'))
    ws.once('error', () => (side ??= 'dst'))
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length
        hasher?.update(chunk)
        onBytes(chunk.length)
        cb(null, chunk)
      }
    })
    try {
      await pipeline(rs, counter, ws, { signal })
    } catch (e) {
      throw Object.assign(e as Error, { side: side ?? 'dst' })
    }
  } finally {
    await fh.close().catch(() => {})
  }
  let mtimeSet = true
  try {
    await utimes(dst, item.atime, item.mtime)
  } catch {
    // Alguns compartilhamentos de rede não aceitam utimes — não é motivo para falhar.
    mtimeSet = false
  }
  return { item, bytes: written, hash: hasher?.digest('hex'), mtimeSet }
}

/** Copia todos os itens para `destRoot` (que já deve existir). */
export async function copyTree(
  items: FileItem[],
  destRoot: string,
  tracker: ProgressTracker,
  signal: AbortSignal,
  opts: { hash: boolean; hooks?: EngineHooks }
): Promise<CopyTreeResult> {
  const copied: CopiedFile[] = []
  const skipped: SkippedFile[] = []
  const madeDirs = new Set<string>()
  let bytes = 0
  for (const item of items) {
    signal.throwIfAborted()
    tracker.file(item.rel)
    let partial = 0
    try {
      const r = await copyOne(
        item,
        destRoot,
        (n) => {
          partial += n
          tracker.addBytes(n)
        },
        signal,
        opts.hash,
        opts.hooks,
        madeDirs
      )
      copied.push(r)
      bytes += r.bytes
    } catch (e) {
      if (signal.aborted) throw signal.reason ?? e
      const code = errCode(e)
      const side = (e as { side?: string }).side
      if (side === 'src' && SKIPPABLE_SOURCE.has(code)) {
        skipped.push({ path: item.abs, reason: skipReason(code) })
        // Mantém o percentual coerente e remove o arquivo parcial do destino.
        tracker.addBytes(Math.max(0, item.size - partial))
        await rm(destPathFor(destRoot, item.rel), { force: true }).catch(() => {})
      } else if (side === 'dst' && code === 'EEXIST') {
        // Destino sem diferença de maiúsculas/acentos (exFAT, NTFS, APFS) e origem com "Foto.jpg" e
        // "foto.jpg": pula só este arquivo. NÃO apaga o caminho — ele é a cópia do outro arquivo.
        skipped.push({
          path: item.abs,
          reason:
            'Já existe um arquivo com o mesmo nome no destino (só muda maiúsculas/minúsculas ou acentos)'
        })
        tracker.addBytes(Math.max(0, item.size - partial))
      } else {
        throw new DestinationError(destinationErrorMessage(code, e), code || 'EDEST', e)
      }
    }
    tracker.fileDone()
  }
  tracker.flush()
  return { copied, bytes, skipped }
}

/** Mensagem pt-BR para erro de gravação no destino. */
export function destinationErrorMessage(code: string, e?: unknown): string {
  switch (code) {
    case 'ENOSPC':
    case 'EDQUOT':
      return 'Sem espaço no destino.'
    case 'EACCES':
    case 'EPERM':
      return 'Sem permissão para gravar no destino.'
    case 'EROFS':
      return 'O destino está protegido contra gravação.'
    case 'ENOENT':
    case 'ENOTCONN':
    case 'ENODEV':
    case 'EIO':
    case 'ENXIO':
    case 'ETIMEDOUT':
    case 'EHOSTDOWN':
    case 'ENETUNREACH':
    case 'EBADF':
      return 'Destino indisponível: verifique se o disco está conectado.'
    case 'ENAMETOOLONG':
      return 'O caminho no destino ficou longo demais.'
    default: {
      const msg = e instanceof Error ? e.message : ''
      return `Erro ao gravar no destino${code ? ` (${code})` : ''}${msg ? `: ${msg}` : '.'}`
    }
  }
}

/** Diferença tolerada no mtime (FAT32/exFAT e compartilhamentos arredondam a 2 s). */
const MTIME_TOLERANCE_MS = 2000

/** FAT32/exFAT só guardam datas de 1980 a 2107: fora disso o mtime não é comparável. */
function mtimeComparable(d: Date): boolean {
  const y = d.getFullYear()
  return y > 1980 && y < 2107
}

export interface VerifyIssue {
  path: string
  reason: string
}

/** Verificação do modo pasta: quick = tamanho + data; full = relê o destino e compara o sha256. */
export async function verifyCopiedFiles(
  copied: CopiedFile[],
  destRoot: string,
  mode: 'quick' | 'full',
  tracker: ProgressTracker,
  signal: AbortSignal
): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = []
  tracker.startVerify(copied.length, mode === 'full' ? copied.reduce((a, c) => a + c.bytes, 0) : 0)
  for (const c of copied) {
    signal.throwIfAborted()
    const dst = destPathFor(destRoot, c.item.rel)
    tracker.file(c.item.rel)
    try {
      const st = await stat(dst)
      if (st.size !== c.bytes) {
        issues.push({ path: dst, reason: `Tamanho diferente do original (${st.size} ≠ ${c.bytes} bytes)` })
      } else if (
        c.mtimeSet &&
        mtimeComparable(c.item.mtime) &&
        Math.abs(st.mtime.getTime() - c.item.mtime.getTime()) > MTIME_TOLERANCE_MS
      ) {
        issues.push({ path: dst, reason: 'Data de modificação diferente do original' })
      } else if (mode === 'full' && c.hash) {
        const h = createHash('sha256')
        await pipeline(
          createReadStream(dst, { highWaterMark: 1 << 20 }),
          new Writable({
            write(chunk: Buffer, _e, cb) {
              h.update(chunk)
              tracker.addBytes(chunk.length)
              cb()
            }
          }),
          { signal }
        )
        if (h.digest('hex') !== c.hash)
          issues.push({ path: dst, reason: 'Conteúdo diferente do original (hash)' })
      }
    } catch (e) {
      if (signal.aborted) throw signal.reason ?? e
      issues.push({ path: dst, reason: `Não foi possível reler o arquivo (${errCode(e) || 'erro'})` })
    }
    tracker.fileDone()
  }
  tracker.flush()
  return issues
}
