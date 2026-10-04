// Modelos de e-mail (HTML + texto) — implementação completa a cargo do agente de marca/e-mail.
// Contrato estável: o envio (smtp.ts) só depende destas assinaturas.

import type { AppSettings, Routine, RunRecord } from '@shared/types'

export interface RunEmailContext {
  run: RunRecord
  routine: Pick<Routine, 'name' | 'notification'>
  settings: Pick<AppSettings, 'clientName' | 'computerAlias' | 'companyName'>
  hostname: string
  appVersion: string
  /** Próxima execução agendada (ISO) ou null. */
  nextRunAt?: string | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export function renderRunEmail(ctx: RunEmailContext): RenderedEmail {
  const subject = `[BC Backup] ${ctx.run.status} — ${ctx.routine.name}`
  const text = `${subject}\n${ctx.run.startedAt}`
  return { subject, html: `<p>${text}</p>`, text }
}

export interface TestEmailContext {
  companyName: string
  hostname: string
  appVersion: string
}

export function renderTestEmail(ctx: TestEmailContext): RenderedEmail {
  const subject = `[${ctx.companyName}] E-mail de teste`
  const text = `Teste enviado de ${ctx.hostname}.`
  return { subject, html: `<p>${text}</p>`, text }
}
