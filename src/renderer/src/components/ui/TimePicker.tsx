import { Clock } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { parseTime } from '@shared/schedule'
import { cn } from '@renderer/lib/cn'
import { inputBase } from './Input'

const pad = (n: number): string => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

/** Normaliza o que foi digitado ("9" → "09:00", "930" → "09:30", "21h" → "21:00"). */
function normalize(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '')
  if (!digits) return null
  let h: number
  let m: number
  if (digits.length <= 2) {
    h = Number(digits)
    m = 0
  } else if (digits.length === 3) {
    h = Number(digits.slice(0, 1))
    m = Number(digits.slice(1))
  } else {
    h = Number(digits.slice(0, 2))
    m = Number(digits.slice(2, 4))
  }
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
      className="flex h-[208px] w-14 flex-col gap-0.5 overflow-y-auto scrollbar-none py-1"
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
              'h-7 shrink-0 rounded-sm font-mono text-small tnum transition-colors duration-[120ms]',
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
  const parsed = parseTime(value) ?? { h: 18, m: 0 }
  const minutes = MINUTES.includes(parsed.m) ? MINUTES : [...MINUTES, parsed.m].sort((a, b) => a - b)

  const commit = (): void => {
    if (draft === null) return
    const n = normalize(draft)
    if (n) onChange(n)
    setDraft(null)
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
              className="absolute top-1/2 left-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:text-fg"
            >
              <Clock className="size-4" strokeWidth={1.75} />
            </button>
          </Popover.Trigger>
          <input
            id={id}
            aria-label={label}
            inputMode="numeric"
            className={cn(inputBase, 'pr-2 pl-8 font-mono text-[13px] tnum')}
            value={draft ?? value}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d:h]/g, '').slice(0, 5))}
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
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="no-drag z-50 flex gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-pop data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
        >
          <Column
            label="Horas"
            items={HOURS}
            selected={parsed.h}
            onPick={(h) => onChange(`${pad(h)}:${pad(parsed.m)}`)}
          />
          <div className="w-px self-stretch bg-border" />
          <Column
            label="Minutos"
            items={minutes}
            selected={parsed.m}
            onPick={(m) => {
              onChange(`${pad(parsed.h)}:${pad(m)}`)
              setOpen(false)
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
