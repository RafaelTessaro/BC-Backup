import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

type CalloutTone = 'info' | 'warning' | 'danger' | 'success' | 'accent' | 'neutral'

const STYLES: Record<CalloutTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: 'bg-info-soft', icon: 'text-info', Icon: Info },
  warning: { box: 'bg-warning-soft', icon: 'text-warning', Icon: TriangleAlert },
  danger: { box: 'bg-danger-soft', icon: 'text-danger', Icon: CircleAlert },
  success: { box: 'bg-success-soft', icon: 'text-success', Icon: CircleCheck },
  accent: { box: 'bg-accent-soft', icon: 'text-accent-text', Icon: Info },
  neutral: { box: 'bg-surface-hover', icon: 'text-fg-muted', Icon: Info }
}

/** Callout (§8): faixa *-soft, radius-md, p 12, ícone 16 + small. */
export function Callout({
  tone = 'info',
  title,
  children,
  icon,
  action,
  className
}: {
  tone?: CalloutTone
  title?: ReactNode
  children?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  className?: string
}) {
  const s = STYLES[tone]
  const Icon = icon ?? s.Icon
  return (
    <div className={cn('flex gap-2.5 rounded-md p-3 text-small', s.box, className)} role="note">
      <Icon className={cn('mt-px size-4 shrink-0', s.icon)} strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1 text-fg">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title ? 'mt-0.5 text-fg-muted' : 'text-fg')}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}
