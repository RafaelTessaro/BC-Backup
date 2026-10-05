import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { inputBase } from './Input'

interface NumberStepperProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  id?: string
  label?: string
  className?: string
}

/** "Dias de histórico" → "dias de histórico" (mantém siglas como "MB"). */
const lower = (s: string): string => s.charAt(0).toLocaleLowerCase('pt-BR') + s.slice(1)

/** NumberStepper (§8): input 72 px centralizado tabular + botões Minus/Plus ghost 28 px. */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  suffix,
  id,
  label,
  className
}: NumberStepperProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const clamp = (n: number): number => Math.min(max, Math.max(min, n))
  const commit = (): void => {
    if (draft === null) return
    const n = Number.parseInt(draft, 10)
    if (Number.isFinite(n)) onChange(clamp(n))
    setDraft(null)
  }
  const btn =
    'flex size-[28px] items-center justify-center rounded-sm text-fg-muted transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg disabled:opacity-40 disabled:pointer-events-none'
  return (
    <div className={cn('inline-flex items-center gap-[4px]', className)}>
      <button
        type="button"
        className={btn}
        aria-label={label ? `Diminuir ${lower(label)}` : 'Diminuir'}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <Minus className="size-[16px]" strokeWidth={1.75} />
      </button>
      <input
        id={id}
        aria-label={label}
        inputMode="numeric"
        className={cn(inputBase, 'w-[72px] px-[4px] text-center tnum')}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            onChange(clamp(value + step))
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(clamp(value - step))
          }
        }}
      />
      <button
        type="button"
        className={btn}
        aria-label={label ? `Aumentar ${lower(label)}` : 'Aumentar'}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <Plus className="size-[16px]" strokeWidth={1.75} />
      </button>
      {suffix && <span className="ml-[4px] text-small text-fg-muted">{suffix}</span>}
    </div>
  )
}
