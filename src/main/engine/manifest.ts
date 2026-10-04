// Manifesto de cada backup e marcador da pasta da rotina. Node puro.
//
// Modo pasta:  <dest>/BC Backup/<rotina>/<carimbo>/bcbackup-manifesto.json
// Modo ZIP:    o manifesto vai DENTRO do .zip (última entrada, para quem abrir o arquivo)
//              e também ao lado, em "<carimbo>.zip.manifesto.json" (fonte usada pela retenção,
//              gravado só depois da verificação e do rename final).
// A retenção só apaga backups com manifesto válido cujo routineId é o da rotina.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import yauzl from 'yauzl'
import type { BackupMode, FinalRunStatus, VerifyMode } from '@shared/types'
import { MANIFEST_FILE, ROUTINE_MARKER_FILE } from '@shared/defaults'
import { writeJsonAtomic } from './fsutil'

export const MANIFEST_FORMAT = 'bcbackup-manifesto'
export const ZIP_SIDECAR_SUFFIX = '.manifesto.json'

export interface BackupManifest {
  format: typeof MANIFEST_FORMAT
  version: 1
  routineId: string
  routineName: string
  /** Id da execução que gerou o backup. */
  snapshotId: string
  startedAt: string
  finishedAt: string
  status: Extract<FinalRunStatus, 'success' | 'warning'>
  mode: BackupMode
  files: number
  bytes: number
  /** Modo de verificação aplicado. */
  verify: VerifyMode
  /** true = verificação concluída sem diferenças (ausente no manifesto interno do ZIP). */
  verified?: boolean
  skipped: number
  appVersion: string
  hostname: string
  sources: Array<{ label: string; path: string }>
}

export interface RoutineMarker {
  format: 'bcbackup-rotina'
  routineId: string
  routineName: string
  createdAt: string
}

export function isValidManifest(v: unknown): v is BackupManifest {
  if (!v || typeof v !== 'object') return false
  const m = v as Partial<BackupManifest>
  return (
    m.format === MANIFEST_FORMAT &&
    typeof m.routineId === 'string' &&
    m.routineId.length > 0 &&
    typeof m.snapshotId === 'string' &&
    typeof m.startedAt === 'string' &&
    (m.status === 'success' || m.status === 'warning')
  )
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export async function readFolderManifest(dir: string): Promise<BackupManifest | null> {
  const v = await readJson(join(dir, MANIFEST_FILE))
  return isValidManifest(v) ? v : null
}

export async function writeFolderManifest(dir: string, m: BackupManifest): Promise<void> {
  await writeJsonAtomic(join(dir, MANIFEST_FILE), m)
}

export function zipSidecarPath(zipPath: string): string {
  return `${zipPath}${ZIP_SIDECAR_SUFFIX}`
}

/** Lê o manifesto de um .zip: primeiro o arquivo ao lado; se faltar, a entrada interna. */
export async function readZipManifest(zipPath: string): Promise<BackupManifest | null> {
  const side = await readJson(zipSidecarPath(zipPath))
  if (isValidManifest(side)) return side
  const inner = await readZipEntryText(zipPath, MANIFEST_FILE, 1024 * 1024).catch(() => null)
  if (!inner) return null
  try {
    const v = JSON.parse(inner)
    return isValidManifest(v) ? v : null
  } catch {
    return null
  }
}

/** Lê uma entrada de texto (pequena) de um ZIP. */
export function readZipEntryText(zipPath: string, name: string, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip inválido'))
      let done = false
      const finish = (v: string | null) => {
        if (done) return
        done = true
        zip.close()
        resolve(v)
      }
      zip.on('error', (e) => {
        if (!done) {
          done = true
          reject(e)
        }
      })
      zip.on('end', () => finish(null))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== name || entry.uncompressedSize > maxBytes) return zip.readEntry()
        zip.openReadStream(entry, (e2, rs) => {
          if (e2 || !rs) return finish(null)
          const chunks: Buffer[] = []
          rs.on('data', (c: Buffer) => chunks.push(c))
          rs.on('error', () => finish(null))
          rs.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
        })
      })
      zip.readEntry()
    })
  })
}

export async function readRoutineMarker(routineDir: string): Promise<RoutineMarker | null> {
  const v = (await readJson(join(routineDir, ROUTINE_MARKER_FILE))) as Partial<RoutineMarker> | null
  if (!v || typeof v !== 'object' || typeof v.routineId !== 'string' || !v.routineId) return null
  return v as RoutineMarker
}

export async function writeRoutineMarker(
  routineDir: string,
  routineId: string,
  routineName: string
): Promise<void> {
  const marker: RoutineMarker = {
    format: 'bcbackup-rotina',
    routineId,
    routineName,
    createdAt: new Date().toISOString()
  }
  await writeJsonAtomic(join(routineDir, ROUTINE_MARKER_FILE), marker)
}
