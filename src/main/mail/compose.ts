// Decide se a execução gera e-mail e monta a mensagem consolidada (uma por execução).
// Node puro. O corpo (HTML/texto) vem de ./template.ts (agente de marca).

import type { AppSettings, EmailStatus, RunRecord, RunStatus } from '@shared/types'
import { backupStamp, formatBytes } from '@shared/format'
import { sanitizeName } from '../engine/fsutil'
import type { StoredRoutine } from '../store'
import { isSmtpConfigured, type OutgoingMail } from './smtp'
import { renderRunEmail } from './template'

export type EmailDecision =
  | { status: Extract<EmailStatus, 'not_configured' | 'skipped'>; reason: string }
  | { status: 'send'; mail: OutgoingMail }

const STATUS_PT: Record<RunStatus, string> = {
  queued: 'Na fila',
  running: 'Em execução',
  success: 'Sucesso',
  warning: 'Concluído com avisos',
  failed: 'Falha',
  cancelled: 'Cancelado'
}

const MAX_LOG_TEXT = 2 * 1024 * 1024

function fmt(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR')
}

/** Log da execução em texto simples (anexo do e-mail / "Salvar .txt"). */
export function runLogText(run: RunRecord, ctx: { computer: string; appVersion: string }): string {
  const lines = [
    `BC Backup ${ctx.appVersion} — log da execução`,
    `Rotina: ${run.routineName}`,
    `Status: ${STATUS_PT[run.status] ?? run.status}`,
    `Início: ${fmt(run.startedAt)}`,
    `Fim: ${fmt(run.finishedAt)}`,
    `Computador: ${ctx.computer}`,
    ''
  ]
  for (const d of run.destinations) {
    lines.push(
      `Destino ${d.label ? `${d.label} (${d.path})` : d.path}: ${STATUS_PT[d.status] ?? d.status}` +
        ` — ${d.filesCopied.toLocaleString('pt-BR')} ${d.filesCopied === 1 ? 'arquivo' : 'arquivos'}, ${formatBytes(d.bytesCopied)}` +
        (d.error ? ` — ${d.error}` : '')
    )
  }
  lines.push('', '-'.repeat(60))
  let size = lines.join('\n').length
  for (const e of run.log) {
    const line = `[${fmt(e.t)}] ${e.level.toUpperCase().padEnd(5)} ${e.message}`
    size += line.length + 1
    if (size > MAX_LOG_TEXT) {
      lines.push('… (log truncado)')
      break
    }
    lines.push(line)
  }
  return lines.join('\r\n')
}

export function decideRunEmail(args: {
  run: RunRecord
  routine: Pick<StoredRoutine, 'name' | 'notification'>
  settings: AppSettings
  hostname: string
  appVersion: string
  nextRunAt: string | null
}): EmailDecision {
  const { run, routine, settings } = args
  const n = routine.notification
  if (!n.enabled || (!n.recipients.length && !n.bcc.length)) {
    return { status: 'not_configured', reason: 'Aviso por e-mail desligado nesta rotina.' }
  }
  if (!isSmtpConfigured(settings)) {
    return {
      status: 'not_configured',
      reason: 'Servidor de e-mail (SMTP) não configurado em Configurações › E-mail.'
    }
  }
  const wants =
    (run.status === 'success' && n.onSuccess) ||
    (run.status === 'warning' && n.onWarning) ||
    (run.status === 'failed' && n.onFailure)
  if (!wants) return { status: 'skipped', reason: 'Esta situação não está marcada para envio de e-mail.' }

  const computer = settings.computerAlias.trim() || args.hostname
  const attach = n.attachLog === 'always' || (n.attachLog === 'onFailure' && run.status === 'failed')
  const rendered = renderRunEmail({
    run,
    routine: { name: routine.name, notification: n },
    settings: {
      clientName: n.clientName?.trim() || settings.clientName,
      computerAlias: settings.computerAlias.trim(),
      companyName: settings.companyName
    },
    hostname: args.hostname,
    appVersion: args.appVersion,
    nextRunAt: args.nextRunAt,
    logAttached: attach
  })
  const mail: OutgoingMail = {
    to: n.recipients,
    bcc: n.bcc,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text
  }
  if (attach) {
    mail.attachments = [
      {
        filename: `log-${sanitizeName(routine.name, 'rotina', 60)}-${backupStamp(new Date(run.startedAt))}.txt`,
        content: runLogText(run, { computer, appVersion: args.appVersion })
      }
    ]
  }
  return { status: 'send', mail }
}
