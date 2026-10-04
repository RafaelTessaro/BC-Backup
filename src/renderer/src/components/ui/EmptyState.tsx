import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: ReactNode
  action?: ReactNode
  align?: 'center' | 'left'
  /** `accent`: tile menta, para o primeiro uso ("Vamos proteger seus arquivos"). */
  tone?: 'neutral' | 'accent'
  className?: string
}

/** EmptyState (§7g): ícone 24 em tile 48 surface-hover · título section · texto small · 1 CTA. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  align = 'center',
  tone = 'neutral',
  className
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className
      )}
    >
      <div
        className={cn(
          'flex size-12 items-center justify-center rounded-lg',
          tone === 'accent' ? 'bg-accent-soft text-accent-text' : 'bg-surface-hover text-fg-muted'
        )}
      >
        <Icon className="size-6" strokeWidth={1.75} aria-hidden />
      </div>
      <div className={cn('flex flex-col gap-1', align === 'center' && 'max-w-[400px] items-center')}>
        <h3 className="text-section font-semibold text-fg">{title}</h3>
        <p className="text-small text-fg-muted">{description}</p>
      </div>
      {action}
    </div>
  )
}
