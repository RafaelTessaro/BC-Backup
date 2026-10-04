// Execução completa de uma rotina (doc 01 §3). Node puro: roda no utilityProcess
// (src/main/engine/worker.ts) ou direto nos testes.
//
// Fluxo: varre as origens UMA vez → para cada destino ativo, em sequência e de forma independente:
//   1) destino acessível? 2) espaço livre ≥ bytes × 1,05? 3) pasta da rotina + marcador + limpeza de sobras
//   4) copia (ou compacta) em "<carimbo>.em-andamento" preservando a data de modificação
//   5) verifica 6) grava o manifesto e renomeia para o nome final 7) retenção (só se 1–6 deram certo)
// Status: success = tudo copiado em todos os destinos · warning = concluído com arquivos pulados ·
// failed = origem ausente, nada a copiar, ou QUALQUER destino falhou · cancelled.

import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DestinationResult,
  FinalRunStatus,
  LogEntry,
  LogLevel,
  SkippedFile,
  SourceItem
} from '@shared/types'
import { BACKUP_ROOT_DIR, IN_PROGRESS_SUFFIX } from '@shared/defaults'
import { formatBytes } from '@shared/format'
import {
  DestinationError,
  copyTree,
  destinationErrorMessage,
  verifyCopiedFiles,
  type EngineHooks,
  type VerifyIssue
} from './copy'
import {
  diskSpaceOf,
  errCode,
  errMessage,
  pathExists,
  renameRetry,
  sanitizeName,
  withTimeout,
  writeJsonAtomic
} from './fsutil'
import {
  MANIFEST_FORMAT,
  readRoutineMarker,
  writeFolderManifest,
  writeRoutineMarker,
  zipSidecarPath,
  type BackupManifest
} from './manifest'
import { ProgressTracker } from './progress'
import { applyRetention, cleanupLeftovers, uniqueStamp } from './retention'
import type { EngineEvent, JobResult, JobSpec } from './types'
import { emptyWalkStats, makeFilter, skipReason, walk, type FileItem, type WalkIssue } from './walk'
import { verifyZip, zipTree } from './zip'

export interface JobOptions {
  now?: () => Date
  hooks?: EngineHooks
  /** Intervalo mínimo entre eventos de progresso (padrão 250 ms → ≤ 4/s). */
  progressIntervalMs?: number
  /** Tempo limite para checar se um destino/origem responde (padrão 15 s). */
  accessTimeoutMs?: number
}

/** Limite de entradas de log por execução (o resto é resumido). */
export const MAX_LOG_ENTRIES = 5000
/** Limite de arquivos pulados listados por destino (a contagem continua exata). */
export const MAX_SKIPPED_LISTED = 2000
/** Quantos arquivos pulados aparecem individualmente no log. */
const MAX_SKIPPED_LOGGED = 200

const TRIGGER_LABEL: Record<JobSpec['trigger'], string> = {
  manual: 'execução manual',
  schedule: 'agendada',
  startup: 'ao iniciar o computador',
  'catch-up': 'backup atrasado'
}

export interface SourceSlot {
  source: SourceItem
  /** Nome da subpasta (ou do arquivo) no backup. */
  name: string
  /** true = os arquivos ficam em "<name>/…"; false = arquivo único gravado como "<name>". */
  folder: boolean
}

function lastSegment(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] ?? ''
}

function defaultSourceName(path: string): string {
  const seg = lastSegment(path)
  const drive = /^([a-zA-Z]):$/.exec(seg)
  if (drive) return `Disco ${drive[1].toUpperCase()}`
  return seg || 'Raiz'
}

