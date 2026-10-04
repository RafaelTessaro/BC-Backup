// Modelo de domínio compartilhado entre o processo principal (main) e a interface (renderer).
// Qualquer mudança aqui afeta a persistência (store) — mantenha campos novos opcionais
// ou adicione uma migração em src/main/store.ts.

export type ID = string

/* ------------------------------------------------------------------ */
/* Rotinas                                                             */
/* ------------------------------------------------------------------ */

export type SourceKind = 'folder' | 'file'

export interface SourceItem {
  id: ID
  path: string
  kind: SourceKind
}

export interface Destination {
  id: ID
  /** Pasta base escolhida pelo usuário (ex.: "D:\\", "E:\\Backups"). */
  path: string
  /** Rótulo amigável opcional (ex.: "HD Externo"). */
  label?: string
}

export type BackupMode = 'copy' | 'zip'

export type ScheduleKind = 'manual' | 'daily' | 'weekly' | 'interval' | 'startup'

export interface Schedule {
  kind: ScheduleKind
  /** Horários "HH:MM" (daily / weekly). Ao menos um quando kind = daily | weekly. */
  times: string[]
  /** 0 = domingo … 6 = sábado (weekly). */
  weekdays: number[]
  /** Intervalo em horas (interval). */
  everyHours: number
  /** Atraso em minutos após iniciar o sistema (startup). */
  startupDelayMinutes: number
  /** Se o computador estava desligado no horário, executar ao ligar. */
  catchUpMissed: boolean
}

export interface Retention {
  enabled: boolean
  /** Apagar backups com mais de N dias. */
  days: number
  /** Nunca apagar abaixo desse número de backups bem-sucedidos (trava de segurança). */
  minKeep: number
}

export interface Filters {
  /** Padrões glob para incluir (vazio = tudo). */
  include: string[]
  /** Padrões glob para excluir. */
  exclude: string[]
  /** Ignorar arquivos ocultos e de sistema (desktop.ini, Thumbs.db, ~$*.docx…). */
  skipHiddenAndSystem: boolean
}

export type NotifyWhen = 'always' | 'failure' | 'never'

export interface RoutineNotification {
  /** E-mails dos destinatários (cliente). */
  recipients: string[]
  when: NotifyWhen
  /** Nome do cliente usado no texto do e-mail. */
  clientName?: string
}

export interface Routine {
  id: ID
  name: string
  description?: string
  /** Cor de destaque escolhida para a rotina (token de acento). */
  color?: RoutineColor
  enabled: boolean
  sources: SourceItem[]
  destinations: Destination[]
  mode: BackupMode
  filters: Filters
  schedule: Schedule
  retention: Retention
  notification: RoutineNotification
  /** Verificar tamanho dos arquivos copiados após a cópia. */
  verify: boolean
  createdAt: string
  updatedAt: string
  /** Última execução (resumo) — preenchido pelo main. */
  lastRun?: RunSummary
}

export type RoutineColor = 'indigo' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate'

/* ------------------------------------------------------------------ */
/* Execuções (histórico)                                               */
/* ------------------------------------------------------------------ */

export type RunStatus = 'running' | 'success' | 'warning' | 'failed' | 'cancelled'

export type RunTrigger = 'manual' | 'schedule' | 'startup' | 'catch-up'

export interface DestinationResult {
  destinationId: ID
  path: string
  /** Pasta (ou .zip) criada para esta execução. */
  outputPath?: string
  status: Exclude<RunStatus, 'running'>
  filesCopied: number
  bytesCopied: number
  /** Backups antigos removidos pela retenção. */
  pruned: string[]
  error?: string
}

export interface RunSummary {
  id: ID
  routineId: ID
  status: RunStatus
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
  trigger: RunTrigger
  emailSent?: boolean
  emailError?: string
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  t: string
  level: LogLevel
  message: string
}

export interface RunRecord extends RunSummary {
  routineName: string
  destinations: DestinationResult[]
  log: LogEntry[]
}

export interface RunProgress {
  runId: ID
  routineId: ID
  phase: 'scanning' | 'copying' | 'verifying' | 'pruning' | 'notifying' | 'done'
  filesTotal: number
  filesDone: number
  bytesTotal: number
  bytesDone: number
  /** Bytes por segundo (média móvel). */
  speed: number
  currentFile?: string
  /** Índice do destino atual (0-based) e total. */
  destinationIndex: number
  destinationCount: number
  startedAt: string
}

/* ------------------------------------------------------------------ */
/* Configurações                                                       */
/* ------------------------------------------------------------------ */

export type ThemePreference = 'light' | 'dark' | 'system'

export type SmtpSecurity = 'ssl' | 'starttls' | 'none'

export interface SmtpSettings {
  host: string
  port: number
  security: SmtpSecurity
  user: string
  /** Nunca trafega de volta para o renderer — só `hasPassword`. */
  hasPassword: boolean
  fromName: string
  fromEmail: string
}

export interface AppSettings {
  theme: ThemePreference
  launchAtLogin: boolean
  startMinimized: boolean
  closeToTray: boolean
  desktopNotifications: boolean
  /** Nome da empresa/técnico exibido nos e-mails (marca própria). */
  companyName: string
  /** Quantos registros de histórico manter. */
  historyLimit: number
  smtp: SmtpSettings
}

/** Payload para salvar SMTP: senha opcional (undefined = manter a atual). */
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
}

export interface DiskSpace {
  path: string
  total: number
  free: number
}

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform | 'browser'
  dataPath: string
}

export interface DashboardStats {
  routinesTotal: number
  routinesActive: number
  runsLast7d: number
  successRate7d: number
  bytesLast7d: number
  nextRun?: { routineId: ID; routineName: string; at: string }
}
