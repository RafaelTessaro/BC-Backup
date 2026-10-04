// Implementação em memória de `window.bc` para desenvolver a interface no navegador
// (`npm run dev:web`) e tirar screenshots sem o Electron.
//
// Flags na URL:
//   ?empty=1                         → nenhuma rotina, nenhum histórico, SMTP não configurado
//   ?scenario=running|ok|warning|failed|empty   (padrão: running)
//   ?theme=light|dark|system         → preferência de tema inicial (padrão: system)
//   ?platform=win32|darwin|linux     → simula a plataforma em app.info()
//   ?frozen=1                        → progresso simulado não avança (screenshots estáveis)
//   ?slow=1                          → leituras demoram ~1,5 s (ver esqueletos de carregamento)

import type {
  BcApi,
  FileResult,
  HistoryQuery,
  MailTestResult,
  MovePreview,
  PathInfo,
  PickResult,
  RoutineInput,
  SizeEstimate,
  ValidationIssue
} from '@shared/api'
import type {
  AppInfo,
  AppSettings,
  DashboardStats,
  DayStatus,
  DestinationResult,
  DiskSpace,
  DriveInfo,
  Filters,
  FinalRunStatus,
  ID,
  LogEntry,
  MoveReport,
  Routine,
  RunProgress,
  RunRecord,
  RunSummary,
  RunTrigger,
  SmtpInput
} from '@shared/types'
import { BACKUP_ROOT_DIR, DEFAULT_EXCLUDES, DEFAULT_NOTIFICATION, DEFAULT_SETTINGS } from '@shared/defaults'
import { backupStamp, formatBytes, formatDuration } from '@shared/format'
import { nextRunAt, slotsForDay } from '@shared/schedule'

type Scenario = 'running' | 'ok' | 'warning' | 'failed' | 'empty'

const GB = 1024 ** 3
const MB = 1024 ** 2
const TB = 1024 ** 4

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const clone = <T>(v: T): T => structuredClone(v)
/** Erros chegam do IPC com este prefixo — o renderer precisa limpá-lo (ver errorMessage). */
const ipcError = (channel: string, message: string): Error =>
  new Error(`Error invoking remote method '${channel}': Error: ${message}`)
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const iso = (d: Date | number): string => new Date(d).toISOString()
const uid = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

function readFlags(): {
  scenario: Scenario
  theme: AppSettings['theme']
  platform: string
  frozen: boolean
  slow: boolean
} {
  const p = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
  let scenario = (p.get('scenario') as Scenario | null) ?? 'running'
  if (p.get('empty') === '1') scenario = 'empty'
  if (!['running', 'ok', 'warning', 'failed', 'empty'].includes(scenario)) scenario = 'running'
  const theme = p.get('theme')
  return {
    scenario,
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    platform: p.get('platform') ?? 'browser',
    frozen: p.get('frozen') === '1',
    slow: p.get('slow') === '1'
  }
}

/* ------------------------------------------------------------------ */
/* Dados semeados                                                      */
/* ------------------------------------------------------------------ */

const DRIVES: DriveInfo[] = [
  { path: 'C:\\', label: 'Windows', total: 476.9 * GB, free: 182.4 * GB },
  { path: 'D:\\', label: 'Dados', total: 931.5 * GB, free: 402.7 * GB },
  { path: 'E:\\', label: 'HD externo azul', total: 1.82 * TB, free: 612 * GB, removable: true },
  { path: 'F:\\', label: 'Backup', total: 931.5 * GB, free: 168.3 * GB, removable: true },
  { path: '\\\\SERVIDOR\\backup', label: 'SERVIDOR', total: 3.64 * TB, free: 262 * GB, network: true }
]

/** Tamanho "real" conhecido das origens semeadas. */
const KNOWN_SIZES: Record<string, { bytes: number; files: number }> = {
  'C:\\Clientes\\NF-e 2026': { bytes: 1.2 * GB, files: 812 },
  'C:\\Clientes\\XML Autorizados': { bytes: 0.6 * GB, files: 318 },
  'D:\\Contratos\\Clientes': { bytes: 0.3 * GB, files: 74 },
  'C:\\Users\\Ana\\Pictures\\Escritório': { bytes: 29.0 * GB, files: 2950 },
  'C:\\ERP\\Dados\\ERP.FDB': { bytes: 3.4 * GB, files: 1 },
  'C:\\ERP\\Config\\erp.ini': { bytes: 12 * 1024, files: 1 },
  'C:\\Contabilidade': { bytes: 6.1 * GB, files: 14211 },
  'D:\\Fiscal\\SPED': { bytes: 2.3 * GB, files: 4221 },
  'C:\\Users\\Ana\\Documents\\Diretoria': { bytes: 4.8 * GB, files: 1876 },
  'C:\\ERP\\Backup': { bytes: 4.2 * GB, files: 2 }
}

function sizeOf(path: string): { bytes: number; files: number } {
  const known = KNOWN_SIZES[path]
  if (known) return known
  const r = mulberry32(hash(path))
  const bytes = (0.05 + r() * 6) * GB
  return { bytes, files: Math.max(1, Math.round(bytes / (2.4 * MB))) }
}

const FOLDER_POOL = [
  'C:\\Users\\Ana\\Desktop\\Planilhas',
  'C:\\Users\\Ana\\Documents\\Orçamentos 2026',
  'D:\\Projetos\\Clientes\\Obras em andamento',
  'C:\\Dados\\Firebird',
  'C:\\Users\\Ana\\OneDrive - Padaria\\Financeiro'
]
const FILE_POOL = ['C:\\ERP\\Dados\\ESTOQUE.FDB', 'C:\\Users\\Ana\\Documents\\Senhas do Wi-Fi.xlsx']

function baseRoutine(
  partial: Partial<Routine> & Pick<Routine, 'id' | 'name'>,
  createdDaysAgo: number
): Routine {
  const created = iso(Date.now() - createdDaysAgo * 86_400_000)
  return {
    description: '',
    color: 'blue',
    enabled: true,
    sources: [],
    destinations: [],
    mode: 'copy',
    zipLevel: 6,
    filters: { include: [], exclude: [...DEFAULT_EXCLUDES], skipHiddenAndSystem: true, maxFileSizeMB: null },
    verify: 'quick',
    schedule: {
      kind: 'daily',
      times: ['18:00'],
      weekdays: [1, 2, 3, 4, 5],
      intervalMinutes: 240,
      window: null,
      startupDelayMinutes: 5,
      catchUpMissed: true
    },
    retention: { enabled: true, days: 30, minKeep: 3 },
    notification: { ...DEFAULT_NOTIFICATION },
    createdAt: created,
    updatedAt: created,
    ...partial
  }
}

