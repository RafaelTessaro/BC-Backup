import { ConfirmDialog } from '@renderer/components/ui/Dialog'
import { useRouter } from '@renderer/lib/router'

/** Confirma a saída do editor quando há alterações não salvas. */
export function NavigationGuard() {
  const pending = useRouter((s) => s.pending)
  const confirmPending = useRouter((s) => s.confirmPending)
  const cancelPending = useRouter((s) => s.cancelPending)
  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) cancelPending()
      }}
      title="Descartar alterações?"
      description="As alterações nesta rotina ainda não foram salvas e serão perdidas."
      confirmLabel="Descartar"
      cancelLabel="Continuar editando"
      onConfirm={() => confirmPending()}
    />
  )
}
