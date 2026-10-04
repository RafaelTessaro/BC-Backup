// Cópia em modo "pasta": streaming arquivo a arquivo, preservando a data de modificação.
// Node puro.
//
// Integridade: cada arquivo é lido UMA vez (o sha256 é calculado sobre os mesmos bytes gravados no
// destino) e, antes e depois da leitura, o tamanho e as datas (mtime/ctime) são conferidos pelo próprio
// handle aberto. Se mudaram, a leitura pode ter misturado a versão antiga e a nova ("leitura rasgada"):
// a cópia é descartada e refeita uma vez; se mudar de novo, o arquivo é pulado com o motivo
// "Arquivo alterado durante a cópia" (aviso). Assim a verificação completa, que compara o destino com o
// que foi lido, nunca certifica uma cópia rasgada.

import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import type { Stats } from 'node:fs'
import { mkdir, open, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SkippedFile } from '@shared/types'
import { errCode, isDirectory } from './fsutil'
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
  /**
   * Depois de ler o arquivo inteiro e antes de conferir se ele mudou durante a leitura (simula outro
   * programa gravando no meio da cópia). `attempt` começa em 1.
   */
  afterRead?: (item: FileItem, attempt: number) => void | Promise<void>
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
  /** Data de modificação da versão copiada (a da leitura; pode ser mais nova que a da varredura). */
  mtime?: Date
}

/** Motivo (pt-BR) do arquivo que mudou durante a leitura duas vezes seguidas. */
export const CHANGED_DURING_COPY = 'Arquivo alterado durante a cópia'
/** Código interno da leitura "rasgada" (o arquivo mudou enquanto era lido). */
export const ECHANGED = 'ECHANGED'

/** O arquivo mudou entre os dois stats (do mesmo handle)? Tamanho, mtime ou ctime diferentes. */
export function changedBetween(before: Stats, after: Stats): boolean {
  return before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
}

/** Erro de leitura rasgada (lado da origem: o arquivo é refeito uma vez e depois pulado). */
export function changedError(path: string): Error {
  return Object.assign(new Error(`${CHANGED_DURING_COPY}: ${path}`), { code: ECHANGED, side: 'src' })
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
 * Cria as pastas de `relDir` (segmentos) DENTRO de `root`, uma a uma, sem `recursive`: nunca recria a
 * própria `root` nem nada acima dela. Se `root` sumiu no meio da execução (disco desconectado; no
 * Linux/macOS o ponto de montagem vazio continua lá), o mkdir falha com ENOENT e o destino falha — o
 * backup nunca é gravado numa pasta recriada pelo caminho (sem o marcador e, talvez, no disco do sistema).
 */
async function mkdirBelow(root: string, relDir: string[], madeDirs?: Set<string>): Promise<void> {
  let cur = root
  for (const seg of relDir) {
    cur = join(cur, seg)
    if (madeDirs?.has(cur)) continue
    try {
      await mkdir(cur)
    } catch (e) {
      // Já existe (inclusive em sistemas que respondem outro código para pasta existente): segue.
      if (errCode(e) !== 'EEXIST' && !(await isDirectory(cur))) throw e
    }
    madeDirs?.add(cur)
  }
}

/**
 * Copia um arquivo. Lança erro com `side` = 'src' (problema na origem → pular) ou
 * 'dst' (problema no destino → falha do destino). Leitura rasgada → erro ECHANGED ('src'), com o
 * arquivo parcial já gravado no destino (quem chama remove).
 */
export async function copyOne(
  item: FileItem,
  destRoot: string,
  onBytes: (n: number) => void,
  signal: AbortSignal,
  hash: boolean,
  hooks?: EngineHooks,
  madeDirs?: Set<string>,
  /** "Mover": força os dados no disco (fsync) antes de fechar — a origem será apagada depois. */
  durable = false,
  attempt = 1,
  /** Caminho relativo no destino (padrão: item.rel; o ZIP usa um nome temporário). */
  dstRel = item.rel
): Promise<CopiedFile> {
  const dst = destPathFor(destRoot, dstRel)
  // Abre a origem primeiro: arquivo em uso/sem permissão é detectado aqui, antes de criar o destino.
  let fh
  let before: Stats
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
      // Pelo handle aberto (fstat): é exatamente o arquivo que vamos ler, mesmo que troquem o nome.
      before = await fh.stat()
    } catch (e) {
      throw Object.assign(e as Error, { side: 'src' })
    }
    try {
      // Só cria pastas DENTRO de `destRoot` (a pasta reservada, com o marcador): ver mkdirBelow.
      await mkdirBelow(destRoot, dstRel.split('/').slice(0, -1), madeDirs)
    } catch (e) {
      throw Object.assign(e as Error, { side: 'dst' })
    }
    const rs = fh.createReadStream({ highWaterMark: 1 << 20, autoClose: false })
    const ws = createWriteStream(dst, { flags: 'wx', flush: durable })
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
    await hooks?.afterRead?.(item, attempt)
    let after: Stats
    try {
      after = await fh.stat()
    } catch (e) {
      throw Object.assign(e as Error, { side: 'src' })
    }
    // Leitura rasgada: o arquivo mudou enquanto era lido (ou o que foi lido não bate com o tamanho).
    if (changedBetween(before, after) || written !== before.size) throw changedError(item.abs)
  } finally {
    await fh.close().catch(() => {})
  }
  let mtimeSet = true
  try {
    await utimes(dst, before.atime, before.mtime)
  } catch {
    // Alguns compartilhamentos de rede não aceitam utimes — não é motivo para falhar.
    mtimeSet = false
  }
  return { item, bytes: written, hash: hasher?.digest('hex'), mtimeSet, mtime: before.mtime }
}

