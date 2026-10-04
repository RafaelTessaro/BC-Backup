import {
  Check,
  CircleCheck,
  CircleX,
  HardDrive,
  Server,
  Square,
  TriangleAlert,
  Usb,
  type LucideIcon
} from 'lucide-react'
import { useState } from 'react'
import type { Routine, RunPhase, RunProgress, RunSummary } from '@shared/types'
import { formatBytes, formatDuration, formatSpeed } from '@shared/format'
import { Button } from '@renderer/components/ui/Button'
import { ConfirmDialog } from '@renderer/components/ui/Dialog'
import { Drawer } from '@renderer/components/ui/Drawer'
import { PathText } from '@renderer/components/ui/PathText'
import { ProgressBar } from '@renderer/components/ui/ProgressBar'
import { StatusPill } from '@renderer/components/ui/StatusPill'
import { TruncatedText } from '@renderer/components/ui/Tooltip'
import { cancelRun } from '@renderer/lib/actions'
import { cn } from '@renderer/lib/cn'
import { formatEta, formatNumber, formatPercent, plural } from '@renderer/lib/format'
import { useTick } from '@renderer/lib/hooks'
import { destinationLabel, overallPercent } from '@renderer/lib/progress'
import { PHASE_LABEL, ROUTINE_STATUS, RUN_STATUS } from '@renderer/lib/status'
import { closeLiveRun, openRunDetail, progressFor, useApp } from '@renderer/lib/store'

const ORDER: RunPhase[] = [
  'queued',
  'scanning',
  'copying',
  'verifying',
  'pruning',
  'moving',
  'notifying',
  'done'
]

function Stat({
  label,
  value,
  sub,
  pending
}: {
  label: string
  value: string
  sub?: string
  /** Ainda sem dado (preparando): traço discreto no lugar de "0 / 0". */
  pending?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption font-medium text-fg-subtle">{label}</span>
      <span className="truncate text-body font-medium text-fg tnum">
        {pending ? (
          <span className="font-normal text-fg-subtle">—</span>
        ) : (
          <>
            {value}
            {sub && <span className="font-normal text-fg-subtle"> {sub}</span>}
          </>
        )}
      </span>
    </div>
  )
}

function destIcon(path: string, removable?: boolean): LucideIcon {
  if (path.startsWith('\\\\')) return Server
  return removable ? Usb : HardDrive
}

