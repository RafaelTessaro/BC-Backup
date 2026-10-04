// Execução completa de uma rotina (doc 01 §3). Node puro: roda no utilityProcess
// (src/main/engine/worker.ts) ou direto nos testes.
//
// Estrutura no destino (layout.ts): "<destino>/<AAAA-MM-DD_HH-mm-ss>/" (ou ".zip"), direto na pasta
// escolhida — o nome da rotina NÃO vira pasta. Uma origem → o conteúdo dela direto na pasta datada
// (um arquivo → o arquivo); várias origens → uma subpasta por origem (rótulo). A pasta do destino é do
// usuário e pode ser compartilhada: nada fora do que esta execução reserva é sobrescrito, e a retenção e a
// limpeza só enxergam o que tem o manifesto/marcador desta rotina.
//
// Fluxo: varre as origens UMA vez → para cada destino ativo, em sequência e de forma independente:
//   1) destino acessível? (e não se sobrepõe a uma origem) 2) limpa sobras DESTA rotina 3) espaço livre
//   ≥ bytes × 1,05? 4) reserva "<nome>.em-andamento" (mkdir atômico, "_2"… se ocupado) + marcador
//   5) copia (ou compacta) preservando a data de modificação 6) verifica 7) grava o manifesto e renomeia
//   para o nome final 8) retenção (só se 1–7 deram certo; inclui os backups legados da rotina)
// Status: success = tudo copiado em todos os destinos · warning = concluído com arquivos pulados ·
// failed = origem ausente, nada a copiar, ou QUALQUER destino falhou · cancelled.
// Um destino que não recebeu NENHUM arquivo (todos em uso/sem permissão) falha: um backup vazio
// contaria na retenção e faria apagar os backups bons. Destino dentro da origem (ou a origem dentro
// do destino) também falha aqui, mesmo que o editor não tenha pego (importação, link/junção, outra
// grafia do caminho): o backup copiaria a si mesmo a cada execução.
//
// "Mover" (doc 04 §5): só entram arquivos elegíveis (idade + teste de uso); sem elegíveis não há
// backup nem retenção. Depois de TODOS os destinos concluídos (sucesso/aviso), a fase "moving" apaga
// da origem cada arquivo conferido com o mesmo tamanho e sha256 em todos os destinos e que continua
// idêntico na origem. Qualquer destino com falha ou cancelamento antes da fase → nada é apagado.

import { realpath, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
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
import { IN_PROGRESS_MARKER_FILE, MANIFEST_FILE, MAX_MOVED_LISTED } from '@shared/defaults'
import { backupStamp, formatBytes } from '@shared/format'
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
import { claimOutput, legacyRoutineDirs, type OutputClaim } from './layout'
import {
  IN_PROGRESS_FORMAT,
  MANIFEST_FORMAT,
  readRoutineMarker,
  writeFolderManifest,
  zipSidecarPath,
  type BackupManifest
} from './manifest'
import {
  ageProblem,
  clampMinAge,
  makeMoveFilter,
  probeExclusive,
  probeReason,
  realParentInside,
  removeFile,
  sha256File,
  unchangedSinceScan,
  unlinkReason
} from './move'
import { ProgressTracker } from './progress'
import { applyRetention, cleanupLeftovers } from './retention'
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
  /** Modo ZIP: limite da leitura para a memória (testes; padrão ZIP_BUFFER_MAX). */
  zipBufferMax?: number
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
  /**
   * Rotina com UMA origem: o conteúdo vai direto na pasta datada (pasta → o que tem dentro dela;
   * arquivo → o próprio arquivo, com o nome dele). `name` só vira subpasta se o conteúdo colidir com
   * os nomes reservados (manifesto/marcador).
   */
  direct: boolean
}

/** Nomes que o BC Backup grava dentro da pasta do backup (em minúsculas). */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(
  [MANIFEST_FILE, IN_PROGRESS_MARKER_FILE].map((n) => n.toLowerCase())
)

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

