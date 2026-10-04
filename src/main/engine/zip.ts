// Modo ZIP: yazl (Zip64 automático, um arquivo aberto por vez) + verificação com yauzl.
// O yauzl NÃO confere CRC-32: na verificação completa calculamos com zlib.crc32 e comparamos.
// Node puro.
//
// Integridade (leitura "rasgada": o arquivo muda enquanto é lido): uma entrada que já foi para o ZIP
// não pode ser retirada. Por isso:
//  - arquivos até ZIP_BUFFER_MAX são lidos inteiros para a memória ANTES de entrar no ZIP; tamanho e
//    datas são conferidos (fstat) antes e depois; mudou → lê de novo; mudou de novo → fica de fora
//    ("Arquivo alterado durante a cópia");
//  - arquivos maiores vão direto para o ZIP; se mudaram durante a leitura, este ZIP é descartado e
//    refeito, com esses arquivos copiados antes para uma cópia temporária estável na pasta de trabalho
//    (mesma regra: muda 2× → fica de fora). No máximo MAX_ZIP_ATTEMPTS montagens.
// O sha256 de cada entrada é calculado sobre os mesmos bytes que entram no ZIP e a verificação
// completa descompacta cada entrada relendo o arquivo do disco.

import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform, Writable, pipeline as pipeCb } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import yazl from 'yazl'
import yauzl from 'yauzl'
import type { SkippedFile } from '@shared/types'
import { MANIFEST_FILE } from '@shared/defaults'
import { errCode } from './fsutil'
import {
  CHANGED_DURING_COPY,
  DestinationError,
  ECHANGED,
  SKIPPABLE_SOURCE,
  changedBetween,
  copyOne,
  destinationErrorMessage,
  type EngineHooks,
  type VerifyIssue
} from './copy'
import type { FileItem } from './walk'
import { skipReason } from './walk'
import type { ProgressTracker } from './progress'
import type { BackupManifest } from './manifest'

export interface ZippedFile {
  name: string
  bytes: number
  /** Caminho de origem (o "Mover" usa para saber o que foi conferido). */
  abs?: string
  /** sha256 do conteúdo lido da origem durante a compactação (conferido na verificação completa). */
  sha256?: string
}

export interface ZipTreeResult {
  added: ZippedFile[]
  bytes: number
  skipped: SkippedFile[]
}

/** Arquivos até este tamanho são lidos para a memória (e conferidos) antes de entrar no ZIP. */
export const ZIP_BUFFER_MAX = 32 * 1024 * 1024
/** Montagens do ZIP no máximo (a 2ª e a 3ª só quando um arquivo grande mudou durante a leitura). */
export const MAX_ZIP_ATTEMPTS = 3

const zipName = (rel: string) => rel.replace(/\\/g, '/')

export interface ZipTreeOptions {
  level: number
  tracker: ProgressTracker
  signal: AbortSignal
  hooks?: EngineHooks
  manifest?: (files: number, bytes: number, skipped: number) => BackupManifest
  /** "Mover": força o .zip no disco (fsync) antes de fechar — a origem será apagada depois. */
  durable?: boolean
  /** Pasta (da execução) para as cópias temporárias de arquivos grandes. Padrão: a pasta do .zip. */
  spoolDir?: string
  /** O ZIP vai ser montado de novo (arquivos grandes mudaram durante a leitura). */
  onRedo?: (changed: FileItem[], attempt: number) => void
  /** Limite da leitura para a memória (padrão ZIP_BUFFER_MAX; os testes usam 0 para forçar o fluxo direto). */
  bufferMax?: number
}

/**
 * Compacta `items` em `outPath` (o chamador grava dentro da sua pasta "em andamento" e move depois).
 * Arquivo bloqueado é detectado na abertura e pulado sem corromper o ZIP.
 * `manifest` é chamado no fim para gravar o manifesto como última entrada.
 */
export async function zipTree(
  items: FileItem[],
  outPath: string,
  opts: ZipTreeOptions
): Promise<ZipTreeResult> {
  const spool = new Set<string>()
  for (let attempt = 1; ; attempt++) {
    const r = await zipOnce(items, outPath, opts, spool)
    if (!r.torn.length) return { added: r.added, bytes: r.bytes, skipped: r.skipped }
    // Há entradas que podem misturar duas versões do arquivo: este ZIP nunca é usado.
    await rm(outPath, { force: true })
    if (attempt >= MAX_ZIP_ATTEMPTS) {
      const n = r.torn.length
      throw new DestinationError(
        `${n === 1 ? 'Um arquivo grande mudou' : `${n} arquivos grandes mudaram`} durante a compactação ${MAX_ZIP_ATTEMPTS} vezes seguidas (${r.torn[0].abs}). Tente de novo quando o programa que o grava terminar.`,
        ECHANGED
      )
    }
    for (const t of r.torn) spool.add(t.abs)
    opts.onRedo?.(r.torn, attempt + 1)
    opts.tracker.restartDestination()
  }
}