function seedRoutines(): Routine[] {
  return [
    baseRoutine(
      {
        id: 'r-nfe',
        name: 'Clientes NF-e',
        description: 'Notas fiscais, XMLs autorizados e contratos dos clientes.',
        color: 'blue',
        sources: [
          { id: 's1', path: 'C:\\Clientes\\NF-e 2026', kind: 'folder' },
          { id: 's2', path: 'C:\\Clientes\\XML Autorizados', kind: 'folder' },
          { id: 's3', path: 'D:\\Contratos\\Clientes', kind: 'folder' }
        ],
        destinations: [
          { id: 'd1', path: 'E:\\', label: 'HD externo azul', enabled: true },
          { id: 'd2', path: '\\\\SERVIDOR\\backup', label: 'Servidor', enabled: true }
        ],
        schedule: {
          kind: 'daily',
          times: ['22:00'],
          weekdays: [],
          intervalMinutes: 240,
          window: null,
          startupDelayMinutes: 5,
          catchUpMissed: true
        },
        retention: { enabled: true, days: 30, minKeep: 3 },
        notification: {
          ...DEFAULT_NOTIFICATION,
          enabled: true,
          recipients: ['financeiro@padariapaoquente.com.br'],
          bcc: ['suporte@bcinformatica.com.br'],
          clientName: 'Padaria Pão Quente'
        }
      },
      40
    ),
    baseRoutine(
      {
        id: 'r-fotos',
        name: 'Fotos do escritório',
        color: 'violet',
        sources: [{ id: 's1', path: 'C:\\Users\\Ana\\Pictures\\Escritório', kind: 'folder' }],
        destinations: [{ id: 'd1', path: 'F:\\Backup', label: 'Pen drive da gaveta', enabled: true }],
        schedule: {
          kind: 'weekly',
          times: ['23:30'],
          weekdays: [1, 3, 5],
          intervalMinutes: 240,
          window: null,
          startupDelayMinutes: 5,
          catchUpMissed: true
        },
        retention: { enabled: true, days: 15, minKeep: 3 }
      },
      30
    ),
    baseRoutine(
      {
        id: 'r-sql',
        name: 'Banco SQL – ERP',
        description: 'Banco Firebird do ERP. Compactado em ZIP.',
        color: 'amber',
        sources: [
          { id: 's1', path: 'C:\\ERP\\Dados\\ERP.FDB', kind: 'file' },
          { id: 's2', path: 'C:\\ERP\\Config\\erp.ini', kind: 'file' }
        ],
        destinations: [{ id: 'd1', path: '\\\\SERVIDOR\\backup', label: 'Servidor', enabled: true }],
        mode: 'zip',
        zipLevel: 6,
        verify: 'full',
        schedule: {
          kind: 'interval',
          times: [],
          weekdays: [1, 2, 3, 4, 5],
          intervalMinutes: 360,
          window: { start: '08:00', end: '20:00' },
          startupDelayMinutes: 5,
          catchUpMissed: true
        },
        retention: { enabled: true, days: 7, minKeep: 5 },
        notification: {
          ...DEFAULT_NOTIFICATION,
          enabled: true,
          recipients: ['ti@padariapaoquente.com.br'],
          onSuccess: false,
          attachLog: 'onFailure'
        }
      },
      5
    ),
    baseRoutine(
      {
        id: 'r-erp',
        name: 'Backup do ERP',
        description: 'Backups gerados pelo ERP: copiados para 2 destinos e apagados do disco principal.',
        color: 'sky',
        sources: [{ id: 's1', path: 'C:\\ERP\\Backup', kind: 'folder' }],
        destinations: [
          { id: 'd1', path: 'E:\\', label: 'HD externo azul', enabled: true },
          { id: 'd2', path: '\\\\SERVIDOR\\backup', label: 'Servidor', enabled: true }
        ],
        verify: 'full',
        schedule: {
          kind: 'daily',
          times: ['23:30'],
          weekdays: [],
          intervalMinutes: 240,
          window: null,
          startupDelayMinutes: 5,
          catchUpMissed: true
        },
        retention: { enabled: true, days: 7, minKeep: 3 },
        moveSources: { enabled: true, minAgeMinutes: 30, warnIfEmpty: true },
        notification: {
          ...DEFAULT_NOTIFICATION,
          enabled: true,
          recipients: ['ti@padariapaoquente.com.br'],
          bcc: ['suporte@bcinformatica.com.br'],
          onSuccess: false
        }
      },
      20
    ),
    baseRoutine(
      {
        id: 'r-contab',
        name: 'Contabilidade',
        color: 'emerald',
        sources: [
          { id: 's1', path: 'C:\\Contabilidade', kind: 'folder' },
          { id: 's2', path: 'D:\\Fiscal\\SPED', kind: 'folder' }
        ],
        destinations: [
          { id: 'd1', path: 'E:\\', label: 'HD externo azul', enabled: true },
          { id: 'd2', path: 'F:\\Backup', enabled: true }
        ],
        schedule: {
          kind: 'daily',
          times: ['12:00', '18:00'],
          weekdays: [],
          intervalMinutes: 240,
          window: null,
          startupDelayMinutes: 5,
          catchUpMissed: true
        },
        retention: { enabled: true, days: 60, minKeep: 3 }
      },
      7
    ),
    baseRoutine(
      {
        id: 'r-dir',
        name: 'Documentos da diretoria',
        color: 'slate',
        enabled: false,
        sources: [{ id: 's1', path: 'C:\\Users\\Ana\\Documents\\Diretoria', kind: 'folder' }],
        destinations: [{ id: 'd1', path: 'F:\\Backup', enabled: true }],
        schedule: {
          kind: 'weekly',
          times: ['10:00'],
          weekdays: [6],
          intervalMinutes: 240,
          window: null,
          startupDelayMinutes: 5,
          catchUpMissed: false
        },
        retention: { enabled: true, days: 90, minKeep: 3 }
      },
      60
    )
  ]
}

const SEED_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  clientName: 'Padaria Pão Quente',
  computerAlias: 'Recepção',
  companyName: 'BC Informática',
  smtp: {
    preset: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    security: 'ssl',
    user: 'backup.paoquente@gmail.com',
    hasPassword: true,
    fromName: 'BC Backup – Padaria Pão Quente',
    fromEmail: 'backup.paoquente@gmail.com',
    replyTo: 'suporte@bcinformatica.com.br',
    allowInvalidCert: false,
    timeoutSec: 30
  }
}

/* ------------------------------------------------------------------ */
/* Geração do histórico                                                */
/* ------------------------------------------------------------------ */

const IN_USE_FILES = [
  'C:\\Contabilidade\\Empresa\\Dados\\CONTAB.MDB',
  'C:\\Contabilidade\\Empresa\\Dados\\~$Balancete 09-2026.xlsx',
  'D:\\Fiscal\\SPED\\Temp\\sped_lock.tmp.lck',
  'C:\\Contabilidade\\Folha\\FOLHA.GDB'
]

interface GenSpec {
  routine: Routine
  start: Date
  trigger: RunTrigger
  status: FinalRunStatus
  errorMessage?: string
  failedDestination?: number
  /** "Mover": o ERP não gerou backup (pasta vazia) → Atenção, sem backup novo. */
  nothingNew?: boolean
  /** "Mover": um arquivo foi alterado depois da cópia e ficou na origem. */
  keptOne?: boolean
}

function profile(r: Routine): { bytes: number; files: number; speed: number } {
  let bytes = 0
  let files = 0
  for (const s of r.sources) {
    const z = sizeOf(s.path)
    bytes += z.bytes
    files += z.files
  }
  // velocidade "típica" do destino mais lento
  const net = r.destinations.some((d) => d.path.startsWith('\\\\'))
  return { bytes, files, speed: (net ? 38 : 92) * MB }
}

