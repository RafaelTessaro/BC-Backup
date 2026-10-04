import { ArrowRight, Mail } from 'lucide-react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import type { AttachLog } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { Card } from '@renderer/components/ui/Card'
import { ChipInput } from '@renderer/components/ui/ChipInput'
import { Field, Input } from '@renderer/components/ui/Input'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { useNow } from '@renderer/lib/clock'
import { EMAIL_RE, formatTime } from '@renderer/lib/format'
import { smtpConfigured, useApp } from '@renderer/lib/store'
import type { Update } from '../model'
import { IssueList, OptionRow } from './shared'

const emailError = (v: string): string | null => (EMAIL_RE.test(v) ? null : 'E-mail inválido')

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

  const client = n.clientName?.trim() || settings?.clientName || 'Cliente'
  const computer = settings?.computerAlias || info?.hostname || 'Computador'
  const date = `${now.toLocaleDateString('pt-BR')} ${formatTime(now)}`
  const subject = `[BC Backup] SUCESSO – ${draft.name.trim() || 'Rotina'} – ${client} (${computer}) – ${date}`
  const shownIssues = issues.filter((i) => !(i.level === 'warning' && !configured))

  return (
    <div className="flex flex-col gap-6">
      {!configured && (
        <Callout
          tone="warning"
          title="E-mail ainda não configurado"
          action={
            <Button variant="link" size="sm" iconRight={ArrowRight} onClick={onConfigureEmail}>
              Configurar em Configurações → E-mail
            </Button>
          }
        >
          Configure o servidor de envio (SMTP) uma vez e todas as rotinas poderão avisar seus clientes. Seu
          rascunho fica guardado enquanto isso.
        </Callout>
      )}

      <Card className="divide-y divide-border">
        <OptionRow
          title="Enviar e-mail ao terminar"
          description="Com o resultado, os destinos e o espaço livre. Ótimo para o cliente saber que está tudo bem."
        >
          <Switch
            label="Enviar e-mail ao terminar"
            checked={n.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </OptionRow>
        {n.enabled && (
          <div className="flex flex-col gap-5 px-5 py-5">
            <Field
              label="Destinatários"
              description="Digite e tecle Enter ou vírgula. Pode colar vários de uma vez."
            >
              {(id) => (
                <ChipInput
                  id={id}
                  values={n.recipients}
                  splitOnWhitespace
                  normalize={(v) => v.trim().toLowerCase()}
                  validate={emailError}
                  invalid={n.recipients.length === 0 && issues.some((i) => i.level === 'error')}
                  placeholder="cliente@empresa.com.br"
                  onChange={(recipients) => set({ recipients })}
                />
              )}
            </Field>
            <Field label="Cópia oculta (Cco)" description="Opcional. Ex.: o e-mail do técnico responsável.">
              {(id) => (
                <ChipInput
                  id={id}
                  values={n.bcc}
                  splitOnWhitespace
                  normalize={(v) => v.trim().toLowerCase()}
                  validate={emailError}
                  placeholder="tecnico@empresa.com.br"
                  onChange={(bcc) => set({ bcc })}
                />
              )}
            </Field>
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
              description="Em branco, usa o nome definido em Configurações."
            >
              {(id) => (
                <Input
                  id={id}
                  value={n.clientName ?? ''}
                  placeholder={settings?.clientName || 'Ex.: Padaria Pão Quente'}
                  onChange={(e) => set({ clientName: e.target.value })}
                  className="max-w-[360px]"
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5 rounded-md bg-surface-hover/70 px-3 py-2.5">
              <span className="flex items-center gap-1.5 text-caption text-fg-subtle">
                <Mail className="size-3.5" strokeWidth={1.75} /> Assunto do e-mail
              </span>
              <span className="truncate font-mono text-mono text-fg-muted" data-selectable>
                {subject}
              </span>
            </div>
          </div>
        )}
      </Card>
      <IssueList issues={shownIssues} />
    </div>
  )
}
