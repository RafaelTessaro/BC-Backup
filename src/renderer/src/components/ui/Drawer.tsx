import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'
import { IconButton } from './Button'

interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Elementos à direita do título (antes do fechar). */
  actions?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  description?: string
}

/** Drawer (§8): direita, 480 px, abaixo da titlebar, surface-raised, sh-dialog, cabeçalho sticky 56 px. */
export function Drawer({ open, onOpenChange, title, actions, subtitle, children, footer, description }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-x-0 top-10 bottom-0 z-40 bg-overlay/50 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed top-10 right-0 bottom-0 z-40 flex w-[480px] max-w-[calc(100vw-64px)] flex-col',
            'rounded-tl-xl border-t border-l border-border bg-surface-raised shadow-dialog',
            'data-[state=open]:animate-drawer-in data-[state=closed]:animate-drawer-out focus:outline-none'
          )}
        >
          <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="flex min-w-0 items-center gap-2 text-section font-semibold text-fg">
                {title}
              </Dialog.Title>
              {subtitle && <div className="mt-0.5 text-small text-fg-muted">{subtitle}</div>}
              {description && <Dialog.Description className="sr-only">{description}</Dialog.Description>}
            </div>
            {actions}
            <Dialog.Close asChild>
              <IconButton icon={X} label="Fechar" size="md" tooltipSide="bottom" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer && (
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
