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

/*
 * Estrutura no destino: cada execução cria, DIRETO na pasta escolhida,
 *   <destino>/<AAAA-MM-DD_HH-mm-ss>/        (ou "<carimbo>.zip")    — "_2", "_3"… se o nome já existir
 * com os arquivos dentro: uma origem → o conteúdo dela direto; várias → uma subpasta por origem.
 * O nome da rotina NÃO vira pasta. A pasta do destino pode ter outras coisas (outras rotinas, outro PC,
 * arquivos do usuário): a retenção e a limpeza só mexem no que tem o manifesto/marcador desta rotina.
 */

/**
 * LEGADO (versões anteriores): pasta raiz "<destino>/BC Backup/<rotina>/<carimbo>". Não é mais criada; a
 * retenção ainda considera os backups antigos de lá (com o manifesto da rotina) para eles saírem no prazo.
 */
export const LEGACY_ROOT_DIR = 'BC Backup'
/** @deprecated Use LEGACY_ROOT_DIR (o motor não cria mais esta pasta). */
export const BACKUP_ROOT_DIR = LEGACY_ROOT_DIR
/** Sufixo da pasta (ou do .zip) enquanto a cópia não terminou. */
export const IN_PROGRESS_SUFFIX = '.em-andamento'
/**
 * Marcador gravado como PRIMEIRA coisa dentro de "<carimbo>.em-andamento" (pasta e ZIP): diz de qual
 * rotina, execução e computador é a cópia em andamento. Sobras sem ele nunca são apagadas.
 */
export const IN_PROGRESS_MARKER_FILE = 'bcbackup-em-andamento.json'
/** Sufixo aplicado antes de apagar um backup antigo. */
export const DELETING_SUFFIX = '.excluindo'
/** Manifesto gravado em cada backup (a retenção só apaga pastas com ele). */
export const MANIFEST_FILE = 'bcbackup-manifesto.json'
/** LEGADO: marcador da pasta "<destino>/BC Backup/<rotina>" (usado só para achar backups antigos). */
export const ROUTINE_MARKER_FILE = '.bcbackup-rotina.json'
/**
 * Sobra de OUTRO computador (ou sem identificação) só é considerada abandonada depois deste tempo
 * sem nenhuma alteração: pode ser um backup rodando agora, numa pasta de rede compartilhada.
 */
export const STALE_LEFTOVER_MS = 12 * 3600_000

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
  '**/*.vbe',
  '**/*.js',
  '**/*.jse',
  '**/*.wsf',
  '**/*.wsh',
  '**/*.py',
  '**/*.psm1',
  '**/*.com',
  '**/*.scr',
  '**/*.cpl',
  '**/*.msc',
  '**/*.sys',
  '**/*.jar',
  '**/*.reg',
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
