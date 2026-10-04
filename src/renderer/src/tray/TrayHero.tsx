// Hero do painel da bandeja: a frase de status (05-painel-da-bandeja §3 e §4). A regra de qual
// estado mostrar é a mesma do ícone da bandeja e do Painel (summarizeHealth em @shared/health).
import {
  ArrowRight,
  Clock,
  FolderPlus,
  LoaderCircle,
  Pause,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Health, HealthKind } from '@shared/health'
import { ROUTES } from '@shared/routes'
import type { Routine, RunSummary } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { ProgressBar } from '@renderer/components/ui/ProgressBar'
import { RelativeTime } from '@renderer/components/ui/RelativeTime'
import { TruncatedText } from '@renderer/components/ui/Tooltip'
import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import { formatEta, formatNumber, formatPercent, formatSize, formatWhen, plural } from '@renderer/lib/format'
import { destinationLabel, overallPercent } from '@renderer/lib/progress'
import { PHASE_LABEL } from '@renderer/lib/status'

export type HeroTone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral'

export const HERO_TONE: Record<HealthKind, HeroTone> = {
  running: 'accent',
  queued: 'accent',
  failed: 'danger',
  warning: 'warning',
  empty: 'neutral',
  paused: 'neutral',
  ok: 'success'
}

const CIRCLE: Record<HeroTone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent-text',
  neutral: 'bg-surface-hover text-fg-muted'
}

/** Brilho suave atrás do cabeçalho e do hero (mesma linguagem do hero do Painel). */
export const HERO_GLOW: Record<HeroTone, string> = {
  success: 'var(--success-soft)',
  warning: 'var(--warning-soft)',
  danger: 'var(--danger-soft)',
  accent: 'var(--accent-soft)',
  neutral: 'transparent'
}

function Shell({
  kind,
  icon: Icon,
  spin,
  title,
  children
}: {
  kind: HealthKind
  icon: LucideIcon
  spin?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <section
      aria-live="polite"
      aria-atomic="false"
      data-health={kind}
      className="relative flex min-h-[104px] shrink-0 flex-col justify-center px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-[40px] shrink-0 items-center justify-center rounded-full',
            CIRCLE[HERO_TONE[kind]]
          )}
        >
          <Icon className={cn('size-[20px]', spin && 'animate-spin-slow')} strokeWidth={1.75} aria-hidden />
        </span>
        {/* pt 6 px: o centro do título (28 px) fica na altura do centro do círculo (40 px). */}
        <div className="flex min-w-0 flex-1 flex-col pt-[6px]">
          <h1 className="truncate text-title font-semibold text-fg">{title}</h1>
          {children}
        </div>
      </div>
    </section>
  )
}

function Line({ children, clamp }: { children: ReactNode; clamp?: boolean }) {
  return (
    <p className={cn('mt-0.5 text-small text-fg-muted', clamp ? 'line-clamp-2 text-balance' : 'truncate')}>
      {children}
    </p>
  )
}

function Action({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <div className="mt-1.5">
      <Button variant="link" size="sm" className="text-small" iconRight={ArrowRight} onClick={onClick}>
        {children}
      </Button>
    </div>
  )
}

export interface TrayHeroProps {
  health: Health<Routine>
  /** Último backup concluído (com ou sem avisos), para "Último backup há 2 h · 2,1 GB". */
  lastOk?: RunSummary
  openMain(route?: string): void
  resumeAll(): void
}

