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

/** Switch (§8): 36 × 20, thumb 16 px; off com contorno text-tertiary. */
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
        'data-[state=checked]:bg-accent data-[state=checked]:shadow-[inset_0_0_0_1px_var(--accent)]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className
      )}
    >
      <S.Thumb
        className={cn(
          'block size-4 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_rgb(16_17_20/0.2),0_0_0_0.5px_rgb(16_17_20/0.08)]',
          'transition-transform duration-[120ms] ease-out data-[state=checked]:translate-x-[18px]'
        )}
      />
    </S.Root>
  )
}
