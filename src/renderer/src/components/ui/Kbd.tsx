import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

/** Tecla (§8): altura 18, mono 11 px, borda inferior 2 px. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-b-2 border-border bg-surface-hover px-[5px]',
        'font-mono text-[11px] leading-none font-medium text-fg-muted',
        className
      )}
    >
      {children}
    </kbd>
  )
}

/** Classes para Kbd dentro do Tooltip invertido. */
export const TOOLTIP_KBD =
  '[&_kbd]:border-white/15 [&_kbd]:bg-white/10 [&_kbd]:text-current dark:[&_kbd]:border-black/15 dark:[&_kbd]:bg-black/5'

export function Shortcut({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}
