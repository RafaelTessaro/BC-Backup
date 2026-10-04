import type { ReactNode } from 'react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import { formatBytes } from '@shared/format'
import { describeSchedule, nextRunAt } from '@shared/schedule'
import { Button } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { Card } from '@renderer/components/ui/Card'
import { PathText } from '@renderer/components/ui/PathText'
import { Switch } from '@renderer/components/ui/Switch'
import { useNow } from '@renderer/lib/clock'
import { cn } from '@renderer/lib/cn'
import { formatWhen, plural } from '@renderer/lib/format'
import { STEPS, ZIP_LEVELS, shortenPaths, type StepId } from '../model'
import type { SourceSizes } from '../sizes'
import { OptionRow } from './shared'

function Row({ label, children, onEdit }: { label: string; children: ReactNode; onEdit: () => void }) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)_auto] items-start gap-4 px-5 py-3.5">
      <span className="pt-px text-small text-fg-subtle">{label}</span>
      <div className="min-w-0 text-small text-fg">{children}</div>
      <Button
        variant="ghost"
        size="sm"
        className="-my-1 h-7"
        aria-label={`Editar ${label.toLowerCase()}`}
        onClick={onEdit}
      >
        Editar
      </Button>
    </div>
  )
}

const zipLabel = (level: number): string =>
  (ZIP_LEVELS.find((z) => Number(z.value) === level)?.label ?? 'Equilibrada').toLowerCase()
const ATTACH = { never: '', onFailure: ' · log anexado se falhar', always: ' · log sempre anexado' }

