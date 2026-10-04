import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

/** Card (§8): surface-raised, 1 px border, radius-lg, sh-card. */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-surface-raised shadow-card', className)}
      {...rest}
    />
  )
})

export function CardHeader({
  title,
  description,
  action,
  className,
  icon
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <div className="min-w-0">
          <h2 className="truncate text-body font-semibold tracking-[-0.005em] text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-small text-fg-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
