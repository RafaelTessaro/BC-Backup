// Retenção (doc 01 §6) e limpeza de sobras. Node puro.
//
// Algoritmo, por destino, só depois de um backup success/warning NAQUELE destino:
//   snaps  = backups com manifesto válido e routineId igual, do mais novo ao mais antigo
//   corte  = inícioDoDia(hoje) − (dias − 1)        (dias=7 no dia 08 → mantém 02..08)
//   manter = snaps com data >= corte
//   cands  = snaps com data <  corte (do mais novo ao mais antigo)
//   faltam = max(0, minKeep − |manter|)
//   salva os `faltam` primeiros de cands; os demais: renomeia para ".excluindo" e apaga
//   (do mais antigo ao mais novo).
// A data vem do NOME da pasta/zip (carimbo), nunca do mtime.
// Nada que não tenha o nosso manifesto (com o mesmo routineId) é apagado.

import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Retention } from '@shared/types'
import { DELETING_SUFFIX, IN_PROGRESS_SUFFIX } from '@shared/defaults'
import { backupStamp, parseBackupStamp } from '@shared/format'
import { errMessage, pathExists, renameRetry } from './fsutil'
import {
  readFolderManifest,
  readZipManifest,
  zipSidecarPath,
  isValidManifest,
  ZIP_SIDECAR_SUFFIX,
  type BackupManifest
} from './manifest'

const STAMP = String.raw`\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}`
const RE_SNAPSHOT_DIR = new RegExp(`^${STAMP}$`)
const RE_SNAPSHOT_ZIP = new RegExp(`^${STAMP}\\.zip$`)
const RE_IN_PROGRESS_DIR = new RegExp(`^(${STAMP})${escapeRe(IN_PROGRESS_SUFFIX)}$`)
const RE_IN_PROGRESS_ZIP = new RegExp(`^${STAMP}\\.zip${escapeRe(IN_PROGRESS_SUFFIX)}$`)
const RE_DELETING = new RegExp(`^${STAMP}(\\.zip)?${escapeRe(DELETING_SUFFIX)}$`)
const RE_SIDECAR = new RegExp(`^(${STAMP}\\.zip)${escapeRe(ZIP_SIDECAR_SUFFIX)}$`)

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Snapshot {
  name: string
  path: string
  kind: 'dir' | 'zip'
  date: Date
  manifest: BackupManifest
}

export type RetentionPolicy = Pick<Retention, 'enabled' | 'days' | 'minKeep'>

/** Início do dia de calendário local que é o limite inferior dos backups mantidos. */
export function retentionCutoff(days: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
}

/** Seleção pura (doc 01 §6). Devolve os que devem ser apagados, do mais antigo ao mais novo. */
export function selectForDeletion<T extends { date: Date }>(snaps: T[], policy: RetentionPolicy, now: Date): T[] {
  if (!policy.enabled || !(policy.days > 0)) return []
  const cutoff = retentionCutoff(Math.floor(policy.days), now).getTime()
  const sorted = [...snaps].sort((a, b) => b.date.getTime() - a.date.getTime())
  const keep = sorted.filter((s) => s.date.getTime() >= cutoff)
  const cands = sorted.filter((s) => s.date.getTime() < cutoff)
  const missing = Math.max(0, Math.floor(policy.minKeep || 0) - keep.length)
  return cands.slice(missing).reverse()
}

/** Lista os backups válidos (com manifesto desta rotina) de uma pasta de rotina. */
export async function listSnapshots(routineDir: string, routineId: string): Promise<Snapshot[]> {
  let names: string[]
  try {
    names = await readdir(routineDir)
  } catch {
    return []
  }
  const out: Snapshot[] = []
  for (const name of names) {
    const isDirName = RE_SNAPSHOT_DIR.test(name)
    const isZipName = RE_SNAPSHOT_ZIP.test(name)
    if (!isDirName && !isZipName) continue
    const date = parseBackupStamp(name)
    if (!date) continue
    const path = join(routineDir, name)
    let st
    try {
      st = await stat(path)
    } catch {
      continue
    }
    let manifest: BackupManifest | null = null
    if (isDirName && st.isDirectory()) manifest = await readFolderManifest(path)
    else if (isZipName && st.isFile()) manifest = await readZipManifest(path)
    if (!manifest || manifest.routineId !== routineId) continue
    out.push({ name, path, kind: isZipName ? 'zip' : 'dir', date, manifest })
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime())
}