interface ZipOnceResult extends ZipTreeResult {
  /** Arquivos grandes que mudaram durante a leitura (as entradas deles no ZIP não valem). */
  torn: FileItem[]
}

async function zipOnce(
  items: FileItem[],
  outPath: string,
  opts: ZipTreeOptions,
  spool: Set<string>
): Promise<ZipOnceResult> {
  const { tracker, signal } = opts
  const level = Math.max(0, Math.min(9, Math.round(opts.level)))
  const spoolDir = opts.spoolDir ?? dirname(outPath)
  const bufferMax = opts.bufferMax ?? ZIP_BUFFER_MAX
  const zip = new yazl.ZipFile()
  const ws = createWriteStream(outPath, { flags: 'wx', flush: opts.durable === true })
  let writeErr: unknown = null
  let opened = false
  ws.once('open', () => (opened = true))
  ws.once('error', (e) => (writeErr ??= e))
  const out = pipeline(zip.outputStream, ws, { signal })
  const failed = new Promise<never>((_, reject) => {
    out.catch(reject)
    zip.once('error', reject)
  })
  failed.catch(() => {})
  const added: ZippedFile[] = []
  const skipped: SkippedFile[] = []
  const torn: FileItem[] = []
  let bytes = 0
  let body: Readable | null = null
  let spoolSeq = 0

  /** Põe uma entrada no ZIP e espera o yazl consumi-la (um arquivo por vez). */
  const addEntry = async (rs: Readable, item: FileItem, mtime: Date): Promise<void> => {
    body = rs
    zip.addReadStream(rs, zipName(item.rel), { mtime, compressionLevel: level })
    try {
      await Promise.race([finished(rs), failed])
    } catch (e) {
      if (signal.aborted) throw e
      if (writeErr) throw e
      throw new DestinationError(
        `Falha ao ler "${item.abs}" durante a compactação (${errCode(e) || 'erro'}).`,
        errCode(e) || 'EREAD',
        e
      )
    }
    body = null
  }
  const skip = (item: FileItem, reason: string, counted: number): void => {
    skipped.push({ path: item.abs, reason })
    tracker.addBytes(Math.max(0, item.size - counted))
  }

  try {
    for (const item of items) {
      signal.throwIfAborted()
      tracker.file(item.rel)

      /* Arquivo grande que mudou na montagem anterior: cópia temporária estável primeiro. */
      if (spool.has(item.abs)) {
        const tmpRel = `.bcbackup-temp-${++spoolSeq}`
        const tmp = join(spoolDir, tmpRel)
        let counted = 0
        let reason = CHANGED_DURING_COPY
        let copied: Awaited<ReturnType<typeof copyOne>> | null = null
        for (let attempt = 1; attempt <= 2 && !copied; attempt++) {
          let partial = 0
          await rm(tmp, { force: true })
          try {
            copied = await copyOne(
              item,
              spoolDir,
              (n) => {
                partial += n
                if (partial > counted) {
                  tracker.addBytes(partial - counted)
                  counted = partial
                }
              },
              signal,
              true,
              opts.hooks,
              undefined,
              false,
              attempt,
              tmpRel
            )
          } catch (e) {
            if (signal.aborted) throw e
            const code = errCode(e)
            const side = (e as { side?: string }).side
            await rm(tmp, { force: true }).catch(() => {})
            if (side === 'src' && code === ECHANGED) continue
            if (side === 'src' && SKIPPABLE_SOURCE.has(code)) {
              reason = skipReason(code)
              break
            }
            throw new DestinationError(destinationErrorMessage(code, e), code || 'EDEST', e)
          }
        }
        if (!copied) {
          // Mudou de novo (ou sumiu/ficou bloqueado): fica de fora deste backup.
          skip(item, reason, counted)
          tracker.fileDone()
          continue
        }
        // Relê a cópia temporária (nossa, estável) para dentro do ZIP e confere o sha256 de novo.
        const h = createHash('sha256')
        let n = 0
        const rs = createReadStream(tmp, { highWaterMark: 1 << 20 })
        const counter = new Transform({
          transform(chunk: Buffer, _e, cb) {
            n += chunk.length
            h.update(chunk)
            cb(null, chunk)
          }
        })
        pipeCb(rs, counter, () => {})
        await addEntry(counter, item, copied.mtime ?? item.mtime)
        await rm(tmp, { force: true }).catch(() => {})
        if (h.digest('hex') !== copied.hash || n !== copied.bytes)
          throw new DestinationError(
            `A cópia temporária de "${item.abs}" não confere com o original.`,
            'EVERIFY'
          )
        added.push({ name: zipName(item.rel), bytes: n, abs: item.abs, sha256: copied.hash })
        bytes += n
        tracker.fileDone()
        continue
      }

      let fh
      try {
        await opts.hooks?.beforeOpen?.(item)
        fh = await open(item.abs, 'r')
      } catch (e) {
        const code = errCode(e)
        if (!SKIPPABLE_SOURCE.has(code)) throw e
        skip(item, skipReason(code), 0)
        tracker.fileDone()
        continue
      }
      try {
        let before: Stats
        try {
          before = await fh.stat()
        } catch (e) {
          const code = errCode(e)
          if (!SKIPPABLE_SOURCE.has(code)) throw e
          skip(item, skipReason(code), 0)
          tracker.fileDone()
          continue
        }

        if (before.size <= bufferMax) {
          /* Pequeno: lê inteiro, confere e só então põe no ZIP. */
          let counted = 0
          let done = false
          for (let attempt = 1; attempt <= 2 && !done; attempt++) {
            if (attempt > 1) before = await fh.stat()
            const chunks: Buffer[] = []
            const h = createHash('sha256')
            let n = 0
            try {
              await pipeline(
                fh.createReadStream({ start: 0, highWaterMark: 1 << 20, autoClose: false }),
                new Writable({
                  write(chunk: Buffer, _e, cb) {
                    chunks.push(chunk)
                    h.update(chunk)
                    n += chunk.length
                    if (n > counted) {
                      tracker.addBytes(n - counted)
                      counted = n
                    }
                    cb()
                  }
                }),
                { signal }
              )
            } catch (e) {
              if (signal.aborted) throw e
              const code = errCode(e)
              if (!SKIPPABLE_SOURCE.has(code)) throw e
              skip(item, skipReason(code), counted)
              done = true
              break
            }
            await opts.hooks?.afterRead?.(item, attempt)
            const after = await fh.stat()
            if (changedBetween(before, after) || n !== before.size) {
              if (attempt >= 2) {
                skip(item, CHANGED_DURING_COPY, counted)
                done = true
              }
              continue
            }
            await addEntry(Readable.from(chunks, { objectMode: false }), item, before.mtime)
            added.push({ name: zipName(item.rel), bytes: n, abs: item.abs, sha256: h.digest('hex') })
            bytes += n
            done = true
          }
          tracker.fileDone()
          continue
        }

        /* Grande: direto para o ZIP; se mudou durante a leitura, esta montagem é descartada. */
        let count = 0
        const hasher = createHash('sha256')
        const rs = fh.createReadStream({ start: 0, highWaterMark: 1 << 20, autoClose: false })
        const counter = new Transform({
          transform(chunk: Buffer, _e, cb) {
            count += chunk.length
            hasher.update(chunk)
            tracker.addBytes(chunk.length)
            cb(null, chunk)
          }
        })
        pipeCb(rs, counter, () => {})
        await addEntry(counter, item, before.mtime)
        await opts.hooks?.afterRead?.(item, 1)
        const after = await fh.stat()
        if (changedBetween(before, after) || count !== before.size) {
          torn.push(item)
        } else {
          added.push({ name: zipName(item.rel), bytes: count, abs: item.abs, sha256: hasher.digest('hex') })
          bytes += count
        }
        tracker.fileDone()
      } finally {
        await fh.close().catch(() => {})
      }
    }
    if (opts.manifest) {
      const m = opts.manifest(added.length, bytes, skipped.length)
      zip.addBuffer(Buffer.from(JSON.stringify(m, null, 2), 'utf8'), MANIFEST_FILE, {
        compressionLevel: level
      })
    }
    zip.end()
    await Promise.race([out, failed])
    tracker.flush()
    return { added, bytes, skipped, torn }
  } catch (e) {
    ;(body as Readable | null)?.destroy()
    ;(zip.outputStream as Readable).destroy()
    ws.destroy()
    await out.catch(() => {})
    // Só apaga o que ESTE fluxo criou ("wx"): um EEXIST significa que o arquivo é de outra pessoa.
    if (opened) await rm(outPath, { force: true }).catch(() => {})
    if (signal.aborted) throw signal.reason ?? e
    if (e instanceof DestinationError) throw e
    const code = errCode(writeErr) || errCode(e)
    throw new DestinationError(destinationErrorMessage(code, writeErr ?? e), code || 'EZIP', e)
  }
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (e, z) =>
      e || !z ? reject(e ?? new Error('zip')) : resolve(z)
    )
  )
}

