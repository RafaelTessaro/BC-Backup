import { AlertDialog } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'
import { useReturnFocus } from '@renderer/lib/hooks'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void | Promise<void>
  children?: ReactNode
}

/** Dialog de confirmação (§8): max-w 440, radius-xl, sh-dialog, p-6; Esc fecha, foco preso. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'danger',
  onConfirm,
  children
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const returnFocus = useReturnFocus(open)
  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="no-drag fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <AlertDialog.Content
          onCloseAutoFocus={returnFocus}
          className={cn(
            'no-drag fixed top-1/2 left-1/2 z-50 w-[calc(100vw-48px)] max-w-[440px] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border border-border bg-surface-raised p-6 shadow-dialog',
            'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out'
          )}
        >
          <AlertDialog.Title className="text-section font-semibold text-fg">{title}</AlertDialog.Title>
          {description && (
            <AlertDialog.Description className="mt-2 text-body text-fg-muted">
              {description}
            </AlertDialog.Description>
          )}
          {children}
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={busy}
              onClick={(e) => {
                e.preventDefault()
                void confirm()
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
