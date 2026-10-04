// Estado global da interface: espelho do que o main expõe via `window.bc`,
// atualizado pelos eventos `bc.on.*`.
import { create } from 'zustand'
import type {
  AppInfo,
  AppSettings,
  DashboardStats,
  DriveInfo,
  ID,
  Routine,
  RunProgress,
  RunSummary
} from '@shared/types'
import { ROUTES, parseRoute } from '@shared/routes'
import { bc } from './bc'
import { navigate, useRouter } from './router'
import { readLocal, writeLocal } from './storage'

const SEEN_KEY = 'bc.historySeenAt'

interface AppState {
  ready: boolean
  info: AppInfo | null
  routines: Routine[]
  nextRuns: Record<ID, string | null>
  settings: AppSettings | null
  stats: DashboardStats | null
  runs: RunSummary[]
  drives: DriveInfo[]
  /** Execuções ativas por runId. */
  progress: Record<ID, RunProgress>
  /** Execuções concluídas nesta sessão, por routineId (estado final do drawer). */
  finished: Record<ID, RunSummary>
  historySeenAt: string
  /** Drawer de execução ao vivo (routineId). */
  liveRoutineId: ID | null
  /** Drawer de detalhes de uma execução do histórico (runId). */
  detailRunId: ID | null
  /** Filtro de rotina do Histórico ('all' = todas). */
  historyRoutine: ID | 'all'
}

export const useApp = create<AppState>(() => ({
  ready: false,
  info: null,
  routines: [],
  nextRuns: {},
  settings: null,
  stats: null,
  runs: [],
  drives: [],
  progress: {},
  finished: {},
  historySeenAt: readLocal(SEEN_KEY) ?? new Date(Date.now() - 7 * 86_400_000).toISOString(),
  liveRoutineId: null,
  detailRunId: null,
  historyRoutine: 'all'
}))

const set = useApp.setState
const get = useApp.getState

/* ------------------------------------------------------------------ */
/* Carregamento                                                        */
/* ------------------------------------------------------------------ */

export async function refreshRoutines(): Promise<void> {
  const [routines, nextRuns] = await Promise.all([bc.routines.list(), bc.routines.nextRuns()])
  set({ routines, nextRuns })
}

export async function refreshRuns(): Promise<void> {
  const [runs, stats] = await Promise.all([bc.runs.list({ limit: 2000 }), bc.system.stats()])
  runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  set({ runs, stats })
}

export async function refreshDrives(): Promise<void> {
  const drives = await bc.system.drives()
  set({ drives })
}

export async function loadAll(): Promise<void> {
  const [info, settings, active] = await Promise.all([bc.app.info(), bc.settings.get(), bc.runs.active()])
  const progress: Record<ID, RunProgress> = {}
  for (const p of active) if (p.phase !== 'done') progress[p.runId] = p
  set({ info, settings, progress })
  // Unidades de disco vêm depois: no Windows a enumeração usa PowerShell e pode levar segundos —
  // não seguramos a interface inteira por elas (só rótulos/ícones de destino dependem disso).
  void refreshDrives().catch(() => undefined)
  await Promise.all([refreshRoutines(), refreshRuns()])
  set({ ready: true })
}

/* ------------------------------------------------------------------ */
/* Progresso (agrupado em no máx. 4 atualizações/s)                     */
/* ------------------------------------------------------------------ */

let pendingProgress: Record<ID, RunProgress> = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flushProgress(): void {
  flushTimer = null
  const batch = pendingProgress
  pendingProgress = {}
  set((s) => {
    const next = { ...s.progress }
    for (const [id, p] of Object.entries(batch)) {
      if (p.phase === 'done') delete next[id]
      else next[id] = p
    }
    return { progress: next }
  })
}

function onProgress(p: RunProgress): void {
  pendingProgress[p.runId] = p
  if (!flushTimer) flushTimer = setTimeout(flushProgress, 250)
}

/* ------------------------------------------------------------------ */
/* Assinaturas                                                         */
/* ------------------------------------------------------------------ */

type FinishedHandler = (summary: RunSummary) => void
let finishedHandler: FinishedHandler | null = null
/** O App registra aqui o toast de fim de execução. */
export function onRunFinished(handler: FinishedHandler): void {
  finishedHandler = handler
}

export function handleRoute(route: string): void {
  const parsed = parseRoute(route)
  if (parsed.name === 'history' && parsed.runId) {
    // Editor com alterações não salvas: só abre os detalhes por cima, sem sair dele (antes o aviso
    // "Descartar alterações?" e o drawer abriam juntos, dois modais disputando o foco).
    const { blocker } = useRouter.getState()
    if (!blocker?.(ROUTES.history)) navigate(ROUTES.history)
    set({ detailRunId: parsed.runId })
    return
  }
  navigate(route)
}

export function subscribeAll(): () => void {
  const offs = [
    bc.on.progress(onProgress),
    bc.on.runFinished((summary) => {
      delete pendingProgress[summary.id]
      set((s) => {
        const progress = { ...s.progress }
        delete progress[summary.id]
        return { progress, finished: { ...s.finished, [summary.routineId]: summary } }
      })
      void refreshRuns()
      void refreshRoutines()
      finishedHandler?.(summary)
    }),
    bc.on.routinesChanged(() => {
      void refreshRoutines()
      void refreshRuns()
    }),
    bc.on.settingsChanged((settings) => set({ settings })),
    bc.on.navigate(handleRoute)
  ]
  return () => offs.forEach((off) => off())
}

/* ------------------------------------------------------------------ */
/* Seletores e ações                                                   */
/* ------------------------------------------------------------------ */

export function progressFor(progress: Record<ID, RunProgress>, routineId: ID): RunProgress | undefined {
  for (const p of Object.values(progress)) if (p.routineId === routineId) return p
  return undefined
}

export function markHistorySeen(): void {
  const now = new Date().toISOString()
  writeLocal(SEEN_KEY, now)
  set({ historySeenAt: now })
}

export function openLiveRun(routineId: ID): void {
  set({ liveRoutineId: routineId })
}

export function closeLiveRun(): void {
  set({ liveRoutineId: null })
}

export function openRunDetail(runId: ID): void {
  set({ detailRunId: runId })
}

export function showHistoryFor(routineId: ID | 'all'): void {
  set({ historyRoutine: routineId })
  navigate(ROUTES.history)
}

export function closeRunDetail(): void {
  set({ detailRunId: null })
}

export async function updateSettings(patch: Partial<Omit<AppSettings, 'smtp'>>): Promise<void> {
  const current = get().settings
  if (current) set({ settings: { ...current, ...patch } })
  const saved = await bc.settings.update(patch)
  set({ settings: saved })
}

export function smtpConfigured(settings: AppSettings | null): boolean {
  return !!settings && !!settings.smtp.host.trim() && !!settings.smtp.fromEmail.trim()
}
