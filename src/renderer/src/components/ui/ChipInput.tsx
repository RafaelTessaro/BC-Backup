import { CircleAlert, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { Tooltip } from './Tooltip'

interface ChipInputProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  /** Retorna mensagem de erro para valores inválidos. */
  validate?: (v: string) => string | null
  id?: string
  mono?: boolean
  className?: string
  invalid?: boolean
  normalize?: (v: string) => string
  /** Espaços também separam itens (e-mails). Padrões glob podem ter espaços. */
  splitOnWhitespace?: boolean
  /** Mostra abaixo do campo o motivo dos itens inválidos (sempre disponível a leitores de tela). */
  showErrors?: boolean
}

/** Lista de chips editável: Enter/vírgula/; adicionam, Backspace remove, colar vários de uma vez. */
export function ChipInput({
  values,
  onChange,
  placeholder,
  validate,
  id,
  mono,
  className,
  invalid,
  normalize = (v) => v.trim(),
  splitOnWhitespace = false,
  showErrors = false
}: ChipInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const errors = values.flatMap((v) => {
    const e = validate?.(v)
    return e ? [`${v}: ${e}`] : []
  })
  const hasErrors = errors.length > 0

  const add = (raw: string): void => {
    const parts = raw
      .split(/[,;\n]+/)
      .map(normalize)
      .filter(Boolean)
    if (!parts.length) return
    const next = [...values]
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setText('')
  }

  return (
    <>
      <div
        className={cn(
          'flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-border-strong bg-surface-raised px-1 py-[3px] shadow-xs',
          'transition-[border-color,box-shadow] duration-[120ms]',
          'focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]',
          (invalid || hasErrors) && 'border-danger',
          className
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v) => {
          const error = validate?.(v) ?? null
          return (
            <Tooltip key={v} label={error}>
              <span
                className={cn(
                  'inline-flex h-6 max-w-full items-center gap-1 rounded-sm pr-0.5 pl-2 text-small',
                  mono && 'font-mono text-mono',
                  error ? 'bg-danger-soft text-danger' : 'bg-surface-hover text-fg'
                )}
              >
                {/* cor nunca sozinha: ícone marca o item inválido */}
                {error && <CircleAlert className="-ml-0.5 size-3 shrink-0" strokeWidth={2} aria-hidden />}
                <span className="truncate" data-selectable>
                  {v}
                </span>
                <button
                  type="button"
                  aria-label={`Remover ${v}`}
                  className="flex size-5 items-center justify-center rounded-xs text-fg-subtle hover:bg-border hover:text-fg"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(values.filter((x) => x !== v))
                  }}
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </span>
            </Tooltip>
          )
        })}
        <input
          ref={inputRef}
          id={id}
          aria-invalid={invalid || hasErrors || undefined}
          aria-describedby={hasErrors ? errorId : undefined}
          value={text}
          placeholder={values.length ? '' : placeholder}
          className={cn(
            'h-6 min-w-[140px] flex-1 bg-transparent px-1.5 text-body text-fg outline-none placeholder:text-fg-subtle',
            mono && 'font-mono text-mono'
          )}
          onChange={(e) => {
            const v = e.target.value
            if (/[,;]/.test(v)) add(v)
            else setText(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || (e.key === 'Tab' && text.trim())) {
              if (text.trim()) {
                e.preventDefault()
                add(text)
              }
            } else if (e.key === 'Backspace' && !text && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => add(text)}
          onPaste={(e) => {
            const data = e.clipboardData.getData('text')
            const sep = splitOnWhitespace ? /[,;\s]/ : /[,;\n]/
            if (sep.test(data.trim())) {
              e.preventDefault()
              add(splitOnWhitespace ? data.replace(/\s+/g, ',') : data)
            }
          }}
        />
      </div>
      <p
        id={errorId}
        className={cn('text-caption text-danger', showErrors && hasErrors ? 'mt-1.5' : 'sr-only')}
        aria-live="polite"
      >
        {hasErrors ? errors.join(' · ') : ''}
      </p>
    </>
  )
}
