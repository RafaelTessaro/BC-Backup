// Notificações nativas do sistema (design §7(h)): com a janela oculta/sem foco usamos a
// notificação do Windows/macOS em vez do toast da interface.

import { Notification } from 'electron'
import type { RunSummary } from '@shared/types'
import { ROUTES } from '@shared/routes'
import { formatBytes } from '@shared/format'
import { log } from './logger'

// Referências vivas: sem isso o GC pode descartar a notificação antes do clique.
const live = new Set<Notification>()

export function showNotification(title: string, body: string, onClick?: () => void): void {
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: false })
    live.add(n)
    const drop = () => live.delete(n)
    n.on('click', () => {
      drop()
      onClick?.()
    })
    n.on('close', drop)
    n.on('failed', drop)
    n.show()
    setTimeout(drop, 10 * 60_000).unref?.()
  } catch (e) {
    log.warn('Falha ao mostrar notificação', e)
  }
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`

/** Título/corpo pt-BR para o fim de uma execução (null = não notificar, ex.: cancelada). */
export function runNotificationText(r: RunSummary): { title: string; body: string } | null {
  switch (r.status) {
    case 'success':
      return {
        title: 'Backup concluído',
        body: `${r.routineName} · ${plural(r.filesCopied, 'arquivo', 'arquivos')} · ${formatBytes(r.bytesCopied)}`
      }
    case 'warning': {
      const n = Math.max(1, r.warnings || r.filesSkipped)
      return {
        title: `Concluído com ${plural(n, 'aviso', 'avisos')}`,
        body: `${r.routineName}: ${plural(r.filesSkipped || n, 'arquivo não copiado', 'arquivos não copiados')}. Clique para ver os detalhes.`
      }
    }
    case 'failed':
      return {
        title: 'Falha no backup',
        body: `${r.routineName}: ${r.errorMessage ?? 'veja os detalhes no histórico.'}`
      }
    default:
      return null
  }
}

export function notifyRunFinished(r: RunSummary, open: (route: string) => void): void {
  const text = runNotificationText(r)
  if (!text) return
  showNotification(text.title, text.body, () => open(ROUTES.run(r.id)))
}
