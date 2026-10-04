// Estrutura no destino: nomes dos backups, reserva atômica do nome e pastas legadas. Node puro.
//
//   <destino>/<AAAA-MM-DD_HH-mm-ss>/                  backup em pasta (arquivos direto dentro)
//   <destino>/<AAAA-MM-DD_HH-mm-ss>.zip               backup em ZIP (+ "<nome>.zip.manifesto.json" ao lado)
//   <destino>/<AAAA-MM-DD_HH-mm-ss>_2/                mesmo segundo já usado (outra rotina, outro PC…)
//   <destino>/<nome>.em-andamento/                    cópia em andamento (modo pasta: os arquivos;
//                                                     modo ZIP: "<nome>.zip" sendo gravado)
//   …/bcbackup-em-andamento.json                      marcador: rotina, execução e computador
//
// A pasta do destino é do usuário e pode ser compartilhada (outras rotinas, outros computadores, arquivos
// quaisquer). Por isso o nome é RESERVADO com um mkdir sem `recursive` (atômico, inclusive em
// compartilhamentos SMB): se já existe, tenta "_2", "_3"… Nunca sobrescrevemos nada.
//
// LEGADO: versões anteriores gravavam em "<destino>/BC Backup/<rotina>/<carimbo>" (pasta marcada com
// ".bcbackup-rotina.json"). Nada novo é criado lá; a retenção só continua contando os backups antigos.

