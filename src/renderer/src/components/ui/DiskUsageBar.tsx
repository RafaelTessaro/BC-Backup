import { TriangleAlert } from 'lucide-react'
import { formatBytes } from '@shared/format'
import { cn } from '@renderer/lib/cn'
import { formatPercent } from '@renderer/lib/format'

interface DiskUsageBarProps {
  total: number
  free: number
  /** Bytes que o próximo backup vai ocupar (faixa hachurada). */
  incoming?: number
  className?: string
  showLegend?: boolean
}

export function usageTone(usedPct: number): 'accent' | 'warning' | 'danger' {
  return usedPct > 90 ? 'danger' : usedPct >= 75 ? 'warning' : 'accent'
}

/** DiskUsageBar (§8): 6 px; usado accent < 75 % · warning 75–90 % · danger > 90 %; hachura = próximo backup. */
export function DiskUsageBar({ total, free, incoming, className, showLegend = true }: DiskUsageBarProps) {
  const used = Math.max(0, total - free)
  const usedPct = total > 0 ? (used / total) * 100 : 0
  const incomingPct = total > 0 && incoming ? Math.min(100 - usedPct, (incoming / total) * 100) : 0
  const tone = usageTone(usedPct)
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        className="relative flex h-1.5 w-full gap-px overflow-hidden rounded-xs bg-surface-hover"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(usedPct)}
        aria-label={`${formatPercent(usedPct)} usado${tone === 'danger' ? ' — pouco espaço livre' : tone === 'warning' ? ' — espaço ficando curto' : ''}`}
      >
        <div
          className={cn(
            'h-full rounded-l-xs transition-[width] duration-[400ms]',
            tone === 'accent' && 'bg-accent',
            tone === 'warning' && 'bg-warning-bar',
            tone === 'danger' && 'bg-danger-bar'
          )}
          style={{ width: `${usedPct}%` }}
        />
        {incomingPct > 0 && (
          <div className="h-full hatch" style={{ width: `${Math.max(incomingPct, 0.8)}%` }} />
        )}
      </div>
      {showLegend && (
        <div className="flex items-center justify-between gap-3 text-caption text-fg-subtle tnum">
          <span>
            {formatBytes(free)} livres de {formatBytes(total)}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              tone === 'warning' && 'font-medium text-warning',
              tone === 'danger' && 'font-medium text-danger'
            )}
          >
            {/* cor nunca sozinha (§3): ícone acompanha o alerta de espaço */}
            {tone !== 'accent' && <TriangleAlert className="size-3 shrink-0" strokeWidth={2} aria-hidden />}
            {formatPercent(usedPct)} usado
          </span>
        </div>
      )}
    </div>
  )
}
