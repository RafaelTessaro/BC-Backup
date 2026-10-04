// Utilitários compartilhados pelos testes.
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Routine } from '@shared/types'
import {
  IN_PROGRESS_MARKER_FILE,
  LEGACY_ROOT_DIR,
  MANIFEST_FILE,
  ROUTINE_MARKER_FILE,
  createDefaultRoutine
} from '@shared/defaults'
import {
  IN_PROGRESS_FORMAT,
  MANIFEST_FORMAT,
  type BackupManifest,
  type InProgressMarker
} from '../src/main/engine/manifest'
import type { StoredRoutine } from '../src/main/store'

export async function tempDir(prefix = 'bcb-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

export async function writeTree(root: string, files: Record<string, string | Buffer>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, ...rel.split('/'))
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, content)
  }
}

export function makeRoutine(patch: Partial<Routine> = {}): StoredRoutine {
  const base = createDefaultRoutine()
  return {
    ...base,
    id: 'rot-1',
    name: 'Financeiro diário',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch
  } as StoredRoutine
}

export function manifest(patch: Partial<BackupManifest> = {}): BackupManifest {
  return {
    format: MANIFEST_FORMAT,
    version: 1,
    routineId: 'rot-1',
    routineName: 'Financeiro diário',
    snapshotId: 'run-x',
    startedAt: '2026-10-01T10:00:00.000Z',
    finishedAt: '2026-10-01T10:05:00.000Z',
    status: 'success',
    mode: 'copy',
    files: 1,
    bytes: 1,
    verify: 'quick',
    skipped: 0,
    appVersion: '0.1.0',
    hostname: 'pc',
    sources: [],
    ...patch
  }
}

/** Cria uma pasta de backup "<stamp>" com manifesto (ou sem, se manifest === null). */
export async function makeSnapshotDir(
  routineDir: string,
  stamp: string,
  m: BackupManifest | null = manifest()
): Promise<string> {
  const p = join(routineDir, stamp)
  await mkdir(p, { recursive: true })
  await writeFile(join(p, 'arquivo.txt'), 'x')
  if (m) await writeFile(join(p, MANIFEST_FILE), JSON.stringify(m))
  return p
}

/** Marcador de cópia em andamento (padrão: rotina rot-1, outra execução, este computador de teste). */
export function inProgressMarker(patch: Partial<InProgressMarker> = {}): InProgressMarker {
  return {
    format: IN_PROGRESS_FORMAT,
    version: 1,
    routineId: 'rot-1',
    routineName: 'Financeiro diário',
    runId: 'run-antigo',
    hostname: 'pc-teste',
    pid: 1234,
    startedAt: new Date().toISOString(),
    ...patch
  }
}

/**
 * Pasta "<nome>.em-andamento" com arquivos parciais e, opcionalmente, o marcador.
 * `ageMs` envelhece a pasta e o marcador (mtime) — sobras de outro PC só saem depois de 12 h paradas.
 */
export async function makeInProgressDir(
  dir: string,
  name: string,
  marker: InProgressMarker | null,
  ageMs = 0
): Promise<string> {
  const p = join(dir, name)
  await mkdir(p, { recursive: true })
  if (marker) await writeFile(join(p, IN_PROGRESS_MARKER_FILE), JSON.stringify(marker))
  await writeFile(join(p, 'parcial.txt'), 'metade')
  if (ageMs) {
    const t = new Date(Date.now() - ageMs)
    if (marker) await utimes(join(p, IN_PROGRESS_MARKER_FILE), t, t)
    await utimes(join(p, 'parcial.txt'), t, t)
    await utimes(p, t, t)
  }
  return p
}

/** Pasta legada "<destino>/BC Backup/<rotina>" com o marcador da rotina (versões anteriores). */
export async function makeLegacyRoutineDir(
  dest: string,
  routineName = 'Financeiro diário',
  routineId = 'rot-1'
): Promise<string> {
  const rd = join(dest, LEGACY_ROOT_DIR, routineName)
  await mkdir(rd, { recursive: true })
  await writeFile(join(rd, ROUTINE_MARKER_FILE), JSON.stringify({ format: 'bcbackup-rotina', routineId }))
  return rd
}
