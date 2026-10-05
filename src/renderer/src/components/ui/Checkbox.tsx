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

/**
 * Checkbox (§8): 16 px, radius-xs, contorno 1 px text-tertiary; marcado accent (borda accent-edge) + check escuro.
 * Tudo em px: a raiz da interface é 14 px (size-4 dava 14 px) e um contorno de 1,5 px muda de espessura
 * conforme a escala da tela (1 px a 100–125 %, 2 px a 150 %).
 */
export function Checkbox({ checked, onCheckedChange, label, disabled, className }: CheckboxProps) {
  const id = useId()
  return (
    <div className={cn('inline-flex items-center gap-[8px]', className)}>
      <C.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className={cn(
          'flex size-[16px] shrink-0 items-center justify-center rounded-xs border border-fg-subtle bg-surface-raised transition-colors duration-[120ms]',
          'data-[state=checked]:border-accent-edge data-[state=checked]:bg-accent'
        )}
      >
        <C.Indicator>
          <Check className="size-[12px] text-accent-foreground" strokeWidth={3} aria-hidden />
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
