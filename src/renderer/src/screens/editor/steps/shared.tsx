import type { ReactNode } from 'react'
import type { ValidationIssue } from '@shared/api'
import { Callout } from '@renderer/components/ui/Callout'
import { cn } from '@renderer/lib/cn'
import { shortenPaths } from '../model'

function Messages({ items }: { items: string[] }) {
  if (items.length === 1) return <>{items[0]}</>
  return (
    <ul className="flex list-disc flex-col gap-0.5 pl-4">
      {items.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  )
}

/**
 * Erros e avisos da validação de uma etapa. Erros são anunciados (role="alert") e recebem o foco
 * quando "Continuar" é bloqueado. `paths` encurta caminhos longos citados nas mensagens.
 */
export function IssueList({
  issues,
  className,
  paths = []
}: {
  issues: ValidationIssue[]
  className?: string
  paths?: string[]
}) {
  const text = (i: ValidationIssue): string => shortenPaths(i.message, paths)
  const errors = [...new Set(issues.filter((i) => i.level === 'error').map(text))]
  const warnings = [...new Set(issues.filter((i) => i.level === 'warning').map(text))]
  if (!errors.length && !warnings.length) return null
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {errors.length > 0 && (
        <div role="alert" tabIndex={-1} data-error-focus className="rounded-md outline-none">
          <Callout tone="danger">
            <Messages items={errors} />
          </Callout>
        </div>
      )}
      {warnings.length > 0 && (
        <Callout tone="warning">
          <Messages items={warnings} />
        </Callout>
      )}
    </div>
  )
}

/** Linha com texto à esquerda e controle à direita (dentro de cards do editor). */
export function OptionRow({
  title,
  description,
  children,
  className
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-6 px-5 py-4', className)}>
      <div className="min-w-0">
        <p className="text-small font-medium text-fg">{title}</p>
        {description && <p className="mt-0.5 text-caption text-fg-subtle">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  )
}

export function SectionTitle({
  title,
  description,
  aside
}: {
  title: string
  description?: string
  aside?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h3 className="text-small font-medium text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-caption text-fg-subtle">{description}</p>}
      </div>
      {aside}
    </div>
  )
}
