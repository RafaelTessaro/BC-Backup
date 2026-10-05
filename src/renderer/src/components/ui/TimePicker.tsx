import { Clock } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useEffect, useId, useRef, useState } from 'react'
import { parseTime } from '@shared/schedule'
import { cn } from '@renderer/lib/cn'
import { inputBase } from './Input'

const pad = (n: number): string => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

/**
 * Normaliza o que foi digitado. Com separador (":" ou "h") cada parte vale sozinha:
 * "7:3" → 07:03, "12:5" → 12:05, "7h30" → 07:30, "21h" → 21:00.
 * Só dígitos: "9" → 09:00, "730" → 07:30, "1230" → 12:30. Inválido → null.
 */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  let h: number
  let m: number
  const sep = /^(\d{1,2})\s*[:h]\s*(\d{0,2})$/.exec(s)
  if (sep) {
    h = Number(sep[1])
    m = sep[2] ? Number(sep[2]) : 0
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) {
      h = Number(s)
      m = 0
    } else if (s.length === 3) {
      h = Number(s.slice(0, 1))
      m = Number(s.slice(1))
    } else {
      h = Number(s.slice(0, 2))
      m = Number(s.slice(2))
    }
  } else return null
  if (h > 23 || m > 59) return null
  return `${pad(h)}:${pad(m)}`
}

function Column({
  items,
  selected,
  onPick,
  label
}: {
  items: number[]
  selected: number
  onPick: (n: number) => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div
      ref={ref}
      className="flex h-[208px] w-[56px] flex-col gap-[2px] overflow-y-auto scrollbar-none py-[4px]"
      aria-label={label}
      role="listbox"
    >
      {items.map((n) => {
        const active = n === selected
        return (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={active}
            data-selected={active}
            onClick={() => onPick(n)}
            className={cn(
              'h-[28px] shrink-0 rounded-sm font-mono text-small tnum transition-colors duration-[120ms]',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
            )}
          >
            {pad(n)}
          </button>
        )
      })}
    </div>
  )
}

interface TimePickerProps {
  value: string
  onChange: (v: string) => void
  id?: string
  label?: string
  className?: string
}

/** TimePicker (§8): input 96 px mono/tabular, máscara HH:mm 24 h + popover com horas/minutos (passo 5). */
export function TimePicker({ value, onChange, id, label = 'Horário', className }: TimePickerProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const errorId = useId()
  const parsed = parseTime(value) ?? { h: 18, m: 0 }
  const minutes = MINUTES.includes(parsed.m) ? MINUTES : [...MINUTES, parsed.m].sort((a, b) => a - b)

  const commit = (): void => {
    if (draft === null) return
    const n = normalizeTime(draft)
    if (n) {
      onChange(n)
      setDraft(null)
      setInvalid(false)
    } else if (draft.trim() === '') {
      // campo apagado: volta ao horário atual
      setDraft(null)
      setInvalid(false)
    } else {
      // mantém o que foi digitado e sinaliza (em vez de voltar ao valor anterior em silêncio)
      setInvalid(true)
    }
  }
  const pick = (v: string): void => {
    setDraft(null)
    setInvalid(false)
    onChange(v)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className={cn('relative w-[96px]', className)}>
          <Popover.Trigger asChild>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Escolher horário"
              className="absolute top-1/2 left-[4px] flex size-[24px] -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:text-fg"
            >
              <Clock className="size-[16px]" strokeWidth={1.75} />
            </button>
          </Popover.Trigger>
          <input
            id={id}
            aria-label={label}
            inputMode="numeric"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className={cn(inputBase, 'pr-[8px] pl-[32px] font-mono text-[13px] tnum')}
            value={draft ?? value}
            onChange={(e) => {
              setDraft(e.target.value.replace(/[^\d:hH]/g, '').slice(0, 5))
              setInvalid(false)
            }}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit()
                setOpen(false)
              }
              if (e.key === 'ArrowDown' && !open) {
                e.preventDefault()
                setOpen(true)
              }
            }}
          />
          <span id={errorId} className="sr-only" role={invalid ? 'alert' : undefined}>
            {invalid ? 'Horário inválido. Use HH:MM, por exemplo 07:30.' : ''}
          </span>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="no-drag z-50 flex gap-[4px] rounded-lg border border-border bg-surface-raised p-[4px] shadow-pop data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
        >
          <Column
            label="Horas"
            items={HOURS}
            selected={parsed.h}
            onPick={(h) => pick(`${pad(h)}:${pad(parsed.m)}`)}
          />
          <div className="w-px self-stretch bg-border" />
          <Column
            label="Minutos"
            items={minutes}
            selected={parsed.m}
            onPick={(m) => {
              pick(`${pad(parsed.h)}:${pad(m)}`)
              setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