export function TrayHero({ health, lastOk, openMain, resumeAll }: TrayHeroProps) {
  const now = useNow()
  const { kind } = health

  if ((kind === 'running' || kind === 'queued') && health.run) {
    const p = health.run
    if (kind === 'queued') {
      return (
        <Shell kind={kind} icon={Clock} title="Backup na fila">
          <Line clamp>
            <span className="font-medium text-fg">{p.routineName}</span> · aguardando outra execução terminar
          </Line>
        </Shell>
      )
    }
    const pct = overallPercent(p)
    const dest = destinationLabel(p)
    const detail =
      p.phase === 'copying'
        ? `${formatNumber(p.filesDone)} de ${plural(p.filesTotal, 'arquivo', 'arquivos')}${dest ? ` · ${dest.toLowerCase()}` : ''}`
        : p.phase === 'scanning'
          ? 'preparando…'
          : (PHASE_LABEL[p.phase] ?? '').toLowerCase()
    const valueText = pct === undefined ? 'Preparando' : `${formatPercent(pct)} · ${formatEta(p.etaMs)}`
    return (
      <Shell kind={kind} icon={LoaderCircle} spin title="Backup em andamento">
        <TruncatedText className="mt-0.5 text-small text-fg-muted" label={`${p.routineName} · ${detail}`}>
          <span className="font-medium text-fg">{p.routineName}</span> · {detail}
        </TruncatedText>
        {/* Fora do aria-live: o percentual muda 4×/s (o leitor de tela lê a barra quando focada). */}
        <button
          type="button"
          onClick={() => openMain(ROUTES.dashboard)}
          aria-live="off"
          aria-label={`Ver o progresso no BC Backup (${valueText})`}
          className="group mt-2.5 flex items-center gap-2.5 rounded-xs focus-visible:outline-offset-4"
        >
          <ProgressBar
            value={pct}
            className="flex-1"
            label={`Progresso do backup de ${p.routineName}`}
            valueText={valueText}
          />
          <span className="shrink-0 text-caption font-medium text-fg tnum">
            {pct === undefined ? (
              <span className="font-normal text-fg-subtle">Preparando…</span>
            ) : (
              <>
                {formatPercent(pct)}
                <span className="font-normal text-fg-subtle"> · {formatEta(p.etaMs)}</span>
              </>
            )}
            {health.count > 0 && (
              <span className="font-normal text-fg-subtle"> · {health.count} na fila</span>
            )}
          </span>
        </button>
      </Shell>
    )
  }

  if (kind === 'failed' && health.routine?.lastRun) {
    const r = health.routine
    const lr = r.lastRun!
    const when = formatWhen(lr.finishedAt ?? lr.startedAt, now)
    // Uma linha: o motivo vale mais que a hora (que está na lista e no Tooltip).
    const text = `${r.name} · ${when}${lr.errorMessage ? ` — ${lr.errorMessage}` : ''}`
    return (
      <Shell
        kind={kind}
        icon={ShieldAlert}
        title={health.count > 1 ? `${health.count} backups falharam` : 'O último backup falhou'}
      >
        <TruncatedText className="mt-0.5 text-small text-fg-muted" label={text}>
          <span className="font-medium text-fg">{r.name}</span>
          {lr.errorMessage ? <span className="text-danger"> · {lr.errorMessage}</span> : <> · {when}</>}
        </TruncatedText>
        <Action onClick={() => openMain(health.count > 1 ? ROUTES.history : ROUTES.run(lr.id))}>
          Ver detalhes
        </Action>
      </Shell>
    )
  }

  if (kind === 'warning' && health.routine?.lastRun) {
    const r = health.routine
    const text =
      health.count === 1
        ? `1 rotina terminou com avisos (${r.name})`
        : `${health.count} rotinas terminaram com avisos`
    return (
      <Shell kind={kind} icon={TriangleAlert} title="Atenção necessária">
        <TruncatedText className="mt-0.5 text-small text-fg-muted" label={text}>
          {text}
        </TruncatedText>
        <Action onClick={() => openMain(health.count > 1 ? ROUTES.history : ROUTES.run(r.lastRun!.id))}>
          Ver detalhes
        </Action>
      </Shell>
    )
  }

  if (kind === 'empty') {
    return (
      <Shell kind={kind} icon={FolderPlus} title="Nenhuma rotina ainda">
        <Line clamp>Crie sua primeira rotina: leva menos de um minuto.</Line>
        <Action onClick={() => openMain(ROUTES.newRoutine)}>Criar primeira rotina</Action>
      </Shell>
    )
  }

  if (kind === 'paused') {
    return (
      <Shell kind={kind} icon={Pause} title="Rotinas pausadas">
        <Line clamp>Os backups agendados não vão rodar até você retomar.</Line>
        <Action onClick={resumeAll}>Retomar rotinas</Action>
      </Shell>
    )
  }

  return (
    <Shell kind="ok" icon={ShieldCheck} title="Tudo protegido">
      <Line>
        {lastOk ? (
          <>
            Último backup <RelativeTime iso={lastOk.finishedAt ?? lastOk.startedAt} mode="ago" />
            {lastOk.bytesCopied > 0 && <> · {formatSize(lastOk.bytesCopied)}</>}
          </>
        ) : (
          'Nenhum backup concluído ainda'
        )}
      </Line>
    </Shell>
  )
}
