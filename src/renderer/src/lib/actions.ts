// Ações de rotina com feedback (toasts) — usadas por várias telas.
import type { ID, Routine, RunSummary } from '@shared/types'
import { BACKUP_ROOT_DIR } from '@shared/defaults'
import { formatBytes } from '@shared/format'
import { ROUTES } from '@shared/routes'
import { bc, errorMessage } from './bc'
import { plural } from './format'
import { navigate } from './router'
import { openLiveRun, openRunDetail, refreshRoutines } from './store'
import { notify } from './toast'

export async function runNow(routine: Pick<Routine, 'id' | 'name'>, opts?: { openDrawer?: boolean }): Promise<void> {
  try {
    await bc.routines.runNow(routine.id)
    if (opts?.openDrawer) openLiveRun(routine.id)
    else
      notify.info('Backup iniciado', {
        description: routine.name,
        action: { label: 'Ver progresso', onClick: () => openLiveRun(routine.id) }
      })
  } catch (err) {
    notify.error('Não foi possível iniciar', { description: errorMessage(err) })
  }
}

export async function cancelRun(routineId: ID): Promise<void> {
  try {
    await bc.routines.cancel(routineId)
  } catch (err) {
    notify.error('Não foi possível parar', { description: errorMessage(err) })
  }
}

export async function setRoutineEnabled(routine: Routine, enabled: boolean): Promise<void> {
  try {
    await bc.routines.setEnabled(routine.id, enabled)
    await refreshRoutines()
    notify.info(enabled ? 'Rotina retomada' : 'Rotina pausada', {
      description: enabled
        ? `${routine.name} volta a seguir o agendamento.`
        : `${routine.name} não vai rodar até você retomar.`
    })
  } catch (err) {
    notify.error('Não foi possível alterar a rotina', { description: errorMessage(err) })
  }
}

export async function duplicateRoutine(routine: Routine): Promise<void> {
  try {
    const copy = await bc.routines.duplicate(routine.id)
    await refreshRoutines()
    notify.success('Rotina duplicada', {
      description: copy.name,
      action: { label: 'Editar cópia', onClick: () => navigate(ROUTES.routine(copy.id)) }
    })
  } catch (err) {
    notify.error('Não foi possível duplicar', { description: errorMessage(err) })
  }
}

export async function removeRoutine(routine: Routine): Promise<void> {
  try {
    await bc.routines.remove(routine.id)
    await refreshRoutines()
    notify.info('Rotina excluída', { description: `As cópias de “${routine.name}” continuam no destino.` })
  } catch (err) {
    notify.error('Não foi possível excluir', { description: errorMessage(err) })
  }
}

function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('/') && !base.includes('\\') ? '/' : '\\'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

export function routineFolder(routine: Routine, destPath: string): string {
  return joinPath(destPath, BACKUP_ROOT_DIR, routine.name)
}

export async function openDestinationFolder(routine: Routine): Promise<void> {
  const dest = routine.destinations.find((d) => d.enabled !== false) ?? routine.destinations[0]
  if (!dest) return
  try {
    await bc.app.openPath(routineFolder(routine, dest.path))
  } catch (err) {
    notify.error('Não foi possível abrir a pasta', { description: errorMessage(err) })
  }
}

/** Toast de fim de execução (§7h). */
export function toastRunFinished(r: RunSummary): void {
  const details = { label: 'Ver detalhes', onClick: () => openRunDetail(r.id) }
  switch (r.status) {
    case 'success':
      notify.success('Backup concluído', {
        description: `${r.routineName} · ${plural(r.filesCopied, 'arquivo', 'arquivos')} · ${formatBytes(r.bytesCopied)}`,
        action: details
      })
      break
    case 'warning':
      notify.warning(`Concluído com ${plural(r.warnings, 'aviso', 'avisos')}`, {
        description: r.routineName,
        action: details
      })
      break
    case 'failed':
      notify.error('Falha no backup', {
        description: `${r.routineName}: ${r.errorMessage ?? 'veja o log para detalhes.'}`,
        action: { label: 'Ver log', onClick: () => openRunDetail(r.id) }
      })
      break
    case 'cancelled':
      notify.info('Backup cancelado', { description: `${r.routineName} · a cópia parcial foi mantida.` })
      break
  }
}
