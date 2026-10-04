import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

/** Contêiner de página: max-w 1080, centralizado, px-8 py-6 (§5, §6). */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-[1080px] px-8 pt-5 pb-12', className)}>{children}</div>
}

/** Cabeçalho (§6): title + descrição small à esquerda; ação primária à direita; 24 px até o conteúdo. */
export function PageHeader({
  title,
  description,
  actions,
  className
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        <h1 className="text-title font-semibold text-fg">{title}</h1>
        {description && <p className="mt-1 text-small text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