import { lstat, mkdir, readdir, rmdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { BackupMode } from '@shared/types'
import { DELETING_SUFFIX, IN_PROGRESS_SUFFIX, LEGACY_ROOT_DIR } from '@shared/defaults'
import { DestinationError, destinationErrorMessage } from './copy'
import { errCode } from './fsutil'
import { readRoutineMarker, writeInProgressMarker, type InProgressMarker } from './manifest'

/** Carimbo "AAAA-MM-DD_HH-mm-ss" (sem ":", que o Windows não aceita; ordenável como texto). */
export const STAMP_SRC = String.raw`\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}`
/** Carimbo com o sufixo opcional de desempate ("_2", "_3"…). */
export const NAME_SRC = String.raw`${STAMP_SRC}(?:_[1-9]\d{0,3})?`

const RE_NAME = new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_([1-9]\d{0,3}))?$`)

/** Maior sufixo tentado ("_500"): bem além de qualquer uso real no mesmo segundo. */
const MAX_SEQ = 500

export interface SnapshotName {
  /** Data/hora do carimbo (horário local de quem gravou). */
  date: Date
  /** 1 sem sufixo; n para "_n". Desempata backups do mesmo segundo. */
  seq: number
}

/** Interpreta "<carimbo>" ou "<carimbo>_N" (sem extensão). null = não é um nome de backup. */
export function parseSnapshotName(name: string): SnapshotName | null {
  const m = RE_NAME.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  const date = new Date(y, mo - 1, d, h, mi, s)
  if (Number.isNaN(date.getTime())) return null
  // Rejeita datas que o Date "corrige" (ex.: 2026-02-31): não foram geradas por nós. (A hora não é
  // conferida: um horário que caiu numa mudança de horário de verão continua sendo um backup válido.)
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return { date, seq: m[7] ? Number(m[7]) : 1 }
}

/**
 * O caminho existe (sem seguir links: um link quebrado também "ocupa" o nome)? Erro diferente de
 * "não existe" (sem permissão, rede caiu) é problema do destino: falha sem criar nada.
 */
async function occupied(p: string): Promise<boolean> {
  try {
    await lstat(p)
    return true
  } catch (e) {
    const code = errCode(e)
    if (code === 'ENOENT') return false
    throw new DestinationError(destinationErrorMessage(code, e), code || 'EDEST', e)
  }
}

async function anyOccupied(paths: string[]): Promise<boolean> {
  for (const p of paths) if (await occupied(p)) return true
  return false
}

/** Todos os nomes que um backup "<nome>" pode ocupar no destino (pasta, ZIP, em andamento, excluindo). */
function namesFor(destDir: string, name: string): string[] {
  return [
    name,
    `${name}.zip`,
    `${name}${IN_PROGRESS_SUFFIX}`,
    `${name}.zip${IN_PROGRESS_SUFFIX}`,
    `${name}${DELETING_SUFFIX}`,
    `${name}.zip${DELETING_SUFFIX}`
  ].map((n) => join(destDir, n))
}

export interface OutputClaim {
  /** "2026-10-04_18-00-00" ou "2026-10-04_18-00-00_2". */
  name: string
  /** Caminho final: "<destino>/<nome>" (pasta) ou "<destino>/<nome>.zip". */
  finalPath: string
  /** Pasta reservada "<nome>.em-andamento" (nos dois modos), já com o marcador dentro. */
  workDir: string
  /** Modo ZIP: o .zip sendo gravado, dentro de workDir. */
  workZip?: string
}

/**
 * Reserva um nome livre para o backup: "<carimbo>", senão "<carimbo>_2", "_3"…
 * A reserva é o `mkdir` (sem recursive) da pasta "<nome>.em-andamento" — a MESMA nos modos pasta e
 * ZIP, então um nome nunca é usado por duas execuções: se outra (outra rotina, outro PC) pegou o mesmo
 * nome ao mesmo tempo, o mkdir falha com EEXIST e tentamos o próximo.
 * A primeira coisa gravada dentro é o marcador (quem está copiando), antes de qualquer arquivo.
 */
export async function claimOutput(
  destDir: string,
  stamp: string,
  mode: BackupMode,
  marker: InProgressMarker
): Promise<OutputClaim> {
  const fail = (e: unknown): never => {
    const code = errCode(e)
    throw new DestinationError(destinationErrorMessage(code, e), code || 'EDEST', e)
  }
  for (let n = 1; n <= MAX_SEQ; n++) {
    const name = n === 1 ? stamp : `${stamp}_${n}`
    if (await anyOccupied(namesFor(destDir, name))) continue
    const finalPath = join(destDir, mode === 'zip' ? `${name}.zip` : name)
    const workDir = join(destDir, `${name}${IN_PROGRESS_SUFFIX}`)
    try {
      await mkdir(workDir)
    } catch (e) {
      if (errCode(e) === 'EEXIST') continue
      fail(e)
    }
    // Reservado. Se outro computador terminou um backup com este nome entre a checagem e o mkdir,
    // devolve a reserva (a pasta está vazia: rmdir nunca apaga conteúdo) e tenta o próximo.
    if (await anyOccupied([join(destDir, name), join(destDir, `${name}.zip`)])) {
      await rmdir(workDir).catch(() => {})
      continue
    }
    try {
      await writeInProgressMarker(workDir, marker)
    } catch (e) {
      await rmdir(workDir).catch(() => {})
      fail(e)
    }
    return {
      name,
      finalPath,
      workDir,
      ...(mode === 'zip' ? { workZip: join(workDir, `${name}.zip`) } : {})
    }
  }
  throw new DestinationError('Não foi possível reservar um nome livre para o backup no destino.', 'EEXIST')
}

/**
 * LEGADO: pastas "<destino>/BC Backup/<rotina>" desta rotina (marcador ".bcbackup-rotina.json" com o
 * mesmo id). Se o destino escolhido é a própria pasta "BC Backup", as subpastas dele também contam.
 * Links/junções nunca são seguidos. Só leitura: nada é criado aqui.
 */
export async function legacyRoutineDirs(destPath: string, routineId: string): Promise<string[]> {
  const roots = [join(destPath, LEGACY_ROOT_DIR)]
  if (basename(resolve(destPath)).toLowerCase() === LEGACY_ROOT_DIR.toLowerCase()) roots.push(destPath)
  const out: string[] = []
  for (const root of roots) {
    try {
      // A raiz informada pelo usuário (destPath) pode ser um link; "BC Backup" dentro dela, não.
      if (root !== destPath && !(await lstat(root)).isDirectory()) continue
      for (const ent of await readdir(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue // links/junções aparecem como link: ignorados
        const dir = join(root, ent.name)
        if ((await readRoutineMarker(dir))?.routineId === routineId && !out.includes(dir)) out.push(dir)
      }
    } catch {
      // sem pasta legada (o normal) ou ilegível agora: nada a considerar
    }
  }
  return out
}
