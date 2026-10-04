import { Check } from 'lucide-react'
import { Checkbox as C } from 'radix-ui'
import { useId, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

interface CheckboxProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label?: ReactNode
  disabled?: boolean
  className?: string
}

/** Checkbox (§8): 16 px, radius-xs, contorno 1.5 px text-tertiary; marcado accent. */
export function Checkbox({ checked, onCheckedChange, label, disabled, className }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <C.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-xs border-[1.5px] border-fg-subtle bg-surface-raised transition-colors duration-[120ms]',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent'
        )}
      >
        <C.Indicator>
          <Check className="size-3 text-white" strokeWidth={3} aria-hidden />
        </C.Indicator>
      </C.Root>
      {label && (
        <label htmlFor={id} className="text-small text-fg-muted select-none">
          {label}
        </label>
      )}
    </div>
  )
}