/** Nome livre (sem diferenciar maiúsculas) diante de `used`: "x", "x (2)", "x (3)"… */
function uniqueName(base: string, used: Set<string>, isFile: boolean): string {
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = withSuffix(base, n, isFile)
  used.add(name.toLowerCase())
  return name
}

/** Nome de um arquivo de origem gravado direto na pasta do backup (fora dos nomes reservados). */
export function directFileName(path: string): string {
  return uniqueName(sanitizeName(defaultSourceName(path), 'Origem'), new Set(RESERVED_NAMES), true)
}

/** Nomes das origens dentro do backup, únicos (sem diferenciar maiúsculas). */
export function sourceSlots(sources: SourceItem[]): SourceSlot[] {
  const direct = sources.length === 1
  // Os nomes do manifesto e do marcador são reservados: um arquivo de origem com esse nome seria
  // sobrescrito por eles (ou os sobrescreveria).
  const used = new Set<string>(RESERVED_NAMES)
  return sources.map((source) => {
    const explicit = source.label?.trim()
    if (direct && source.kind === 'file')
      return { source, name: directFileName(source.path), folder: false, direct }
    const folder = source.kind !== 'file' || !!explicit
    const base = sanitizeName(explicit || defaultSourceName(source.path), 'Origem')
    return { source, name: uniqueName(base, used, !folder), folder, direct }
  })
}

/** Caminho real (resolve links/junções/unidades substituídas); se falhar, o caminho absoluto. */
async function realPathOf(p: string, timeoutMs: number): Promise<string> {
  return withTimeout(realpath(p), timeoutMs).catch(() => resolve(p))
}

/** Identidade física (volume + número do arquivo); null se não existe ou o sistema não informa. */
async function physicalId(p: string, timeoutMs: number): Promise<string | null> {
  const st = await withTimeout(stat(p, { bigint: true }), timeoutMs).catch(() => null)
  if (!st || st.ino === 0n) return null
  return `${st.dev}:${st.ino}`
}

/**
 * `inner` fica fisicamente dentro de `outer` (ou é ela), por qualquer grafia? Pega o que o caminho
 * real não resolve: "\\PC\D$" x "D:\", unidade mapeada x compartilhamento, montagens. Sobe a partir
 * de `inner` procurando uma pasta com a identidade de `outer` e confirma que `inner` aparece no
 * caminho equivalente sob `outer` (discos clonados podem repetir volume + número de uma pasta).
 */