function withSuffix(name: string, n: number, isFile: boolean): string {
  if (!isFile) return `${name} (${n})`
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`
}

/** Nomes das origens dentro do backup, únicos (sem diferenciar maiúsculas). */
export function sourceSlots(sources: SourceItem[]): SourceSlot[] {
  const used = new Set<string>()
  return sources.map((source) => {
    const explicit = source.label?.trim()
    const folder = source.kind !== 'file' || !!explicit
    const base = sanitizeName(explicit || defaultSourceName(source.path), 'Origem')
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = withSuffix(base, n, !folder)
    used.add(name.toLowerCase())
    return { source, name, folder }
  })
}

/**
 * Pasta "<destino>/BC Backup/<rotina>" com o marcador `.bcbackup-rotina.json`.
 * Se a rotina mudou de nome, reaproveita (e tenta renomear) a pasta antiga marcada com o mesmo id;
 * se o nome já pertence a outra rotina, usa "<nome> (2)".
 */
export async function resolveRoutineDir(
  destPath: string,
  routine: { id: string; name: string },
  log: (level: LogLevel, message: string) => void = () => {}
): Promise<string> {
  const base = join(destPath, BACKUP_ROOT_DIR)
  try {
    await mkdir(base, { recursive: true })
  } catch (e) {
    const code = errCode(e)
    throw new DestinationError(destinationErrorMessage(code, e), code || 'EDEST', e)
  }
  const desired = sanitizeName(routine.name)
  let entries: string[]
  try {
    entries = (await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    entries = []
  }
  for (const name of entries) {
    const marker = await readRoutineMarker(join(base, name))
    if (marker?.routineId !== routine.id) continue
    if (name !== desired && !(await pathExists(join(base, desired)))) {
      try {
        await renameRetry(join(base, name), join(base, desired), 3)
        log('info', `Pasta da rotina renomeada de "${name}" para "${desired}".`)
        return join(base, desired)
      } catch {
        // Pasta aberta no Explorer, por exemplo: segue usando o nome antigo.
      }
    }
    return join(base, name)
  }
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? desired : `${desired} (${n})`
    const dir = join(base, candidate)
    const marker = await readRoutineMarker(dir)
    if (marker && marker.routineId !== routine.id) continue
    try {
      await mkdir(dir, { recursive: true })
      await writeRoutineMarker(dir, routine.id, routine.name)
    } catch (e) {
      const code = errCode(e)
      throw new DestinationError(destinationErrorMessage(code, e), code || 'EDEST', e)
    }
    return dir
  }
  throw new DestinationError('Não foi possível criar a pasta da rotina no destino.', 'EDEST')
}

function verifyFailureMessage(issues: VerifyIssue[]): string {
  const n = issues.length
  const first = issues[0]
  return `A verificação encontrou ${n} ${n === 1 ? 'arquivo diferente' : 'arquivos diferentes'} do original (${first.path}: ${first.reason}).`
}

export async function runJob(
  spec: JobSpec,
  onEvent: (e: EngineEvent) => void,
  signal: AbortSignal,
  opts: JobOptions = {}
): Promise<JobResult> {
  const now = opts.now ?? (() => new Date())
  const accessTimeout = opts.accessTimeoutMs ?? 15_000
  const routine = spec.routine
  const log: LogEntry[] = []
  let dropped = 0
  const L = (level: LogLevel, message: string) => {
    const entry: LogEntry = { t: now().toISOString(), level, message }
    if (log.length < MAX_LOG_ENTRIES) log.push(entry)
    else dropped++
    onEvent({ type: 'log', entry })
  }
  const enabledDests = routine.destinations.filter((d) => d.enabled !== false)
  const tracker = new ProgressTracker(
    {
      runId: spec.runId,
      routineId: routine.id,
      routineName: routine.name,
      startedAt: spec.startedAt,
      destinationCount: Math.max(1, enabledDests.length)
    },
    (progress) => onEvent({ type: 'progress', progress }),
    () => now().getTime(),
    opts.progressIntervalMs ?? 250
  )

  const skippedCounts = new Map<DestinationResult, number>()
  const result: JobResult = {
    status: 'failed',
    finishedAt: '',
    filesTotal: 0,
    bytesTotal: 0,
    filesCopied: 0,
    bytesCopied: 0,
    filesSkipped: 0,
    warnings: 0,
    errors: 0,
    destinations: [],
    log
  }
  const finish = (status: FinalRunStatus, errorMessage?: string): JobResult => {
    result.status = status
    if (errorMessage) result.errorMessage = errorMessage
    if (dropped)
      log.push({
        t: now().toISOString(),
        level: 'warn',
        message: `… e mais ${dropped} linhas de log omitidas.`
      })
    result.finishedAt = now().toISOString()
    tracker.phase('done')
    return result
  }
  const fail = (message: string): JobResult => {
    L('error', message)
    result.errors = Math.max(1, result.errors)
    return finish('failed', message)
  }

  L('info', `Início do backup "${routine.name}" (${TRIGGER_LABEL[spec.trigger] ?? spec.trigger}).`)

  try {
    if (!routine.sources.length) return fail('Nenhuma origem configurada nesta rotina.')
    if (!enabledDests.length) return fail('Nenhum destino ativo nesta rotina.')

    /* ---------------------------- varredura ---------------------------- */
    tracker.phase('scanning')
    const slots = sourceSlots(routine.sources)
    const missing: string[] = []
    for (const slot of slots) {
      const ok = await withTimeout(stat(slot.source.path), accessTimeout).then(
        () => true,
        () => false
      )
      if (!ok) missing.push(slot.source.path)
    }
    signal.throwIfAborted()
    if (missing.length) {
      return fail(
        `${missing.length === 1 ? 'Origem não encontrada' : 'Origens não encontradas'}: ${missing.join(', ')}. ` +
          'Verifique se a pasta existe e se o disco está conectado.'
      )
    }

    const filter = makeFilter(routine.filters)
    const items: FileItem[] = []
    const issues: WalkIssue[] = []
    const stats = emptyWalkStats()
    let totalBytes = 0
    for (const slot of slots) {
      for await (const f of walk(slot.source.path, filter, issues, stats, signal)) {
        const rel = slot.folder ? `${slot.name}/${f.rel}` : slot.name
        items.push({ ...f, rel })
        totalBytes += f.size
        tracker.scanned(items.length, totalBytes)
      }
    }
    tracker.scanned(items.length, totalBytes)
    result.filesTotal = items.length
    result.bytesTotal = totalBytes

    const walkSkipped: SkippedFile[] = issues.map((i) => ({
      path: i.path,
      reason: skipReason(i.code, i.dir)
    }))
    L('info', `Encontrados ${items.length.toLocaleString('pt-BR')} arquivos (${formatBytes(totalBytes)}).`)
    if (stats.tooBig) L('info', `${stats.tooBig} arquivo(s) ignorado(s) por passar do tamanho máximo.`)
    if (stats.hidden) L('info', `${stats.hidden} arquivo(s) oculto(s) ou de sistema ignorado(s).`)
    if (stats.links) L('info', `${stats.links} atalho(s)/link(s) simbólico(s) ignorado(s).`)
    walkSkipped.slice(0, MAX_SKIPPED_LOGGED).forEach((s) => L('warn', `Ignorado: ${s.path} — ${s.reason}`))

    if (!items.length) {
      return fail(
        'Nenhum arquivo para copiar: as origens estão vazias ou os filtros excluem todos os arquivos.'
      )
    }

    const longest = items.reduce((m, it) => Math.max(m, it.rel.length), 0)

    /* ---------------------------- destinos ----------------------------- */
    const startedAt = new Date(spec.startedAt)
    for (let i = 0; i < enabledDests.length; i++) {
      if (signal.aborted) break
      const dest = enabledDests[i]
      const name = dest.label ? `${dest.label} (${dest.path})` : dest.path
      const res: DestinationResult = {
        destinationId: dest.id,
        path: dest.path,
        label: dest.label,
        status: 'failed',
        filesCopied: 0,
        bytesCopied: 0,
        skipped: [],
        pruned: []
      }
      let skippedAll: SkippedFile[] = [...walkSkipped]
      let workPath: string | null = null
      let keepWork = false
      tracker.startDestination(i, dest.path, items.length, totalBytes)
      L('info', `Destino ${i + 1} de ${enabledDests.length}: ${name}`)
      try {
        // 1) acessível?
        const st = await withTimeout(stat(dest.path), accessTimeout).catch(() => null)
        if (!st || !st.isDirectory()) {
          throw new DestinationError(
            'Destino indisponível: verifique se o disco está conectado.',
            'EUNAVAILABLE'
          )
        }
        // 2) pasta da rotina, marcador e sobras de execuções anteriores (libera espaço antes da checagem)
        const routineDir = await resolveRoutineDir(dest.path, routine, L)
        await cleanupLeftovers(routineDir, routine.id, L)
        // 3) espaço livre ≥ bytes × 1,05
        const need = Math.ceil(totalBytes * 1.05)
        const space = await diskSpaceOf(dest.path, accessTimeout).catch(() => null)
        if (space && space.free < need) {
          throw new DestinationError(
            `Sem espaço em ${dest.path} (faltam ${formatBytes(need - space.free)}).`,
            'ENOSPC'
          )
        }
        if (routineDir.length + longest + 25 > 240) {
          L(
            'warn',
            'Alguns caminhos no destino passam de 240 caracteres; o Explorer do Windows pode ter dificuldade para abri-los.'
          )
        }
        const stamp = await uniqueStamp(routineDir, startedAt)
        const manifest = (
          files: number,
          bytes: number,
          skipped: number,
          verified?: boolean
        ): BackupManifest => ({
          format: MANIFEST_FORMAT,
          version: 1,
          routineId: routine.id,
          routineName: routine.name,
          snapshotId: spec.runId,
          startedAt: spec.startedAt,
          finishedAt: now().toISOString(),
          status: skipped > 0 ? 'warning' : 'success',
          mode: routine.mode,
          files,
          bytes,
          verify: routine.verify,
          ...(verified === undefined ? {} : { verified }),
          skipped,
          appVersion: spec.appVersion,
          hostname: spec.hostname,
          sources: slots.map((s) => ({ label: s.name, path: s.source.path }))
        })

        if (routine.mode === 'zip') {
          // 4) compacta em "<carimbo>.zip.em-andamento"
          const finalPath = join(routineDir, `${stamp}.zip`)
          const work = `${finalPath}${IN_PROGRESS_SUFFIX}`
          workPath = work
          const z = await zipTree(items, work, {
            level: routine.zipLevel ?? 6,
            tracker,
            signal,
            hooks: opts.hooks,
            manifest: (files, bytes, skipped) => manifest(files, bytes, skipped + walkSkipped.length)
          })
          skippedAll = [...walkSkipped, ...z.skipped]
          // 5) verifica
          if (routine.verify !== 'none') {
            const vi = await verifyZip(work, z.added, routine.verify, tracker, signal)
            if (vi.length) throw new DestinationError(verifyFailureMessage(vi), 'EVERIFY')
            L(
              'info',
              `Verificação ${routine.verify === 'full' ? 'completa' : 'rápida'} do ZIP concluída sem diferenças.`
            )
          }
          // 6) nome final + manifesto ao lado (fonte da retenção)
          await renameRetry(work, finalPath)
          workPath = null
          await writeJsonAtomic(
            zipSidecarPath(finalPath),
            manifest(z.added.length, z.bytes, skippedAll.length, routine.verify !== 'none')
          )
          res.outputPath = finalPath
          res.filesCopied = z.added.length
          res.bytesCopied = z.bytes
        } else {
          // 4) copia para "<carimbo>.em-andamento"
          const finalPath = join(routineDir, stamp)
          const work = `${finalPath}${IN_PROGRESS_SUFFIX}`
          workPath = work
          await mkdir(work, { recursive: true }).catch((e) => {
            throw new DestinationError(destinationErrorMessage(errCode(e), e), errCode(e) || 'EDEST', e)
          })
          const c = await copyTree(items, work, tracker, signal, {
            hash: routine.verify === 'full',
            hooks: opts.hooks
          })
          skippedAll = [...walkSkipped, ...c.skipped]
          // 5) verifica
          if (routine.verify !== 'none') {
            const vi = await verifyCopiedFiles(c.copied, work, routine.verify, tracker, signal)
            if (vi.length) throw new DestinationError(verifyFailureMessage(vi), 'EVERIFY')
            L(
              'info',
              `Verificação ${routine.verify === 'full' ? 'completa' : 'rápida'} concluída sem diferenças.`
            )
          }
          // 6) manifesto + rename
          await writeFolderManifest(
            work,
            manifest(
              c.copied.length,
              c.bytes,
              skippedAll.length,
              routine.verify === 'none' ? undefined : true
            )
          )
          res.filesCopied = c.copied.length
          res.bytesCopied = c.bytes
          try {
            await renameRetry(work, finalPath)
            res.outputPath = finalPath
            workPath = null
          } catch (e) {
            // Backup completo e com manifesto: fica com o nome provisório e é finalizado na próxima execução.
            keepWork = true
            res.outputPath = work
            skippedAll.push({
              path: work,
              reason: `A pasta não pôde ser renomeada (${errCode(e) || 'bloqueada'}); será finalizada na próxima execução`
            })
            L(
              'warn',
              `Não foi possível dar o nome final à pasta do backup (${errCode(e) || errMessage(e)}). Ela será finalizada na próxima execução.`
            )
          }
        }

        res.status = skippedAll.length ? 'warning' : 'success'
        skippedAll
          .slice(walkSkipped.length, walkSkipped.length + MAX_SKIPPED_LOGGED)
          .forEach((s) => L('warn', `Ignorado: ${s.path} — ${s.reason}`))
        L(
          res.status === 'success' ? 'info' : 'warn',
          `${name}: ${res.filesCopied.toLocaleString('pt-BR')} arquivos (${formatBytes(res.bytesCopied)})` +
            (skippedAll.length ? `, ${skippedAll.length} ignorado(s).` : '.')
        )

        // 7) retenção — só depois de um backup concluído neste destino
        if (routine.retention.enabled && !keepWork) {
          tracker.phase('pruning')
          res.pruned = await applyRetention(routineDir, routine.id, routine.retention, now(), L)
        }
      } catch (e) {
        if (workPath && !keepWork)
          await rm(workPath, { recursive: true, force: true, maxRetries: 2 }).catch(() => {})
        if (signal.aborted) {
          res.status = 'cancelled'
          res.error = 'Execução cancelada.'
          L('warn', `${name}: execução cancelada; a cópia parcial foi removida.`)
        } else {
          res.status = 'failed'
          res.error = e instanceof DestinationError ? e.message : destinationErrorMessage(errCode(e), e)
          L('error', `${name}: ${res.error}`)
        }
      }
      res.skipped = skippedAll.slice(0, MAX_SKIPPED_LISTED)
      skippedCounts.set(res, skippedAll.length)
      const after = await diskSpaceOf(dest.path, 3000).catch(() => null)
      if (after) res.freeBytesAfter = after.free
      result.destinations.push(res)
      if (res.status === 'cancelled') break
    }
  } catch (e) {
    if (!signal.aborted) return fail(`Erro inesperado: ${errMessage(e)}`)
  }

  /* ---------------------------- resultado ---------------------------- */
  const dests = result.destinations
  const skippedCount = (d: DestinationResult) => skippedCounts.get(d) ?? d.skipped.length
  const best = dests
    .filter((d) => d.status === 'success' || d.status === 'warning')
    .sort((a, b) => b.filesCopied - a.filesCopied)[0]
  result.filesCopied = best?.filesCopied ?? Math.max(0, ...dests.map((d) => d.filesCopied))
  result.bytesCopied = best?.bytesCopied ?? Math.max(0, ...dests.map((d) => d.bytesCopied))
  result.filesSkipped = Math.max(0, ...dests.map(skippedCount))
  result.warnings = result.filesSkipped
  const failedDests = dests.filter((d) => d.status === 'failed')
  result.errors = failedDests.length

  if (signal.aborted) {
    L('warn', 'Execução cancelada pelo usuário.')
    return finish('cancelled')
  }
  if (failedDests.length) {
    const msg =
      dests.length > 1
        ? failedDests.map((d) => `${d.label || d.path}: ${d.error}`).join(' · ')
        : (failedDests[0].error ?? 'Falha no destino.')
    L('error', 'Backup terminou com falha.')
    return finish('failed', msg)
  }
  const status: FinalRunStatus = dests.some((d) => d.status === 'warning') ? 'warning' : 'success'
  L(
    status === 'success' ? 'info' : 'warn',
    status === 'success' ? 'Backup concluído com sucesso.' : 'Backup concluído com avisos.'
  )
  return finish(status)
}
