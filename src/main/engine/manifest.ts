// Manifesto de cada backup, marcador de cópia em andamento e marcador legado da pasta da rotina.
// Node puro.
//
// Modo pasta:  <dest>/<carimbo>/bcbackup-manifesto.json
// Modo ZIP:    o manifesto vai DENTRO do .zip (última entrada, para quem abrir o arquivo)
//              e também ao lado, em "<carimbo>.zip.manifesto.json" (fonte usada pela retenção,
//              gravado só depois da verificação e do rename final).
// Em andamento: "<carimbo>.em-andamento/" (modo pasta: os arquivos; modo ZIP: o .zip sendo gravado),
//              sempre com "bcbackup-em-andamento.json" gravado ANTES de qualquer arquivo.
// A retenção só apaga backups com manifesto válido cujo routineId é o da rotina; a limpeza de sobras
// só apaga cópias em andamento cujo marcador é desta rotina (e que comprovadamente não estão rodando).

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import yauzl from 'yauzl'
import type { BackupMode, FinalRunStatus, VerifyMode } from '@shared/types'
import { IN_PROGRESS_MARKER_FILE, MANIFEST_FILE, ROUTINE_MARKER_FILE } from '@shared/defaults'
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
  /** O backup veio de uma rotina "Mover": os arquivos podem não existir mais na origem. */
  moveSources?: true
  /**
   * direct = uma origem só: o conteúdo dela está direto na pasta (ou na raiz do ZIP);
   * subfolders = uma subpasta por origem (rótulo). Ausente = backups antigos (sempre subpastas).
   */
  layout?: 'direct' | 'subfolders'
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

/** LEGADO: marcador da pasta "<destino>/BC Backup/<rotina>" (só lido, para achar backups antigos). */
export async function readRoutineMarker(routineDir: string): Promise<RoutineMarker | null> {
  const v = (await readJson(join(routineDir, ROUTINE_MARKER_FILE))) as Partial<RoutineMarker> | null
  if (!v || typeof v !== 'object' || typeof v.routineId !== 'string' || !v.routineId) return null
  return v as RoutineMarker
}

/* ------------------------------------------------------------------ */
/* Cópia em andamento                                                  */
/* ------------------------------------------------------------------ */

export const IN_PROGRESS_FORMAT = 'bcbackup-em-andamento'

/** Quem está gravando uma "<carimbo>.em-andamento" (a pasta do destino pode ser compartilhada). */
export interface InProgressMarker {
  format: typeof IN_PROGRESS_FORMAT
  version: 1
  routineId: string
  routineName: string
  runId: string
  hostname: string
  pid: number
  /** ISO: quando a cópia neste destino começou. */
  startedAt: string
}

export function isValidInProgressMarker(v: unknown): v is InProgressMarker {
  if (!v || typeof v !== 'object') return false
  const m = v as Partial<InProgressMarker>
  return (
    m.format === IN_PROGRESS_FORMAT &&
    typeof m.routineId === 'string' &&
    m.routineId.length > 0 &&
    typeof m.runId === 'string' &&
    typeof m.hostname === 'string' &&
    typeof m.startedAt === 'string'
  )
}

/**
 * Lê o marcador de uma pasta em andamento. 'missing' = comprovadamente não existe (ENOENT);
 * 'unreadable' = existe mas não pôde ser lido/entendido agora (antivírus, rede) — nunca é sobra.
 */
export async function readInProgressMarker(
  workDir: string
): Promise<InProgressMarker | 'missing' | 'unreadable'> {
  let text: string
  try {
    text = await readFile(join(workDir, IN_PROGRESS_MARKER_FILE), 'utf8')
  } catch (e) {
    return (e as { code?: string }).code === 'ENOENT' ? 'missing' : 'unreadable'
  }
  try {
    const v: unknown = JSON.parse(text)
    return isValidInProgressMarker(v) ? v : 'unreadable'
  } catch {
    return 'unreadable'
  }
}

/** Grava o marcador (criação exclusiva: falha se já existir). É a primeira coisa dentro da pasta. */
export async function writeInProgressMarker(workDir: string, m: InProgressMarker): Promise<void> {
  await writeFile(join(workDir, IN_PROGRESS_MARKER_FILE), JSON.stringify(m, null, 2), {
    encoding: 'utf8',
    flag: 'wx'
  })
}
