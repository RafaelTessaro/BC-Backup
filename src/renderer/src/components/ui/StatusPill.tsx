import { cn } from '@renderer/lib/cn'
import { TONE_SOFT, type StatusMeta } from '@renderer/lib/status'

/** StatusPill (§8): altura 22, px 8, radius-full, caption 500, ícone 12 px + texto. */
export function StatusPill({
  meta,
  className,
  label
}: {
  meta: StatusMeta
  className?: string
  label?: string
}) {
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-caption font-medium whitespace-nowrap',
        TONE_SOFT[meta.tone],
        className
      )}
    >
      <Icon className={cn('size-3 shrink-0', meta.spin && 'animate-spin-slow')} strokeWidth={2} aria-hidden />
      {label ?? meta.label}
    </span>
  )
}