async function physicallyInside(inner: string, outer: string, timeoutMs: number): Promise<boolean> {
  const outerId = await physicalId(outer, timeoutMs)
  const innerId = outerId ? await physicalId(inner, timeoutMs) : null
  if (!outerId || !innerId) return false
  const start = resolve(inner)
  let cur = start
  for (let depth = 0; depth < 64; depth++) {
    if ((await physicalId(cur, timeoutMs)) === outerId) {
      if ((await physicalId(join(outer, relative(cur, start)), timeoutMs)) === innerId) return true
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return false
}

const INSIDE_SOURCE_MESSAGE =
  'O destino fica dentro da origem (ou a origem dentro do destino): o backup copiaria a si mesmo. Escolha outro destino.'

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
        // Uma origem: direto na pasta do backup. Várias: "<rótulo>/…" (ou o arquivo como "<rótulo>").
        const rel = slot.direct
          ? isDir[i]
            ? f.rel
            : directFileName(slot.source.path)
          : slot.folder || isDir[i]
            ? `${slot.name}/${f.rel}`
            : slot.name
        const item: FileItem = { ...f, rel }
        if (report) {
          // Progresso a cada arquivo examinado, não só a cada elegível: com muitos recentes ou em uso
          // (cada um espera ~4 s no teste exclusivo) o vigia de travamento (30 min) mataria o motor.
          tracker.scanned(items.length, totalBytes)
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
    // Uma origem (pasta) com um arquivo/pasta na raiz chamado como o manifesto ou o marcador (ex.: o
    // backup de uma pasta de backup): o conteúdo vai para a subpasta da origem, sem colidir.
    let layout: BackupManifest['layout'] = slots.length === 1 ? 'direct' : 'subfolders'
    if (
      layout === 'direct' &&
      isDir[0] &&
      items.some((it) => RESERVED_NAMES.has(it.rel.split('/')[0].toLowerCase()))
    ) {
      for (const it of items) it.rel = `${slots[0].name}/${it.rel}`
      layout = 'subfolders'
      L(
        'info',
        `A origem tem arquivos com nomes reservados do BC Backup; o conteúdo vai na subpasta "${slots[0].name}".`
      )
    }

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
      if (moveFilter.emptyCount)
        L(
          'warn',
          `${moveFilter.emptyCount} arquivo(s) vazio(s) (0 bytes) ignorado(s): não contam como backup do sistema e ficam na origem.`
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
        // 1a) "Mover": a mesma pasta de um destino anterior (outra grafia, link, unidade mapeada ou
        // repetida numa configuração importada) não é um segundo lugar — "conferido em 2 destinos"
        // seria uma cópia só. Confere se o backup que esta execução acabou de gravar lá aparece aqui.
        if (move) {
          for (const prev of result.destinations) {
            if (!prev.outputPath) continue
            const prevId = await physicalId(prev.outputPath, accessTimeout)
            const here = join(dest.path, relative(prev.path, prev.outputPath))
            if (prevId && (await physicalId(here, accessTimeout)) === prevId) {
              throw new DestinationError(
                `Este destino é a mesma pasta de ${prev.label || prev.path} (outra grafia, link ou unidade mapeada) e não conta como uma segunda cópia. Com "Mover", cada destino precisa ser um lugar diferente.`,
                'ESAMEDEST'
              )
            }
          }
        }
        // 1b) destino dentro da origem (ou a origem dentro do destino)? Antes de criar qualquer coisa.
        const realDest = await realPathOf(dest.path, accessTimeout)
        if (sourceDirs.some((src) => isInside(realDest, src) || isInside(src, realDest))) {
          throw new DestinationError(INSIDE_SOURCE_MESSAGE, 'EINSIDE')
        }
        // …também por outra grafia que o caminho real não resolve (\\PC\D$, unidade mapeada).
        for (const src of sourceDirs) {
          if (
            (await physicallyInside(dest.path, src, accessTimeout)) ||
            (await physicallyInside(src, dest.path, accessTimeout))
          )
            throw new DestinationError(INSIDE_SOURCE_MESSAGE, 'EINSIDE')
        }
        // 2) sobras de execuções anteriores DESTA rotina (libera espaço antes da checagem). A pasta pode
        // ser compartilhada: o que é de outra rotina, ou de outro computador e recente, fica.
        const cleanup = { routineId: routine.id, runId: spec.runId, hostname: spec.hostname, now: now() }
        // Destino escolhido = a antiga pasta desta rotina ("BC Backup/<rotina>", com o marcador dela):
        // as sobras sem marcador lá são da versão anterior (tratadas como legadas).
        const destIsLegacy = (await readRoutineMarker(dest.path))?.routineId === routine.id
        await cleanupLeftovers(dest.path, { ...cleanup, legacy: destIsLegacy }, L)
        // Backups antigos em "<destino>/BC Backup/<rotina>" (versões anteriores): só retenção e limpeza.
        const legacyDirs = await legacyRoutineDirs(dest.path, routine.id)
        for (const dir of legacyDirs) await cleanupLeftovers(dir, { ...cleanup, legacy: true }, L)
        // 3) espaço livre ≥ bytes × 1,05
        const need = Math.ceil(totalBytes * 1.05)
        const space = await diskSpaceOf(dest.path, accessTimeout).catch(() => null)
        if (space && space.free < need) {
          throw new DestinationError(
            `Sem espaço em ${dest.path} (faltam ${formatBytes(need - space.free)}).`,
            'ENOSPC'
          )
        }
        // "<destino>\<carimbo>.em-andamento\" + o caminho relativo mais longo.
        if (dest.path.length + 40 + longest > 240) {
          L(
            'warn',
            'Alguns caminhos no destino passam de 240 caracteres; o Explorer do Windows pode ter dificuldade para abri-los.'
          )
        }
        // 4) reserva o nome (mkdir atômico; "_2", "_3"… se outra rotina/outro PC já usou este segundo)
        // e grava o marcador de "em andamento" antes de qualquer arquivo.
        const claim: OutputClaim = await claimOutput(dest.path, backupStamp(startedAt), routine.mode, {
          format: IN_PROGRESS_FORMAT,
          version: 1,
          routineId: routine.id,
          routineName: routine.name,
          runId: spec.runId,
          hostname: spec.hostname,
          pid: process.pid,
          startedAt: now().toISOString()
        })
        workPath = claim.workDir
        const markerPath = join(claim.workDir, IN_PROGRESS_MARKER_FILE)
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
          ...(move ? { moveSources: true as const } : {}),
          layout
        })
        /** "Mover": o que este destino conferiu (preenchido só depois da verificação completa). */
        const verified = new Map<string, { bytes: number; sha256: string }>()

        if (routine.mode === 'zip') {
          // 5) compacta em "<nome>.em-andamento/<nome>.zip"
          const work = claim.workZip!
          const z = await zipTree(items, work, {
            level: routine.zipLevel ?? 6,
            tracker,
            signal,
            hooks: opts.hooks,
            manifest: (files, bytes, skipped) => manifest(files, bytes, skipped + walkSkipped.length),
            durable: move,
            spoolDir: claim.workDir,
            bufferMax: opts.zipBufferMax,
            onRedo: (changed, attempt) =>
              L(
                'warn',
                `${plural(changed.length, 'arquivo grande mudou', 'arquivos grandes mudaram')} durante a leitura (${changed[0].abs}); o ZIP será montado de novo (tentativa ${attempt}).`
              )
          })
          skippedAll = [...walkSkipped, ...z.skipped]
          if (!z.added.length) throw new DestinationError(nothingCopiedMessage(), 'ENOFILES')
          await opts.hooks?.beforeVerify?.(work, i)
          // 6) verifica (completa: relê o .zip do disco, CRC-32 e sha256 de cada entrada)
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
          // 7) nome final (para fora da pasta reservada) + manifesto ao lado (fonte da retenção).
          // O nome é nosso (reservado), mas confere de novo: um rename por cima apagaria o arquivo de alguém.
          if (await pathExists(claim.finalPath))
            throw new DestinationError(
              `Já existe ${claim.finalPath} no destino (criado por outro programa durante o backup).`,
              'EEXIST'
            )
          await renameRetry(work, claim.finalPath)
          res.outputPath = claim.finalPath
          // Sem recriar a pasta do destino: se ela sumiu agora (disco desconectado), falha o destino.
          await writeJsonAtomic(
            zipSidecarPath(claim.finalPath),
            manifest(z.added.length, z.bytes, skippedAll.length, verify !== 'none'),
            true,
            false
          )
          // A pasta reservada só tem o marcador agora.
          await rm(claim.workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(
            () => {}
          )
          workPath = null
          res.filesCopied = z.added.length
          res.bytesCopied = z.bytes
        } else {
          // 5) copia para "<nome>.em-andamento" (já reservada, com o marcador)
          const work = claim.workDir
          const c = await copyTree(items, work, tracker, signal, {
            hash: verify === 'full',
            hooks: opts.hooks,
            // "Mover": cada cópia vai para o disco antes de a origem ser apagada (queda de energia).
            durable: move
          })
          skippedAll = [...walkSkipped, ...c.skipped]
          if (!c.copied.length) throw new DestinationError(nothingCopiedMessage(), 'ENOFILES')
          await opts.hooks?.beforeVerify?.(work, i)
          // 6) verifica (completa: relê o destino e compara o sha256 da leitura da origem)
          if (verify !== 'none') {
            const vi = await verifyCopiedFiles(c.copied, work, verify, tracker, signal)
            if (vi.length) throw new DestinationError(verifyFailureMessage(vi), 'EVERIFY')
            L('info', `Verificação ${verify === 'full' ? 'completa' : 'rápida'} concluída sem diferenças.`)
            if (verify === 'full')
              for (const f of c.copied)
                if (f.hash) verified.set(f.item.abs, { bytes: f.bytes, sha256: f.hash })
          }
          // 7) manifesto, tira o marcador e dá o nome final
          await writeFolderManifest(
            work,
            manifest(c.copied.length, c.bytes, skippedAll.length, verify === 'none' ? undefined : true)
          )
          await rm(markerPath, { force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {})
          res.filesCopied = c.copied.length
          res.bytesCopied = c.bytes
          try {
            await renameRetry(work, claim.finalPath)
            res.outputPath = claim.finalPath
            workPath = null
          } catch (e) {
            // Só é "backup completo com nome provisório" se a pasta continua lá, com o manifesto. Se ela
            // sumiu (disco desconectado, pasta apagada), é falha do destino: o "Mover" não pode contar com
            // um backup que não está onde deveria.
            const gone = await stat(join(work, MANIFEST_FILE)).then(
              () => false,
              (e2: unknown) => errCode(e2) === 'ENOENT' || errCode(e2) === 'ENOTDIR'
            )
            if (gone) throw new DestinationError(destinationErrorMessage('ENOENT', e), 'ENOENT', e)
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

        // 8) retenção — só depois de um backup concluído neste destino (nunca apaga o que esta execução
        // criou, em nenhum destino). Só vê backups com o manifesto desta rotina.
        if (routine.retention.enabled && !keepWork && res.outputPath) {
          tracker.phase('pruning')
          res.pruned = await applyRetention(dest.path, routine.id, routine.retention, now(), L, {
            protect: [res.outputPath],
            protectSnapshotId: spec.runId,
            extraDirs: legacyDirs
          })
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
        /** Caminho real de cada pasta de origem (a raiz configurada pode ser um link). */
        const realRoots = new Map<string, string | null>()
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
                // Progresso a cada bloco: um arquivo enorme pode levar mais que o vigia de
                // travamento do motor (30 min sem eventos) e ele seria encerrado no meio da fase.
                again = await sha256File(item.abs, signal, () => tracker.file(item.rel))
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
            // d) Windows: ninguém com o arquivo aberto. ANTES do re-stat (c): o teste pode esperar
            // até ~4 s entre tentativas (EBUSY) e, nesse meio-tempo, quem estava com o arquivo
            // aberto pode gravar e fechar. Só depois de uma abertura exclusiva bem-sucedida as
            // datas e o tamanho no disco refletem todas as gravações (NTFS atualiza ao fechar).
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
            // c) continua idêntico à varredura (arquivo comum, tamanho, mtime e ctime) — o último
            // passo antes do unlink: a janela que sobra é de microssegundos.
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
            // …e o caminho REAL da pasta do arquivo continua dentro da origem: o unlink segue links
            // nas pastas do caminho, e uma subpasta trocada por link/junção depois da varredura
            // (move + mklink /J) levaria a exclusão para fora dela.
            let realRoot = realRoots.get(root)
            if (realRoot === undefined) {
              realRoot = await realpath(root).catch(() => null)
              realRoots.set(root, realRoot)
            }
            const where = await realParentInside(item, realRoot)
            if (where === 'gone') {
              gone(item)
              continue
            }
            if (where !== 'inside') {
              keep(item.abs, 'Fora da pasta de origem (não apagado)')
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
