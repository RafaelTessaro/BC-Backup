import type { RoutineInput } from './api'
import type { AppSettings, MoveSources, RoutineNotification, SmtpPreset, SmtpSecurity } from './types'

export const DEFAULT_EXCLUDES = [
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.DS_Store',
  '**/~$*',
  '**/*.tmp',
  '**/$RECYCLE.BIN/**',
  '**/System Volume Information/**'
]

/** Nome da pasta raiz criada dentro de cada destino. */
export const BACKUP_ROOT_DIR = 'BC Backup'
/** Sufixo da pasta enquanto a cópia não terminou. */
export const IN_PROGRESS_SUFFIX = '.em-andamento'
/** Sufixo aplicado antes de apagar um backup antigo. */
export const DELETING_SUFFIX = '.excluindo'
/** Manifesto gravado em cada backup (a retenção só apaga pastas com ele). */
export const MANIFEST_FILE = 'bcbackup-manifesto.json'
/** Marcador gravado na pasta da rotina dentro do destino. */
export const ROUTINE_MARKER_FILE = '.bcbackup-rotina.json'

/** "Mover" desligado por padrão; `createDefaultRoutine()` NÃO preenche o campo. */
export const DEFAULT_MOVE_SOURCES: MoveSources = { enabled: false, minAgeMinutes: 30, warnIfEmpty: true }
/** Limites de "Só mover arquivos sem alteração há pelo menos N minutos". */
export const MOVE_MIN_AGE_RANGE = { min: 5, max: 1440 } as const
/** Arquivos apagados listados por execução no histórico (a contagem continua exata). */
export const MAX_MOVED_LISTED = 5000
/** Nunca entram numa rotina "Mover" (nem copiados nem apagados). */
export const MOVE_NEVER = [
  '**/*.exe',
  '**/*.dll',
  '**/*.msi',
  '**/*.bat',
  '**/*.cmd',
  '**/*.ps1',
  '**/*.vbs',
  '**/*.lnk',
  '**/*.ini',
  '**/*.config',
  '**/*.tmp',
  '**/*.part',
  '**/*.partial',
  '**/*.crdownload',
  '**/~*'
]

export const DEFAULT_NOTIFICATION: RoutineNotification = {
  enabled: false,
  recipients: [],
  bcc: [],
  onSuccess: true,
  onWarning: true,
  onFailure: true,
  attachLog: 'onFailure',
  clientName: ''
}

export function createDefaultRoutine(): RoutineInput {
  return {
    name: '',
    description: '',
    color: 'blue',
    enabled: true,
    sources: [],
    destinations: [],
    mode: 'copy',
    zipLevel: 6,
    filters: { include: [], exclude: [...DEFAULT_EXCLUDES], skipHiddenAndSystem: true, maxFileSizeMB: null },
    verify: 'full',
    schedule: {
      kind: 'daily',
      times: ['18:00'],
      weekdays: [1, 2, 3, 4, 5],
      intervalMinutes: 240,
      window: null,
      startupDelayMinutes: 5,
      catchUpMissed: true
    },
    retention: { enabled: true, days: 7, minKeep: 3 },
    notification: { ...DEFAULT_NOTIFICATION }
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  launchAtLogin: true,
  closeToTray: true,
  desktopNotifications: true,
  clientName: '',
  computerAlias: '',
  companyName: 'BC Backup',
  historyDays: 180,
  trayHintShown: false,
  smtp: {
    preset: 'custom',
    host: '',
    port: 587,
    security: 'starttls',
    user: '',
    hasPassword: false,
    fromName: 'BC Backup',
    fromEmail: '',
    replyTo: '',
    allowInvalidCert: false,
    timeoutSec: 30
  }
}

export interface SmtpPresetInfo {
  id: SmtpPreset
  label: string
  host: string
  port: number
  security: SmtpSecurity
  /** Dica exibida na interface. */
  hint?: string
}

/** Presets de provedores comuns no Brasil (docs/research/01, seção 7). */
export const SMTP_PRESETS: SmtpPresetInfo[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    security: 'ssl',
    hint: 'No Gmail, ative a verificação em 2 etapas e use uma "senha de app".'
  },
  {
    id: 'office365',
    label: 'Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    hint: 'A autenticação SMTP precisa estar habilitada na caixa de correio.'
  },
  { id: 'hostinger', label: 'Hostinger', host: 'smtp.hostinger.com', port: 465, security: 'ssl' },
  { id: 'locaweb', label: 'Locaweb', host: 'email-ssl.com.br', port: 587, security: 'starttls' },
  { id: 'uol', label: 'UOL Host', host: 'smtps.uol.com.br', port: 587, security: 'starttls' },
  { id: 'kinghost', label: 'KingHost', host: 'smtpi.kinghost.net', port: 587, security: 'starttls' },
  {
    id: 'hostgator',
    label: 'HostGator',
    host: 'mail.seudominio.com.br',
    port: 465,
    security: 'ssl',
    hint: 'Troque "seudominio.com.br" pelo domínio do seu e-mail.'
  },
  { id: 'custom', label: 'Personalizado', host: '', port: 587, security: 'starttls' }
]
