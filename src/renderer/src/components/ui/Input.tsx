import { forwardRef, useId, useLayoutEffect, type InputHTMLAttributes, type ReactNode } from 'react'
import { CircleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/cn'

export const inputBase =
  'h-8 w-full min-w-0 rounded-md border border-border-strong bg-surface-raised px-2.5 text-body text-fg shadow-xs ' +
  'transition-[border-color,box-shadow] duration-[120ms] placeholder:text-fg-subtle ' +
  'hover:border-[color-mix(in_srgb,var(--border-strong)_70%,var(--text-tertiary))] ' +
  'focus:border-accent-edge focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-danger aria-invalid:focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_18%,transparent)]'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
  icon?: LucideIcon
  suffix?: ReactNode
  prefixText?: ReactNode
  inputClassName?: string
}

/** Input (§8): 32 px, surface-raised, borda border-strong, foco accent. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, icon: Icon, suffix, prefixText, className, inputClassName, ...rest },
  ref
) {
  if (!Icon && !suffix && !prefixText) {
    return (
      <input ref={ref} aria-invalid={invalid || undefined} className={cn(inputBase, className)} {...rest} />
    )
  }
  return (
    <div className={cn('relative flex items-center', className)}>
      {Icon && (
        <Icon
          className="pointer-events-none absolute left-2.5 size-4 text-fg-subtle"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      {prefixText && (
        <span className="pointer-events-none absolute left-2.5 text-body text-fg-subtle">{prefixText}</span>
      )}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(inputBase, Icon && 'pl-8', suffix && 'pr-12', inputClassName)}
        {...rest}
      />
      {suffix && (
        <span className="absolute right-2.5 flex items-center text-small text-fg-subtle">{suffix}</span>
      )}
    </div>
  )
})

interface FieldProps {
  label?: ReactNode
  description?: ReactNode
  error?: string | null
  children: (id: string) => ReactNode
  className?: string
  aside?: ReactNode
}

/** Label → controle 6 px; descrição small; erro caption danger com ícone. */
export function Field({ label, description, error, children, className, aside }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const hasHint = !!error || !!description
  // Liga descrição/erro ao controle (aria-describedby) sem exigir nada de quem usa o Field.
  // Roda a cada render: se o controle tiver o próprio aria-describedby (ex.: ChipInput), mescla.
  useLayoutEffect(() => {
    const el = document.getElementById(id)
    if (!el) return
    const current = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    const next = hasHint ? [...new Set([...current, hintId])] : current.filter((x) => x !== hintId)
    if (next.length) el.setAttribute('aria-describedby', next.join(' '))
    else el.removeAttribute('aria-describedby')
  })
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={id} className="text-small font-medium text-fg">
              {label}
            </label>
          )}
          {aside}
        </div>
      )}
      {children(id)}
      {error ? (
        <p id={hintId} className="flex items-center gap-1.5 text-caption text-danger" role="alert">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {error}
        </p>
      ) : description ? (
        <p id={hintId} className="text-caption text-fg-subtle">
          {description}
        </p>
      ) : null}
    </div>
  )
}
