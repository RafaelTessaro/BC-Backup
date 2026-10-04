import { ArrowRight, Mail } from 'lucide-react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import type { AttachLog } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { Card } from '@renderer/components/ui/Card'
import { Field, Input } from '@renderer/components/ui/Input'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { useNow } from '@renderer/lib/clock'
import { formatDayMonth, formatTime } from '@renderer/lib/format'
import { smtpConfigured, useApp } from '@renderer/lib/store'
import type { Update } from '../model'
import { EmailChips, isEmail } from './EmailChips'
import { IssueList, OptionRow } from './shared'

function invalidText(bad: string[]): string | null {
  if (!bad.length) return null
  return bad.length === 1
    ? `E-mail inválido: ${bad[0]}. Corrija ou remova.`
    : `E-mails inválidos: ${bad.join(', ')}. Corrija ou remova.`
}

export function NotificationStep({
  draft,
  update,
  issues,
  onConfigureEmail
}: {
  draft: RoutineInput
  update: Update
  issues: ValidationIssue[]
  onConfigureEmail: () => void
}) {
  const settings = useApp((s) => s.settings)
  const info = useApp((s) => s.info)
  const now = useNow()
  const n = draft.notification
  const configured = smtpConfigured(settings)
  const set = (patch: Partial<RoutineInput['notification']>): void =>
    update((d) => ({ ...d, notification: { ...d.notification, ...patch } }))

  // Erros mostrados junto do campo (o resto da validação fica na lista do fim da etapa).
  const badTo = n.recipients.filter((v) => !isEmail(v))
  const badBcc = n.bcc.filter((v) => !isEmail(v))
  const missing = issues.find((i) => i.level === 'error' && /destinat/i.test(i.message))
  const toError = invalidText(badTo) ?? missing?.message ?? null
  const bccError = invalidText(badBcc)
  const covered = (i: ValidationIssue): boolean =>
    /e-mails? inválido|destinat/i.test(i.message) ||
    (!configured && /SMTP|servidor de e-mail/i.test(i.message))
  const rest = issues.filter((i) => !covered(i))

  // Igual ao assunto montado pelo main (src/main/mail/template.ts → buildRunSubject).
  const routine = draft.name.trim() || 'Rotina sem nome'
  const client = n.clientName?.trim() || settings?.clientName?.trim() || ''
  const computer = settings?.computerAlias?.trim() || info?.hostname || ''
  const who = client
    ? computer
      ? `${routine} – ${client} (${computer})`
      : `${routine} – ${client}`
    : computer
      ? `${routine} (${computer})`
      : routine
  const subject = `[BC Backup] Concluído – ${who} – ${formatDayMonth(now)} ${formatTime(now)}`

  const toggle = (enabled: boolean): void =>
    // Ao desligar, endereços inválidos (que não poderiam ser usados) saem junto com o campo.
    set(
      enabled
        ? { enabled }
        : { enabled, recipients: n.recipients.filter(isEmail), bcc: n.bcc.filter(isEmail) }
    )

  return (
    <div className="flex flex-col gap-6">
      {!configured && (
        <Callout
          tone={n.enabled ? 'warning' : 'info'}
          title="E-mail ainda não configurado"
          action={
            <Button variant="link" size="sm" iconRight={ArrowRight} onClick={onConfigureEmail}>
              Configurar e-mail
            </Button>
          }
        >
          {n.enabled
            ? 'Nada será enviado até o servidor de envio (SMTP) ser configurado em Configurações → E-mail. Seu rascunho fica guardado enquanto isso.'
            : 'Configure o servidor de envio (SMTP) uma vez em Configurações → E-mail e todas as rotinas poderão avisar seus clientes.'}
        </Callout>
      )}

      <Card className="divide-y divide-border">
        <OptionRow
          title="Enviar e-mail ao terminar"
          description="Com o resultado, os destinos e o espaço livre. Ótimo para o cliente saber que está tudo bem."
        >
          <Switch label="Enviar e-mail ao terminar" checked={n.enabled} onCheckedChange={toggle} />
        </OptionRow>
        {n.enabled && (
          <div className="flex flex-col gap-5 px-5 py-5">
            <div data-invalid={toError ? '' : undefined}>
              <Field
                label="Destinatários"
                error={toError}
                description="Digite e tecle Enter ou vírgula. Pode colar vários de uma vez."
              >
                {(id) => (
                  <EmailChips
                    id={id}
                    values={n.recipients}
                    invalid={!!toError}
                    placeholder="cliente@empresa.com.br"
                    onChange={(recipients) => set({ recipients })}
                  />
                )}
              </Field>
            </div>
            <div data-invalid={bccError ? '' : undefined}>
              <Field
                label="Cópia oculta (Cco)"
                error={bccError}
                description="Opcional. Ex.: o e-mail do técnico responsável."
              >
                {(id) => (
                  <EmailChips
                    id={id}
                    values={n.bcc}
                    invalid={!!bccError}
                    placeholder="tecnico@empresa.com.br"
                    onChange={(bcc) => set({ bcc })}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Quando enviar">
                {() => (
                  <Segmented<'always' | 'issues'>
                    label="Quando enviar"
                    value={n.onSuccess ? 'always' : 'issues'}
                    onChange={(v) => set({ onSuccess: v === 'always', onWarning: true, onFailure: true })}
                    className="w-full"
                    options={[
                      { value: 'always', label: 'Sempre' },
                      { value: 'issues', label: 'Só avisos e falhas' }
                    ]}
                  />
                )}
              </Field>
              <Field label="Anexar o log">
                {(id) => (
                  <Select<AttachLog>
                    id={id}
                    value={n.attachLog}
                    onChange={(attachLog) => set({ attachLog })}
                    options={[
                      { value: 'never', label: 'Nunca' },
                      { value: 'onFailure', label: 'Só quando falhar' },
                      { value: 'always', label: 'Sempre' }
                    ]}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Nome do cliente no e-mail"
              description={
                settings?.clientName?.trim()
                  ? `Em branco, usa “${settings.clientName.trim()}”, definido em Configurações.`
                  : 'Opcional. Aparece no assunto e no texto do e-mail.'
              }
            >
              {(id) => (
                <Input
                  id={id}
                  value={n.clientName ?? ''}
                  maxLength={80}
                  placeholder={settings?.clientName?.trim() || 'Ex.: Padaria Pão Quente'}
                  onChange={(e) => set({ clientName: e.target.value })}
                  className="max-w-[360px]"
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5 rounded-md bg-surface-hover/70 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-caption text-fg-subtle">
                <Mail className="size-3.5" strokeWidth={1.75} aria-hidden /> Exemplo de assunto
              </span>
              <span className="font-mono text-mono break-words text-fg-muted" data-selectable>
                {subject}
              </span>
            </div>
          </div>
        )}
      </Card>
      <IssueList issues={rest} />
    </div>
  )
}
