// Progresso de uma execução. Os contadores de RunProgress (arquivos/bytes) são do destino ATUAL;
// o percentual geral considera todos os destinos: (destinationIndex + fração) / destinationCount.
import type { ID, RunProgress } from '@shared/types'

export function isQueued(p: RunProgress): boolean {
  return p.phase === 'queued'
}

/** Percentual geral 0–100 (undefined enquanto está na fila ou preparando). */
export function overallPercent(p: RunProgress): number | undefined {
  if (p.phase === 'queued' || (p.phase === 'scanning' && p.bytesTotal <= 0)) return undefined
  if (p.phase === 'done') return 100
  const count = Math.max(1, p.destinationCount)
  const index = Math.min(Math.max(0, p.destinationIndex), count - 1)
  const frac = p.bytesTotal > 0 ? Math.min(1, Math.max(0, p.bytesDone / p.bytesTotal)) : 0
  return Math.min(100, ((index + frac) / count) * 100)
}

/** Execução "principal" para destaque (em andamento antes das que estão na fila). */
export function primaryRun(progress: Record<ID, RunProgress>): RunProgress | undefined {
  const all = Object.values(progress)
  return all.find((p) => !isQueued(p)) ?? all[0]
}

/** "Destino 1 de 2" (só quando há mais de um). */
export function destinationLabel(p: RunProgress): string | null {
  return p.destinationCount > 1 ? `Destino ${p.destinationIndex + 1} de ${p.destinationCount}` : null
}
