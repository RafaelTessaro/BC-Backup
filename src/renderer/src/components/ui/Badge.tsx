import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

/** Contador (§8): altura 18, min-w 18, caption 600 tabular. */
export function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: 'neutral' | 'danger' | 'accent'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-caption font-semibold tnum',
        tone === 'neutral' && 'bg-surface-hover text-fg-muted',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'accent' && 'bg-accent-soft text-accent-text',
        className
      )}
    >
      {children}
    </span>
  )
}
