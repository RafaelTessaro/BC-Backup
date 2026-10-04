// Estado enxuto do painel da bandeja (05-painel-da-bandeja §6). NÃO usa lib/store.ts: o loadAll()
// de lá busca 2000 execuções e as unidades de disco (PowerShell no Windows) — pesado demais para
// um painel que abre e fecha o tempo todo.
import { create } from 'zustand'
import type { AppSettings, DashboardStats, ID, Routine, RunProgress, RunSummary } from '@shared/types'
import { bc } from '@renderer/lib/bc'
import { useClock } from '@renderer/lib/clock'

/** Execuções pedidas ao main (a mais nova pode estar `running`) e quantas o painel mostra. */
const RUNS_FETCH = 8
export const RUNS_SHOWN = 5

interface TrayState {
  ready: boolean
  /** A última consulta falhou (o painel mostra o que tinha). */
  failed: boolean
  stats: DashboardStats | null
  /** Execuções finalizadas, da mais nova para a mais antiga (no máx. RUNS_SHOWN). */
  runs: RunSummary[]
  routines: Routine[]
  /** Execuções ativas por runId. */
  progress: Record<ID, RunProgress>
  settings: AppSettings | null
}

export const useTray = create<TrayState>(() => ({
  ready: false,
  failed: false,
  stats: null,
  runs: [],
  routines: [],
  progress: {},
  settings: null
}))

const set = useTray.setState

const isFinal = (r: RunSummary): boolean => r.status !== 'running' && r.status !== 'queued'

function activeMap(list: RunProgress[]): Record<ID, RunProgress> {
  const out: Record<ID, RunProgress> = {}
  for (const p of list) if (p.phase !== 'done') out[p.runId] = p
  return out
}

/* ------------------------------------------------------------------ */
/* Progresso agrupado (no máx. 4 atualizações/s, como em lib/store.ts)   */
/* ------------------------------------------------------------------ */

let pending: Record<ID, RunProgress> = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null

function flush(): void {
  flushTimer = null
  const batch = pending
  pending = {}
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
  pending[p.runId] = p
  if (!flushTimer) flushTimer = setTimeout(flush, 250)
}

let inFlight: Promise<void> | null = null
let again = false

/** Consulta tudo de novo. Chamadas durante uma consulta viram UMA consulta extra no fim. */
export function loadTray(): Promise<void> {
  if (inFlight) {
    again = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      do {
        again = false
        const [stats, runs, active, routines, settings] = await Promise.all([
          bc.system.stats(),
          bc.runs.list({ limit: RUNS_FETCH }),
          bc.runs.active(),
          bc.routines.list(),
          bc.settings.get()
        ])
        set({
          ready: true,
          failed: false,
          stats,
          runs: runs.filter(isFinal).slice(0, RUNS_SHOWN),
          routines,
          progress: activeMap(active),
          settings
        })
      } while (again)
    } catch {
      set({ ready: true, failed: true })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/** Só as execuções ativas (logo depois de "Executar", para o hero mudar na hora). */
export async function refreshActive(): Promise<void> {
  try {
    set({ progress: activeMap(await bc.runs.active()) })
  } catch {
    /* o próximo evento corrige */
  }
}

/**
 * Assina os eventos do main. `onShown` roda quando o painel aparece (o main manda `trayShown`
 * depois do show): janelas ocultas têm timers estrangulados, então o relógio e os dados são
 * atualizados na hora.
 */
export function subscribeTray(onShown: () => void): () => void {
  const offs = [
    bc.on.progress(onProgress),
    bc.on.runFinished((summary) => {
      delete pending[summary.id]
      set((s) => {
        const progress = { ...s.progress }
        delete progress[summary.id]
        return { progress }
      })
      void loadTray()
    }),
    bc.on.routinesChanged(() => void loadTray()),
    bc.on.settingsChanged((settings) => set({ settings })),
    bc.on.trayShown(() => {
      useClock.setState({ now: Date.now() })
      void loadTray()
      onShown()
    })
  ]
  return () => offs.forEach((off) => off())
}