function buildRecord(spec: GenSpec, rnd: () => number, smtpReady = true): RunRecord {
  const { routine, start, trigger, status } = spec
  const prof = profile(routine)
  const id = `run-${routine.id}-${start.getTime().toString(36)}`
  const dests = routine.destinations.filter((d) => d.enabled !== false)
  const variance = 0.9 + rnd() * 0.2
  const bytesTotal = Math.round(prof.bytes * variance)
  const filesTotal = Math.max(1, Math.round(prof.files * (0.96 + rnd() * 0.06)))
  const log: LogEntry[] = []
  let t = start.getTime()
  const push = (level: LogEntry['level'], message: string, advanceMs = 300): void => {
    t += advanceMs
    log.push({ t: iso(t), level, message })
  }

  const trigText =
    trigger === 'manual'
      ? 'executada manualmente'
      : trigger === 'catch-up'
        ? 'backup atrasado'
        : trigger === 'startup'
          ? 'ao iniciar o computador'
          : 'agendada'
  push('info', `Iniciando rotina "${routine.name}" (${trigText})`, 200)
  push(
    'info',
    `Origem: ${routine.sources.length} ${routine.sources.length === 1 ? 'item' : 'itens'} · ${filesTotal.toLocaleString('pt-BR')} arquivos · ${formatBytes(bytesTotal)}`,
    1200
  )

  const destinations: DestinationResult[] = []
  let warnings = 0
  let errors = 0
  const stamp = backupStamp(start)

  dests.forEach((d, i) => {
    const drive = DRIVES.find((x) => d.path.toUpperCase().startsWith(x.path.toUpperCase()))
    const outputPath = `${d.path.replace(/\\$/, '')}\\${BACKUP_ROOT_DIR}\\${routine.name}\\${stamp}${routine.mode === 'zip' ? '.zip' : ''}`
    push('info', `Destino ${i + 1}/${dests.length}: ${d.path}${d.label ? ` (${d.label})` : ''}`, 400)
    const destFails = status === 'failed' && (spec.failedDestination ?? dests.length - 1) === i
    if (destFails) {
      const msg = spec.errorMessage ?? 'Destino indisponível: verifique se o disco está conectado.'
      push('error', msg, 2400)
      errors++
      destinations.push({
        destinationId: d.id,
        path: d.path,
        label: d.label,
        status: 'failed',
        filesCopied: 0,
        bytesCopied: 0,
        skipped: [],
        pruned: [],
        error: msg
      })
      return
    }
    push('info', `Criando ${outputPath}.em-andamento`, 200)
    const skipped =
      status === 'warning'
        ? IN_USE_FILES.slice(0, 1 + Math.floor(rnd() * 3)).map((path) => ({
            path,
            reason: 'Arquivo em uso (ignorado)'
          }))
        : []
    const cancelled = status === 'cancelled'
    const ratio = cancelled ? 0.35 + rnd() * 0.3 : 1
    const destBytes = Math.round(bytesTotal * ratio)
    const destFiles = Math.round(filesTotal * ratio) - skipped.length
    const copyMs = (destBytes / prof.speed) * 1000
    for (const sk of skipped) {
      push('warn', `Arquivo em uso (ignorado): ${sk.path}`, copyMs * (0.2 + rnd() * 0.5) * 0.3)
      warnings++
    }
    if (cancelled) {
      push('warn', 'Execução cancelada pelo usuário. A cópia parcial foi mantida.', copyMs)
      warnings++
    } else {
      push(
        'info',
        `${destFiles.toLocaleString('pt-BR')} arquivos copiados (${formatBytes(destBytes)}) em ${formatDuration(copyMs)}`,
        copyMs * 0.8
      )
      if (routine.verify !== 'none') {
        push(
          'info',
          `Verificação ${routine.verify === 'full' ? 'completa' : 'rápida'} concluída: ${destFiles.toLocaleString('pt-BR')} arquivos conferidos`,
          routine.verify === 'full' ? copyMs * 0.4 : 1800
        )
      }
    }
    const pruned: string[] = []
    if (!cancelled && routine.retention.enabled && rnd() > 0.35) {
      const old = new Date(start.getTime() - routine.retention.days * 86_400_000)
      pruned.push(
        `${d.path.replace(/\\$/, '')}\\${BACKUP_ROOT_DIR}\\${routine.name}\\${backupStamp(old)}${routine.mode === 'zip' ? '.zip' : ''}`
      )
      push('info', `Retenção: 1 backup antigo removido (${backupStamp(old)})`, 900)
    }
    destinations.push({
      destinationId: d.id,
      path: d.path,
      label: d.label,
      outputPath,
      status: cancelled ? 'cancelled' : skipped.length ? 'warning' : 'success',
      filesCopied: Math.max(0, destFiles),
      bytesCopied: destBytes,
      skipped,
      pruned,
      freeBytesAfter: drive ? drive.free - rnd() * 4 * GB : undefined
    })
  })

  // Mesma semântica do main: not_configured = notificação desligada / sem destinatários / SMTP ausente;
  // skipped = resultado não selecionado para envio ou execução cancelada.
  let email: RunSummary['email'] = 'not_configured'
  const n = routine.notification
  if (n.enabled && n.recipients.length > 0 && smtpReady) {
    const wants =
      status === 'success'
        ? n.onSuccess
        : status === 'warning'
          ? n.onWarning
          : status === 'failed'
            ? n.onFailure
            : false
    if (wants) {
      email = 'sent'
      push('info', `E-mail enviado para ${n.recipients.join(', ')}`, 1300)
    } else email = 'skipped'
  }

  const final =
    status === 'failed'
      ? `Falhou: ${spec.errorMessage ?? 'destino indisponível'}`
      : status === 'warning'
        ? `Concluído com ${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}`
        : status === 'cancelled'
          ? 'Cancelado'
          : 'Concluído com sucesso'
  push(status === 'failed' ? 'error' : status === 'success' ? 'info' : 'warn', final, 200)

  const durationMs = t - start.getTime()
  return {
    id,
    routineId: routine.id,
    routineName: routine.name,
    status,
    trigger,
    startedAt: iso(start),
    finishedAt: iso(t),
    durationMs,
    filesTotal,
    // totais do melhor destino (detalhe por destino em `destinations`)
    filesCopied: Math.max(0, ...destinations.map((d) => d.filesCopied)),
    filesSkipped: destinations.reduce((a, d) => a + d.skipped.length, 0),
    bytesTotal,
    bytesCopied: Math.max(0, ...destinations.map((d) => d.bytesCopied)),
    warnings,
    errors,
    destinationCount: dests.length,
    email,
    errorMessage: status === 'failed' ? spec.errorMessage : undefined,
    destinations,
    log
  }
}

const fakeSha = (s: string): string => hash(s).toString(16).padStart(8, '0').repeat(8)

/**
 * "Mover" (mesma semântica do motor): acrescenta o relatório de movidos/mantidos, o destaque de
 * "nenhum arquivo novo" e as linhas "Movido: …" do log a um registro gerado por `buildRecord`.
 */
