import type { AppSettings, Routine } from './types'
import type { RoutineInput } from './api'

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

export function createDefaultRoutine(): RoutineInput {
  return {
    name: '',
    description: '',
    color: 'indigo',
    enabled: true,
    sources: [],
    destinations: [],
    mode: 'copy',
    filters: { include: [], exclude: [...DEFAULT_EXCLUDES], skipHiddenAndSystem: true },
    schedule: {
      kind: 'daily',
      times: ['18:00'],
      weekdays: [1, 2, 3, 4, 5],
      everyHours: 4,
      startupDelayMinutes: 5,
      catchUpMissed: true
    },
    retention: { enabled: true, days: 7, minKeep: 3 },
    notification: { recipients: [], when: 'never', clientName: '' },
    verify: true
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  launchAtLogin: true,
  startMinimized: true,
  closeToTray: true,
  desktopNotifications: true,
  companyName: 'BC Backup',
  historyLimit: 500,
  smtp: {
    host: '',
    port: 587,
    security: 'starttls',
    user: '',
    hasPassword: false,
    fromName: 'BC Backup',
    fromEmail: ''
  }
}

export type RoutineDraft = RoutineInput & Partial<Pick<Routine, 'createdAt' | 'updatedAt'>>