export type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void

/** Apaga um backup: renomeia para ".excluindo" e remove (pasta ou zip + manifesto ao lado). */
export async function deleteSnapshot(s: Snapshot): Promise<void> {
  const deleting = `${s.path}${DELETING_SUFFIX}`
  await renameRetry(s.path, deleting)
  await rm(deleting, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  if (s.kind === 'zip') await rm(zipSidecarPath(s.path), { force: true })
}

/** Aplica a retenção numa pasta de rotina. Devolve os caminhos apagados. */
export async function applyRetention(
  routineDir: string,
  routineId: string,
  policy: RetentionPolicy,
  now: Date,
  log: LogFn = () => {}
): Promise<string[]> {
  if (!policy.enabled || !(policy.days > 0)) return []
  const snaps = await listSnapshots(routineDir, routineId)
  const victims = selectForDeletion(snaps, policy, now)
  const pruned: string[] = []
  for (const v of victims) {
    try {
      await deleteSnapshot(v)
      pruned.push(v.path)
      log('info', `Retenção: backup antigo excluído (${v.name}).`)
    } catch (e) {
      log('warn', `Retenção: não foi possível excluir ${v.name}: ${errMessage(e)}`)
    }
  }
  return pruned
}

/**
 * Limpa sobras de execuções anteriores desta rotina (chamada no início de cada execução):
 *  - "<carimbo>.em-andamento" com manifesto válido desta rotina → finaliza (rename);
 *    sem manifesto → apaga (execução que caiu ou foi interrompida).
 *  - "<carimbo>.zip.em-andamento" → apaga.
 *  - "<carimbo>(.zip).excluindo" → termina a exclusão.
 *  - "<carimbo>.zip.manifesto.json" sem o .zip correspondente → apaga.
 */
export async function cleanupLeftovers(routineDir: string, routineId: string, log: LogFn = () => {}): Promise<void> {
  let names: string[]
  try {
    names = await readdir(routineDir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(routineDir, name)
    try {
      const inProgress = RE_IN_PROGRESS_DIR.exec(name)
      if (inProgress) {
        const st = await stat(path)
        if (!st.isDirectory()) continue
        const manifest = await readFolderManifest(path)
        const finalPath = join(routineDir, inProgress[1])
        if (manifest && manifest.routineId === routineId && !(await pathExists(finalPath))) {
          await renameRetry(path, finalPath)
          log('info', `Backup anterior finalizado: ${inProgress[1]}.`)
        } else {
          await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
          log('info', `Removida a sobra de uma execução interrompida: ${name}.`)
        }
        continue
      }
      if (RE_IN_PROGRESS_ZIP.test(name)) {
        await rm(path, { force: true, recursive: true })
        log('info', `Removida a sobra de uma execução interrompida: ${name}.`)
        continue
      }
      if (RE_DELETING.test(name)) {
        await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
        continue
      }
      const sidecar = RE_SIDECAR.exec(name)
      if (sidecar && !(await pathExists(join(routineDir, sidecar[1])))) {
        const v: unknown = await readFile(path, 'utf8').then(JSON.parse, () => null)
        if (isValidManifest(v) && v.routineId === routineId) await rm(path, { force: true })
      }
    } catch (e) {
      log('warn', `Não foi possível limpar ${name}: ${errMessage(e)}`)
    }
  }
}

/** Carimbo único dentro da pasta da rotina (avança 1 s se já existir). */
export async function uniqueStamp(routineDir: string, start: Date): Promise<string> {
  const d = new Date(start.getTime())
  for (let i = 0; i < 120; i++) {
    const stamp = backupStamp(d)
    const taken = await Promise.all([
      pathExists(join(routineDir, stamp)),
      pathExists(join(routineDir, `${stamp}${IN_PROGRESS_SUFFIX}`)),
      pathExists(join(routineDir, `${stamp}.zip`)),
      pathExists(join(routineDir, `${stamp}.zip${IN_PROGRESS_SUFFIX}`))
    ])
    if (!taken.some(Boolean)) return stamp
    d.setSeconds(d.getSeconds() + 1)
  }
  return backupStamp(d)
}
