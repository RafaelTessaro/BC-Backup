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
//
// A pasta do destino é do USUÁRIO e pode ser compartilhada por outras rotinas, outros computadores e
// arquivos quaisquer. Para a retenção só existe o que está DIRETO nela, tem nome de backup
// ("<carimbo>", "<carimbo>_N", pasta ou .zip) E tem o manifesto desta rotina (routineId igual). Todo o
// resto é invisível: nunca é apagado. Também contam os backups LEGADOS da rotina
// ("<destino>/BC Backup/<rotina>/<carimbo>", mesma regra), para saírem no prazo; as pastas legadas em si
// nunca são apagadas.
// Links simbólicos/junções nunca são seguidos (lstat): nem contam como backup, nem são limpos.
// O backup que a execução acabou de criar é sempre mantido (conta em `manter`): uma execução que
// atravessa a meia-noite (ou um backup "do futuro" de quando o relógio estava errado) não pode apagá-lo.

import { lstat, readFile, readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Retention } from '@shared/types'
import {
  DELETING_SUFFIX,
  IN_PROGRESS_MARKER_FILE,
  IN_PROGRESS_SUFFIX,
  MANIFEST_FILE,
  STALE_LEFTOVER_MS
} from '@shared/defaults'
import { errCode, errMessage, renameRetry } from './fsutil'
import { NAME_SRC, parseSnapshotName } from './layout'
import {
  isValidManifest,
  readFolderManifest,
  readInProgressMarker,
  readZipEntryText,
  readZipManifest,
  zipSidecarPath,
  ZIP_SIDECAR_SUFFIX,
  type BackupManifest
} from './manifest'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const IN = escapeRe(IN_PROGRESS_SUFFIX)
const RE_SNAPSHOT_DIR = new RegExp(`^(${NAME_SRC})$`)
const RE_SNAPSHOT_ZIP = new RegExp(`^(${NAME_SRC})\\.zip$`)
/** Em andamento (pasta, nos dois modos: arquivos copiados ou o "<nome>.zip" sendo gravado). */
const RE_IN_PROGRESS_DIR = new RegExp(`^(${NAME_SRC})${IN}$`)
/** ZIP em andamento de versões anteriores ("<carimbo>.zip.em-andamento", arquivo solto). */
const RE_IN_PROGRESS_ZIP = new RegExp(`^(${NAME_SRC})\\.zip${IN}$`)
const RE_DELETING = new RegExp(`^(${NAME_SRC})(\\.zip)?${escapeRe(DELETING_SUFFIX)}$`)
const RE_SIDECAR = new RegExp(`^(${NAME_SRC}\\.zip)${escapeRe(ZIP_SIDECAR_SUFFIX)}$`)

export interface Snapshot {
  name: string
  path: string
  kind: 'dir' | 'zip'
  date: Date
  /** Desempate de backups do mesmo segundo ("_2" = 2). */
  seq: number
  manifest: BackupManifest
}

export type RetentionPolicy = Pick<Retention, 'enabled' | 'days' | 'minKeep'>

/** Início do dia de calendário local que é o limite inferior dos backups mantidos. */
export function retentionCutoff(days: number, now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
}

/**
 * Seleção pura (doc 01 §6). Devolve os que devem ser apagados, do mais antigo ao mais novo.
 * `isProtected` marca backups que nunca saem (ex.: o que acabou de ser criado) — contam em `manter`.
 */
export function selectForDeletion<T extends { date: Date; seq?: number }>(
  snaps: T[],
  policy: RetentionPolicy,
  now: Date,
  isProtected: (s: T) => boolean = () => false
): T[] {
  if (!policy.enabled || !(policy.days > 0)) return []
  const cutoff = retentionCutoff(Math.floor(policy.days), now).getTime()
  const sorted = [...snaps].sort(newestFirst)
  const kept = (s: T) => s.date.getTime() >= cutoff || isProtected(s)
  const keep = sorted.filter(kept)
  const cands = sorted.filter((s) => !kept(s))
  const missing = Math.max(0, Math.floor(policy.minKeep || 0) - keep.length)
  return cands.slice(missing).reverse()
}

function newestFirst(a: { date: Date; seq?: number }, b: { date: Date; seq?: number }): number {
  return b.date.getTime() - a.date.getTime() || (b.seq ?? 1) - (a.seq ?? 1)
}

/**
 * Backups válidos DESTA rotina diretamente em `dir` (a pasta do destino ou uma pasta legada da rotina).
 * Só nomes de backup, sem seguir links, com manifesto válido e o mesmo routineId.
 */
