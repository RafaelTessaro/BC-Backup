import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Clock,
  FolderSync,
  HardDrive,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Server,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Usb,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DayStatus, DiskSpace, Routine, RunSummary } from '@shared/types'
import { formatBytes, formatDuration } from '@shared/format'
import { ROUTES } from '@shared/routes'
import { describeSchedule, upcomingRuns } from '@shared/schedule'
import { Page, PageHeader } from '@renderer/components/shell/Page'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { DiskUsageBar, usageTone } from '@renderer/components/ui/DiskUsageBar'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuTrigger } from '@renderer/components/ui/Menu'
import { ProgressBar } from '@renderer/components/ui/ProgressBar'
import { RelativeTime } from '@renderer/components/ui/RelativeTime'
import { StatusPill } from '@renderer/components/ui/StatusPill'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { runNow } from '@renderer/lib/actions'
import { bc } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import {
  formatDayHeading,
  formatDayWord,
  formatEta,
  formatNumber,
  formatPercent,
  formatTime,
  formatWhen,
  pathRoot,
  plural
} from '@renderer/lib/format'
import { navigate } from '@renderer/lib/router'
import { destinationLabel, overallPercent, primaryRun } from '@renderer/lib/progress'
import { PHASE_LABEL, RUN_STATUS, STATUS_BAR } from '@renderer/lib/status'
import { openLiveRun, openRunDetail, useApp } from '@renderer/lib/store'

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function DaysStrip({ days }: { days: DayStatus[] }) {
  const now = useNow()
  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <span className="text-caption font-medium text-fg-subtle">Últimos 14 dias</span>
      <div className="flex items-end gap-[3px]" role="list" aria-label="Status dos últimos 14 dias">
        {days.map((d) => {
          const [y, m, dd] = d.date.split('-').map(Number)
          const date = new Date(y, m - 1, dd)
          const label = d.status ? RUN_STATUS[d.status].label : 'Sem execuções'
          return (
            <Tooltip
              key={d.date}
              label={
                <span className="flex flex-col">
                  <span>{formatDayHeading(date, now)}</span>
                  <span className="opacity-70">
                    {d.runs ? `${plural(d.runs, 'execução', 'execuções')} · ${label}` : label}
                  </span>
                </span>
              }
            >
              <span
                role="listitem"
                aria-label={`${formatDayHeading(date, now)}: ${label}`}
                className={cn(
                  'block h-6 w-[5px] rounded-xs transition-[filter,transform] duration-[120ms] hover:scale-y-110 hover:brightness-110',
                  STATUS_BAR[d.status ?? 'none']
                )}
              />
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

type HeroTone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral'

const HERO_TONE: Record<HeroTone, { circle: string; glow: string }> = {
  success: { circle: 'bg-success-soft text-success', glow: 'var(--success-soft)' },
  warning: { circle: 'bg-warning-soft text-warning', glow: 'var(--warning-soft)' },
  danger: { circle: 'bg-danger-soft text-danger', glow: 'var(--danger-soft)' },
  accent: { circle: 'bg-accent-soft text-accent-text', glow: 'var(--accent-soft)' },
  neutral: { circle: 'bg-surface-hover text-fg-muted', glow: 'transparent' }
}

function HeroShell({
  tone,
  icon: Icon,
  spin,
  title,
  line,
  children,
  days,
  actions
}: {
  tone: HeroTone
  icon: LucideIcon
  spin?: boolean
  title: string
  line: ReactNode
  children?: ReactNode
  days: DayStatus[]
  actions?: ReactNode
}) {
  const t = HERO_TONE[tone]
  return (
    <Card className="relative overflow-hidden rounded-xl p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 dark:opacity-60"
        style={{ background: `radial-gradient(80% 140% at 0% 0%, ${t.glow}, transparent 60%)` }}
      />
      <div className="relative flex items-start gap-4">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', t.circle)}>
          <Icon className={cn('size-5', spin && 'animate-spin-slow')} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-display font-semibold text-fg">{title}</h2>
          <div className="text-small text-fg-muted">{line}</div>
          {children}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
        {days.length > 0 && <DaysStrip days={days} />}
      </div>
    </Card>
  )
}

function StatusHero({ routines }: { routines: Routine[] }) {
  const stats = useApp((s) => s.stats)
  const progress = useApp((s) => s.progress)
  const now = useNow()
  const days = stats?.days ?? []
  const running = primaryRun(progress)
  const enabled = routines.filter((r) => r.enabled)
  const failed = enabled.filter((r) => r.lastRun?.status === 'failed')
  const warned = enabled.filter((r) => r.lastRun?.status === 'warning')
  const lastOk = useApp((s) => s.runs.find((r) => r.status === 'success' || r.status === 'warning'))
  const next = stats?.nextRun

  const lastNext = (
    <>
      {lastOk ? (
        <>
          Último backup <RelativeTime iso={lastOk.finishedAt ?? lastOk.startedAt} mode="ago" />
        </>
      ) : (
        'Nenhum backup concluído ainda'
      )}
      {next && (
        <>
          {' · '}Próximo <RelativeTime iso={next.at} />{' '}
          <span className="text-fg-subtle">({next.routineName})</span>
        </>
      )}
    </>
  )

  if (running) {
    const pct = overallPercent(running)
    const dest = destinationLabel(running)
    return (
      <HeroShell
        tone="accent"
        icon={running.phase === 'queued' ? Clock : LoaderCircle}
        spin={running.phase !== 'queued'}
        title={running.phase === 'queued' ? 'Backup na fila' : 'Backup em andamento'}
        days={days}
        line={
          <>
            <span className="font-medium text-fg">{running.routineName}</span>
            {' · '}
            {running.phase === 'queued'
              ? 'na fila, aguardando outra execução terminar'
              : running.phase === 'copying'
                ? `copiando ${formatNumber(running.filesDone)} de ${plural(running.filesTotal, 'arquivo', 'arquivos')}${dest ? ` · ${dest.toLowerCase()}` : ''}`
                : running.phase === 'scanning'
                  ? 'preparando…'
                  : PHASE_LABEL[running.phase].toLowerCase()}
          </>
        }
      >
        <button
          type="button"
          onClick={() => openLiveRun(running.routineId)}
          className="group mt-3 flex max-w-[460px] items-center gap-3 rounded-md text-left"
          aria-label="Ver progresso"
        >
          <ProgressBar value={running.phase === 'queued' ? 0 : pct} className="flex-1" label="Progresso" />
          <span className="shrink-0 text-small font-medium text-fg tnum">
            {running.phase === 'queued' ? (
              'Na fila'
            ) : pct === undefined ? (
              <span className="font-normal text-fg-subtle">Preparando…</span>
            ) : (
              <>
                {formatPercent(pct)}
                <span className="font-normal text-fg-subtle"> · {formatEta(running.etaMs)}</span>
              </>
            )}
          </span>
          <ArrowRight
            className="size-4 shrink-0 text-fg-subtle transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-fg"
            strokeWidth={1.75}
          />
        </button>
      </HeroShell>
    )
  }

  if (failed.length > 0) {
    const r = failed[0]
    const lr = r.lastRun!
    return (
      <HeroShell
        tone="danger"
        icon={ShieldAlert}
        title="O último backup falhou"
        days={days}
        line={
          failed.length > 1 ? (
            `${failed.length} rotinas falharam na última execução: ${failed.map((f) => f.name).join(', ')}.`
          ) : (
            <>
              <span className="font-medium text-fg">{r.name}</span> · {formatWhen(lr.startedAt, now)}
              {lr.errorMessage && <span className="block text-danger">{lr.errorMessage}</span>}
            </>
          )
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => openRunDetail(lr.id)}>
              Ver detalhes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Play}
              onClick={() => void runNow(r, { openDrawer: true })}
            >
              Executar novamente
            </Button>
          </>
        }
      />
    )
  }

  if (warned.length > 0) {
    return (
      <HeroShell
        tone="warning"
        icon={TriangleAlert}
        title="Atenção necessária"
        days={days}
        line={
          <>
            {warned.length === 1
              ? `1 rotina terminou com avisos (${warned[0].name})`
              : `${warned.length} rotinas terminaram com avisos`}
            {' · '}
            {lastNext}
          </>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={() => openRunDetail(warned[0].lastRun!.id)}>
            Ver detalhes
          </Button>
        }
      />
    )
  }

  if (enabled.length === 0) {
    return (
      <HeroShell
        tone="neutral"
        icon={Pause}
        title="Rotinas pausadas"
        days={days}
        line="Nenhuma rotina está ativa. Retome uma rotina para voltar a proteger seus arquivos."
        actions={
          <Button variant="secondary" size="sm" onClick={() => navigate(ROUTES.routines)}>
            Ver rotinas
          </Button>
        }
      />
    )
  }

  return <HeroShell tone="success" icon={ShieldCheck} title="Tudo protegido" days={days} line={lastNext} />
}

/* ------------------------------------------------------------------ */
/* Stat tiles                                                          */
/* ------------------------------------------------------------------ */

function StatTile({
  label,
  value,
  suffix,
  sub,
  delta
}: {
  label: string
  value: string
  suffix?: string
  sub?: ReactNode
  delta?: { text: string; good: boolean; up: boolean }
}) {
  const Arrow = delta?.up ? ArrowUpRight : ArrowDownRight
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-caption font-medium text-fg-muted">{label}</span>
      <span className="text-stat font-semibold text-fg tnum">
        {value}
        {suffix && (
          <span className="ml-1 text-body font-normal tracking-normal text-fg-subtle">{suffix}</span>
        )}
      </span>
      <span className="flex min-h-4 items-center gap-1 truncate text-caption text-fg-subtle">
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              delta.good ? 'text-success' : 'text-danger'
            )}
          >
            <Arrow className="size-3.5" strokeWidth={2} aria-hidden />
            {delta.text}
          </span>
        )}
        {sub}
      </span>
    </Card>
  )
}

