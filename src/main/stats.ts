// Números do painel. Node puro.
//
// - runsLast7d / successRate7d / bytesLast7d: execuções finalizadas desde o início do dia de 6 dias atrás
//   (7 dias de calendário, hoje incluso). Taxa de sucesso = (success + warning) / (success + warning + failed);
//   canceladas não entram na conta.
// - days: últimos 14 dias (do mais antigo ao mais novo) com o PIOR status do dia:
//   failed > warning > success > cancelled (cancelada só aparece se foi a única coisa do dia).

import type { DashboardStats, DayStatus, FinalRunStatus, ID, RunStatus } from '@shared/types'
import type { StoredRun } from './history'
import { toSummary } from './history'
import type { StoredRoutine } from './store'

const SEVERITY: Record<FinalRunStatus, number> = { failed: 4, warning: 3, success: 2, cancelled: 1 }

const isFinal = (s: RunStatus): s is FinalRunStatus => s !== 'queued' && s !== 'running'

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function computeStats(
  routines: StoredRoutine[],
  runsNewestFirst: StoredRun[],
  nextRuns: Record<ID, string | null>,
  now: Date = new Date()
): DashboardStats {
  const finished = runsNewestFirst.filter((r) => isFinal(r.status))
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()
  const week = finished.filter((r) => Date.parse(r.startedAt) >= weekStart)
  const ok = week.filter((r) => r.status === 'success' || r.status === 'warning').length
  const failed = week.filter((r) => r.status === 'failed').length
  const rated = ok + failed

  const days: DayStatus[] = []
  const byDay = new Map<string, DayStatus>()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const ds: DayStatus = { date: dayKey(d), status: null, runs: 0 }
    days.push(ds)
    byDay.set(ds.date, ds)
  }
  for (const r of finished) {
    const ds = byDay.get(dayKey(new Date(r.startedAt)))
    if (!ds) continue
    ds.runs++
    const st = r.status as FinalRunStatus
    if (!ds.status || SEVERITY[st] > SEVERITY[ds.status]) ds.status = st
  }

  let nextRun: DashboardStats['nextRun']
  for (const r of routines) {
    const at = nextRuns[r.id]
    if (!at) continue
    if (!nextRun || at < nextRun.at) nextRun = { routineId: r.id, routineName: r.name, at }
  }

  const stats: DashboardStats = {
    routinesTotal: routines.length,
    routinesActive: routines.filter((r) => r.enabled).length,
    runsLast7d: week.length,
    successRate7d: rated ? Math.round((ok / rated) * 1000) / 10 : null,
    bytesLast7d: week.reduce((a, r) => a + (r.bytesCopied || 0), 0),
    days
  }
  if (finished[0]) stats.lastRun = toSummary(finished[0])
  if (nextRun) stats.nextRun = nextRun
  return stats
}