function decorateMove(rec: RunRecord, spec: GenSpec): RunRecord {
  const r = spec.routine
  if (!r.moveSources?.enabled) return rec
  const from = r.sources.map((s) => s.path)
  const root = from[0] ?? 'C:\\Backup'
  const d = spec.start
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const names = [`ERP_${day}_2300.fbk`, `Diario\\NFE_${day}.zip`]
  const base: MoveReport = {
    removed: [],
    removedCount: 0,
    removedBytes: 0,
    kept: [],
    keptCount: 0,
    postponed: [],
    postponedCount: 0,
    sources: from
  }
  const finalLine = rec.log[rec.log.length - 1]
  const at = (offsetMs: number): string =>
    iso(new Date(finalLine ? finalLine.t : rec.startedAt).getTime() - offsetMs)

  if (spec.nothingNew) {
    const notice = `Nenhum arquivo novo em ${from.join(', ')}. O sistema pode não ter gerado o backup.`
    const n = r.notification
    return {
      ...rec,
      status: 'warning',
      filesTotal: 0,
      filesCopied: 0,
      filesSkipped: 0,
      bytesTotal: 0,
      bytesCopied: 0,
      warnings: 1,
      errors: 0,
      errorMessage: undefined,
      notice,
      filesMoved: 0,
      bytesMoved: 0,
      durationMs: 1800,
      finishedAt: iso(new Date(rec.startedAt).getTime() + 1800),
      email: n.enabled && n.recipients.length > 0 && n.onWarning ? 'sent' : rec.email,
      destinations: rec.destinations.map((x) => ({
        ...x,
        status: 'success',
        outputPath: undefined,
        filesCopied: 0,
        bytesCopied: 0,
        skipped: [],
        pruned: [],
        error: undefined
      })),
      log: [
        rec.log[0],
        {
          t: iso(new Date(rec.startedAt).getTime() + 900),
          level: 'info',
          message: 'Encontrados 0 arquivos (0 B).'
        },
        {
          t: iso(new Date(rec.startedAt).getTime() + 1800),
          level: 'warn',
          message: `${notice} Nenhum backup novo foi criado.`
        }
      ],
      move: { ...base, nothingNew: true, notice }
    }
  }

  const sizes = [Math.round(rec.bytesCopied * 0.82), rec.bytesCopied - Math.round(rec.bytesCopied * 0.82)]
  const files = names.map((n, i) => ({
    path: `${root}\\${n}`,
    bytes: sizes[i],
    sha256: fakeSha(`${root}${n}`)
  }))
  if (rec.status === 'failed' || rec.status === 'cancelled') {
    const failed = rec.destinations.find((x) => x.status === 'failed')
    const why =
      rec.status === 'failed'
        ? `Nada foi apagado da origem porque ${failed?.label || failed?.path || 'um destino'} falhou.`
        : 'Nada foi apagado da origem porque a execução foi cancelada.'
    const kept = files.map((f) => ({
      path: f.path,
      reason: why.replace(/^Nada foi apagado da origem porque /, 'Não apagado: ').replace(/\.$/, '')
    }))
    return {
      ...rec,
      filesMoved: 0,
      bytesMoved: 0,
      log: [
        ...rec.log.slice(0, -1),
        { t: at(100), level: rec.status === 'failed' ? 'error' : 'warn', message: why },
        ...rec.log.slice(-1)
      ],
      move: { ...base, kept, keptCount: kept.length, notDeletedReason: why }
    }
  }
  const removed = spec.keptOne ? files.slice(1) : files
  const kept = spec.keptOne
    ? [{ path: files[0].path, reason: 'Alterado depois da cópia; será copiado de novo na próxima execução' }]
    : []
  const n = rec.destinations.length
  const moveLog: LogEntry[] = [
    {
      t: at(900),
      level: 'info',
      message: `Removendo da origem o que foi copiado e conferido em ${n} ${n === 1 ? 'destino' : 'destinos'}.`
    },
    ...removed.map((f, i) => ({
      t: at(800 - i * 100),
      level: 'info' as const,
      message: `Movido: ${f.path} (${formatBytes(f.bytes)}), conferido em ${n} ${n === 1 ? 'destino' : 'destinos'}.`
    })),
    ...kept.map((k) => ({ t: at(300), level: 'warn' as const, message: `Mantido: ${k.path} — ${k.reason}` }))
  ]
  const removedBytes = removed.reduce((a, f) => a + f.bytes, 0)
  return {
    ...rec,
    status: kept.length ? 'warning' : rec.status,
    warnings: rec.warnings + kept.length,
    notice: kept.length ? '1 arquivo ficou na origem; veja os motivos no histórico.' : rec.notice,
    filesMoved: removed.length,
    bytesMoved: removedBytes,
    log: [...rec.log.slice(0, -1), ...moveLog, ...rec.log.slice(-1)],
    move: { ...base, removed, removedCount: removed.length, removedBytes, kept, keptCount: kept.length }
  }
}

