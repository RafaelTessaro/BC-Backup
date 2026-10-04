import type { ReactNode } from 'react'
import { Card } from '@renderer/components/ui/Card'
import { cn } from '@renderer/lib/cn'

/** Grupo de configurações (layout macOS Ajustes): título fora do card + linhas com divisórias. */
export function SettingsGroup({
  title,
  description,
  children,
  aside
}: {
  title: string
  description?: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-body font-semibold tracking-[-0.005em] text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-small text-fg-muted">{description}</p>}
        </div>
        {aside}
      </div>
      <Card className="divide-y divide-border">{children}</Card>
    </section>
  )
}

/** Linha: label body 500 + descrição small à esquerda, controle à direita. */
export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  className,
  stack
}: {
  label: ReactNode
  description?: ReactNode
  children?: ReactNode
  htmlFor?: string
  className?: string
  /** Controle abaixo do texto (campos largos). */
  stack?: boolean
}) {
  return (
    <div
      className={cn(
        'flex gap-x-6 gap-y-3 px-5 py-4',
        stack ? 'flex-col' : 'items-center justify-between',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-body font-medium text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-small text-fg-muted">{description}</p>}
      </div>
      {children && <div className={cn('flex shrink-0 items-center gap-2', stack && 'w-full')}>{children}</div>}
    </div>
  )
}
