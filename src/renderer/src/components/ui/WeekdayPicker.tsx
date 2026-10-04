import { ToggleGroup } from 'radix-ui'
import { WEEKDAY_LONG } from '@shared/schedule'
import { cn } from '@renderer/lib/cn'
import { Tooltip } from './Tooltip'

const LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const WORKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [0, 6]
const ALL = [0, 1, 2, 3, 4, 5, 6]

const same = (a: number[], b: number[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i])

/** WeekdayPicker (§8): 7 chips 32 × 32 D S T Q Q S S + atalhos. Semana começa no domingo. */
export function WeekdayPicker({
  value,
  onChange,
  className
}: {
  value: number[]
  onChange: (days: number[]) => void
  className?: string
}) {
  const shortcut = (label: string, days: number[]) => {
    const active = same(value, days)
    return (
      <button
        type="button"
        onClick={() => onChange(days)}
        className={cn(
          'rounded-sm px-1.5 py-0.5 text-caption font-medium transition-colors duration-[120ms]',
          active ? 'text-accent-text' : 'text-fg-subtle hover:text-fg'
        )}
        aria-pressed={active}
      >
        {label}
      </button>
    )
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ToggleGroup.Root
        type="multiple"
        value={value.map(String)}
        onValueChange={(v) => onChange(v.map(Number).sort((a, b) => a - b))}
        aria-label="Dias da semana"
        className="flex gap-1.5"
      >
        {LETTERS.map((letter, day) => (
          <Tooltip key={day} label={WEEKDAY_LONG[day]}>
            <ToggleGroup.Item
              value={String(day)}
              aria-label={WEEKDAY_LONG[day]}
              className={cn(
                'flex size-8 items-center justify-center rounded-sm border text-small font-medium transition-[background-color,border-color,color] duration-[120ms]',
                'border-border-strong bg-surface-raised text-fg-muted shadow-xs hover:text-fg',
                'data-[state=on]:border-accent data-[state=on]:bg-accent data-[state=on]:text-accent-foreground'
              )}
            >
              {letter}
            </ToggleGroup.Item>
          </Tooltip>
        ))}
      </ToggleGroup.Root>
      <div className="-ml-1.5 flex items-center gap-1">
        {shortcut('Dias úteis', WORKDAYS)}
        <span className="text-fg-subtle/60" aria-hidden>
          ·
        </span>
        {shortcut('Fim de semana', WEEKEND)}
        <span className="text-fg-subtle/60" aria-hidden>
          ·
        </span>
        {shortcut('Todos', ALL)}
      </div>
    </div>
  )
}
