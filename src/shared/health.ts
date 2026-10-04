// "Saúde" geral dos backups — a mesma regra para o ícone/tooltip da bandeja (main), o hero do
// Painel e o painel da bandeja (renderer), para que os três nunca discordem.
// Prioridade (05-painel-da-bandeja §4): executando > só na fila > falha > avisos > sem rotinas >
// tudo pausado > ok. Sem dependências de Node/DOM.

import type { Routine, RunProgress } from './types'

export type HealthKind = 'running' | 'queued' | 'failed' | 'warning' | 'empty' | 'paused' | 'ok'

export type HealthRoutine = Pick<Routine, 'id' | 'name' | 'enabled' | 'lastRun'>

export interface Health<R extends HealthRoutine = HealthRoutine> {
  kind: HealthKind
  /** running/queued: a execução em destaque (a que está rodando vem antes das da fila). */
  run?: RunProgress
  /** failed/warning: a rotina afetada mais recente. */
  routine?: R
  /** failed/warning: rotinas afetadas (mais recente primeiro). */
  affected: R[]
  /** failed/warning: nº de rotinas afetadas · running/queued: nº de execuções na fila. */
  count: number
}

const lastAt = (r: HealthRoutine): string => r.lastRun?.finishedAt ?? r.lastRun?.startedAt ?? ''

/**
 * Resume o estado dos backups. `progress` = execuções ativas (`runs.active()` ou o mapa do
 * renderer); fases `done` são ignoradas. Só rotinas **ativas** contam para falha/aviso: uma rotina
 * pausada que falhou não deixa o ícone vermelho para sempre.
 */
export function summarizeHealth<R extends HealthRoutine>(
  routines: readonly R[],
  progress: readonly RunProgress[] | Readonly<Record<string, RunProgress>>
): Health<R> {
  const all: readonly RunProgress[] = Array.isArray(progress) ? progress : Object.values(progress)
  const list = all.filter((p) => p.phase !== 'done')
  const queued = list.filter((p) => p.phase === 'queued')
  const running = list.find((p) => p.phase !== 'queued')
  if (running) return { kind: 'running', run: running, affected: [], count: queued.length }
  if (queued.length) return { kind: 'queued', run: queued[0], affected: [], count: queued.length }

  const enabled = routines.filter((r) => r.enabled)
  const byRecent = (a: R, b: R): number => lastAt(b).localeCompare(lastAt(a))
  const failed = enabled.filter((r) => r.lastRun?.status === 'failed').sort(byRecent)
  if (failed.length) return { kind: 'failed', routine: failed[0], affected: failed, count: failed.length }
  const warned = enabled.filter((r) => r.lastRun?.status === 'warning').sort(byRecent)
  if (warned.length) return { kind: 'warning', routine: warned[0], affected: warned, count: warned.length }
  if (!routines.length) return { kind: 'empty', affected: [], count: 0 }
  if (!enabled.length) return { kind: 'paused', affected: [], count: 0 }
  return { kind: 'ok', affected: [], count: 0 }
}
