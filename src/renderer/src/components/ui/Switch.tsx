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
 * Switch (§8, geometria do Windows 11): trilho 40 × 20 com contorno de 1 px (sombra interna, não borda),
 * bolinha de 12 px centrada numa célula de 20 × 20 que anda 20 px — 4 px de folga nos quatro lados, ligado
 * ou desligado. Tudo em px (a raiz da interface é 14 px: rem aqui deixava a bolinha encostar na borda).
 * Passar o mouse cresce a bolinha para 14 px; pressionar estica para 17 × 14 (folga externa de 3 px).
 * Ligado: verde da marca com a bolinha escura (#00140F) — contraste ≥ 7:1; branco sobre o verde não passa de 2,2:1.
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
        'group relative inline-flex h-[20px] w-[40px] shrink-0 items-center rounded-full border-0 p-0 align-middle',
        'bg-fg/[0.04] shadow-[inset_0_0_0_1px_var(--text-tertiary)]',
        'transition-[background-color,box-shadow] duration-[120ms] ease-out',
        'hover:bg-fg/[0.07] active:bg-fg/[0.10]',
        'data-[state=checked]:bg-accent data-[state=checked]:shadow-[inset_0_0_0_1px_var(--accent-edge)]',
        'data-[state=checked]:hover:bg-accent-hover data-[state=checked]:active:bg-accent-hover',
        'disabled:pointer-events-none disabled:opacity-45',
        // Alto contraste do Windows: o Chromium remove sombras e força fundos; usa as cores do sistema.
        'forced-colors:forced-color-adjust-none forced-colors:bg-[Canvas] forced-colors:shadow-[inset_0_0_0_1px_ButtonText]',
        'forced-colors:data-[state=checked]:bg-[Highlight] forced-colors:data-[state=checked]:shadow-none',
        className
      )}
    >
      <S.Thumb
        className={cn(
          'pointer-events-none flex h-[20px] w-[20px] shrink-0 items-center justify-center',
          'transition-transform duration-[180ms] ease-out data-[state=checked]:translate-x-[20px]',
          'before:block before:h-[12px] before:w-[12px] before:shrink-0 before:rounded-full before:bg-fg-muted',
          'before:transition-[width,height,background-color] before:duration-[120ms] before:ease-out',
          'data-[state=checked]:before:bg-accent-foreground',
          'group-hover:before:h-[14px] group-hover:before:w-[14px]',
          'group-active:before:h-[14px] group-active:before:w-[17px]',
          'group-active:data-[state=unchecked]:justify-start group-active:data-[state=unchecked]:pl-[3px]',
          'group-active:data-[state=checked]:justify-end group-active:data-[state=checked]:pr-[3px]',
          'forced-colors:before:bg-[ButtonText] forced-colors:data-[state=checked]:before:bg-[HighlightText]'
        )}
      />
    </S.Root>
  )
}