function seedRuns(routines: Routine[], scenario: Scenario, now: Date): RunRecord[] {
  const rnd = mulberry32(20261004)
  const specs: GenSpec[] = []
  for (let back = 14; back >= 0; back--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
    for (const r of routines) {
      // "Backup do ERP" tem histórico próprio (abaixo): não mexe na sequência das demais.
      if (r.moveSources?.enabled) continue
      const created = new Date(r.createdAt)
      // a rotina pausada rodou até 6 dias atrás
      if (!r.enabled && back < 6) continue
      const schedule = r.enabled ? r.schedule : { ...r.schedule, kind: 'weekly' as const, weekdays: [1, 4] }
      for (const slot of slotsForDay(schedule, day)) {
        const start = new Date(slot.getTime() + Math.floor(rnd() * 40_000))
        if (start < created || start.getTime() > now.getTime() - 20 * 60_000) continue
        if (back === 14 && rnd() > 0.4) continue
        let status: FinalRunStatus = 'success'
        let errorMessage: string | undefined
        let failedDestination: number | undefined
        const roll = rnd()
        if (r.id === 'r-contab' && roll < 0.14) status = 'warning'
        else if (r.id === 'r-nfe' && back === 9) {
          status = 'failed'
          errorMessage =
            'Destino indisponível: \\\\SERVIDOR\\backup não respondeu. Verifique se o servidor está ligado.'
          failedDestination = 1
        } else if (r.id === 'r-fotos' && back === 6) {
          status = 'failed'
          errorMessage = 'Sem espaço em F:\\ (faltam 12 GB).'
          failedDestination = 0
        } else if (r.id === 'r-dir' && back === 8) status = 'cancelled'
        else if (roll > 0.975) status = 'warning'
        specs.push({
          routine: r,
          start,
          trigger: back === 3 && r.id === 'r-nfe' ? 'catch-up' : 'schedule',
          status,
          errorMessage,
          failedDestination
        })
      }
    }
  }

  // Ajusta o "último" resultado de algumas rotinas conforme o cenário.
  const lastOf = (id: ID): GenSpec | undefined => [...specs].reverse().find((s) => s.routine.id === id)
  const sql = lastOf('r-sql')
  const contab = lastOf('r-contab')
  const nfe = lastOf('r-nfe')
  for (const s of [sql, contab, nfe]) if (s) s.status = 'success'
  if ((scenario === 'running' || scenario === 'failed') && sql) {
    sql.status = 'failed'
    sql.errorMessage =
      'Destino indisponível: \\\\SERVIDOR\\backup não respondeu. Verifique se o servidor está ligado.'
    sql.failedDestination = 0
  }
  if (scenario === 'warning' && contab) contab.status = 'warning'

  const records = specs.map((s) => buildRecord(s, rnd))

  // "Mover": um backup do ERP por noite; um dia sem arquivo novo, um com arquivo alterado, uma falha.
  const rndErp = mulberry32(4242)
  for (const r of routines.filter((x) => x.moveSources?.enabled)) {
    for (let back = 14; back >= 0; back--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
      for (const slot of slotsForDay(r.schedule, day)) {
        const start = new Date(slot.getTime() + Math.floor(rndErp() * 40_000))
        if (start < new Date(r.createdAt) || start.getTime() > now.getTime() - 20 * 60_000) continue
        const spec: GenSpec = { routine: r, start, trigger: 'schedule', status: 'success' }
        if (back === 4) spec.nothingNew = true
        else if (back === 2) spec.keptOne = true
        else if (back === 6) {
          spec.status = 'failed'
          spec.errorMessage =
            'Destino indisponível: \\\\SERVIDOR\\backup não respondeu. Verifique se o servidor está ligado.'
          spec.failedDestination = 1
        }
        records.push(decorateMove(buildRecord(spec, rndErp), spec))
      }
    }
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/* ------------------------------------------------------------------ */
/* Simulação de execução                                               */
/* ------------------------------------------------------------------ */

interface ActiveRun {
  progress: RunProgress
  routine: Routine
  trigger: RunTrigger
  timer: ReturnType<typeof setInterval> | null
  ticks: number
  baseSpeed: number
  bytesPerDest: number
  filesPerDest: number
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

type Listener<T> = (v: T) => void

/** Mesma regra do main (ipc.ts): servidor, porta ou usuário diferentes invalidam a senha salva. */
function accountChanged(
  saved: Pick<SmtpInput, 'host' | 'port' | 'user'>,
  next: Pick<SmtpInput, 'host' | 'port' | 'user'>
): boolean {
  const norm = (v: string): string => v.trim().toLowerCase()
  return (
    norm(saved.host) !== norm(next.host) || saved.port !== next.port || norm(saved.user) !== norm(next.user)
  )
}

export function createMockApi(): BcApi {
  const flags = readFlags()
  const now = new Date()
  const empty = flags.scenario === 'empty'

  let routines: Routine[] = empty ? [] : seedRoutines()
  let runs: RunRecord[] = empty ? [] : seedRuns(routines, flags.scenario, now)
  let settings: AppSettings = clone(empty ? DEFAULT_SETTINGS : SEED_SETTINGS)
  settings.theme = flags.theme
  let smtpPassword = empty ? '' : 'abcd efgh ijkl mnop'
  const active = new Map<ID, ActiveRun>()
  let pickCursor = 0

  const listeners = {
    progress: new Set<Listener<RunProgress>>(),
    runFinished: new Set<Listener<RunSummary>>(),
    routinesChanged: new Set<Listener<void>>(),
    settingsChanged: new Set<Listener<AppSettings>>(),
    navigate: new Set<Listener<string>>(),
    trayShown: new Set<Listener<void>>()
  }
  const emit = <T>(set: Set<Listener<T>>, value: T): void => {
    for (const l of set) l(value)
  }
  const subscribe = <T>(set: Set<Listener<T>>, cb: Listener<T>): (() => void) => {
    set.add(cb)
    return () => set.delete(cb)
  }

  const summaryOf = (r: RunRecord): RunSummary => {
    const { destinations: _d, log: _l, emailError: _e, move: _m, ...summary } = r
    return summary
  }

  const withLastRun = (r: Routine): Routine => {
    const last = runs.find((x) => x.routineId === r.id)
    return clone({ ...r, lastRun: last ? summaryOf(last) : undefined })
  }

  const routinesChanged = (): void => emit(listeners.routinesChanged, undefined)

  function driveFor(path: string): DriveInfo | undefined {
    const upper = path.toUpperCase()
    return [...DRIVES]
      .sort((a, b) => b.path.length - a.path.length)
      .find((d) => upper.startsWith(d.path.toUpperCase().replace(/\\$/, '')))
  }

  /* ---------------- execução simulada ---------------- */

  function startRun(
    routine: Routine,
    trigger: RunTrigger,
    opts?: { startRatio?: number; startedAgoMs?: number }
  ): ID {
    const prof = profile(routine)
    const dests = routine.destinations.filter((d) => d.enabled !== false)
    const runId = uid('run')
    const ratio = opts?.startRatio ?? 0
    const isSeeded = ratio > 0
    // fila global: só uma execução por vez (como o agendador do main)
    const busy = [...active.values()].some((a) => a.progress.phase !== 'queued')
    // execuções iniciadas na interface são aceleradas para a demonstração
    const speed = isSeeded ? 84 * MB : Math.max(prof.bytes / 14, 40 * MB)
    const progress: RunProgress = {
      runId,
      routineId: routine.id,
      routineName: routine.name,
      phase: isSeeded ? 'copying' : busy ? 'queued' : 'scanning',
      filesTotal: isSeeded ? prof.files : 0,
      filesDone: Math.round(prof.files * ratio),
      bytesTotal: isSeeded ? prof.bytes : 0,
      bytesDone: Math.round(prof.bytes * ratio),
      speed: isSeeded ? speed : 0,
      etaMs: isSeeded ? ((prof.bytes * (dests.length - ratio)) / speed) * 1000 : undefined,
      currentFile: isSeeded
        ? 'C:\\Users\\Ana\\Pictures\\Escritório\\2026\\Clientes\\Reforma da fachada\\IMG_4821.HEIC'
        : undefined,
      destinationIndex: 0,
      destinationCount: dests.length,
      destinationPath: dests[0]?.path,
      startedAt: iso(Date.now() - (opts?.startedAgoMs ?? 0))
    }
    const run: ActiveRun = {
      progress,
      routine,
      trigger,
      timer: null,
      ticks: isSeeded ? 40 : 0,
      baseSpeed: speed,
      bytesPerDest: prof.bytes,
      filesPerDest: prof.files
    }
    active.set(runId, run)
    if (!flags.frozen) run.timer = setInterval(() => tick(runId), 400)
    queueMicrotask(() => emit(listeners.progress, clone(progress)))
    return runId
  }

  const FILE_NAMES = [
    'NF-e 35261004\\35261004123456000187550010000123451234567890-nfe.xml',
    'Relatórios\\Balancete 09-2026.pdf',
    '2026\\Clientes\\Reforma da fachada\\IMG_4833.HEIC',
    'Contratos\\Contrato de prestação de serviços – Mercado Bom Preço.docx',
    'Dados\\ERP.FDB',
    'Planilhas\\Fluxo de caixa outubro.xlsx'
  ]

  function tick(runId: ID): void {
    const run = active.get(runId)
    if (!run) return
    const p = run.progress
    run.ticks++
    if (p.phase === 'queued') {
      const someoneRunning = [...active.values()].some((a) => a !== run && a.progress.phase !== 'queued')
      if (someoneRunning) return
      p.phase = 'scanning'
      p.startedAt = iso(Date.now())
      run.ticks = 0
    } else if (p.phase === 'scanning') {
      if (run.ticks >= 4) {
        p.phase = 'copying'
        p.filesTotal = run.filesPerDest
        p.bytesTotal = run.bytesPerDest
      }
    } else if (p.phase === 'copying') {
      const jitter = 0.85 + Math.random() * 0.3
      p.speed = Math.round(run.baseSpeed * jitter)
      const step = p.speed * 0.4
      p.bytesDone = Math.min(p.bytesTotal, p.bytesDone + step)
      p.filesDone = Math.min(p.filesTotal, Math.round((p.bytesDone / p.bytesTotal) * p.filesTotal))
      const src = run.routine.sources[Math.floor(Math.random() * run.routine.sources.length)]
      p.currentFile = `${src?.path ?? 'C:\\'}\\${FILE_NAMES[Math.floor(Math.random() * FILE_NAMES.length)]}`
      const elapsed = Date.now() - new Date(p.startedAt).getTime()
      const remaining =
        p.bytesTotal - p.bytesDone + (p.destinationCount - p.destinationIndex - 1) * p.bytesTotal
      p.etaMs = elapsed > 5000 ? (remaining / Math.max(1, p.speed)) * 1000 : undefined
      if (p.bytesDone >= p.bytesTotal) {
        if (p.destinationIndex < p.destinationCount - 1) {
          p.destinationIndex++
          p.destinationPath = run.routine.destinations.filter((d) => d.enabled !== false)[p.destinationIndex]
            ?.path
          p.bytesDone = 0
          p.filesDone = 0
        } else {
          p.phase = run.routine.verify === 'none' ? 'pruning' : 'verifying'
          p.currentFile = undefined
          p.etaMs = 2000
          run.ticks = 0
        }
      }
    } else if (p.phase === 'verifying' && run.ticks >= 4) {
      p.phase = 'pruning'
      run.ticks = 0
    } else if (p.phase === 'pruning' && run.ticks >= 3) {
      if (run.routine.moveSources?.enabled) {
        // "Mover": confere e apaga da origem o que foi copiado (bytes do último destino completos).
        p.phase = 'moving'
        p.filesTotal = run.filesPerDest
        p.filesDone = 0
        p.bytesDone = p.bytesTotal
        p.speed = 0
      } else p.phase = run.routine.notification.enabled ? 'notifying' : 'done'
      run.ticks = 0
    } else if (p.phase === 'moving') {
      p.filesDone = Math.min(p.filesTotal, p.filesDone + 1)
      const src = run.routine.sources[0]?.path ?? 'C:\\Backup'
      p.currentFile = `${src}\\${p.filesDone % 2 ? 'ERP_2026-10-04_2300.fbk' : 'Diario\\NFE_2026-10-04.zip'}`
      if (run.ticks >= Math.max(3, p.filesTotal + 1)) {
        p.phase = run.routine.notification.enabled ? 'notifying' : 'done'
        p.currentFile = undefined
        run.ticks = 0
      }
    } else if (p.phase === 'notifying' && run.ticks >= 3) {
      p.phase = 'done'
    }
    emit(listeners.progress, clone(p))
    if (p.phase === 'done') finishRun(runId, 'success')
  }

  function finishRun(runId: ID, status: FinalRunStatus): void {
    const run = active.get(runId)
    if (!run) return
    if (run.timer) clearInterval(run.timer)
    active.delete(runId)
    const start = new Date(run.progress.startedAt)
    const spec: GenSpec = { routine: run.routine, start, trigger: run.trigger, status }
    const record = decorateMove(
      buildRecord(spec, mulberry32(hash(runId)), !!settings.smtp.host && !!settings.smtp.fromEmail),
      spec
    )
    record.id = runId
    record.finishedAt = iso(Date.now())
    record.durationMs = Date.now() - start.getTime()
    runs = [record, ...runs]
    emit(listeners.progress, { ...clone(run.progress), phase: 'done' })
    emit(listeners.runFinished, summaryOf(record))
    routinesChanged()
  }

  if (flags.scenario === 'running') {
    const fotos = routines.find((r) => r.id === 'r-fotos')
    if (fotos) startRun(fotos, 'manual', { startRatio: 0.42, startedAgoMs: 152_000 })
  }

  /* ---------------- validação ---------------- */

  function validate(input: RoutineInput): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    // mesmas regras e textos de src/main/validate.ts
    const name = input.name.trim()
    const key = name.toLocaleLowerCase('pt-BR')
    if (!name) issues.push({ level: 'error', step: 'origem', message: 'Dê um nome para a rotina.' })
    else if (name.length > 60)
      issues.push({
        level: 'error',
        step: 'origem',
        message: 'Use no máximo 60 caracteres no nome da rotina.'
      })
    else if (routines.some((r) => r.id !== input.id && r.name.trim().toLocaleLowerCase('pt-BR') === key))
      issues.push({
        level: 'error',
        step: 'origem',
        message: `Já existe uma rotina chamada "${name}". Escolha outro nome.`
      })
    const add = (
      level: ValidationIssue['level'],
      step: ValidationIssue['step'],
      message: string,
      destinationId?: string,
      topic?: ValidationIssue['topic']
    ): void => {
      if (issues.some((i) => i.message === message && i.step === step)) return
      const issue: ValidationIssue = { level, step, message }
      if (destinationId) issue.destinationId = destinationId
      if (topic) issue.topic = topic
      issues.push(issue)
    }
    const move = input.moveSources?.enabled === true
    const norm = (p: string): string => p.toUpperCase().replace(/[\\/]+$/, '')
    const isAbs = (p: string): boolean =>
      /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')
    const inside = (child: string, parent: string): boolean => {
      const c = norm(child)
      const pa = norm(parent)
      return c === pa || c.startsWith(pa + '\\') || c.startsWith(pa + '/')
    }
    const destName = (d: { label?: string; path: string }): string =>
      d.label ? `${d.label} (${d.path})` : d.path

    if (input.sources.length === 0)
      add('error', 'origem', 'Escolha pelo menos uma pasta ou arquivo para copiar.')
    const seenSources = new Set<string>()
    for (const s of input.sources) {
      if (!s.path?.trim() || !isAbs(s.path))
        add('error', 'origem', `Caminho de origem inválido: ${s.path || '(vazio)'}`)
      if (s.path && seenSources.has(norm(s.path))) add('warning', 'origem', `Origem repetida: ${s.path}`)
      if (s.path) seenSources.add(norm(s.path))
    }

    const dests = input.destinations.filter((d) => d.enabled !== false)
    if (dests.length === 0) add('error', 'destinos', 'Escolha pelo menos um destino para as cópias.')
    const seenDests = new Set<string>()
    for (const d of input.destinations) {
      if (!d.path?.trim() || !isAbs(d.path)) {
        add('error', 'destinos', `Caminho de destino inválido: ${d.path || '(vazio)'}`)
        continue
      }
      if (seenDests.has(norm(d.path))) add('error', 'destinos', `Destino repetido: ${d.path}`, d.id)
      seenDests.add(norm(d.path))
    }
    for (const d of dests) {
      if (!d.path || !isAbs(d.path)) continue
      for (const s of input.sources) {
        if (!s.path || !isAbs(s.path)) continue
        if (inside(d.path, s.path))
          add(
            'error',
            'destinos',
            `O destino ${destName(d)} fica dentro da origem ${s.path}. Escolha outra pasta.`,
            d.id
          )
        else if (inside(s.path, d.path))
          add(
            'error',
            'destinos',
            `O destino ${destName(d)} contém a origem ${s.path}. Escolha outra pasta.`,
            d.id
          )
      }
      if (!driveFor(d.path))
        add(
          'warning',
          'destinos',
          `Destino indisponível agora: ${destName(d)}. Conecte o disco antes do horário do backup.`,
          d.id
        )
      const sameDisk = input.sources.find(
        (s) =>
          /^[A-Z]:/i.test(d.path) &&
          s.path.slice(0, 2).toUpperCase() === d.path.slice(0, 2).toUpperCase() &&
          !inside(d.path, s.path) &&
          !inside(s.path, d.path)
      )
      if (sameDisk && move)
        add(
          'warning',
          'destinos',
          `O destino ${destName(d)} fica no mesmo disco da origem: "Mover" não libera espaço nesse disco.`,
          d.id,
          'move'
        )
      else if (sameDisk)
        add(
          'warning',
          'destinos',
          `O destino ${destName(d)} está no mesmo disco da origem: se o disco falhar, perde os dois.`,
          d.id
        )
    }
    const sc = input.schedule
    if (sc.kind === 'daily' || sc.kind === 'weekly') {
      const valid = sc.times.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))
      if (!valid.length) add('error', 'agendamento', 'Informe pelo menos um horário (HH:MM).')
      if (sc.times.length > 6) add('error', 'agendamento', 'Use no máximo 6 horários por dia.')
      if (valid.length !== sc.times.length)
        add('error', 'agendamento', 'Há um horário inválido. Use o formato HH:MM.')
      if (sc.kind === 'weekly' && !sc.weekdays.length)
        add('error', 'agendamento', 'Escolha pelo menos um dia da semana.')
    }
    if (sc.kind === 'interval') {
      if (!(sc.intervalMinutes >= 5)) add('error', 'agendamento', 'O intervalo mínimo é de 5 minutos.')
      // fim igual ao início é permitido (como no main)
      if (sc.window && sc.window.end < sc.window.start)
        add('error', 'agendamento', 'O fim da janela precisa ser depois do início.')
    }
    const ret = input.retention
    if (ret.enabled) {
      if (!(ret.days >= 1)) add('error', 'retencao', 'Mantenha os backups por pelo menos 1 dia.')
      if (!(ret.minKeep >= 0))
        add('error', 'retencao', 'O mínimo de backups guardados não pode ser negativo.')
      else if (ret.minKeep === 0)
        add(
          'warning',
          'retencao',
          'Sem um mínimo garantido, um computador desligado por dias pode ficar sem backups antigos.'
        )
    }
    const n = input.notification
    // como o main: com o aviso desligado, e-mails não são validados (campos ocultos)
    if (n.enabled) {
      for (const e of [...n.recipients, ...n.bcc])
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e))
          issues.push({ level: 'error', step: 'notificacao', message: `E-mail inválido: ${e}` })
      if (n.recipients.length === 0 && n.bcc.length === 0)
        issues.push({
          level: 'error',
          step: 'notificacao',
          message: 'Informe pelo menos um destinatário para os avisos por e-mail.'
        })
      if (!n.onSuccess && !n.onWarning && !n.onFailure)
        issues.push({
          level: 'warning',
          step: 'notificacao',
          message: 'Nenhuma situação marcada: nenhum e-mail será enviado.'
        })
      if (!settings.smtp.host || !settings.smtp.fromEmail)
        issues.push({
          level: 'warning',
          step: 'notificacao',
          message:
            'Configure o servidor de e-mail (SMTP) em Configurações › E-mail para os avisos funcionarem.'
        })
    }
    // "Mover" — mesmas regras e textos de src/main/validate.ts (pastas bloqueadas simplificadas).
    if (move) {
      const blocked = (path: string): boolean => {
        const n = norm(path)
        if (/^[A-Z]:$/.test(n) || /^\\\\[^\\]+\\[^\\]+$/.test(n)) return true
        if (n === 'C:\\WINDOWS' || n.startsWith('C:\\WINDOWS\\')) return true
        if (['C:\\PROGRAM FILES', 'C:\\PROGRAM FILES (X86)', 'C:\\PROGRAMDATA', 'C:\\USERS'].includes(n))
          return true
        const parts = n.split('\\')
        if (parts[0] === 'C:' && parts[1] === 'USERS' && parts.length === 3) return true
        const known = ['DESKTOP', 'DOCUMENTS', 'DOCUMENTOS', 'DOWNLOADS', 'PICTURES', 'IMAGENS']
        if (
          parts[0] === 'C:' &&
          parts[1] === 'USERS' &&
          parts.length === 4 &&
          (known.includes(parts[3]) || /^ONEDRIVE( - .+)?$/.test(parts[3]))
        )
          return true
        return false
      }
      for (const s of input.sources) {
        if (!s.path?.trim() || !isAbs(s.path)) continue
        if (s.kind === 'file')
          add(
            'error',
            'origem',
            '"Mover" só funciona com pastas. Troque o arquivo pela pasta que o contém.',
            undefined,
            'move'
          )
        else if (blocked(s.path))
          add(
            'error',
            'origem',
            'Não é possível usar "Mover" em uma unidade inteira ou pasta do sistema (C:\\, C:\\Windows, C:\\Users\\Ana…). Escolha a pasta onde o sistema grava os backups.',
            undefined,
            'move'
          )
        for (const other of routines) {
          if (other.id === input.id) continue
          if (other.sources.some((o) => inside(o.path, s.path) || inside(s.path, o.path)))
            add(
              'warning',
              'origem',
              `A rotina "${other.name}" também usa esta pasta e pode não encontrar os arquivos depois que eles forem movidos.`,
              undefined,
              'move'
            )
        }
      }
      if (
        input.sources.some((s) =>
          /(^|[\\/])(onedrive( - [^\\/]+)?|dropbox|google drive|meu drive)([\\/]|$)/i.test(s.path)
        )
      )
        add(
          'warning',
          'origem',
          'Esta pasta é sincronizada com a nuvem (OneDrive/Dropbox): apagar aqui também apaga lá.',
          undefined,
          'move'
        )
      if (dests.length === 1)
        add(
          'warning',
          'destinos',
          'Só há 1 destino ativo: depois de mover, o backup existirá em um único lugar. Recomendamos 2 destinos.',
          undefined,
          'move'
        )
      if (!ret.enabled)
        add(
          'warning',
          'retencao',
          'A retenção está desligada: os destinos vão acumular todos os backups movidos.',
          undefined,
          'move'
        )
      if (sc.kind === 'interval' && input.moveSources?.warnIfEmpty !== false && sc.intervalMinutes >= 5) {
        const m = sc.intervalMinutes
        const every =
          m % 60 === 0 ? (m === 60 ? 'a cada hora' : `a cada ${m / 60} horas`) : `a cada ${m} minutos`
        add(
          'warning',
          'agendamento',
          `Com execuções ${every}, desmarque "Avisar se não houver arquivo novo".`,
          undefined,
          'move'
        )
      }
    }
    return issues
  }

  /* ---------------- estatísticas ---------------- */

  function stats(): DashboardStats {
    const nowMs = Date.now()
    const weekAgo = nowMs - 7 * 86_400_000
    const final = runs.filter((r) => r.status !== 'running' && r.status !== 'queued')
    const last7 = final.filter((r) => new Date(r.startedAt).getTime() >= weekAgo)
    const ok = last7.filter((r) => r.status === 'success' || r.status === 'warning').length
    const counted = last7.filter((r) => r.status !== 'cancelled').length
    const days: DayStatus[] = []
    const today = new Date()
    const rank: Record<FinalRunStatus, number> = { success: 1, cancelled: 0, warning: 2, failed: 3 }
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dayRuns = final.filter((r) => {
        const s = new Date(r.startedAt)
        return (
          s.getFullYear() === d.getFullYear() && s.getMonth() === d.getMonth() && s.getDate() === d.getDate()
        )
      })
      let worst: FinalRunStatus | null = null
      for (const r of dayRuns) {
        const st = r.status as FinalRunStatus
        if (!worst || rank[st] > rank[worst]) worst = st
      }
      days.push({ date: key, status: worst, runs: dayRuns.length })
    }
    let nextRun: DashboardStats['nextRun']
    for (const r of routines) {
      if (!r.enabled) continue
      const at = nextRunAt(r.schedule, new Date())
      if (at && (!nextRun || at.toISOString() < nextRun.at))
        nextRun = { routineId: r.id, routineName: r.name, at: at.toISOString() }
    }
    const lastFinal = final[0]
    return {
      routinesTotal: routines.length,
      routinesActive: routines.filter((r) => r.enabled).length,
      runsLast7d: last7.length,
      successRate7d: counted ? Math.round((ok / counted) * 100) : null,
      bytesLast7d: last7.reduce((a, r) => a + r.bytesCopied * Math.max(1, r.destinationCount), 0),
      lastRun: lastFinal ? summaryOf(lastFinal) : undefined,
      nextRun,
      days
    }
  }

  /* ---------------- objeto público ---------------- */

  const info: AppInfo = {
    name: 'BC Backup',
    version: '0.1.0',
    platform: flags.platform,
    dataPath: 'C:\\ProgramData\\BC Backup',
    logsPath: 'C:\\ProgramData\\BC Backup\\logs',
    hostname: 'RECEPCAO-01'
  }

  /** Latência simulada das leituras (?slow=1). */
  const lag = (): Promise<void> => (flags.slow ? delay(1500) : Promise.resolve())

  const api: BcApi = {
    app: {
      info: async () => clone(info),
      openPath: async () => {},
      showInFolder: async () => {},
      openExternal: async () => {},
      window: async () => {},
      setResolvedTheme: async () => {}
    },
    routines: {
      list: async () => {
        await lag()
        return routines.map(withLastRun)
      },
      get: async (id) => {
        const r = routines.find((x) => x.id === id)
        return r ? withLastRun(r) : null
      },
      save: async (input) => {
        await delay(250)
        // como o main: recusa salvar com problemas de nível "error"
        const blocking = validate(input).filter((i) => i.level === 'error')
        if (blocking.length) throw ipcError('routines:save', blocking[0].message)
        const ts = iso(Date.now())
        let saved: Routine
        const existing = input.id ? routines.find((r) => r.id === input.id) : undefined
        if (existing) {
          saved = { ...existing, ...clone(input), id: existing.id, updatedAt: ts } as Routine
          routines = routines.map((r) => (r.id === existing.id ? saved : r))
        } else {
          saved = { ...clone(input), id: uid('r'), createdAt: ts, updatedAt: ts } as Routine
          routines = [...routines, saved]
        }
        routinesChanged()
        return withLastRun(saved)
      },
      remove: async (id) => {
        routines = routines.filter((r) => r.id !== id)
        routinesChanged()
      },
      duplicate: async (id) => {
        const r = routines.find((x) => x.id === id)
        if (!r) throw ipcError('routines:duplicate', 'Rotina não encontrada.')
        const ts = iso(Date.now())
        const copy: Routine = {
          ...clone(r),
          id: uid('r'),
          name: `${r.name} (cópia)`,
          createdAt: ts,
          updatedAt: ts
        }
        delete copy.lastRun
        routines = [...routines, copy]
        routinesChanged()
        return clone(copy)
      },
      setEnabled: async (id, enabled) => {
        routines = routines.map((r) => (r.id === id ? { ...r, enabled, updatedAt: iso(Date.now()) } : r))
        routinesChanged()
        return withLastRun(routines.find((r) => r.id === id)!)
      },
      runNow: async (id) => {
        const r = routines.find((x) => x.id === id)
        if (!r) throw ipcError('routines:run-now', 'Rotina não encontrada.')
        // já em execução ou na fila: devolve a execução existente (sem duplicar)
        for (const [existingId, a] of active) if (a.routine.id === id) return { runId: existingId }
        const runId = startRun(r, 'manual')
        routinesChanged()
        return { runId }
      },
      cancel: async (id) => {
        await delay(200)
        for (const [runId, a] of active)
          if (runId === id || a.routine.id === id) finishRun(runId, 'cancelled')
      },
      nextRuns: async () => {
        const out: Record<ID, string | null> = {}
        for (const r of routines) {
          const at = r.enabled ? nextRunAt(r.schedule, new Date()) : null
          out[r.id] = at ? at.toISOString() : null
        }
        return out
      },
      validate: async (input) => {
        await delay(60)
        return validate(input)
      }
    },
    runs: {
      list: async (query?: HistoryQuery) => {
        let list = runs
        if (query?.routineId) list = list.filter((r) => r.routineId === query.routineId)
        if (query?.status) list = list.filter((r) => r.status === query.status)
        if (query?.limit) list = list.slice(0, query.limit)
        return list.map(summaryOf).map(clone)
      },
      get: async (id) => {
        await lag()
        const r = runs.find((x) => x.id === id)
        return r ? clone(r) : null
      },
      active: async () => [...active.values()].map((a) => clone(a.progress)),
      clear: async () => {
        runs = []
        routinesChanged()
      }
    },
    settings: {
      get: async () => clone(settings),
      update: async (patch) => {
        settings = { ...settings, ...clone(patch) }
        emit(listeners.settingsChanged, clone(settings))
        return clone(settings)
      },
      saveSmtp: async (input: SmtpInput) => {
        await delay(300)
        const { password, ...rest } = input
        if (password !== undefined) smtpPassword = password
        // como o main: a senha salva só vale para o mesmo servidor/porta/usuário
        else if (accountChanged(settings.smtp, rest)) smtpPassword = ''
        settings = { ...settings, smtp: { ...rest, hasPassword: smtpPassword.length > 0 } }
        emit(listeners.settingsChanged, clone(settings))
        return clone(settings)
      },
      testSmtp: async (input): Promise<MailTestResult> => {
        await delay(1400)
        if (!input.host.trim())
          return { ok: false, message: 'Servidor não encontrado. Confira o endereço e a internet.' }
        if (
          (input.security === 'ssl' && input.port === 587) ||
          (input.security === 'starttls' && input.port === 465)
        )
          return { ok: false, message: 'A porta e a segurança não combinam: 465 = SSL; 587 = STARTTLS.' }
        if (input.password === undefined && settings.smtp.hasPassword && accountChanged(settings.smtp, input))
          return {
            ok: false,
            message: 'Você mudou o servidor ou o usuário: digite a senha novamente para testar.'
          }
        const pass = input.password ?? smtpPassword
        if (!input.user.trim() || !pass)
          return {
            ok: false,
            message: 'Usuário ou senha recusados. No Gmail, use uma Senha de app, não a senha normal.'
          }
        return { ok: true, message: `E-mail de teste enviado para ${input.to}.` }
      },
      exportConfig: async (): Promise<FileResult> => {
        await delay(400)
        const path = 'C:\\Users\\Ana\\Documents\\bc-backup-configuracoes.json'
        return { canceled: false, ok: true, path, message: `Configurações exportadas para ${path}` }
      },
      importConfig: async (): Promise<FileResult> => {
        await delay(400)
        return { canceled: true }
      }
    },
    system: {
      drives: async () => {
        await delay(flags.slow ? 3000 : 120)
        return clone(DRIVES)
      },
      diskSpace: async (path): Promise<DiskSpace | null> => {
        await lag()
        const d = driveFor(path)
        return d ? { path: d.path, total: d.total, free: d.free } : null
      },
      pickFolders: async (opts): Promise<PickResult> => {
        await delay(150)
        const n = opts?.multi === false ? 1 : 1
        const paths = Array.from({ length: n }, () => FOLDER_POOL[pickCursor++ % FOLDER_POOL.length])
        return { canceled: false, paths }
      },
      pickFiles: async (): Promise<PickResult> => {
        await delay(150)
        return { canceled: false, paths: [FILE_POOL[pickCursor++ % FILE_POOL.length]] }
      },
      pathForFile: (file: File): string => (file.name ? `C:\\Users\\Ana\\Documentos\\${file.name}` : ''),
      inspectPaths: async (paths: string[]): Promise<PathInfo[]> => {
        await delay(60)
        return paths.map((path) => {
          const name = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
          return { path, kind: /\.[^.\\/]+$/.test(name) ? ('file' as const) : ('folder' as const) }
        })
      },
      stats: async () => stats(),
      estimateSize: async (sources: string[], filters?: Filters): Promise<SizeEstimate> => {
        await delay(450 + (sources.length % 3) * 120)
        let bytes = 0
        let files = 0
        for (const s of sources) {
          const z = sizeOf(s)
          bytes += z.bytes
          files += z.files
        }
        if (filters?.maxFileSizeMB) bytes *= 0.82
        return { bytes: Math.round(bytes), files, partial: files > 12000 }
      },
      previewMove: async (sources, _filters, move): Promise<MovePreview> => {
        await delay(380)
        // Mesmas regras do motor, simuladas: o ERP terminou de gravar 2 arquivos e ainda grava 1.
        const out: MovePreview = {
          files: 0,
          bytes: 0,
          names: [],
          waiting: 0,
          waitingItems: [],
          partial: false
        }
        for (const src of sources) {
          if (/\.[^.\\/]+$/.test(src)) continue // arquivo: "Mover" só funciona com pastas
          const z = sizeOf(src)
          const r = mulberry32(hash(src))
          const files = Math.min(z.files, 2 + Math.floor(r() * 2))
          const recent = move.minAgeMinutes >= 120 ? 2 : 1
          out.files += Math.max(0, files - recent + 1)
          out.bytes += Math.round(z.bytes * 0.92)
          for (let i = 0; i < files - recent + 1; i++)
            out.names.push(i === 0 ? 'ERP_2026-10-04_2300.fbk' : `Diario\\NFE_2026-10-0${4 - i}.zip`)
          out.waiting += recent
          for (let i = 0; i < recent; i++)
            out.waitingItems.push({
              name: i === 0 ? 'ERP_2026-10-05_1200.fbk' : 'Diario\\NFE_2026-10-05.zip',
              reason: `Alterado há ${4 + i * 9} min, pode estar sendo gravado`
            })
        }
        out.names = out.names.slice(0, 10)
        out.waitingItems = out.waitingItems.slice(0, 10)
        return out
      }
    },
    on: {
      progress: (cb) => subscribe(listeners.progress, cb),
      runFinished: (cb) => subscribe(listeners.runFinished, cb),
      routinesChanged: (cb) => subscribe(listeners.routinesChanged, () => cb()),
      settingsChanged: (cb) => subscribe(listeners.settingsChanged, cb),
      navigate: (cb) => subscribe(listeners.navigate, cb),
      trayShown: (cb) => subscribe(listeners.trayShown, () => cb())
    },
    // Painel da bandeja (http://localhost:5199/tray.html): no navegador não há janela a mostrar.
    tray: (() => {
      let pausedByTray: ID[] = []
      return {
        openMain: async (route?: string) => {
          console.info('[mock] tray.openMain', route ?? '/')
        },
        hide: async () => {},
        setAllPaused: async (paused: boolean) => {
          const now = iso(Date.now())
          if (paused) {
            pausedByTray = routines.filter((r) => r.enabled).map((r) => r.id)
            routines = routines.map((r) => (r.enabled ? { ...r, enabled: false, updatedAt: now } : r))
          } else {
            const ids = pausedByTray.length ? new Set(pausedByTray) : null
            routines = routines.map((r) =>
              !r.enabled && (!ids || ids.has(r.id)) ? { ...r, enabled: true, updatedAt: now } : r
            )
            pausedByTray = []
          }
          routinesChanged()
        },
        quit: async () => {}
      }
    })()
  }
  return api
}

/** Instala o mock em `window.bc` (dev:web ou quando não há preload). */
export function installMockApi(): void {
  ;(window as Window & { bc?: BcApi }).bc = createMockApi()
}
