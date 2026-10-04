// Contrato da ponte IPC exposta em `window.bc` pelo preload.
// O renderer só conversa com o main por aqui. Cada método `invoke` tem um canal
// homônimo em IPC_CHANNELS; eventos (main → renderer) estão em IPC_EVENTS.

import type {
  AppInfo,
  AppSettings,
  DashboardStats,
  DiskSpace,
  DriveInfo,
  Filters,
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

export interface ValidationIssue {
  level: 'error' | 'warning'
  /** Etapa do editor a que o problema pertence. */
  step: 'origem' | 'destinos' | 'agendamento' | 'retencao' | 'notificacao'
  /** Mensagem em pt-BR pronta para exibir. */
  message: string
  /** Destino a que o problema se refere (para destacar o cartão certo no editor). */
  destinationId?: ID
}

export interface SizeEstimate {
  files: number
  bytes: number
  /** true se a contagem foi interrompida pelo tempo limite (valor parcial). */
  partial: boolean
}

export interface PathInfo {
  path: string
  /** null = caminho não existe ou não pôde ser lido. */
  kind: 'file' | 'folder' | null
}

export interface FileResult {
  canceled: boolean
  path?: string
  /** Mensagem em pt-BR (sucesso ou erro). */
  message?: string
  ok?: boolean
}

export interface BcApi {
  app: {
    info(): Promise<AppInfo>
    openPath(path: string): Promise<void>
    showInFolder(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    /** Controles de janela (titlebar customizada). */
    window(action: 'minimize' | 'maximize' | 'close'): Promise<void>
    /** Tema efetivo mudou — main ajusta titleBarOverlay e cor de fundo. */
    setResolvedTheme(theme: 'light' | 'dark'): Promise<void>
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
    /** Valida origem/destinos (destino dentro da origem, mesmo disco, acessível…). */
    validate(input: RoutineInput): Promise<ValidationIssue[]>
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
    /** Exporta rotinas + configurações (sem senhas) para um .json escolhido pelo usuário. */
    exportConfig(): Promise<FileResult>
    importConfig(): Promise<FileResult>
  }
  system: {
    drives(): Promise<DriveInfo[]>
    diskSpace(path: string): Promise<DiskSpace | null>
    pickFolders(opts?: { multi?: boolean; title?: string }): Promise<PickResult>
    pickFiles(opts?: { title?: string }): Promise<PickResult>
    stats(): Promise<DashboardStats>
    /** Soma arquivos/bytes das origens com os filtros (tempo limite ~4 s). */
    estimateSize(sources: string[], filters?: Filters): Promise<SizeEstimate>
    /**
     * Caminho real de um arquivo/pasta solto na janela (arrastar e soltar). Síncrono.
     * Devolve '' quando não há caminho (ex.: conteúdo arrastado de um navegador).
     */
    pathForFile(file: File): string
    /** Diz se cada caminho é arquivo ou pasta (para origens soltas na janela). */
    inspectPaths(paths: string[]): Promise<PathInfo[]>
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
  appSetResolvedTheme: 'app:set-resolved-theme',
  routinesList: 'routines:list',
  routinesGet: 'routines:get',
  routinesSave: 'routines:save',
  routinesRemove: 'routines:remove',
  routinesDuplicate: 'routines:duplicate',
  routinesSetEnabled: 'routines:set-enabled',
  routinesRunNow: 'routines:run-now',
  routinesCancel: 'routines:cancel',
  routinesNextRuns: 'routines:next-runs',
  routinesValidate: 'routines:validate',
  runsList: 'runs:list',
  runsGet: 'runs:get',
  runsActive: 'runs:active',
  runsClear: 'runs:clear',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsSaveSmtp: 'settings:save-smtp',
  settingsTestSmtp: 'settings:test-smtp',
  settingsExport: 'settings:export',
  settingsImport: 'settings:import',
  systemDrives: 'system:drives',
  systemDiskSpace: 'system:disk-space',
  systemPickFolders: 'system:pick-folders',
  systemPickFiles: 'system:pick-files',
  systemStats: 'system:stats',
  systemEstimateSize: 'system:estimate-size',
  systemInspectPaths: 'system:inspect-paths'
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