function PhaseSteps({ p, routine }: { p: RunProgress; routine?: Routine }) {
  const steps: { phase: RunPhase; label: string; detail?: string }[] = [
    { phase: 'scanning', label: 'Preparando', detail: 'Contando arquivos e conferindo espaço' },
    {
      phase: 'copying',
      label: 'Copiando',
      detail:
        p.destinationCount > 1 ? `Destino ${p.destinationIndex + 1} de ${p.destinationCount}` : undefined
    }
  ]
  steps.push({
    phase: 'verifying',
    label: 'Verificando a cópia',
    detail: 'Relendo e comparando cada arquivo'
  })
  if (!routine || routine.retention.enabled)
    steps.push({ phase: 'pruning', label: 'Limpando cópias antigas' })
  if (routine?.moveSources?.enabled || p.phase === 'moving')
    steps.push({
      phase: 'moving',
      label: 'Removendo da origem',
      detail: 'Apagando o que já foi copiado e conferido'
    })
  if (routine?.notification.enabled) steps.push({ phase: 'notifying', label: 'Enviando e-mail' })
  const current = ORDER.indexOf(p.phase)
  return (
    <ol className="relative flex flex-col">
      {steps.map((s, i) => {
        const idx = ORDER.indexOf(s.phase)
        const done = current > idx
        const active = current === idx
        return (
          <li key={s.phase} className="relative flex gap-3 pb-3 last:pb-0">
            {i < steps.length - 1 && (
              <span
                className={cn(
                  'absolute top-5 bottom-0 left-[9.5px] w-px',
                  done ? 'bg-accent/40' : 'bg-border'
                )}
                aria-hidden
              />
            )}
            <span
              className={cn(
                'relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full',
                done && 'bg-accent-soft text-accent-text',
                active && 'bg-accent text-accent-foreground',
                !done && !active && 'border border-border-strong bg-surface-raised'
              )}
            >
              {done ? (
                <Check className="size-3" strokeWidth={2.5} />
              ) : active ? (
                <span className="size-1.5 rounded-full bg-current" />
              ) : null}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pt-px">
              <span
                className={cn(
                  'text-small',
                  active ? 'font-medium text-fg' : done ? 'text-fg-muted' : 'text-fg-subtle'
                )}
              >
                {s.label}
              </span>
              {s.detail && (active || done) && (
                <span className="text-caption text-fg-subtle">{s.detail}</span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Running({ p, routine }: { p: RunProgress; routine?: Routine }) {
  const now = useTick(1000)
  const pct = overallPercent(p)
  const destPct = p.bytesTotal > 0 ? (p.bytesDone / p.bytesTotal) * 100 : 0
  const queued = p.phase === 'queued'
  const preparing = p.phase === 'scanning' || queued
  const dest = destinationLabel(p)
  const elapsed = now.getTime() - new Date(p.startedAt).getTime()
  const drives = useApp((s) => s.drives)
  const dests = routine?.destinations.filter((d) => d.enabled !== false) ?? []

  return (
    <div className="flex flex-col gap-6 px-5 py-5">
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <span className="text-[32px] leading-10 font-semibold tracking-[-0.02em] text-fg tnum">
            {queued ? 'Na fila' : pct === undefined ? 'Preparando' : formatPercent(pct)}
          </span>
          <span className="pb-1 text-small text-fg-muted tnum">
            {preparing
              ? ''
              : p.phase === 'copying'
                ? p.etaMs === undefined
                  ? 'Calculando…'
                  : `${formatEta(p.etaMs)} restantes`
                : PHASE_LABEL[p.phase]}
          </span>
        </div>
        <ProgressBar
          value={queued ? 0 : preparing ? undefined : pct}
          size="md"
          label={`Progresso do backup de ${p.routineName}`}
          valueText={
            queued
              ? 'Na fila'
              : preparing || pct === undefined
                ? 'Preparando'
                : `${formatPercent(pct)}${p.phase === 'copying' && p.etaMs !== undefined ? ` · ${formatEta(p.etaMs)} restantes` : ''}`
          }
        />
        <p className="text-small text-fg-muted tnum">
          {queued
            ? 'Aguardando a execução atual terminar. Só um backup roda por vez.'
            : preparing
              ? 'Contando arquivos…'
              : p.phase === 'copying'
                ? `Copiando ${formatNumber(p.filesDone)} de ${plural(p.filesTotal, 'arquivo', 'arquivos')}${dest ? ` · ${dest.toLowerCase()}` : ''}`
                : p.phase === 'moving'
                  ? `Removendo da origem · ${formatNumber(p.filesDone)} de ${plural(p.filesTotal, 'arquivo conferido', 'arquivos conferidos')}`
                  : PHASE_LABEL[p.phase]}
        </p>
      </section>

      {!queued && (
        <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg bg-surface-sunken p-4 dark:bg-surface">
          <Stat
            label={
              p.phase === 'moving' ? 'Conferidos na origem' : dest ? 'Arquivos · neste destino' : 'Arquivos'
            }
            value={formatNumber(p.filesDone)}
            sub={`/ ${formatNumber(p.filesTotal)}`}
            pending={preparing && p.filesTotal === 0}
          />
          <Stat
            label={dest ? 'Dados · neste destino' : 'Dados'}
            value={formatBytes(p.bytesDone)}
            sub={`/ ${formatBytes(p.bytesTotal)}`}
            pending={preparing && p.bytesTotal === 0}
          />
          <Stat label="Velocidade" value={formatSpeed(p.speed)} pending={!(p.speed > 0)} />
          <Stat label="Tempo decorrido" value={formatDuration(Math.max(0, elapsed))} />
        </section>
      )}

      {p.currentFile && (p.phase === 'copying' || p.phase === 'moving') && (
        <section className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-fg-subtle">
            {p.phase === 'moving' ? 'Conferindo e apagando' : 'Arquivo atual'}
          </span>
          <div className="rounded-md border border-border bg-surface px-3 py-2">
            <PathText path={p.currentFile} className="text-fg-muted" />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-caption font-medium text-fg-subtle">Etapas</h3>
        <PhaseSteps p={p} routine={routine} />
      </section>

      {dests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-caption font-medium text-fg-subtle">Destinos</h3>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {dests.map((d, i) => {
              const drive = drives.find((x) =>
                d.path.toUpperCase().startsWith(x.path.toUpperCase().replace(/\\$/, ''))
              )
              const Icon = destIcon(d.path, drive?.removable)
              const state =
                i < p.destinationIndex ||
                (i === p.destinationIndex && ORDER.indexOf(p.phase) > ORDER.indexOf('copying'))
                  ? 'done'
                  : i === p.destinationIndex && p.phase === 'copying'
                    ? 'active'
                    : 'waiting'
              return (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Icon className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-small font-medium text-fg">
                      {d.label || drive?.label || d.path}
                    </p>
                    <PathText path={d.path} className="text-fg-subtle" />
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-caption font-medium tnum',
                      state === 'done' && 'text-success',
                      state === 'active' && 'text-accent-text',
                      state === 'waiting' && 'text-fg-subtle'
                    )}
                  >
                    {state === 'done'
                      ? 'Concluído'
                      : state === 'active'
                        ? formatPercent(destPct)
                        : 'Aguardando'}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}

function Finished({ r }: { r: RunSummary }) {
  const meta = RUN_STATUS[r.status]
  const Icon = r.status === 'success' ? CircleCheck : r.status === 'failed' ? CircleX : TriangleAlert
  const tone =
    r.status === 'success'
      ? 'bg-success-soft text-success'
      : r.status === 'failed'
        ? 'bg-danger-soft text-danger'
        : r.status === 'warning'
          ? 'bg-warning-soft text-warning'
          : 'bg-surface-hover text-fg-muted'
  return (
    <div className="flex flex-col gap-6 px-5 py-6">
      <div className="flex items-center gap-4">
        <span className={cn('flex size-11 items-center justify-center rounded-full', tone)}>
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
        <div>
          <p className="text-section font-semibold text-fg">
            {r.status === 'success'
              ? 'Backup concluído'
              : r.status === 'warning' && r.notice && !r.filesCopied
                ? 'Nenhum backup novo'
                : r.status === 'warning'
                  ? `Concluído com ${plural(r.warnings, 'aviso', 'avisos')}`
                  : r.status === 'failed'
                    ? 'O backup falhou'
                    : meta.label}
          </p>
          <p className="text-small text-fg-muted">
            {r.durationMs !== undefined ? `Levou ${formatDuration(r.durationMs)}` : null}
          </p>
        </div>
      </div>
      {r.errorMessage && (
        <p className="rounded-md bg-danger-soft p-3 text-small text-danger">{r.errorMessage}</p>
      )}
      {r.notice && (
        <p
          className={cn(
            'rounded-md p-3 text-small',
            r.status === 'warning' ? 'bg-warning-soft text-fg' : 'bg-surface-hover text-fg-muted'
          )}
        >
          {r.notice}
        </p>
      )}
      <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg bg-surface-sunken p-4 dark:bg-surface">
        <Stat label="Arquivos copiados" value={formatNumber(r.filesCopied)} />
        <Stat label="Dados" value={formatBytes(r.bytesCopied)} />
        {r.filesMoved !== undefined ? (
          <Stat
            label="Removidos da origem"
            value={formatNumber(r.filesMoved)}
            sub={r.bytesMoved ? `· ${formatBytes(r.bytesMoved)}` : undefined}
          />
        ) : (
          <Stat label="Avisos" value={formatNumber(r.warnings)} />
        )}
        <Stat label="Destinos" value={formatNumber(r.destinationCount)} />
      </section>
    </div>
  )
}

/** Drawer de execução em andamento (§7d). */
export function LiveRunDrawer() {
  const routineId = useApp((s) => s.liveRoutineId)
  const progress = useApp((s) => (routineId ? progressFor(s.progress, routineId) : undefined))
  const finished = useApp((s) => (routineId ? s.finished[routineId] : undefined))
  const routine = useApp((s) => s.routines.find((r) => r.id === routineId))
  const [confirmStop, setConfirmStop] = useState(false)
  const name = progress?.routineName ?? finished?.routineName ?? routine?.name ?? ''
  const status = progress
    ? progress.phase === 'queued'
      ? ROUTINE_STATUS.queued
      : RUN_STATUS.running
    : finished
      ? RUN_STATUS[finished.status]
      : null

  const announcement = progress
    ? progress.phase === 'queued'
      ? `${name}: na fila`
      : `${name}: ${PHASE_LABEL[progress.phase].replace('…', '')}`
    : finished
      ? `${name}: ${RUN_STATUS[finished.status].label}`
      : ''

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {routineId !== null ? announcement : ''}
      </div>
      <Drawer
        open={routineId !== null}
        onOpenChange={(open) => !open && closeLiveRun()}
        title={
          <>
            <TruncatedText>{name}</TruncatedText>
            {status && <StatusPill meta={status} />}
          </>
        }
        actions={
          progress ? (
            <Button variant="danger" size="sm" icon={Square} onClick={() => setConfirmStop(true)}>
              Parar
            </Button>
          ) : undefined
        }
        footer={
          !progress && finished ? (
            <>
              <Button variant="ghost" onClick={closeLiveRun}>
                Fechar
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  closeLiveRun()
                  openRunDetail(finished.id)
                }}
              >
                Ver detalhes
              </Button>
            </>
          ) : undefined
        }
      >
        {progress ? (
          <Running p={progress} routine={routine} />
        ) : finished ? (
          <Finished r={finished} />
        ) : (
          <p className="px-5 py-6 text-small text-fg-muted">Nenhuma execução em andamento.</p>
        )}
      </Drawer>
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`Parar “${name}”?`}
        description={
          routine?.moveSources?.enabled
            ? 'Nada mais é apagado da origem: o que ainda não foi removido fica lá para a próxima execução. A rotina continua agendada normalmente.'
            : 'A cópia parcial será mantida no destino. A rotina continua agendada normalmente.'
        }
        confirmLabel="Parar backup"
        onConfirm={() => (routineId ? cancelRun(routineId) : undefined)}
      />
    </>
  )
}