export function ReviewStep({
  draft,
  update,
  sizes,
  issues,
  goTo,
  isNew
}: {
  draft: RoutineInput
  update: (fn: (d: RoutineInput) => RoutineInput) => void
  sizes: SourceSizes
  issues: ValidationIssue[]
  goTo: (s: StepId) => void
  isNew: boolean
}) {
  const now = useNow()
  const next = draft.enabled ? nextRunAt(draft.schedule, now) : null
  const folders = draft.sources.filter((s) => s.kind === 'folder').length
  const files = draft.sources.length - folders
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')
  const n = draft.notification
  const stepLabel = (id: StepId): string => STEPS.find((s) => s.id === id)?.label ?? id
  const paths = [...draft.sources.map((s) => s.path), ...draft.destinations.map((d) => d.path)]
  const text = (i: ValidationIssue): string => shortenPaths(i.message, paths)

  return (
    <div className="flex flex-col gap-6">
      {errors.length > 0 && (
        <Callout
          tone="danger"
          title={errors.length === 1 ? 'Falta 1 ajuste' : `Faltam ${errors.length} ajustes`}
        >
          <ul className="mt-1 flex flex-col gap-1">
            {errors.map((e) => (
              <li key={e.message} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-fg">{text(e)}</span>
                <Button variant="link" size="sm" onClick={() => goTo(e.step)}>
                  Ir para {stepLabel(e.step)}
                </Button>
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {warnings.length > 0 && (
        <Callout tone="warning" title="Vale conferir">
          <ul className="mt-1 flex flex-col gap-1">
            {warnings.map((e) => (
              <li key={e.message} className="break-words text-fg">
                {text(e)}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <Card className="divide-y divide-border">
        <Row label="Nome" onEdit={() => goTo('origem')}>
          <span className="font-medium">
            {draft.name.trim() || <span className="text-danger">Sem nome</span>}
          </span>
        </Row>
        <Row label="Origem" onEdit={() => goTo('origem')}>
          <p>
            {[
              folders ? plural(folders, 'pasta', 'pastas') : null,
              files ? plural(files, 'arquivo', 'arquivos') : null
            ]
              .filter(Boolean)
              .join(' e ') || <span className="text-danger">Nada selecionado</span>}
            {sizes.total && <span className="text-fg-muted"> · ≈ {formatBytes(sizes.total.bytes)}</span>}
          </p>
          <div className="mt-1 flex flex-col gap-0.5">
            {draft.sources.slice(0, 4).map((s) => (
              <PathText key={s.id} path={s.path} className="text-fg-subtle" />
            ))}
            {draft.sources.length > 4 && (
              <span className="text-caption text-fg-subtle">e mais {draft.sources.length - 4}</span>
            )}
          </div>
          {draft.moveSources?.enabled && (
            <p className="mt-1.5 text-fg">
              Mover: apaga da origem depois de copiar e conferir
              <span className="text-fg-muted">
                {' '}
                · arquivos sem alteração há {plural(draft.moveSources.minAgeMinutes, 'minuto', 'minutos')}
                {draft.moveSources.warnIfEmpty ? ' · avisa se não houver arquivo novo' : ''}
              </span>
            </p>
          )}
        </Row>
        <Row label="Destinos" onEdit={() => goTo('destinos')}>
          {draft.destinations.length === 0 ? (
            <span className="text-danger">Nenhum destino</span>
          ) : (
            <div className="flex flex-col gap-0.5">
              {draft.destinations.map((d) => (
                <span key={d.id} className="flex min-w-0 items-baseline gap-2">
                  {d.label?.trim() && <span className="shrink-0">{d.label.trim()}</span>}
                  <span
                    className={cn(
                      'min-w-0 truncate font-mono text-mono',
                      d.label?.trim() ? 'text-fg-subtle' : 'text-fg'
                    )}
                    title={d.path}
                    data-selectable
                  >
                    {d.path}
                  </span>
                  {d.enabled === false && (
                    <span className="shrink-0 text-caption text-fg-subtle">(desligado)</span>
                  )}
                </span>
              ))}
            </div>
          )}
          <p className="mt-1 text-fg-muted">
            {draft.mode === 'zip'
              ? `Compactar em ZIP (compressão ${zipLabel(draft.zipLevel)})`
              : 'Pastas (cópia simples)'}{' '}
            · verificação completa de cada arquivo
          </p>
        </Row>
        <Row label="Agendamento" onEdit={() => goTo('agendamento')}>
          <p>{describeSchedule(draft.schedule)}</p>
          {!draft.enabled ? (
            <p className="text-warning">Pausada: não roda até você ativar a rotina.</p>
          ) : (
            next && <p className="text-fg-muted">Próxima execução: {formatWhen(next, now)}</p>
          )}
        </Row>
        <Row label="Retenção" onEdit={() => goTo('retencao')}>
          {draft.retention.enabled ? (
            <p>
              Guardar por {plural(draft.retention.days, 'dia', 'dias')}
              <span className="text-fg-muted">
                {' '}
                · no mínimo {plural(draft.retention.minKeep, 'backup', 'backups')}
              </span>
            </p>
          ) : (
            <p className="text-fg-muted">Desligada: nenhum backup é apagado</p>
          )}
        </Row>
        <Row label="Notificação" onEdit={() => goTo('notificacao')}>
          {n.enabled ? (
            <p>
              E-mail para{' '}
              {n.recipients.length ? n.recipients.join(', ') : <span className="text-danger">ninguém</span>}
              <span className="text-fg-muted">
                {n.bcc.length > 0 && ` · Cco: ${n.bcc.join(', ')}`} ·{' '}
                {n.onSuccess ? 'sempre' : 'só com avisos ou falhas'}
                {ATTACH[n.attachLog]}
              </span>
            </p>
          ) : (
            <p className="text-fg-muted">Desligada</p>
          )}
        </Row>
      </Card>

      <Card>
        <OptionRow
          title="Ativar rotina"
          description={
            draft.enabled
              ? 'A rotina segue o agendamento assim que for salva.'
              : 'Desligada, a rotina fica pausada até você retomar.'
          }
        >
          <Switch
            label="Ativar rotina"
            checked={draft.enabled}
            onCheckedChange={(enabled) => update((d) => ({ ...d, enabled }))}
          />
        </OptionRow>
      </Card>
      {isNew && (
        <p className="text-caption text-fg-subtle">
          Você pode mudar qualquer detalhe depois, em Rotinas → {draft.name.trim() || 'esta rotina'}.
        </p>
      )}
    </div>
  )
}