export async function listSnapshots(dir: string, routineId: string): Promise<Snapshot[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: Snapshot[] = []
  for (const name of names) {
    const asDir = RE_SNAPSHOT_DIR.exec(name)
    const asZip = asDir ? null : RE_SNAPSHOT_ZIP.exec(name)
    const parsed = parseSnapshotName((asDir ?? asZip)?.[1] ?? '')
    if (!parsed) continue
    const path = join(dir, name)
    let st
    try {
      st = await lstat(path)
    } catch {
      continue
    }
    let manifest: BackupManifest | null = null
    if (asDir && st.isDirectory()) manifest = await readFolderManifest(path)
    else if (asZip && st.isFile()) manifest = await readZipManifest(path)
    if (!manifest || manifest.routineId !== routineId) continue
    out.push({ name, path, kind: asZip ? 'zip' : 'dir', date: parsed.date, seq: parsed.seq, manifest })
  }
  return out.sort(newestFirst)
}

export type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void

/**
 * Apaga uma pasta de backup que já tem nome ".excluindo": primeiro tudo menos o manifesto, depois o
 * manifesto, por último a pasta vazia. Assim uma exclusão interrompida continua identificável
 * (o manifesto é a última coisa a sair) e a próxima execução da MESMA rotina pode terminá-la.
 */
async function removeBackupDir(path: string): Promise<void> {
  const opts = { recursive: true, force: true, maxRetries: 3, retryDelay: 200 } as const
  for (const name of await readdir(path)) if (name !== MANIFEST_FILE) await rm(join(path, name), opts)
  await rm(path, opts)
}

/** Apaga um backup: renomeia para ".excluindo" e remove (pasta, ou zip + manifesto ao lado). */
export async function deleteSnapshot(s: Snapshot): Promise<void> {
  const deleting = `${s.path}${DELETING_SUFFIX}`
  await renameRetry(s.path, deleting)
  if (s.kind === 'zip') {
    await rm(deleting, { force: true, maxRetries: 3, retryDelay: 200 })
    await rm(zipSidecarPath(s.path), { force: true })
  } else {
    await removeBackupDir(deleting)
  }
}

export interface RetentionOptions {
  /** Caminhos (pasta ou .zip) que nunca são apagados — o backup desta execução. */
  protect?: string[]
  /** Id da execução atual: qualquer backup dela (ex.: em 2 destinos que são a mesma pasta) fica. */
  protectSnapshotId?: string
  /** Pastas legadas da rotina ("<destino>/BC Backup/<rotina>"): os backups de lá entram na conta. */
  extraDirs?: string[]
}

/** Aplica a retenção na pasta do destino (+ pastas legadas). Devolve os caminhos apagados. */
export async function applyRetention(
  dir: string,
  routineId: string,
  policy: RetentionPolicy,
  now: Date,
  log: LogFn = () => {},
  opts: RetentionOptions = {}
): Promise<string[]> {
  if (!policy.enabled || !(policy.days > 0)) return []
  const snaps = await listSnapshots(dir, routineId)
  for (const extra of opts.extraDirs ?? []) {
    if (extra !== dir) snaps.push(...(await listSnapshots(extra, routineId)))
  }
  const protect = new Set(opts.protect ?? [])
  const victims = selectForDeletion(
    snaps,
    policy,
    now,
    (s) =>
      protect.has(s.path) || (!!opts.protectSnapshotId && s.manifest.snapshotId === opts.protectSnapshotId)
  )
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

/* ------------------------------------------------------------------ */
/* Limpeza de sobras                                                   */
/* ------------------------------------------------------------------ */

export interface CleanupContext {
  routineId: string
  /** Execução atual: o que ela mesma está gravando nunca é sobra. */
  runId: string
  /** Computador atual: a mesma rotina não roda duas vezes ao mesmo tempo no mesmo computador. */
  hostname: string
  now: Date
  /**
   * Pasta LEGADA desta rotina ("BC Backup/<rotina>", identificada pelo marcador da pasta): lá as sobras
   * não têm o marcador novo (eram da versão anterior) e são tratadas como desta rotina, de outro
   * computador (só saem depois de STALE_LEFTOVER_MS sem alteração).
   */
  legacy?: boolean
}

const sameHost = (a: string | undefined, b: string): boolean =>
  !!a && a.trim().toLowerCase() === b.trim().toLowerCase()

/** Mais recente entre os instantes conhecidos (mtime da sobra, início no marcador…), em ms. */
function newest(times: Array<number | undefined>): number {
  return Math.max(...times.map((t) => (typeof t === 'number' && Number.isFinite(t) ? t : -Infinity)))
}

/** Sem nenhuma alteração há STALE_LEFTOVER_MS? (data no futuro = não está parada) */
function stale(ctx: CleanupContext, times: Array<number | undefined>): boolean {
  const t = newest(times)
  return Number.isFinite(t) && ctx.now.getTime() - t >= STALE_LEFTOVER_MS
}

async function mtimeOf(p: string): Promise<number | undefined> {
  return lstat(p).then(
    (s) => s.mtimeMs,
    () => undefined
  )
}

/** true só quando `p` comprovadamente não existe (ENOENT). */
async function missing(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return false
  } catch (e) {
    return errCode(e) === 'ENOENT'
  }
}

