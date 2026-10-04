// Execução completa de uma rotina (doc 01 §3). Node puro: roda no utilityProcess
// (src/main/engine/worker.ts) ou direto nos testes.
//
// Fluxo: varre as origens UMA vez → para cada destino ativo, em sequência e de forma independente:
//   1) destino acessível? 2) espaço livre ≥ bytes × 1,05? 3) pasta da rotina + marcador + limpeza de sobras
//   4) copia (ou compacta) em "<carimbo>.em-andamento" preservando a data de modificação
//   5) verifica 6) grava o manifesto e renomeia para o nome final 7) retenção (só se 1–6 deram certo)
// Status: success = tudo copiado em todos os destinos · warning = concluído com arquivos pulados ·
// failed = origem ausente, nada a copiar, ou QUALQUER destino falhou · cancelled.
// Um destino que não recebeu NENHUM arquivo (todos em uso/sem permissão) falha: um backup vazio
// contaria na retenção e faria apagar os backups bons. Destino dentro da origem (ou a origem dentro
// da pasta "BC Backup" do destino) também falha aqui, mesmo que o editor não tenha pego (importação,
// link/junção, outra grafia do caminho): o backup copiaria a si mesmo a cada execução.
//
// "Mover" (doc 04 §5): só entram arquivos elegíveis (idade + teste de uso); sem elegíveis não há
// backup nem retenção. Depois de TODOS os destinos concluídos (sucesso/aviso), a fase "moving" apaga
// da origem cada arquivo conferido com o mesmo tamanho e sha256 em todos os destinos e que continua
// idêntico na origem. Qualquer destino com falha ou cancelamento antes da fase → nada é apagado.

import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type {
  DestinationResult,
  FinalRunStatus,
  LogEntry,
  LogLevel,
  MoveReport,
  SkippedFile,
  SourceItem,
  VerifyMode
} from '@shared/types'
import { BACKUP_ROOT_DIR, IN_PROGRESS_SUFFIX, MANIFEST_FILE, MAX_MOVED_LISTED } from '@shared/defaults'
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
import {
  ageProblem,
  clampMinAge,
  makeMoveFilter,
  probeExclusive,
  probeReason,
  removeFile,
  sha256File,
  unchangedSinceScan,
  unlinkReason
} from './move'
import { ProgressTracker } from './progress'
import { applyRetention, cleanupLeftovers, uniqueStamp } from './retention'
import type { EngineEvent, JobResult, JobSpec } from './types'
import { emptyWalkStats, makeFilter, skipReason, walk, type FileItem, type WalkIssue } from './walk'
import { verifyZip, zipTree } from './zip'
import { isBlockedMoveSource, isInside, normalizeForCompare } from '../validate'

export interface JobOptions {
  now?: () => Date
  hooks?: EngineHooks
  /** Intervalo mínimo entre eventos de progresso (padrão 250 ms → ≤ 4/s). */
  progressIntervalMs?: number
  /** Tempo limite para checar se um destino/origem responde (padrão 15 s). */
  accessTimeoutMs?: number
  /** "Mover": intervalo entre as tentativas do teste de uso exclusivo (padrão 2 s). */
  probeRetryMs?: number
  /** "Mover": plataforma do teste de uso exclusivo (padrão: process.platform; testes). */
  platform?: NodeJS.Platform
  /** "Mover": desloca o relógio SÓ da regra de idade mínima (E2E no Windows; ver e2eJobOptions). */
  moveAgeSkewMs?: number
}

/**
 * Opções vindas do ambiente, só para testes E2E (BC_E2E=1): BC_E2E_MOVE_SKEW_MIN adianta o relógio da
 * regra de idade do "Mover", já que no Windows não dá para "envelhecer" o ChangeTime de um arquivo novo.
 * Fora do modo E2E nunca tem efeito.
 */
