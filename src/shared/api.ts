// Contrato da ponte IPC exposta em `window.bc` pelo preload.
// O renderer só conversa com o main por aqui. Cada método `invoke` tem um canal
// homônimo em IPC_CHANNELS; eventos (main → renderer) estão em IPC_EVENTS.

import type {
  AppInfo,
  AppSettings,
  DashboardStats,
  DiskSpace,
  DriveInfo,
  ID,
  Routine,
  RunProgress,
  RunRecord,
  RunSummary,
  SmtpInput
} from './types'

export type RoutineInput = Omit<Routine, 'id' | 'createdAt' | 'updatedAt' | 'lastRun'> & {
  id?: ID
}

export interface HistoryQuery {
  routineId?: ID
  status?: RunSummary['status']
  limit?: number
}

export interface MailTestResult {
  ok: boolean
  /** Mensagem amigável em pt-BR. */
  message: string
}

export interface PickResult {
  canceled: boolean
  paths: string[]
}

export interface BcApi {
  app: {
    info(): Promise<AppInfo>
    openPath(path: string): Promise<void>
    showInFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    /** Controles de janela (titlebar customizada). */
    window(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  }
  routines: {
    list(): Promise<Routine[]>
    get(id: ID): Promise<Routine | null>
    save(input: RoutineInput): Promise<Routine>
    remove(id: ID): Promise<void>
    duplicate(id: ID): Promise<Routine>
    setEnabled(id: ID, enabled: boolean): Promise<Routine>
    runNow(id: ID): Promise<{ runId: ID }>
    cancel(id: ID): Promise<void>
    /** Próxima execução calculada pelo agendador (ISO) ou null. */
    nextRuns(): Promise<Record<ID, string | null>>
  }
  runs: {
    list(query?: HistoryQuery): Promise<RunSummary[]>
    get(id: ID): Promise<RunRecord | null>
    active(): Promise<RunProgress[]>
    clear(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<Omit<AppSettings, 'smtp'>>): Promise<AppSettings>
    saveSmtp(input: SmtpInput): Promise<AppSettings>
    testSmtp(input: SmtpInput & { to: string }): Promise<MailTestResult>
  }
  system: {
    drives(): Promise<DriveInfo[]>
    diskSpace(path: string): Promise<DiskSpace | null>
    pickFolders(opts?: { multi?: boolean; title?: string }): Promise<PickResult>
    pickFiles(opts?: { title?: string }): Promise<PickResult>
    stats(): Promise<DashboardStats>
  }
  on: {
    progress(cb: (p: RunProgress) => void): () => void
    runFinished(cb: (r: RunSummary) => void): () => void
    routinesChanged(cb: () => void): () => void
    settingsChanged(cb: (s: AppSettings) => void): () => void
    /** O main pede para a UI navegar (ex.: clique no tray / notificação). */
    navigate(cb: (route: string) => void): () => void
  }
}

export const IPC_CHANNELS = {
  appInfo: 'app:info',
  appOpenPath: 'app:open-path',
  appShowInFolder: 'app:show-in-folder',
  appOpenExternal: 'app:open-external',
  appWindow: 'app:window',
  routinesList: 'routines:list',
  routinesGet: 'routines:get',
  routinesSave: 'routines:save',
  routinesRemove: 'routines:remove',
  routinesDuplicate: 'routines:duplicate',
  routinesSetEnabled: 'routines:set-enabled',
  routinesRunNow: 'routines:run-now',
  routinesCancel: 'routines:cancel',
  routinesNextRuns: 'routines:next-runs',
  runsList: 'runs:list',
  runsGet: 'runs:get',
  runsActive: 'runs:active',
  runsClear: 'runs:clear',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsSaveSmtp: 'settings:save-smtp',
  settingsTestSmtp: 'settings:test-smtp',
  systemDrives: 'system:drives',
  systemDiskSpace: 'system:disk-space',
  systemPickFolders: 'system:pick-folders',
  systemPickFiles: 'system:pick-files',
  systemStats: 'system:stats'
} as const

export const IPC_EVENTS = {
  progress: 'evt:progress',
  runFinished: 'evt:run-finished',
  routinesChanged: 'evt:routines-changed',
  settingsChanged: 'evt:settings-changed',
  navigate: 'evt:navigate'
} as const

declare global {
  interface Window {
    bc: BcApi
  }
}
