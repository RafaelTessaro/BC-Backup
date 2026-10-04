import { Switch as S } from 'radix-ui'
import { cn } from '@renderer/lib/cn'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  id?: string
  label?: string
  className?: string
}

/**
 * Switch (§8): trilho 36 × 20; bolinha de 14 px com 3 px de folga em todos os lados (estilo Windows 11),
 * para nunca encostar na borda do trilho em nenhuma escala de tela.
 */
export function Switch({ checked, onCheckedChange, disabled, id, label, className }: SwitchProps) {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'group relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-[background-color,box-shadow] duration-[120ms] ease-out',
        'bg-fg-subtle/25 shadow-[inset_0_0_0_1px_var(--text-tertiary)]',
        'data-[state=checked]:bg-accent data-[state=checked]:shadow-[inset_0_0_0_1px_var(--accent-edge)]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className
      )}
    >
      <S.Thumb
        className={cn(
          'pointer-events-none block size-3.5 translate-x-[3px] rounded-full bg-white shadow-[0_1px_2px_rgb(4_20_14/0.3)]',
          'transition-transform duration-[120ms] ease-out data-[state=checked]:translate-x-[19px]'
        )}
      />
    </S.Root>
  )
}