export function e2eJobOptions(env: NodeJS.ProcessEnv = process.env): JobOptions {
  if (env.BC_E2E !== '1') return {}
  const min = Number(env.BC_E2E_MOVE_SKEW_MIN)
  return Number.isFinite(min) && min > 0 ? { moveAgeSkewMs: min * 60_000 } : {}
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
  // O nome do manifesto é reservado: um arquivo de origem com esse nome seria sobrescrito por ele.
  const used = new Set<string>([MANIFEST_FILE.toLowerCase()])
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

/** Caminho real (resolve links/junções/unidades substituídas); se falhar, o caminho absoluto. */
async function realPathOf(p: string, timeoutMs: number): Promise<string> {
  return withTimeout(realpath(p), timeoutMs).catch(() => resolve(p))
}

const INSIDE_SOURCE_MESSAGE =
  'O destino fica dentro da origem (ou a origem dentro da pasta "BC Backup" do destino): o backup copiaria a si mesmo. Escolha outro destino.'

function nothingCopiedMessage(): string {
  return 'Nenhum arquivo pôde ser copiado (em uso, sem permissão ou removidos durante o backup). Os backups anteriores foram mantidos.'
}

/** true se `child` está DENTRO de `parent` (nunca o próprio `parent`). */
function strictlyInside(child: string, parent: string): boolean {
  return isInside(child, parent) && normalizeForCompare(child) !== normalizeForCompare(parent)
}

const plural = (n: number, one: string, many: string): string =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

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

  /* ----- "Mover" ----- */
  const move = routine.moveSources?.enabled === true
  const minAge = clampMinAge(routine.moveSources?.minAgeMinutes ?? 30)
  // "Mover" só apaga o que foi relido e conferido por sha256: verificação completa, sempre.
  const verify: VerifyMode = move ? 'full' : routine.verify
  const report: MoveReport | null = move
    ? {
        removed: [],
        removedCount: 0,
        removedBytes: 0,
        kept: [],
        keptCount: 0,
        postponed: [],
        postponedCount: 0,
        sources: routine.sources.map((x) => x.path)
      }
    : null
  const keep = (path: string, reason: string): void => {
    if (!report) return
    report.keptCount = (report.keptCount ?? 0) + 1
    if (report.kept.length < MAX_SKIPPED_LISTED) report.kept.push({ path, reason })
  }
  /** Pasta de origem de cada arquivo da lista congelada (a exclusão confere que está DENTRO dela). */
  const rootOf = new Map<string, string>()
  /** Por destino: arquivo de origem → bytes e sha256 conferidos na verificação completa. */
  const verifiedBy: Array<Map<string, { bytes: number; sha256: string }>> = []

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
    if (report) {
      result.move = report
      result.filesMoved = report.removedCount
      result.bytesMoved = report.removedBytes
    }
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
    /** Caminhos reais das origens que são pastas (para recusar destino dentro da origem). */
    const sourceDirs: string[] = []
    /** O que está no disco manda: origem marcada como "arquivo" que é uma pasta vira subpasta. */
    const isDir: boolean[] = []
    for (const slot of slots) {
      const st = await withTimeout(stat(slot.source.path), accessTimeout).catch(() => null)
      isDir.push(!!st?.isDirectory())
      if (!st) missing.push(slot.source.path)
      else if (st.isDirectory()) sourceDirs.push(await realPathOf(slot.source.path, accessTimeout))
    }
    signal.throwIfAborted()
    if (missing.length) {
      return fail(
        `${missing.length === 1 ? 'Origem não encontrada' : 'Origens não encontradas'}: ${missing.join(', ')}. ` +
          'Verifique se a pasta existe e se o disco está conectado.'
      )
    }
    if (move) {
      // Defesa extra (o editor já valida): só pastas, nunca unidade inteira/sistema/perfil.
      const guard = { dataPath: spec.dataPath }
      for (const [i, slot] of slots.entries()) {
        const p = slot.source.path
        if (!isDir[i])
          return fail(
            `"Mover" recusado: ${p} não é uma pasta. "Mover" só funciona com pastas; troque o arquivo pela pasta que o contém.`
          )
        const real = await realPathOf(p, accessTimeout)
        if (isBlockedMoveSource(p, guard) || isBlockedMoveSource(real, guard))
          return fail(
            `"Mover" recusado: ${p} é uma unidade inteira ou pasta do sistema. Escolha a pasta onde o sistema grava os backups.`
          )
      }
    }

    const moveFilter = move ? makeMoveFilter(routine.filters) : null
    const filter = moveFilter ?? makeFilter(routine.filters)
    const items: FileItem[] = []
    const issues: WalkIssue[] = []
    const stats = emptyWalkStats()
    let totalBytes = 0
    /** "Mover": `now` fixo no início da varredura. */
    const scanNow = now().getTime() + (opts.moveAgeSkewMs ?? 0)
    for (const [i, slot] of slots.entries()) {
      for await (const f of walk(slot.source.path, filter, issues, stats, signal)) {
        const rel = slot.folder || isDir[i] ? `${slot.name}/${f.rel}` : slot.name
        const item: FileItem = { ...f, rel }
        if (report) {
          // Não elegível nem é copiado: fica para a próxima execução.
          let reason = ageProblem(item, scanNow, minAge)
          if (!reason) {
            const code = await probeExclusive(item, 'scan', {
              hooks: opts.hooks,
              signal,
              retryMs: opts.probeRetryMs,
              platform: opts.platform
            })
            if (code === 'ENOENT') continue
            if (code) reason = probeReason(code)
          }
          if (reason) {
            report.postponedCount++
            if (report.postponed.length < MAX_SKIPPED_LISTED)
              report.postponed.push({ path: item.abs, reason })
            continue
          }
          if (!rootOf.has(item.abs)) rootOf.set(item.abs, slot.source.path)
        }
        items.push(item)
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
    if (report && moveFilter) {
      if (moveFilter.neverCount)
        L(
          'info',
          `${moveFilter.neverCount} arquivo(s) de programa, atalho ou temporário ignorado(s) ("Mover" nunca os copia nem apaga).`
        )
      if (report.postponedCount) {
        L(
          'warn',
          `${plural(report.postponedCount, 'arquivo ficou', 'arquivos ficaram')} para a próxima execução (recentes, em uso ou com data no futuro).`
        )
        report.postponed
          .slice(0, MAX_SKIPPED_LOGGED)
          .forEach((s) => L('warn', `Aguardando: ${s.path} — ${s.reason}`))
      }
    }

    if (report && !items.length) {
      // Sem arquivo novo: não cria backup nem roda retenção (a retenção nunca apaga a última cópia
      // de um sistema que parou de gerar backups). Ainda confere se os destinos respondem.
      report.nothingNew = true
      const where = routine.sources.map((x) => x.path).join(', ')
      for (const dest of enabledDests) {
        const st = await withTimeout(stat(dest.path), accessTimeout).catch(() => null)
        const ok = !!st?.isDirectory()
        const res: DestinationResult = {
          destinationId: dest.id,
          path: dest.path,
          label: dest.label,
          status: ok ? (walkSkipped.length ? 'warning' : 'success') : 'failed',
          filesCopied: 0,
          bytesCopied: 0,
          // Pastas que não puderam ser lidas: podem esconder o backup que o sistema gerou.
          skipped: walkSkipped.slice(0, MAX_SKIPPED_LISTED),
          pruned: []
        }
        if (!ok) {
          res.error = 'Destino indisponível: verifique se o disco está conectado.'
          L('error', `${dest.label ? `${dest.label} (${dest.path})` : dest.path}: ${res.error}`)
        } else {
          const after = await diskSpaceOf(dest.path, 3000).catch(() => null)
          if (after) res.freeBytesAfter = after.free
        }
        result.destinations.push(res)
      }
      signal.throwIfAborted()
      const failed = result.destinations.filter((d) => d.status === 'failed')
      if (failed.length) {
        result.errors = failed.length
        const msg = failed.map((d) => `${d.label || d.path}: ${d.error}`).join(' · ')
        L('error', 'Backup terminou com falha.')
        return finish('failed', msg)
      }
      let status: FinalRunStatus
      if (report.postponedCount) {
        status = 'warning'
        report.notice = `${plural(report.postponedCount, 'arquivo ainda em gravação/em uso', 'arquivos ainda em gravação/em uso')}; ${report.postponedCount === 1 ? 'será movido' : 'serão movidos'} na próxima execução.`
      } else if (routine.moveSources?.warnIfEmpty !== false) {
        status = 'warning'
        report.notice = `Nenhum arquivo novo em ${where}. O sistema pode não ter gerado o backup.`
      } else {
        status = walkSkipped.length ? 'warning' : 'success'
        report.notice = 'Nada novo para mover.'
      }
      result.filesSkipped = walkSkipped.length
      result.warnings = status === 'warning' ? Math.max(1, report.postponedCount + walkSkipped.length) : 0
      L(status === 'warning' ? 'warn' : 'info', `${report.notice} Nenhum backup novo foi criado.`)
      return finish(status)
    }

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
        // 1b) destino dentro da origem? (antes de criar qualquer coisa no destino)
        const backupRoot = join(await realPathOf(dest.path, accessTimeout), BACKUP_ROOT_DIR)
        if (sourceDirs.some((src) => isInside(backupRoot, src) || isInside(src, backupRoot))) {
          throw new DestinationError(INSIDE_SOURCE_MESSAGE, 'EINSIDE')
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
          verify,
          ...(verified === undefined ? {} : { verified }),
          skipped,
          appVersion: spec.appVersion,
          hostname: spec.hostname,
          sources: slots.map((s) => ({ label: s.name, path: s.source.path })),
          ...(move ? { moveSources: true as const } : {})
        })
        /** "Mover": o que este destino conferiu (preenchido só depois da verificação completa). */
        const verified = new Map<string, { bytes: number; sha256: string }>()

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
          if (!z.added.length) throw new DestinationError(nothingCopiedMessage(), 'ENOFILES')
          await opts.hooks?.beforeVerify?.(work, i)
          // 5) verifica (completa: CRC-32 e sha256 de cada entrada)
          if (verify !== 'none') {
            const vi = await verifyZip(work, z.added, verify, tracker, signal)
            if (vi.length) throw new DestinationError(verifyFailureMessage(vi), 'EVERIFY')
            L(
              'info',
              `Verificação ${verify === 'full' ? 'completa' : 'rápida'} do ZIP concluída sem diferenças.`
            )
            if (verify === 'full')
              for (const f of z.added)
                if (f.abs && f.sha256) verified.set(f.abs, { bytes: f.bytes, sha256: f.sha256 })
          }
          // 6) nome final + manifesto ao lado (fonte da retenção)
          await renameRetry(work, finalPath)
          workPath = null
          await writeJsonAtomic(
            zipSidecarPath(finalPath),
            manifest(z.added.length, z.bytes, skippedAll.length, verify !== 'none')
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
            hash: verify === 'full',
            hooks: opts.hooks
          })
          skippedAll = [...walkSkipped, ...c.skipped]
          if (!c.copied.length) throw new DestinationError(nothingCopiedMessage(), 'ENOFILES')
          await opts.hooks?.beforeVerify?.(work, i)
          // 5) verifica (completa: relê o destino e compara o sha256 da leitura da origem)
          if (verify !== 'none') {
            const vi = await verifyCopiedFiles(c.copied, work, verify, tracker, signal)
            if (vi.length) throw new DestinationError(verifyFailureMessage(vi), 'EVERIFY')
            L('info', `Verificação ${verify === 'full' ? 'completa' : 'rápida'} concluída sem diferenças.`)
            if (verify === 'full')
              for (const f of c.copied)
                if (f.hash) verified.set(f.item.abs, { bytes: f.bytes, sha256: f.hash })
          }
          // 6) manifesto + rename
          await writeFolderManifest(
            work,
            manifest(c.copied.length, c.bytes, skippedAll.length, verify === 'none' ? undefined : true)
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
        // Conta para o "Mover" inclusive o keepWork (backup completo com manifesto e nome provisório).
        if (move) verifiedBy[i] = verified
        skippedAll
          .slice(walkSkipped.length, walkSkipped.length + MAX_SKIPPED_LOGGED)
          .forEach((s) => L('warn', `Ignorado: ${s.path} — ${s.reason}`))
        L(
          res.status === 'success' ? 'info' : 'warn',
          `${name}: ${res.filesCopied.toLocaleString('pt-BR')} arquivos (${formatBytes(res.bytesCopied)})` +
            (skippedAll.length ? `, ${skippedAll.length} ignorado(s).` : '.')
        )

        // 7) retenção — só depois de um backup concluído neste destino (nunca apaga o que acabou de ser criado)
        if (routine.retention.enabled && !keepWork && res.outputPath) {
          tracker.phase('pruning')
          res.pruned = await applyRetention(routineDir, routine.id, routine.retention, now(), L, [
            basename(res.outputPath)
          ])
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
      await opts.hooks?.afterDestination?.(i)
      if (res.status === 'cancelled') break
    }

    /* ------------------------ "Mover": exclusão ------------------------ */
    if (report) {
      const dests = result.destinations
      const failedDest = dests.find((d) => d.status !== 'success' && d.status !== 'warning')
      const allDone =
        !signal.aborted &&
        dests.length === enabledDests.length &&
        !failedDest &&
        enabledDests.every((_, k) => verifiedBy[k] !== undefined)
      if (!allDone) {
        // Porta fechada: um destino falhou (ou a execução foi cancelada) → NADA é apagado.
        const why =
          signal.aborted || failedDest?.status === 'cancelled'
            ? 'Nada foi apagado da origem porque a execução foi cancelada.'
            : `Nada foi apagado da origem porque ${failedDest ? failedDest.label || failedDest.path : 'um destino'} falhou.`
        report.notDeletedReason = why
        L(signal.aborted ? 'warn' : 'error', why)
        const seen = new Set<string>()
        for (const it of items) {
          if (seen.has(it.abs)) continue
          seen.add(it.abs)
          keep(it.abs, why.replace(/^Nada foi apagado da origem porque /, 'Não apagado: ').replace(/\.$/, ''))
        }
      } else {
        const maps = enabledDests.map(
          (_, k) => verifiedBy[k] as Map<string, { bytes: number; sha256: string }>
        )
        const n = maps.length
        tracker.startMoving(items.length)
        L('info', `Removendo da origem o que foi copiado e conferido em ${plural(n, 'destino', 'destinos')}.`)
        const seen = new Set<string>()
        const gone = (it: FileItem) => L('info', `Já tinha sido removido por outro programa: ${it.abs}`)
        const CANCELLED = 'Execução cancelada antes de apagar'
        for (let k = 0; k < items.length; k++) {
          const item = items[k]
          if (seen.has(item.abs)) continue
          if (signal.aborted) {
            for (const rest of items.slice(k))
              if (!seen.has(rest.abs)) {
                seen.add(rest.abs)
                keep(rest.abs, CANCELLED)
              }
            break
          }
          seen.add(item.abs)
          tracker.file(item.rel)
          try {
            // Só arquivos DA LISTA CONGELADA e DENTRO da pasta de origem (nunca a raiz, nunca pastas).
            const root = rootOf.get(item.abs)
            if (!root || !strictlyInside(item.abs, root)) {
              keep(item.abs, 'Fora da pasta de origem (não apagado)')
              continue
            }
            // a) conferido em TODOS os destinos, com o mesmo tamanho e sha256, e tamanho = varredura
            const got = maps.map((m) => m.get(item.abs))
            const first = got[0]
            if (!first || got.some((g) => !g)) {
              keep(item.abs, 'Não copiado para todos os destinos')
              continue
            }
            if (
              got.some((g) => g!.bytes !== first.bytes || g!.sha256 !== first.sha256) ||
              first.bytes !== item.size
            ) {
              keep(item.abs, 'Alterado durante a cópia')
              continue
            }
            // b) um destino só: relê a origem e compara o sha256
            if (n === 1) {
              let again: { hash: string; bytes: number }
              try {
                again = await sha256File(item.abs, signal)
              } catch (e) {
                if (signal.aborted) throw e
                const code = errCode(e)
                if (code === 'ENOENT') gone(item)
                else
                  keep(
                    item.abs,
                    code === 'EBUSY'
                      ? 'Em uso por outro programa'
                      : `Não foi possível reler o arquivo (${code || 'erro'})`
                  )
                continue
              }
              if (again.hash !== first.sha256 || again.bytes !== first.bytes) {
                keep(item.abs, 'Alterado durante a cópia')
                continue
              }
            }
            // c) continua idêntico à varredura (arquivo comum, tamanho, mtime e ctime)
            const same = await unchangedSinceScan(item)
            if (same === 'gone') {
              gone(item)
              continue
            }
            if (same !== 'same') {
              keep(
                item.abs,
                same === 'changed'
                  ? 'Alterado depois da cópia; será copiado de novo na próxima execução'
                  : `Não foi possível conferir o arquivo (${same})`
              )
              continue
            }
            // d) Windows: ninguém com o arquivo aberto
            const busy = await probeExclusive(item, 'delete', {
              hooks: opts.hooks,
              signal,
              retryMs: opts.probeRetryMs,
              platform: opts.platform
            })
            if (busy === 'ENOENT') {
              gone(item)
              continue
            }
            if (busy) {
              keep(item.abs, probeReason(busy))
              continue
            }
            if (signal.aborted) {
              keep(item.abs, CANCELLED)
              continue
            }
            // e) exclusão permanente do ARQUIVO (unlink; nunca rmdir)
            const err = await removeFile(item, opts.hooks)
            if (!err) {
              report.removedCount++
              report.removedBytes += item.size
              if (report.removed.length < MAX_MOVED_LISTED)
                report.removed.push({ path: item.abs, bytes: item.size, sha256: first.sha256 })
              L(
                'info',
                `Movido: ${item.abs} (${formatBytes(item.size)}), conferido em ${plural(n, 'destino', 'destinos')}.`
              )
            } else if (err === 'ENOENT') gone(item)
            else keep(item.abs, unlinkReason(err))
          } catch (e) {
            if (!signal.aborted) {
              keep(item.abs, `Não apagado: erro inesperado (${errMessage(e)})`)
              continue
            }
            keep(item.abs, CANCELLED)
          } finally {
            tracker.fileDone()
          }
        }
        tracker.flush()
        L(
          'info',
          `Removidos da origem: ${plural(report.removedCount, 'arquivo', 'arquivos')} (${formatBytes(report.removedBytes)}).`
        )
        const keptCount = report.keptCount ?? 0
        if (keptCount) {
          L('warn', `${plural(keptCount, 'arquivo ficou', 'arquivos ficaram')} na origem:`)
          report.kept
            .slice(0, MAX_SKIPPED_LOGGED)
            .forEach((x) => L('warn', `Mantido: ${x.path} — ${x.reason}`))
        }
      }
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
  // "Mover": o que ficou na origem (aguardando ou mantido) também é aviso.
  const stayed = report ? (report.keptCount ?? 0) + report.postponedCount : 0
  result.warnings += stayed
  if (report && stayed)
    report.notice = `${plural(stayed, 'arquivo ficou', 'arquivos ficaram')} na origem; veja os motivos no histórico.`
  const status: FinalRunStatus =
    stayed > 0 || dests.some((d) => d.status === 'warning') ? 'warning' : 'success'
  L(
    status === 'success' ? 'info' : 'warn',
    status === 'success' ? 'Backup concluído com sucesso.' : 'Backup concluído com avisos.'
  )
  return finish(status)
}
