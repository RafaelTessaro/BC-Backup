// Toasts (§7h): canto inferior direito, 360 px, radius-lg, sh-pop; ícone semântico + título + descrição + ação.
import { CircleCheck, CircleX, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { cn } from './cn'

type Kind = 'success' | 'warning' | 'error' | 'info'

const META: Record<Kind, { icon: LucideIcon; cls: string }> = {
  success: { icon: CircleCheck, cls: 'text-success' },
  warning: { icon: TriangleAlert, cls: 'text-warning' },
  error: { icon: CircleX, cls: 'text-danger' },
  info: { icon: Info, cls: 'text-accent-text' }
}

interface NotifyOptions {
  description?: ReactNode
  action?: { label: string; onClick: () => void }
  duration?: number
  id?: string
}

function ToastCard({
  id,
  kind,
  title,
  description,
  action
}: {
  id: string | number
  kind: Kind
  title: ReactNode
  description?: ReactNode
  action?: NotifyOptions['action']
}) {
  const { icon: Icon, cls } = META[kind]
  return (
    <div
      className={cn(
        'group flex w-[360px] items-start gap-3 rounded-lg border border-border bg-surface-raised py-3 pr-3 pl-3.5 shadow-pop'
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', cls)} strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold tracking-[-0.005em] text-fg">{title}</p>
        {description && <p className="mt-0.5 text-small break-words text-fg-muted">{description}</p>}
        {action && (
          <button
            type="button"
            className="mt-1.5 text-small font-medium text-accent-text hover:underline underline-offset-4"
            onClick={() => {
              action.onClick()
              toast.dismiss(id)
            }}
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Fechar"
        className="-mt-0.5 -mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-subtle opacity-70 transition-opacity hover:bg-surface-hover hover:text-fg group-hover:opacity-100"
        onClick={() => toast.dismiss(id)}
      >
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}

function show(kind: Kind, title: ReactNode, opts: NotifyOptions = {}): string | number {
  return toast.custom(
    (id) => (
      <ToastCard id={id} kind={kind} title={title} description={opts.description} action={opts.action} />
    ),
    { duration: opts.duration ?? (kind === 'error' ? Infinity : 5000), id: opts.id }
  )
}

export const notify = {
  success: (title: ReactNode, opts?: NotifyOptions) => show('success', title, opts),
  warning: (title: ReactNode, opts?: NotifyOptions) => show('warning', title, opts),
  error: (title: ReactNode, opts?: NotifyOptions) => show('error', title, opts),
  info: (title: ReactNode, opts?: NotifyOptions) => show('info', title, opts),
  dismiss: (id: string | number) => void toast.dismiss(id)
}
