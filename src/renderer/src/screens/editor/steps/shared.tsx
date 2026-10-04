import type { ReactNode } from 'react'
import type { ValidationIssue } from '@shared/api'
import { Callout } from '@renderer/components/ui/Callout'
import { cn } from '@renderer/lib/cn'

/** Erros e avisos da validação de uma etapa. */
export function IssueList({ issues, className }: { issues: ValidationIssue[]; className?: string }) {
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  if (!errors.length && !warnings.length) return null
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {errors.length > 0 && (
        <Callout tone="danger">
          {errors.length === 1 ? (
            errors[0].message
          ) : (
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {errors.map((e) => (
                <li key={e.message}>{e.message}</li>
              ))}
            </ul>
          )}
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout tone="warning">
          {warnings.length === 1 ? (
            warnings[0].message
          ) : (
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {warnings.map((e) => (
                <li key={e.message}>{e.message}</li>
              ))}
            </ul>
          )}
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
