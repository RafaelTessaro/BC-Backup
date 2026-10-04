// Modelo de domínio compartilhado entre o processo principal (main) e a interface (renderer).
// Qualquer mudança aqui afeta a persistência (store) — mantenha campos novos opcionais
// ou adicione uma migração em src/main/store.ts.
// Base: docs/research/01-concorrentes-e-funcionalidades.md (seções 3–7).

export type ID = string

/* ------------------------------------------------------------------ */
/* Rotinas                                                             */
/* ------------------------------------------------------------------ */

export type SourceKind = 'folder' | 'file'

export interface SourceItem {
  id: ID
  path: string
  kind: SourceKind
  /** Nome da subpasta dentro do backup (padrão: nome da pasta/arquivo de origem). */
  label?: string
}

export interface Destination {
  id: ID
  /** Pasta base escolhida pelo usuário (ex.: "E:\\", "\\\\SERVIDOR\\backup"). */
  path: string
  /** Rótulo amigável opcional (ex.: "HD externo azul"). */
  label?: string
  /** false = destino ignorado nas execuções (padrão true). */
  enabled?: boolean
}

export type BackupMode = 'copy' | 'zip'

/** none = sem verificação · quick = tamanho + data · full = hash relendo o destino. */
export type VerifyMode = 'none' | 'quick' | 'full'

export type ScheduleKind = 'manual' | 'daily' | 'weekly' | 'interval' | 'startup'

export interface TimeWindow {
  /** "HH:MM" */
  start: string
  /** "HH:MM" (inclusivo) */
  end: string
}

export interface Schedule {
  kind: ScheduleKind
  /** Horários "HH:MM" (daily / weekly), 1–6. */
  times: string[]
  /** 0 = domingo … 6 = sábado. Usado por weekly e interval (vazio = todos os dias). */
  weekdays: number[]
  /** interval: a cada N minutos (15, 30, 60, 120, 240, 360, 720). */
  intervalMinutes: number
  /** interval: só executar dentro desta janela (null = o dia todo, começando 00:00). */
  window: TimeWindow | null
  /** startup: atraso em minutos após o app iniciar com o sistema. */
  startupDelayMinutes: number
  /** Se o computador estava desligado no horário, executar uma vez ao ligar. */
  catchUpMissed: boolean
}

export interface Retention {
  enabled: boolean
  /** Manter backups dos últimos N dias de calendário (hoje conta como 1). */
  days: number
  /** Nunca apagar abaixo desse número de backups concluídos (trava de segurança). */
  minKeep: number
}

export interface Filters {
  /** Padrões glob para incluir (vazio = tudo). */
  include: string[]
  /** Padrões glob para excluir. */
  exclude: string[]
  /** Ignorar arquivos ocultos e de sistema. */
  skipHiddenAndSystem: boolean
  /** Ignorar arquivos maiores que N MB (null = sem limite). */
  maxFileSizeMB: number | null
}

export type AttachLog = 'never' | 'onFailure' | 'always'

export interface RoutineNotification {
  enabled: boolean
  /** E-mails dos destinatários (cliente). */
  recipients: string[]
  /** Cópia oculta (ex.: e-mail do técnico). */
  bcc: string[]
  onSuccess: boolean
  onWarning: boolean
  onFailure: boolean
  attachLog: AttachLog
  /** Nome do cliente usado no texto do e-mail (padrão: configuração global). */
  clientName?: string
}

export type RoutineColor = 'blue' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate'

export interface Routine {
  id: ID
  name: string
  description?: string
  color?: RoutineColor
  /** false = "Pausada". */
  enabled: boolean
  sources: SourceItem[]
  destinations: Destination[]
  mode: BackupMode
  /** Nível de compressão do ZIP (0–9, padrão 6). */
  zipLevel: number
  filters: Filters
  verify: VerifyMode
  schedule: Schedule
  retention: Retention
  notification: RoutineNotification
  createdAt: string
  updatedAt: string
  /** Resumo da última execução — preenchido pelo main. */
  lastRun?: RunSummary
}

/* ------------------------------------------------------------------ */
/* Execuções (histórico)                                               */
/* ------------------------------------------------------------------ */

export type RunStatus = 'queued' | 'running' | 'success' | 'warning' | 'failed' | 'cancelled'

export type FinalRunStatus = Exclude<RunStatus, 'queued' | 'running'>

export type RunTrigger = 'manual' | 'schedule' | 'startup' | 'catch-up'

export type EmailStatus = 'not_configured' | 'skipped' | 'sent' | 'queued' | 'failed'

