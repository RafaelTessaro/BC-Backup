import { Archive, ShieldCheck } from 'lucide-react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import { formatBytes } from '@shared/format'
import { Callout } from '@renderer/components/ui/Callout'
import { Card } from '@renderer/components/ui/Card'
import { NumberStepper } from '@renderer/components/ui/NumberStepper'
import { Switch } from '@renderer/components/ui/Switch'
import { cn } from '@renderer/lib/cn'
import { formatNumber, plural } from '@renderer/lib/format'
import { runsPerDay, type Update } from '../model'
import type { SourceSizes } from '../sizes'
import { IssueList, OptionRow } from './shared'

const QUICK = [7, 15, 30, 90, 365]

export function RetentionStep({
  draft,
  update,
  sizes,
  issues
}: {
  draft: RoutineInput
  update: Update
  sizes: SourceSizes
  issues: ValidationIssue[]
}) {
  const r = draft.retention
  const set = (patch: Partial<RoutineInput['retention']>): void =>
    update((d) => ({ ...d, retention: { ...d.retention, ...patch } }))

  const perDay = runsPerDay(draft.schedule)
  const versions = perDay === null ? null : Math.max(r.minKeep, Math.round(perDay * r.days))
  const bytesEach = sizes.total ? sizes.total.bytes * (draft.mode === 'zip' ? 0.6 : 1) : null
  const totalBytes = versions !== null && bytesEach !== null ? versions * bytesEach : null

  return (
    <div className="flex flex-col gap-6">
      <Card className="divide-y divide-border">
        <OptionRow
          title="Apagar backups antigos automaticamente"
          description="Recomendado. Sem isso, os backups se acumulam até o disco encher."
        >
          <Switch
            label="Apagar backups antigos"
            checked={r.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </OptionRow>
        {r.enabled && (
          <>
            <div className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-small font-medium text-fg">Apagar cópias com mais de</p>
                  <p className="mt-0.5 text-caption text-fg-subtle">
                    Dias de calendário — hoje conta como o primeiro.
                  </p>
                </div>
                <NumberStepper
                  label="Dias"
                  value={r.days}
                  min={1}
                  max={3650}
                  suffix={r.days === 1 ? 'dia' : 'dias'}
                  onChange={(days) => set({ days })}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => set({ days: d })}
                    className={cn(
                      'h-7 rounded-sm border px-2.5 text-caption font-medium transition-colors duration-[120ms]',
                      r.days === d
                        ? 'border-accent bg-accent-soft text-accent-text'
                        : 'border-border-strong bg-surface-raised text-fg-muted hover:text-fg'
                    )}
                  >
                    {d === 365 ? '1 ano' : `${d} dias`}
                  </button>
                ))}
              </div>
            </div>
            <OptionRow
              title="Sempre manter ao menos"
              description="Trava de segurança: mesmo com o computador dias desligado, as últimas cópias nunca são apagadas."
            >
              <NumberStepper
                label="Cópias mínimas"
                value={r.minKeep}
                min={1}
                max={99}
                suffix={r.minKeep === 1 ? 'cópia' : 'cópias'}
                onChange={(minKeep) => set({ minKeep })}
              />
            </OptionRow>
          </>
        )}
      </Card>

      {r.enabled ? (
        <div className="flex gap-3 rounded-lg bg-accent-soft p-4">
          <Archive className="mt-0.5 size-4 shrink-0 text-accent-text" strokeWidth={1.75} />
          <div className="flex flex-col gap-1">
            <p className="text-small font-medium text-fg">
              {versions === null ? (
                <>Como a rotina é manual, o número de versões depende de quantas vezes você executar.</>
              ) : (
                <>
                  Com base no agendamento, você terá{' '}
                  <span className="text-accent-text">~{plural(versions, 'versão', 'versões')}</span>
                  {totalBytes !== null && (
                    <>
                      {' '}
                      ocupando <span className="text-accent-text">~{formatBytes(totalBytes)}</span>
                    </>
                  )}{' '}
                  em cada destino.
                </>
              )}
            </p>
            <p className="text-caption text-fg-muted">
              Backups com mais de {plural(r.days, 'dia', 'dias')} são apagados, mas nunca menos que as{' '}
              {formatNumber(r.minKeep)} mais recentes.
            </p>
          </div>
        </div>
      ) : (
        <Callout tone="warning">Sem retenção, os backups se acumulam até encher o disco de destino.</Callout>
      )}

      <ul className="flex flex-col gap-2 text-small text-fg-muted">
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          Um backup antigo só é apagado depois que um novo terminar com sucesso naquele destino.
        </li>
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          Só pastas criadas pelo BC Backup são apagadas — nada mais no disco é tocado.
        </li>
      </ul>
      <IssueList issues={issues} />
    </div>
  )
}
