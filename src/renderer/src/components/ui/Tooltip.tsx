import type { ReactNode } from 'react'
import { Tooltip as T } from 'radix-ui'
import { cn } from '@renderer/lib/cn'

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
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-[60] max-w-[420px] rounded-sm bg-tooltip px-2 py-1 text-caption font-medium text-tooltip-fg shadow-pop',
            'data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-fade-in data-[state=closed]:animate-fade-out',
            'break-words select-none',
            className
          )}
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}