function rate(runs: RunSummary[]): number | null {
  const counted = runs.filter(
    (r) => r.status !== 'cancelled' && r.status !== 'running' && r.status !== 'queued'
  )
  if (!counted.length) return null
  return (counted.filter((r) => r.status !== 'failed').length / counted.length) * 100
}

function StatTiles({ routines }: { routines: Routine[] }) {
  const stats = useApp((s) => s.stats)
  const runs = useApp((s) => s.runs)
  const now = useNow()
  const nowMs = now.getTime()
  const week = runs.filter((r) => nowMs - new Date(r.startedAt).getTime() < 7 * 86_400_000)
  const prevWeek = runs.filter((r) => {
    const age = nowMs - new Date(r.startedAt).getTime()
    return age >= 7 * 86_400_000 && age < 14 * 86_400_000
  })
  const failures = week.filter((r) => r.status === 'failed').length
  const warnings = week.filter((r) => r.status === 'warning').length
  const paused = routines.filter((r) => !r.enabled).length
  const current = stats?.successRate7d ?? null
  const previous = rate(prevWeek)
  const diff = current !== null && previous !== null ? Math.round(current - previous) : null
  const destCount = new Set(routines.flatMap((r) => r.destinations.map((d) => pathRoot(d.path)))).size

  return (
    <div className="grid grid-cols-2 gap-4 @[44rem]:grid-cols-4">
      <StatTile
        label="Rotinas ativas"
        value={formatNumber(stats?.routinesActive ?? 0)}
        suffix={`de ${formatNumber(stats?.routinesTotal ?? 0)}`}
        sub={paused ? plural(paused, 'pausada', 'pausadas') : 'Nenhuma pausada'}
      />
      <StatTile
        label="Execuções · 7 dias"
        value={formatNumber(stats?.runsLast7d ?? 0)}
        sub={
          failures || warnings
            ? [
                failures ? plural(failures, 'falha', 'falhas') : null,
                warnings ? `${formatNumber(warnings)} com avisos` : null
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Nenhuma falha'
        }
      />
      <StatTile
        label="Taxa de sucesso"
        value={current === null ? '—' : formatPercent(current)}
        delta={
          diff !== null && diff !== 0
            ? { text: `${Math.abs(diff)} p.p.`, good: diff > 0, up: diff > 0 }
            : undefined
        }
        sub={diff !== null && diff !== 0 ? 'vs. semana anterior' : 'Últimos 7 dias'}
      />
      <StatTile
        label="Copiado · 7 dias"
        value={formatBytes(stats?.bytesLast7d ?? 0)}
        sub={destCount ? `em ${plural(destCount, 'destino', 'destinos')}` : undefined}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Próximas execuções                                                  */
/* ------------------------------------------------------------------ */

function UpcomingCard({ routines }: { routines: Routine[] }) {
  const now = useNow()
  const nowMs = now.getTime()
  const items = useMemo(() => {
    const from = new Date(nowMs)
    return routines
      .filter((r) => r.enabled)
      .flatMap((r) => upcomingRuns(r.schedule, from, 3).map((at) => ({ routine: r, at })))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, 5)
  }, [routines, nowMs])

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Próximas execuções" />
      {items.length === 0 ? (
        <p className="px-5 pb-5 text-small text-fg-muted">
          Nenhuma execução agendada. Rotinas manuais rodam quando você pedir.
        </p>
      ) : (
        <ul className="flex flex-col px-2 pb-2">
          {items.map(({ routine, at }) => (
            <li
              key={`${routine.id}-${at.getTime()}`}
              className="group flex h-12 items-center gap-3 rounded-md px-3 transition-colors duration-[120ms] hover:bg-surface-hover"
            >
              <Tooltip label={formatWhen(at, now)}>
                <div className="flex w-[76px] shrink-0 flex-col leading-tight">
                  <span className="text-caption text-fg-subtle first-letter:uppercase">
                    {formatDayWord(at, now).split(',')[0]}
                  </span>
                  <span className="text-body font-medium text-fg tnum">{formatTime(at)}</span>
                </div>
              </Tooltip>
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col text-left"
                onClick={() => navigate(ROUTES.routine(routine.id))}
              >
                <span className="truncate text-small font-medium text-fg">{routine.name}</span>
                <span className="truncate text-caption text-fg-subtle">
                  {describeSchedule(routine.schedule)}
                </span>
              </button>
              <IconButton
                icon={Play}
                label="Executar agora"
                className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void runNow(routine)}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Destinos                                                            */
/* ------------------------------------------------------------------ */

interface DestRow {
  root: string
  label?: string
  routines: string[]
  network: boolean
}

function useDiskSpaces(paths: string[]): Record<string, DiskSpace | null> {
  const [spaces, setSpaces] = useState<Record<string, DiskSpace | null>>({})
  const key = paths.join('|')
  useEffect(() => {
    let alive = true
    const list = key ? key.split('|') : []
    void Promise.all(list.map((p) => bc.system.diskSpace(p).catch(() => null))).then((res) => {
      if (!alive) return
      const out: Record<string, DiskSpace | null> = {}
      list.forEach((p, i) => (out[p] = res[i]))
      setSpaces(out)
    })
    return () => {
      alive = false
    }
  }, [key])
  return spaces
}

function DestinationsCard({ routines }: { routines: Routine[] }) {
  const drives = useApp((s) => s.drives)
  const rows = useMemo(() => {
    const map = new Map<string, DestRow>()
    for (const r of routines)
      for (const d of r.destinations) {
        const root = pathRoot(d.path)
        const row = map.get(root) ?? {
          root,
          label: undefined,
          routines: [],
          network: root.startsWith('\\\\')
        }
        if (!row.routines.includes(r.name)) row.routines.push(r.name)
        row.label ??= d.label
        map.set(root, row)
      }
    return [...map.values()].sort((a, b) => b.routines.length - a.routines.length)
  }, [routines])
  const spaces = useDiskSpaces(rows.map((r) => r.root))

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Destinos" />
      {rows.length === 0 ? (
        <p className="px-5 pb-5 text-small text-fg-muted">Nenhum destino configurado.</p>
      ) : (
        <ul className="flex flex-col gap-1 px-2 pb-3">
          {rows.map((row) => {
            const drive = drives.find(
              (d) => d.path.toUpperCase().replace(/\\$/, '') === row.root.toUpperCase().replace(/\\$/, '')
            )
            const space =
              spaces[row.root] ?? (drive ? { path: drive.path, total: drive.total, free: drive.free } : null)
            const Icon: LucideIcon = row.network ? Server : drive?.removable ? Usb : HardDrive
            const usedPct = space && space.total ? ((space.total - space.free) / space.total) * 100 : 0
            const tone = usageTone(usedPct)
            const name = drive?.label || row.label || row.root
            return (
              <li key={row.root} className="flex items-start gap-3 rounded-md px-3 py-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-small font-medium text-fg">{name}</span>
                      <span className="shrink-0 font-mono text-mono text-fg-subtle">{row.root}</span>
                    </div>
                    <Tooltip label={row.routines.join(', ')}>
                      <span className="shrink-0 text-caption text-fg-subtle">
                        {plural(row.routines.length, 'rotina', 'rotinas')}
                      </span>
                    </Tooltip>
                  </div>
                  {space ? (
                    <div className="flex items-center gap-2">
                      <DiskUsageBar total={space.total} free={space.free} className="flex-1" />
                      {tone === 'danger' && (
                        <Tooltip label="Pouco espaço livre: o próximo backup pode falhar.">
                          <TriangleAlert
                            className="-mt-5 size-4 shrink-0 text-danger"
                            strokeWidth={1.75}
                            aria-label="Pouco espaço"
                          />
                        </Tooltip>
                      )}
                    </div>
                  ) : (
                    <span className="text-caption text-warning">
                      Indisponível agora — conecte o disco ou verifique a rede.
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Últimas execuções                                                   */
/* ------------------------------------------------------------------ */

function RecentRunsCard() {
  const runs = useApp((s) => s.runs)
  const recent = runs.slice(0, 6)
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Últimas execuções"
        action={
          <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate(ROUTES.history)}>
            Ver histórico
          </Button>
        }
      />
      {recent.length === 0 ? (
        <p className="px-5 pb-5 text-small text-fg-muted">
          Assim que uma rotina rodar, o resultado aparece aqui.
        </p>
      ) : (
        <div className="px-2 pb-2" role="table" aria-label="Últimas execuções">
          {recent.map((r) => (
            <button
              key={r.id}
              type="button"
              role="row"
              onClick={() => openRunDetail(r.id)}
              className="grid h-11 w-full grid-cols-[112px_minmax(0,1fr)_128px_72px_104px_72px] items-center gap-3 rounded-md px-3 text-left text-small transition-colors duration-[120ms] hover:bg-surface-hover"
            >
              <span role="cell">
                <StatusPill meta={RUN_STATUS[r.status]} />
              </span>
              <span role="cell" className="truncate font-medium text-fg">
                {r.routineName}
              </span>
              <span role="cell" className="truncate text-fg-muted">
                <RelativeTime iso={r.startedAt} />
              </span>
              {r.status === 'failed' ? (
                <span role="cell" className="col-span-3 truncate text-right text-danger">
                  {r.errorMessage?.split(':')[0] ?? 'Falhou'}
                </span>
              ) : (
                <>
                  <span role="cell" className="text-right text-fg-muted tnum">
                    {r.durationMs !== undefined ? formatDuration(r.durationMs) : '—'}
                  </span>
                  <span role="cell" className="text-right text-fg-muted tnum">
                    {plural(r.filesCopied, 'arquivo', 'arquivos')}
                  </span>
                  <span role="cell" className="text-right font-medium text-fg tnum">
                    {formatBytes(r.bytesCopied)}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Tela                                                                */
/* ------------------------------------------------------------------ */

function RunNowMenu({ routines }: { routines: Routine[] }) {
  const progress = useApp((s) => s.progress)
  const busy = new Set(Object.values(progress).map((p) => p.routineId))
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button variant="primary" icon={Play} iconRight={ChevronDown} disabled={routines.length === 0}>
          Executar agora
        </Button>
      </MenuTrigger>
      <MenuContent className="w-[280px]">
        <MenuLabel>Escolha a rotina</MenuLabel>
        {routines.map((r) => (
          <MenuItem
            key={r.id}
            icon={busy.has(r.id) ? LoaderCircle : FolderSync}
            disabled={busy.has(r.id)}
            onSelect={() => void runNow(r, { openDrawer: true })}
            hint={busy.has(r.id) ? 'Em execução' : !r.enabled ? 'Pausada' : undefined}
          >
            {r.name}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  )
}

export function DashboardScreen() {
  const routines = useApp((s) => s.routines)
  const now = useNow()

  if (routines.length === 0) {
    return (
      <Page>
        <PageHeader title="Painel" description="Visão geral das suas rotinas de backup" />
        <Card className="flex min-h-[420px] items-center justify-center rounded-xl p-10">
          <EmptyState
            icon={ShieldCheck}
            title="Vamos proteger seus arquivos"
            description="Crie sua primeira rotina: escolha o que copiar, para onde e quando. Leva menos de um minuto."
            action={
              <Button variant="primary" icon={Plus} onClick={() => navigate(ROUTES.newRoutine)}>
                Criar primeira rotina
              </Button>
            }
          />
        </Card>
      </Page>
    )
  }

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'

  return (
    <Page>
      <PageHeader
        title="Painel"
        description={`${greeting}! Veja como estão as suas rotinas de backup.`}
        actions={<RunNowMenu routines={routines} />}
      />
      <div className="flex flex-col gap-4">
        <StatusHero routines={routines} />
        <StatTiles routines={routines} />
        <div className="grid grid-cols-1 gap-4 @[60rem]:grid-cols-12">
          <div className="@[60rem]:col-span-5">
            <UpcomingCard routines={routines} />
          </div>
          <div className="@[60rem]:col-span-7">
            <DestinationsCard routines={routines} />
          </div>
        </div>
        <RecentRunsCard />
      </div>
    </Page>
  )
}