/**
 * Verifica o ZIP: quick = diretório central legível + nomes e tamanhos conferem;
 * full = também descompacta cada entrada (abrindo o arquivo de novo, do disco) e confere o CRC-32 e o
 * sha256 da leitura da origem. Nos dois modos o ZIP precisa ter EXATAMENTE as entradas esperadas
 * (+ o manifesto): entrada a mais, repetida ou faltando é problema.
 */
export async function verifyZip(
  zipPath: string,
  expected: ZippedFile[],
  mode: 'quick' | 'full',
  tracker: ProgressTracker,
  signal: AbortSignal
): Promise<VerifyIssue[]> {
  const issues: VerifyIssue[] = []
  const want = new Map(expected.map((f) => [f.name, f.bytes]))
  const wantHash = new Map(expected.filter((f) => f.sha256).map((f) => [f.name, f.sha256 as string]))
  const totalBytes = mode === 'full' ? expected.reduce((a, f) => a + f.bytes, 0) : 0
  tracker.startVerify(expected.length, totalBytes)
  let zip: yauzl.ZipFile
  try {
    zip = await openZip(zipPath)
  } catch (e) {
    return [
      {
        path: zipPath,
        reason: `O arquivo ZIP não pôde ser aberto (${e instanceof Error ? e.message : 'erro'})`
      }
    ]
  }
  const seen = new Set<string>()
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      zip.close()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    const done = (err?: unknown) => {
      signal.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }
    zip.on('error', (e) => done(e))
    zip.on('end', () => done())
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName
      if (name === MANIFEST_FILE || name.endsWith('/')) return zip.readEntry()
      if (!want.has(name)) {
        issues.push({ path: name, reason: 'Entrada inesperada dentro do ZIP' })
        return zip.readEntry()
      }
      if (seen.has(name)) {
        issues.push({ path: name, reason: 'Entrada repetida dentro do ZIP' })
        return zip.readEntry()
      }
      seen.add(name)
      tracker.file(name)
      if (entry.uncompressedSize !== want.get(name)) {
        issues.push({ path: name, reason: 'Tamanho diferente do original dentro do ZIP' })
        tracker.fileDone()
        return zip.readEntry()
      }
      if (mode !== 'full') {
        tracker.fileDone()
        return zip.readEntry()
      }
      zip.openReadStream(entry, (err, rs) => {
        if (err || !rs) {
          issues.push({ path: name, reason: 'Entrada do ZIP ilegível' })
          tracker.fileDone()
          return zip.readEntry()
        }
        let crc = 0
        const expectedHash = wantHash.get(name)
        const h = expectedHash ? createHash('sha256') : null
        pipeline(
          rs,
          new Writable({
            write(chunk: Buffer, _e, cb) {
              crc = crc32(chunk, crc)
              h?.update(chunk)
              tracker.addBytes(chunk.length)
              cb()
            }
          })
        ).then(
          () => {
            if (crc >>> 0 !== entry.crc32 >>> 0)
              issues.push({ path: name, reason: 'CRC-32 inválido (conteúdo corrompido)' })
            else if (h && h.digest('hex') !== expectedHash)
              issues.push({ path: name, reason: 'Conteúdo diferente do original (hash)' })
            tracker.fileDone()
            zip.readEntry()
          },
          () => {
            issues.push({ path: name, reason: 'Falha ao descompactar a entrada (conteúdo corrompido)' })
            tracker.fileDone()
            zip.readEntry()
          }
        )
      })
    })
    zip.readEntry()
  }).catch((e) => {
    if (signal.aborted) throw signal.reason ?? e
    issues.push({ path: zipPath, reason: `Erro ao ler o ZIP (${e instanceof Error ? e.message : 'erro'})` })
  })
  for (const f of expected) {
    if (!seen.has(f.name)) issues.push({ path: f.name, reason: 'Arquivo ausente no ZIP' })
  }
  tracker.flush()
  return issues
}