export interface SkippedFile {
  path: string
  /** Motivo em pt-BR (ex.: "Arquivo em uso", "Sem permissão"). */
  reason: string
}

export interface DestinationResult {
  destinationId: ID
  path: string
  label?: string
  /** Pasta (ou .zip) criada para esta execução. */
  outputPath?: string
  status: FinalRunStatus
  filesCopied: number
  bytesCopied: number
  skipped: SkippedFile[]
  /** Backups antigos removidos pela retenção (caminhos). */
  pruned: string[]
  freeBytesAfter?: number
  error?: string
}

export interface RunSummary {
  id: ID
  routineId: ID
  routineName: string
  status: RunStatus
  trigger: RunTrigger
  startedAt: string
  finishedAt?: string
  durationMs?: number
  filesTotal: number
  filesCopied: number
  filesSkipped: number
  bytesTotal: number
  bytesCopied: number
  warnings: number
  errors: number
  destinationCount: number
  email?: EmailStatus
  /** Mensagem principal do erro (para listas). */
  errorMessage?: string
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  t: string
  level: LogLevel
  message: string
}

export interface RunRecord extends RunSummary {
  destinations: DestinationResult[]
  log: LogEntry[]
  emailError?: string
}

export type RunPhase = 'queued' | 'scanning' | 'copying' | 'verifying' | 'pruning' | 'notifying' | 'done'

export interface RunProgress {
  runId: ID
  routineId: ID
  routineName: string
  phase: RunPhase
  filesTotal: number
  filesDone: number
  bytesTotal: number
  bytesDone: number
  /** Bytes por segundo (média móvel ~3 s). */
  speed: number
  /** Estimativa em ms (undefined enquanto calcula). */
  etaMs?: number
  currentFile?: string
  /** Destino atual (0-based) e total. */
  destinationIndex: number
  destinationCount: number
  destinationPath?: string
  startedAt: string
}

/* ------------------------------------------------------------------ */
/* Configurações                                                       */
/* ------------------------------------------------------------------ */

export type ThemePreference = 'light' | 'dark' | 'system'

export type SmtpSecurity = 'ssl' | 'starttls' | 'none'

export type SmtpPreset =
  'gmail' | 'office365' | 'hostinger' | 'locaweb' | 'uol' | 'kinghost' | 'hostgator' | 'custom'

export interface SmtpSettings {
  preset: SmtpPreset
  host: string
  port: number
  security: SmtpSecurity
  user: string
  /** A senha nunca trafega de volta para o renderer — só `hasPassword`. */
  hasPassword: boolean
  fromName: string
  fromEmail: string
  replyTo: string
  allowInvalidCert: boolean
  timeoutSec: number
}

export interface AppSettings {
  theme: ThemePreference
  launchAtLogin: boolean
  closeToTray: boolean
  desktopNotifications: boolean
  /** Nome padrão do cliente (aparece nos e-mails). */
  clientName: string
  /** Apelido do computador (padrão: hostname). */
  computerAlias: string
  /** Nome da empresa/técnico na assinatura dos e-mails (marca própria). */
  companyName: string
  /** Dias de histórico mantidos. */
  historyDays: number
  smtp: SmtpSettings
  /** Já mostramos a dica "continua rodando na bandeja"? */
  trayHintShown: boolean
}

/** Payload para salvar SMTP: senha opcional (undefined = manter a atual, '' = apagar). */
export type SmtpInput = Omit<SmtpSettings, 'hasPassword'> & { password?: string }

/* ------------------------------------------------------------------ */
/* Sistema                                                             */
/* ------------------------------------------------------------------ */

export interface DriveInfo {
  /** Raiz do volume (ex.: "D:\\", "/Volumes/Backup"). */
  path: string
  label: string
  total: number
  free: number
  removable?: boolean
  network?: boolean
}

export interface DiskSpace {
  path: string
  total: number
  free: number
}

export interface AppInfo {
  name: string
  version: string
  platform: 'win32' | 'darwin' | 'linux' | 'browser' | (string & {})
  dataPath: string
  logsPath: string
  hostname: string
}

export interface DayStatus {
  /** "AAAA-MM-DD" */
  date: string
  /** Pior status do dia; null = nenhuma execução. */
  status: FinalRunStatus | null
  runs: number
}

export interface DashboardStats {
  routinesTotal: number
  routinesActive: number
  runsLast7d: number
  /** 0–100 (null sem execuções). */
  successRate7d: number | null
  bytesLast7d: number
  lastRun?: RunSummary
  nextRun?: { routineId: ID; routineName: string; at: string }
  /** Últimos 14 dias, do mais antigo para o mais novo. */
  days: DayStatus[]
}
