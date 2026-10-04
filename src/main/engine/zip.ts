// Modo ZIP: yazl (Zip64 automático, um arquivo aberto por vez) + verificação com yauzl.
// O yauzl NÃO confere CRC-32: na verificação completa calculamos com zlib.crc32 e comparamos.
// Node puro.

import { createWriteStream } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { Transform, Writable, pipeline as pipeCb, type Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import yazl from 'yazl'
import yauzl from 'yauzl'
import type { SkippedFile } from '@shared/types'
import { MANIFEST_FILE } from '@shared/defaults'
import { errCode } from './fsutil'
import { DestinationError, SKIPPABLE_SOURCE, destinationErrorMessage, type EngineHooks, type VerifyIssue } from './copy'
import type { FileItem } from './walk'
import { skipReason } from './walk'
import type { ProgressTracker } from './progress'
import type { BackupManifest } from './manifest'

export interface ZippedFile {
  name: string
  bytes: number
}

export interface ZipTreeResult {
  added: ZippedFile[]
  bytes: number
  skipped: SkippedFile[]
}

const zipName = (rel: string) => rel.replace(/\\/g, '/')

/**
 * Compacta `items` em `outPath` (o chamador usa "<carimbo>.zip.em-andamento" e renomeia depois).
 * Arquivo bloqueado é detectado na abertura e pulado sem corromper o ZIP.
 * `manifest` é chamado no fim para gravar o manifesto como última entrada.
 */
export async function zipTree(
  items: FileItem[],
  outPath: string,
  opts: {
    level: number
    tracker: ProgressTracker
    signal: AbortSignal
    hooks?: EngineHooks
    manifest?: (files: number, bytes: number, skipped: number) => BackupManifest
  }
): Promise<ZipTreeResult> {
  const { tracker, signal } = opts
  const level = Math.max(0, Math.min(9, Math.round(opts.level)))
  const zip = new yazl.ZipFile()
  const ws = createWriteStream(outPath, { flags: 'wx' })
  let writeErr: unknown = null
  ws.once('error', (e) => (writeErr ??= e))
  const out = pipeline(zip.outputStream, ws, { signal })
  const failed = new Promise<never>((_, reject) => {
    out.catch(reject)
    zip.once('error', reject)
  })
  failed.catch(() => {})
  const added: ZippedFile[] = []
  const skipped: SkippedFile[] = []
  let bytes = 0
  let body: Transform | null = null
  try {
    for (const item of items) {
      signal.throwIfAborted()
      tracker.file(item.rel)
      let fh
      try {
        await opts.hooks?.beforeOpen?.(item)
        fh = await open(item.abs, 'r')
      } catch (e) {
        const code = errCode(e)
        if (!SKIPPABLE_SOURCE.has(code)) throw e
        skipped.push({ path: item.abs, reason: skipReason(code) })
        tracker.addBytes(item.size)
        tracker.fileDone()
        continue
      }
      let count = 0
      const rs = fh.createReadStream({ highWaterMark: 1 << 20 })
      const counter = new Transform({
        transform(chunk: Buffer, _e, cb) {
          count += chunk.length
          tracker.addBytes(chunk.length)
          cb(null, chunk)
        }
      })
      body = counter
      pipeCb(rs, counter, () => {})
      zip.addReadStream(counter, zipName(item.rel), { mtime: item.mtime, compressionLevel: level })
      try {
        await Promise.race([finished(counter), failed])
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
      added.push({ name: zipName(item.rel), bytes: count })
      bytes += count
      tracker.fileDone()
    }
    if (opts.manifest) {
      const m = opts.manifest(added.length, bytes, skipped.length)
      zip.addBuffer(Buffer.from(JSON.stringify(m, null, 2), 'utf8'), MANIFEST_FILE, { compressionLevel: level })
    }
    zip.end()
    await Promise.race([out, failed])
    tracker.flush()
    return { added, bytes, skipped }
  } catch (e) {
    body?.destroy()
    ;(zip.outputStream as Readable).destroy()
    ws.destroy()
    await out.catch(() => {})
    await rm(outPath, { force: true }).catch(() => {})
    if (signal.aborted) throw signal.reason ?? e
    if (e instanceof DestinationError) throw e
    const code = errCode(writeErr) || errCode(e)
    throw new DestinationError(destinationErrorMessage(code, writeErr ?? e), code || 'EZIP', e)
  }
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (e, z) => (e || !z ? reject(e ?? new Error('zip')) : resolve(z)))
  )
}

/**
 * Verifica o ZIP: quick = diretório central legível + nomes e tamanhos conferem;
 * full = também descompacta cada entrada e confere o CRC-32.
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
  const totalBytes = mode === 'full' ? expected.reduce((a, f) => a + f.bytes, 0) : 0
  tracker.startVerify(expected.length, totalBytes)
  let zip: yauzl.ZipFile
  try {
    zip = await openZip(zipPath)
  } catch (e) {
    return [{ path: zipPath, reason: `O arquivo ZIP não pôde ser aberto (${e instanceof Error ? e.message : 'erro'})` }]
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
      if (name === MANIFEST_FILE || name.endsWith('/') || !want.has(name)) return zip.readEntry()
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
        pipeline(
          rs,
          new Writable({
            write(chunk: Buffer, _e, cb) {
              crc = crc32(chunk, crc)
              tracker.addBytes(chunk.length)
              cb()
            }
          })
        ).then(
          () => {
            if (crc >>> 0 !== entry.crc32 >>> 0) issues.push({ path: name, reason: 'CRC-32 inválido (conteúdo corrompido)' })
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
