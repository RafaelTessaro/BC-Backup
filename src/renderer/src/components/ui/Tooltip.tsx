import { useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { Tooltip as T } from 'radix-ui'
import { cn } from '@renderer/lib/cn'
import { inputModality } from '@renderer/lib/modality'

export const TooltipProvider = T.Provider

interface TooltipProps {
  label: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Não exibe (mantém o filho). */
  disabled?: boolean
  className?: string
  delay?: number
}

const CONTENT =
  'z-[60] max-w-[420px] rounded-sm bg-tooltip px-2 py-1 text-caption font-medium text-tooltip-fg shadow-pop ' +
  'data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out ' +
  'break-words select-none'

/**
 * Só abre por foco quando o foco é "de teclado" (:focus-visible). Assim, devolver o foco a um
 * botão-ícone depois de fechar um menu/drawer com o mouse não faz o Tooltip pipocar.
 */
function onlyKeyboardFocus(e: FocusEvent<HTMLElement>): void {
  if (inputModality() === 'pointer') return e.preventDefault()
  try {
    if (!e.currentTarget.matches(':focus-visible')) e.preventDefault()
  } catch {
    /* navegador sem :focus-visible */
  }
}

/** Tooltip invertido (§8): caption, px 8 py 4, radius-sm, sem seta, delay 400 ms. */
export function Tooltip({
  label,
  children,
  side = 'top',
  align = 'center',
  disabled,
  className,
  delay
}: TooltipProps) {
  if (disabled || label === null || label === undefined || label === '') return <>{children}</>
  return (
    <T.Root delayDuration={delay}>
      <T.Trigger asChild onFocus={onlyKeyboardFocus}>
        {children}
      </T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(CONTENT, className)}
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

/**
 * Texto em uma linha com reticências; mostra o texto completo num Tooltip só quando
 * está de fato cortado (nomes de rotina longos, títulos de drawer…).
 */
export function TruncatedText({
  children,
  label,
  className,
  side = 'top',
  align = 'start'
}: {
  children: ReactNode
  /** Conteúdo do Tooltip (padrão: o próprio texto). */
  label?: ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const overflowing = (): boolean => {
    const el = ref.current
    return !!el && el.scrollWidth > el.clientWidth + 1
  }
  return (
    <T.Root open={open} onOpenChange={(o) => setOpen(o && overflowing())}>
      <T.Trigger asChild onFocus={onlyKeyboardFocus}>
        <span ref={ref} className={cn('block min-w-0 truncate', className)}>
          {children}
        </span>
      </T.Trigger>
      <T.Portal>
        <T.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={CONTENT}>
          {label ?? children}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
