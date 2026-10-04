import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import { formatAgo, formatFull, formatWhen } from '@renderer/lib/format'
import { Tooltip } from './Tooltip'

/** Data relativa ("há 2 h", "hoje às 22:00") com a absoluta no Tooltip (§9). */
export function RelativeTime({
  iso,
  mode = 'when',
  className,
  prefix
}: {
  iso: string
  mode?: 'when' | 'ago'
  className?: string
  prefix?: string
}) {
  const now = useNow()
  const text = mode === 'ago' ? formatAgo(iso, now) : formatWhen(iso, now)
  return (
    <Tooltip label={formatFull(iso)}>
      <span className={cn('tnum', className)}>
        {prefix}
        {text}
      </span>
    </Tooltip>
  )
}
