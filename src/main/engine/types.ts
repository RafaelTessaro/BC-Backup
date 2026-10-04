// Tipos trocados entre o motor (utilityProcess ou mesmo processo) e o main.

import type {
  DestinationResult,
  FinalRunStatus,
  LogEntry,
  MoveReport,
  Routine,
  RunProgress,
  RunTrigger
} from '@shared/types'

export interface JobSpec {
  runId: string
  /** Cópia da rotina no momento em que a execução começou. */
  routine: Omit<Routine, 'lastRun'>
  trigger: RunTrigger
  /** ISO — também define o carimbo da pasta/zip. */
  startedAt: string
  appVersion: string
  hostname: string
  /** Pasta de dados do BC Backup: "Mover" recusa uma origem que a contenha. */
  dataPath?: string
}

export interface JobResult {
  status: FinalRunStatus
  errorMessage?: string
  finishedAt: string
  filesTotal: number
  bytesTotal: number
  filesCopied: number
  bytesCopied: number
  filesSkipped: number
  warnings: number
  errors: number
  destinations: DestinationResult[]
  log: LogEntry[]
  /** Só em rotinas com "Mover". */
  move?: MoveReport
  filesMoved?: number
  bytesMoved?: number
}

export type EngineEvent = { type: 'progress'; progress: RunProgress } | { type: 'log'; entry: LogEntry }

/** Mensagens main → worker. */
export type ToWorker = { type: 'start'; spec: JobSpec } | { type: 'cancel' }

/** Mensagens worker → main. */
export type FromWorker =
  EngineEvent | { type: 'done'; result: JobResult } | { type: 'crashed'; message: string }