async function isEmptyDir(p: string): Promise<boolean> {
  return readdir(p).then(
    (n) => n.length === 0,
    () => false
  )
}

/** Manifesto do .zip que está sendo excluído: o arquivo ao lado (do nome original) ou o interno. */
async function deletingZipManifest(
  deletingPath: string,
  originalZip: string
): Promise<BackupManifest | null> {
  const side: unknown = await readFile(zipSidecarPath(originalZip), 'utf8').then(JSON.parse, () => null)
  if (isValidManifest(side)) return side
  const inner = await readZipEntryText(deletingPath, MANIFEST_FILE, 1024 * 1024).catch(() => null)
  if (!inner) return null
  try {
    const v: unknown = JSON.parse(inner)
    return isValidManifest(v) ? v : null
  } catch {
    return null
  }
}

/**
 * Limpa sobras de execuções anteriores DESTA rotina em `dir` (chamada antes de cada cópia).
 *
 * "<nome>.em-andamento" (pasta com o marcador `bcbackup-em-andamento.json`; no modo ZIP o .zip fica dentro):
 *  - com manifesto válido desta rotina (backup completo que não recebeu o nome final) → finaliza (rename);
 *  - marcador desta rotina, de OUTRA execução, deste computador (a mesma rotina não roda 2× ao mesmo
 *    tempo aqui) ou parado há ≥ 12 h → apaga (execução que caiu ou foi interrompida);
 *  - marcador de outra rotina, ou desta rotina em outro computador e recente → não mexe (pode estar
 *    rodando agora, numa pasta de rede compartilhada);
 *  - sem marcador → nunca apaga (só registra); exceção: pasta VAZIA parada há ≥ 12 h (rmdir).
 *  - manifesto ou marcador presentes mas ilegíveis agora (antivírus, rede) → não mexe.
 * "<nome>(.zip).excluindo" desta rotina (manifesto) → termina a exclusão; vazia → rmdir.
 * "<nome>.zip.manifesto.json" desta rotina sem o .zip → apaga.
 * Links/junções nunca são seguidos nem apagados.
 */