/** Copia todos os itens para `destRoot` (que já deve existir). */
export async function copyTree(
  items: FileItem[],
  destRoot: string,
  tracker: ProgressTracker,
  signal: AbortSignal,
  opts: { hash: boolean; hooks?: EngineHooks; durable?: boolean }
): Promise<CopyTreeResult> {
  const copied: CopiedFile[] = []
  const skipped: SkippedFile[] = []
  const madeDirs = new Set<string>()
  let bytes = 0
  // A pasta de destino existe antes do 1º arquivo (o motor passa a pasta reservada, já criada; quem
  // chama sem criá-la continua funcionando). Daqui em diante o copyOne nunca a recria: se ela sumir no
  // meio da cópia, o destino falha.
  try {
    await mkdir(destRoot, { recursive: true })
  } catch (e) {
    throw new DestinationError(destinationErrorMessage(errCode(e), e), errCode(e) || 'EDEST', e)
  }
  for (const item of items) {
    signal.throwIfAborted()
    tracker.file(item.rel)
    // Bytes já contados no progresso deste arquivo: uma nova tentativa só soma o que passar disso.
    let counted = 0
    for (let attempt = 1; ; attempt++) {
      let partial = 0
      try {
        const r = await copyOne(
          item,
          destRoot,
          (n) => {
            partial += n
            if (partial > counted) {
              tracker.addBytes(partial - counted)
              counted = partial
            }
          },
          signal,
          opts.hash,
          opts.hooks,
          madeDirs,
          opts.durable,
          attempt
        )
        copied.push(r)
        bytes += r.bytes
        break
      } catch (e) {
        if (signal.aborted) throw signal.reason ?? e
        const code = errCode(e)
        const side = (e as { side?: string }).side
        if (side === 'src' && code === ECHANGED) {
          // O arquivo parcial é nosso (criado com "wx" nesta tentativa): sai antes de tentar de novo.
          await rm(destPathFor(destRoot, item.rel), { force: true }).catch(() => {})
          if (attempt < 2) continue
          skipped.push({ path: item.abs, reason: CHANGED_DURING_COPY })
          tracker.addBytes(Math.max(0, item.size - counted))
        } else if (side === 'src' && SKIPPABLE_SOURCE.has(code)) {
          skipped.push({ path: item.abs, reason: skipReason(code) })
          // Mantém o percentual coerente e remove o arquivo parcial do destino.
          tracker.addBytes(Math.max(0, item.size - counted))
          await rm(destPathFor(destRoot, item.rel), { force: true }).catch(() => {})
        } else if (side === 'dst' && code === 'EEXIST') {
          // Destino sem diferença de maiúsculas/acentos (exFAT, NTFS, APFS) e origem com "Foto.jpg" e
          // "foto.jpg": pula só este arquivo. NÃO apaga o caminho — ele é a cópia do outro arquivo.
          skipped.push({
            path: item.abs,
            reason:
              'Já existe um arquivo com o mesmo nome no destino (só muda maiúsculas/minúsculas ou acentos)'
          })
          tracker.addBytes(Math.max(0, item.size - counted))
        } else {
          throw new DestinationError(destinationErrorMessage(code, e), code || 'EDEST', e)
        }
        break
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

/**
 * Verificação do modo pasta: quick = tamanho + data; full = abre de novo CADA arquivo no destino (outro
 * handle, lido do disco — não do fluxo que gravou) e compara o sha256 com o da leitura da origem.
 */
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
        mtimeComparable(c.mtime ?? c.item.mtime) &&
        Math.abs(st.mtime.getTime() - (c.mtime ?? c.item.mtime).getTime()) > MTIME_TOLERANCE_MS
      ) {
        issues.push({ path: dst, reason: 'Data de modificação diferente do original' })
      } else if (mode === 'full' && !c.hash) {
        // Nunca "aprova" sem comparar: verificação completa exige o sha256 da leitura da origem.
        issues.push({ path: dst, reason: 'Sem o sha256 da origem para conferir' })
      } else if (mode === 'full') {
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
