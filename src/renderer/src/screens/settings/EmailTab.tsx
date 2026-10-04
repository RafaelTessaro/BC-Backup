import { Eye, EyeOff, MailCheck, Send, TriangleAlert } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { useState } from 'react'
import type { MailTestResult } from '@shared/api'
import { SMTP_PRESETS } from '@shared/defaults'
import type { SmtpInput, SmtpSecurity, SmtpSettings } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { Card } from '@renderer/components/ui/Card'
import { Field, Input } from '@renderer/components/ui/Input'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Switch } from '@renderer/components/ui/Switch'
import { bc, errorMessage } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { EMAIL_RE } from '@renderer/lib/format'
import { navigate } from '@renderer/lib/router'
import { smtpConfigured, useApp } from '@renderer/lib/store'
import { hasStash } from '@renderer/screens/editor/model'
import { ROUTES } from '@shared/routes'
import { notify } from '@renderer/lib/toast'
import { SettingsGroup, SettingsRow } from './SettingsRow'

function toInput(s: SmtpSettings): SmtpInput {
  const { hasPassword: _h, ...rest } = s
  return rest
}

const same = (a: SmtpInput, b: SmtpInput): boolean => JSON.stringify(a) === JSON.stringify(b)

export function EmailTab() {
  const settings = useApp((s) => s.settings)!
  const saved = settings.smtp
  const [draft, setDraft] = useState<SmtpInput>(() => toInput(saved))
  const [showPass, setShowPass] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testTo, setTestTo] = useState(saved.fromEmail || saved.user || '')
  const [result, setResult] = useState<MailTestResult | null>(null)

  const dirty = !same(draft, toInput(saved))
  // A senha salva vale só para o mesmo servidor/porta/usuário (o main a descarta se mudarem).
  const norm = (v: string): string => v.trim().toLowerCase()
  const accountChanged =
    norm(draft.host) !== norm(saved.host) || draft.port !== saved.port || norm(draft.user) !== norm(saved.user)
  const keepsSavedPassword = saved.hasPassword && !accountChanged
  const needsPassword = saved.hasPassword && accountChanged && !draft.password && !!draft.user.trim()
  const preset = SMTP_PRESETS.find((p) => p.id === draft.preset)
  const configured = smtpConfigured(settings)
  const set = <K extends keyof SmtpInput>(key: K, value: SmtpInput[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }))
    setResult(null)
  }

  const pickPreset = (id: string): void => {
    const p = SMTP_PRESETS.find((x) => x.id === id)
    if (!p) return
    setDraft((d) =>
      p.id === 'custom'
        ? { ...d, preset: p.id }
        : { ...d, preset: p.id, host: p.host, port: p.port, security: p.security }
    )
    setResult(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const next = await bc.settings.saveSmtp(draft)
      useApp.setState({ settings: next })
      setDraft(toInput(next.smtp))
      notify.success('E-mail configurado', {
        description: 'As rotinas com notificação já podem avisar seus clientes.'
      })
    } catch (err) {
      notify.error('Não foi possível salvar', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await bc.settings.testSmtp({ ...draft, to: testTo.trim() }))
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  const fromMismatch =
    draft.fromEmail &&
    draft.user &&
    draft.user.includes('@') &&
    draft.fromEmail.toLowerCase() !== draft.user.toLowerCase()
  const testValid = EMAIL_RE.test(testTo.trim())

  const stash = hasStash()

  return (
    <div className="flex flex-col gap-8 pb-4">
      {stash && (
        <Callout
          tone="accent"
          title={`Rascunho guardado: ${stash.name.trim() || 'Nova rotina'}`}
          action={
            <Button
              variant="link"
              size="sm"
              onClick={() => navigate(stash.key === 'new' ? ROUTES.newRoutine : ROUTES.routine(stash.key))}
            >
              Voltar para a rotina
            </Button>
          }
        >
          Salve o e-mail e volte para terminar a rotina — nada do que você preencheu foi perdido.
        </Callout>
      )}
      {!configured && !dirty && (
        <Callout tone="info" title="E-mail ainda não configurado">
          Configure o SMTP para avisar seus clientes ao fim de cada backup. Escolha o provedor abaixo para
          começar.
        </Callout>
      )}

      <SettingsGroup title="Provedor" description="Preenche servidor, porta e segurança automaticamente.">
        <div className="flex flex-col gap-4 p-5">
          <RadioGroup.Root
            value={draft.preset}
            onValueChange={pickPreset}
            aria-label="Provedor de e-mail"
            className="flex flex-wrap gap-1.5"
            orientation="horizontal"
          >
            {SMTP_PRESETS.map((p) => (
              <RadioGroup.Item
                key={p.id}
                value={p.id}
                className={cn(
                  'h-8 rounded-md border px-2.5 text-small font-medium transition-[background-color,border-color,color] duration-[120ms]',
                  'border-border-strong bg-surface-raised text-fg-muted shadow-xs hover:text-fg',
                  'data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft data-[state=checked]:text-accent-text'
                )}
              >
                {p.label}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          {preset?.hint && <Callout tone="info">{preset.hint}</Callout>}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Servidor de envio (SMTP)">
        <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-4 p-5">
          <Field label="Servidor">
            {(id) => (
              <Input
                id={id}
                value={draft.host}
                placeholder="smtp.seuprovedor.com.br"
                className="font-mono text-[13px]"
                onChange={(e) => set('host', e.target.value.trim())}
                spellCheck={false}
              />
            )}
          </Field>
          <Field label="Porta">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                className="tnum"
                value={String(draft.port || '')}
                onChange={(e) => set('port', Number(e.target.value.replace(/\D/g, '').slice(0, 5)) || 0)}
              />
            )}
          </Field>
          <Field label="Segurança" description="465 = SSL/TLS · 587 = STARTTLS" className="col-span-2">
            {() => (
              <Segmented<SmtpSecurity>
                label="Segurança"
                value={draft.security}
                onChange={(v) => set('security', v)}
                className="w-[320px]"
                options={[
                  { value: 'ssl', label: 'SSL/TLS' },
                  { value: 'starttls', label: 'STARTTLS' },
                  { value: 'none', label: 'Nenhuma' }
                ]}
              />
            )}
          </Field>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <Field label="Usuário">
              {(id) => (
                <Input
                  id={id}
                  value={draft.user}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="voce@empresa.com.br"
                  onChange={(e) => set('user', e.target.value.trim())}
                />
              )}
            </Field>
            <Field
              label="Senha"
              description={
                needsPassword ? (
                  <span className="flex items-center gap-1.5 text-warning">
                    <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                    Digite a senha novamente para o novo servidor.
                  </span>
                ) : draft.password === undefined && keepsSavedPassword ? (
                  'Deixe em branco para manter a senha salva.'
                ) : undefined
              }
            >
              {(id) => (
                <div className="relative">
                  <Input
                    id={id}
                    type={showPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={draft.password ?? ''}
                    placeholder={keepsSavedPassword ? '(senha salva)' : 'Senha ou senha de app'}
                    className="pr-9"
                    invalid={needsPassword && dirty}
                    // apagar tudo volta a "manter a senha salva" (string vazia apagaria a senha)
                    onChange={(e) => set('password', e.target.value === '' ? undefined : e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:text-fg"
                  >
                    {showPass ? (
                      <EyeOff className="size-4" strokeWidth={1.75} />
                    ) : (
                      <Eye className="size-4" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              )}
            </Field>
          </div>
        </div>
        <SettingsRow
          label="Ignorar erros de certificado"
          description="Só ligue se confiar no servidor (ex.: servidor interno com certificado próprio)."
          htmlFor="invalid-cert"
        >
          <Switch
            id="invalid-cert"
            checked={draft.allowInvalidCert}
            onCheckedChange={(v) => set('allowInvalidCert', v)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Remetente">
        <div className="grid grid-cols-2 gap-4 p-5">
          <Field label="Nome do remetente">
            {(id) => (
              <Input
                id={id}
                value={draft.fromName}
                placeholder="BC Backup – Nome do cliente"
                onChange={(e) => set('fromName', e.target.value)}
              />
            )}
          </Field>
          <Field
            label="E-mail do remetente"
            error={fromMismatch ? 'Use o mesmo e-mail da conta — muitos provedores recusam outro.' : null}
            description="Use o mesmo e-mail da conta autenticada."
          >
            {(id) => (
              <Input
                id={id}
                value={draft.fromEmail}
                placeholder="voce@empresa.com.br"
                onChange={(e) => set('fromEmail', e.target.value.trim())}
              />
            )}
          </Field>
          <Field
            label="Responder para"
            description="Opcional — ex.: o e-mail do suporte."
            className="col-span-1"
          >
            {(id) => (
              <Input
                id={id}
                value={draft.replyTo}
                placeholder="suporte@empresa.com.br"
                onChange={(e) => set('replyTo', e.target.value.trim())}
              />
            )}
          </Field>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Testar envio" description="Usa os dados acima, mesmo antes de salvar.">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-end gap-3">
            <Field label="Enviar para" className="flex-1">
              {(id) => (
                <Input
                  id={id}
                  value={testTo}
                  placeholder="voce@empresa.com.br"
                  onChange={(e) => setTestTo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && testValid && !needsPassword && void test()}
                />
              )}
            </Field>
            <Button
              icon={Send}
              loading={testing}
              disabled={!testValid || !draft.host || needsPassword}
              onClick={() => void test()}
            >
              Enviar e-mail de teste
            </Button>
          </div>
          {needsPassword && !result && (
            <p className="flex items-center gap-1.5 text-caption text-fg-subtle">
              <TriangleAlert className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
              Digite a senha acima para testar com o novo servidor ou usuário.
            </p>
          )}
          {result && (
            <Callout
              tone={result.ok ? 'success' : 'danger'}
              title={result.ok ? 'Tudo certo!' : 'Não foi possível enviar'}
            >
              {result.message}
            </Callout>
          )}
        </div>
      </SettingsGroup>

      <div
        className={cn(
          'sticky bottom-4 z-10 transition-[opacity,transform] duration-[180ms] ease-out',
          dirty ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
        )}
        aria-hidden={!dirty}
      >
        <Card className="flex items-center gap-3 px-4 py-3 shadow-pop">
          {needsPassword ? (
            <TriangleAlert className="size-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
          ) : (
            <MailCheck className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
          )}
          <span className="flex-1 text-small text-fg-muted" role="status">
            {needsPassword
              ? 'Digite a senha novamente: ela só vale para o servidor e o usuário em que foi salva.'
              : 'Você tem alterações não salvas.'}
          </span>
          <Button variant="ghost" onClick={() => setDraft(toInput(saved))} tabIndex={dirty ? 0 : -1}>
            Descartar
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={needsPassword}
            onClick={() => void save()}
            tabIndex={dirty ? 0 : -1}
          >
            Salvar
          </Button>
        </Card>
      </div>
    </div>
  )
}