export async function cleanupLeftovers(
  dir: string,
  ctx: CleanupContext,
  log: LogFn = () => {}
): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const rmOpts = { recursive: true, force: true, maxRetries: 3, retryDelay: 200 } as const
  // Exclusões interrompidas e cópias em andamento primeiro; manifestos órfãos depois (dependem delas).
  const order = (n: string) => (RE_SIDECAR.test(n) ? 1 : 0)
  for (const name of [...names].sort((a, b) => order(a) - order(b))) {
    const path = join(dir, name)
    try {
      const workDir = RE_IN_PROGRESS_DIR.exec(name)
      const workZip = workDir ? null : RE_IN_PROGRESS_ZIP.exec(name)
      const deleting = RE_DELETING.exec(name)
      const sidecar = RE_SIDECAR.exec(name)
      if (!workDir && !workZip && !deleting && !sidecar) continue
      const st = await lstat(path).catch(() => null)
      if (!st || st.isSymbolicLink()) continue

      /* --------------------------- em andamento --------------------------- */
      if (workDir || workZip) {
        const base = (workDir ?? workZip)![1]
        if (st.isFile() && workZip) {
          // ZIP em andamento de uma versão anterior (arquivo solto, sem marcador).
          if (ctx.legacy && stale(ctx, [st.mtimeMs])) {
            await rm(path, { force: true })
            log('info', `Removida a sobra de uma execução interrompida: ${name}.`)
          } else if (!ctx.legacy) {
            log('info', `Cópia em andamento sem identificação deixada como está: ${name}.`)
          }
          continue
        }
        if (!st.isDirectory()) continue
        const marker = await readInProgressMarker(path)
        const markerTime = await mtimeOf(join(path, IN_PROGRESS_MARKER_FILE))
        // Modo pasta: backup completo (manifesto gravado depois da verificação) sem o nome final.
        if (workDir) {
          const manifest = await readFolderManifest(path)
          if (manifest) {
            // De outra rotina, ou desta mesma execução (2 destinos que são a mesma pasta): não mexe.
            if (manifest.routineId !== ctx.routineId || manifest.snapshotId === ctx.runId) continue
            const finalPath = join(dir, base)
            const mine =
              sameHost(manifest.hostname, ctx.hostname) ||
              stale(ctx, [st.mtimeMs, Date.parse(manifest.finishedAt), markerTime])
            if (!mine) {
              log('info', `Backup de outro computador ainda sendo finalizado, deixado como está: ${name}.`)
            } else if (!(await missing(finalPath))) {
              log('warn', `Backup completo deixado como está (não pôde receber o nome final): ${name}.`)
            } else {
              await rm(join(path, IN_PROGRESS_MARKER_FILE), { force: true, maxRetries: 3, retryDelay: 100 })
              await renameRetry(path, finalPath)
              log('info', `Backup anterior finalizado: ${base}.`)
            }
            continue
          }
          // Só é sobra quando o manifesto NÃO existe (gravado por último, de forma atômica). Se ele
          // existe mas não pôde ser lido agora (antivírus, rede instável), pode ser um backup completo
          // que não recebeu o nome final — com "Mover", a única cópia neste destino.
          if (!(await missing(join(path, MANIFEST_FILE)))) {
            if (marker === 'missing' || marker === 'unreadable' || marker.routineId === ctx.routineId)
              log('warn', `Backup deixado como está (o manifesto não pôde ser lido agora): ${name}.`)
            continue
          }
        }
        if (marker === 'unreadable') {
          log('warn', `Cópia em andamento deixada como está (o marcador não pôde ser lido agora): ${name}.`)
          continue
        }
        if (marker === 'missing') {
          if (ctx.legacy) {
            // Versão anterior: a pasta da rotina era só dela. Parada há 12 h → execução que caiu.
            if (stale(ctx, [st.mtimeMs])) {
              await rm(path, rmOpts)
              log('info', `Removida a sobra de uma execução interrompida: ${name}.`)
            }
          } else if (stale(ctx, [st.mtimeMs]) && (await isEmptyDir(path))) {
            // Reserva sem marcador (o programa caiu entre o mkdir e o marcador): vazia, nada a perder.
            await rmdir(path).catch(() => {})
          } else {
            log('info', `Cópia em andamento sem identificação deixada como está: ${name}.`)
          }
          continue
        }
        if (marker.routineId !== ctx.routineId || marker.runId === ctx.runId) continue
        const abandoned =
          sameHost(marker.hostname, ctx.hostname) ||
          stale(ctx, [st.mtimeMs, Date.parse(marker.startedAt), markerTime])
        if (abandoned) {
          await rm(path, rmOpts)
          log('info', `Removida a sobra de uma execução interrompida: ${name}.`)
        } else {
          log(
            'info',
            `Cópia em andamento de outro computador (${marker.hostname || 'sem nome'}) deixada como está: ${name}.`
          )
        }
        continue
      }

      /* ----------------------- exclusão interrompida ---------------------- */
      if (deleting) {
        const isZip = !!deleting[2]
        if (!isZip && st.isDirectory()) {
          const manifest = await readFolderManifest(path)
          if (manifest?.routineId === ctx.routineId) await removeBackupDir(path)
          else if (await isEmptyDir(path)) await rmdir(path).catch(() => {})
          else if (ctx.legacy && !manifest && (await missing(join(path, MANIFEST_FILE))))
            // Versão anterior apagava com rm -r (o manifesto pode ter saído antes): a pasta era da rotina.
            await rm(path, rmOpts)
        } else if (isZip && st.isFile()) {
          const original = join(dir, `${deleting[1]}.zip`)
          const manifest = await deletingZipManifest(path, original)
          if (manifest?.routineId === ctx.routineId || (ctx.legacy && !manifest)) {
            await rm(path, { force: true })
            if (manifest?.routineId === ctx.routineId && (await missing(original)))
              await rm(zipSidecarPath(original), { force: true })
          }
        }
        continue
      }

      /* ------------------------- manifesto órfão -------------------------- */
      if (sidecar && st.isFile()) {
        const zip = join(dir, sidecar[1])
        if (!(await missing(zip)) || !(await missing(`${zip}${DELETING_SUFFIX}`))) continue
        const v: unknown = await readFile(path, 'utf8').then(JSON.parse, () => null)
        if (isValidManifest(v) && v.routineId === ctx.routineId) await rm(path, { force: true })
      }
    } catch (e) {
      log('warn', `Não foi possível limpar ${name}: ${errMessage(e)}`)
    }
  }
}
