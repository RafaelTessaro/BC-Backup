import { Archive, FolderOutput, ShieldCheck } from 'lucide-react'
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

/**
 * Quantos backups ficam guardados no pior caso (doc 01 §6): os dos últimos N dias de calendário
 * (hoje conta como o 1º), nunca menos que o mínimo. Em regime, logo após o último backup do dia,
 * há N × (execuções por dia); arredondamos para cima nos agendamentos semanais.
 */
function keptBackups(perDay: number | null, days: number, minKeep: number): number | null {
  if (perDay === null) return null
  return Math.max(minKeep, Math.ceil(perDay * days - 1e-9))
}

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
  const byDays = perDay === null ? null : Math.ceil(perDay * r.days - 1e-9)
  const kept = keptBackups(perDay, r.days, r.minKeep)
  const minWins = byDays !== null && r.minKeep > byDays
  const bytesEach = sizes.total ? sizes.total.bytes * (draft.mode === 'zip' ? 0.6 : 1) : null
  const totalBytes = kept !== null && bytesEach !== null ? kept * bytesEach : null

  return (
    <div className="flex flex-col gap-6">
      {draft.moveSources?.enabled && (
        <Callout tone="accent" icon={FolderOutput}>
          Com “Mover”, os backups do sistema ficam só nos destinos: a retenção decide por quanto tempo.
        </Callout>
      )}
      <Card className="divide-y divide-border">
        <OptionRow
          title="Apagar backups antigos automaticamente"
          description="Recomendado. Sem isso, os backups se acumulam até o disco encher."
        >
          <Switch
            label="Apagar backups antigos automaticamente"
            checked={r.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
          />
        </OptionRow>
        {r.enabled && (
          <>
            <div className="flex flex-col gap-3 px-5 py-4">
              <div className="flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <p className="text-small font-medium text-fg">Guardar backups por</p>
                  <p className="mt-0.5 text-caption text-fg-subtle">
                    Hoje conta como o 1º dia: no {formatNumber(r.days + 1)}º dia, o backup mais antigo é
                    apagado.
                  </p>
                </div>
                <NumberStepper
                  className="shrink-0"
                  label="Dias para guardar os backups"
                  value={r.days}
                  min={1}
                  max={3650}
                  suffix={r.days === 1 ? 'dia' : 'dias'}
                  onChange={(days) => set({ days })}
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de dias">
                {QUICK.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={r.days === d}
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
              title="Manter sempre no mínimo"
              description="Trava de segurança: se o computador ficar dias desligado, os backups mais recentes nunca são apagados."
            >
              <NumberStepper
                label="Mínimo de backups guardados"
                value={r.minKeep}
                min={1}
                max={99}
                suffix={r.minKeep === 1 ? 'backup' : 'backups'}
                onChange={(minKeep) => set({ minKeep })}
              />
            </OptionRow>
          </>
        )}
      </Card>

      {r.enabled ? (
        <div className="flex gap-3 rounded-lg bg-accent-soft p-4" role="status">
          <Archive className="mt-0.5 size-4 shrink-0 text-accent-text" strokeWidth={1.75} />
          <div className="flex flex-col gap-1">
            {kept === null ? (
              <>
                <p className="text-small font-medium text-fg">
                  Ficam os backups dos últimos {plural(r.days, 'dia', 'dias')}, no mínimo{' '}
                  {plural(r.minKeep, 'backup', 'backups')}.
                </p>
                <p className="text-caption text-fg-muted">
                  Como a rotina é manual, a quantidade depende de quantas vezes você executar.
                </p>
              </>
            ) : (
              <>
                <p className="text-small font-medium text-fg">
                  Até <span className="text-accent-text">{plural(kept, 'backup', 'backups')}</span> em cada
                  destino
                  {totalBytes !== null && (
                    <>
                      , ocupando <span className="text-accent-text">~{formatBytes(totalBytes)}</span>
                    </>
                  )}
                  .
                </p>
                <p className="text-caption text-fg-muted">
                  {minWins
                    ? `O mínimo de ${formatNumber(r.minKeep)} backups vale mais que o limite de dias: os ${formatNumber(r.minKeep)} mais recentes ficam sempre guardados.`
                    : bytesEach !== null
                      ? `Durante a cópia, cada destino precisa de espaço para mais um backup (~${formatBytes(bytesEach)}).`
                      : 'Durante a cópia, cada destino precisa de espaço para mais um backup.'}
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <Callout tone="warning">Sem retenção, os backups se acumulam até encher o disco de destino.</Callout>
      )}

      <ul className="flex flex-col gap-2 text-small text-fg-muted">
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          Um backup antigo só é apagado depois que um novo termina com sucesso naquele destino.
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
