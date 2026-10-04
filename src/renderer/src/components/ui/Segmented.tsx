import type { LucideIcon } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { cn } from '@renderer/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  count?: number
}

interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  label: string
  size?: 'sm' | 'md'
  className?: string
  /** Segmentos com a mesma largura (indicador desliza). */
  equal?: boolean
}

/**
 * Segmented (§8): trilho surface-hover, padding 2; ativo surface-raised + sh-xs.
 * Segmentos de largura igual para o indicador deslizar só com CSS (sem medir o DOM).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  className,
  equal = true
}: SegmentedProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  const n = options.length
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      orientation="horizontal"
      loop
      onKeyDown={(e) => {
        // A seleção acompanha as setas já no keydown. O Radix move o foco num setTimeout e só seleciona
        // se a tecla ainda estiver pressionada: com a interface ocupada (ex.: a etapa trocando de
        // conteúdo), o foco andava para outra opção sem selecioná-la.
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        const from = options.findIndex((o) => o.value === (e.target as HTMLElement).getAttribute('value'))
        if (from < 0) return
        const next = options[(from + (e.key === 'ArrowRight' ? 1 : -1) + n) % n]
        if (next.value !== value) onChange(next.value)
      }}
      className={cn(
        'relative isolate inline-grid shrink-0 rounded-md bg-surface-hover p-0.5',
        size === 'sm' ? 'h-7' : 'h-8',
        className
      )}
      style={{ gridTemplateColumns: equal ? `repeat(${n}, minmax(0, 1fr))` : `repeat(${n}, auto)` }}
    >
      {equal && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0.5 -z-10 rounded-[6px] bg-segment-active shadow-xs transition-transform duration-[180ms] ease-out dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
          style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${index * 100}%)` }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value
        const Icon = o.icon
        return (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            className={cn(
              'relative flex min-w-0 items-center justify-center gap-1.5 rounded-[6px] font-medium whitespace-nowrap transition-colors duration-[120ms]',
              size === 'sm' ? 'px-2.5 text-caption' : 'px-3 text-small',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg',
              !equal && active && 'bg-segment-active shadow-xs',
              'focus-visible:outline-offset-0'
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />}
            <span className="truncate">{o.label}</span>
            {o.count !== undefined && (
              <span className={cn('tnum text-caption', active ? 'text-fg-muted' : 'text-fg-subtle')}>
                {o.count}
              </span>
            )}
          </RadioGroup.Item>
        )
      })}
    </RadioGroup.Root>
  )
}
