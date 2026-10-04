import {
  Copy,
  Ellipsis,
  FolderOpen,
  FolderOutput,
  FolderSync,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  SearchX,
  Square,
  Trash2
} from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { Routine, RunProgress } from '@shared/types'
import { formatBytes } from '@shared/format'
import { ROUTES } from '@shared/routes'
import { describeSchedule } from '@shared/schedule'
import { Page, PageHeader } from '@renderer/components/shell/Page'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { ConfirmDialog } from '@renderer/components/ui/Dialog'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '@renderer/components/ui/Menu'
import { ProgressBar } from '@renderer/components/ui/ProgressBar'
import { RelativeTime } from '@renderer/components/ui/RelativeTime'
import { Segmented } from '@renderer/components/ui/Segmented'
import { StatusPill } from '@renderer/components/ui/StatusPill'
import { Tooltip, TruncatedText } from '@renderer/components/ui/Tooltip'
import {
  cancelRun,
  duplicateRoutine,
  openDestinationFolder,
  removeRoutine,
  runNow,
  setRoutineEnabled
} from '@renderer/lib/actions'
import { cn } from '@renderer/lib/cn'
import { formatPercent, plural } from '@renderer/lib/format'
import { destinationLabel, overallPercent } from '@renderer/lib/progress'
import { navigate } from '@renderer/lib/router'
import { ROUTINE_STATUS, routineState } from '@renderer/lib/status'
import { openLiveRun, progressFor, showHistoryFor, useApp } from '@renderer/lib/store'

type Filter = 'all' | 'active' | 'paused'

function sourcesSummary(r: Routine): string {
  const folders = r.sources.filter((s) => s.kind === 'folder').length
  const files = r.sources.length - folders
  const parts = []
  if (folders) parts.push(plural(folders, 'pasta', 'pastas'))
  if (files) parts.push(plural(files, 'arquivo', 'arquivos'))
  return parts.join(' e ') || 'Sem origem'
}

function destinationsSummary(r: Routine): string {
  const list = r.destinations.map((d) => d.path)
  if (list.length === 0) return 'sem destino'
  if (list.length <= 2) return list.join(', ')
  return `${list.slice(0, 2).join(', ')} +${list.length - 2}`
}

function RoutineRow({ routine, progress }: { routine: Routine; progress?: RunProgress }) {
  const nextRun = useApp((s) => s.nextRuns[routine.id])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const state = routineState(routine, progress)
  const paused = !routine.enabled
  const pct = progress ? overallPercent(progress) : undefined
  const dest = progress ? destinationLabel(progress) : null
  const descId = useId()
  const edit = (): void => navigate(ROUTES.routine(routine.id))
  const summary = (
    <>
      <span className={cn(!paused && 'text-fg-muted')}>{describeSchedule(routine.schedule)}</span>
      {' · '}
      {sourcesSummary(routine)} → <span className="font-mono text-mono">{destinationsSummary(routine)}</span>
      {routine.retention.enabled && ` · ${plural(routine.retention.days, 'dia', 'dias')}`}
    </>
  )

  return (
    <li className="group relative">
      {/* Linha inteira clicável com o mouse; para teclado/leitor de tela a ação é o botão do nome
          (sem botões aninhados dentro de outro botão). */}
      <div
        onClick={edit}
        className="flex min-h-[72px] items-center gap-4 px-5 py-3 transition-colors duration-[120ms] group-first:rounded-t-[11px] group-last:rounded-b-[11px] hover:bg-surface-hover/60 has-[[data-row-main]:focus-visible]:outline-2 has-[[data-row-main]:focus-visible]:outline-offset-[-2px] has-[[data-row-main]:focus-visible]:outline-ring"
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            paused ? 'bg-surface-hover text-fg-subtle' : 'bg-accent-soft text-accent-text'
          )}
        >
          <FolderSync className="size-4" strokeWidth={1.75} aria-hidden />
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              data-row-main
              aria-label={`Editar ${routine.name}`}
              aria-describedby={descId}
              className={cn(
                'min-w-0 text-left text-body font-semibold tracking-[-0.005em] focus-visible:outline-none',
                paused ? 'text-fg-muted' : 'text-fg'
              )}
            >
              <TruncatedText>{routine.name}</TruncatedText>
            </button>
            <StatusPill meta={ROUTINE_STATUS[state]} />
            {routine.moveSources?.enabled && (
              <Tooltip label="Apaga da origem depois de copiar">
                <span
                  className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-border-strong px-2 text-caption font-medium whitespace-nowrap text-fg-muted"
                  data-chip="mover"
                >
                  <FolderOutput className="size-3 shrink-0" strokeWidth={2} aria-hidden />
                  Mover
                </span>
              </Tooltip>
            )}
          </div>
          <TruncatedText className="text-small text-fg-subtle" label={summary}>
            <span id={descId}>
              <span className="sr-only">{ROUTINE_STATUS[state].label}. </span>
              {summary}
            </span>
          </TruncatedText>
        </div>

        {progress ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              openLiveRun(routine.id)
            }}
            className="-mr-2 flex w-[228px] shrink-0 flex-col gap-1.5 rounded-md px-2 py-1 text-left transition-colors duration-[120ms] hover:bg-surface-raised"
            aria-label={`Ver progresso de ${routine.name}`}
          >
            <span className="flex items-baseline justify-between text-caption tnum">
              <span className="font-medium text-accent-text">
                {pct !== undefined
                  ? formatPercent(pct)
                  : progress.phase === 'queued'
                    ? 'Na fila'
                    : 'Preparando…'}
              </span>
              {progress.bytesTotal > 0 && progress.phase !== 'queued' && (
                <span className="truncate text-fg-subtle">
                  {dest ? `${dest} · ` : ''}
                  {formatBytes(progress.bytesDone)} de {formatBytes(progress.bytesTotal)}
                </span>
              )}
            </span>
            <ProgressBar
              value={progress.phase === 'queued' ? 0 : pct}
              label={`Progresso de ${routine.name}`}
              valueText={
                progress.phase === 'queued'
                  ? 'Na fila'
                  : pct === undefined
                    ? 'Preparando'
                    : `${formatPercent(pct)} · ${formatBytes(progress.bytesDone)} de ${formatBytes(progress.bytesTotal)}`
              }
            />
          </button>
        ) : (
          <div className="hidden w-[180px] shrink-0 flex-col items-end gap-0.5 text-right @[52rem]:flex">
            <span className="text-caption text-fg-subtle">Próxima execução</span>
            <span className="text-small text-fg-muted">
              {paused ? (
                <span className="text-fg-subtle">Não agendada</span>
              ) : nextRun ? (
                <RelativeTime iso={nextRun} className="first-letter:uppercase" />
              ) : routine.schedule.kind === 'startup' ? (
                'Ao iniciar'
              ) : (
                'Manual'
              )}
            </span>
          </div>
        )}

        <div
          className="flex w-[112px] shrink-0 items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {progress ? (
            <IconButton icon={Square} label="Parar" onClick={() => setConfirmStop(true)} />
          ) : paused ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Play}
              className="text-accent-text hover:text-accent-text"
              onClick={() => void setRoutineEnabled(routine, true)}
            >
              Retomar
            </Button>
          ) : (
            <>
              <IconButton icon={Play} label="Executar agora" onClick={() => void runNow(routine)} />
              <IconButton
                icon={Pause}
                label="Pausar"
                onClick={() => void setRoutineEnabled(routine, false)}
              />
            </>
          )}
          <MenuRoot>
            <Tooltip label="Mais ações">
              <MenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Mais ações"
                  className="flex size-7 items-center justify-center rounded-sm text-fg-muted transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg aria-expanded:bg-surface-hover aria-expanded:text-fg"
                >
                  <Ellipsis className="size-4" strokeWidth={1.75} />
                </button>
              </MenuTrigger>
            </Tooltip>
            <MenuContent>
              {paused && !progress && (
                <MenuItem icon={Play} onSelect={() => void runNow(routine)}>
                  Executar agora
                </MenuItem>
              )}
              <MenuItem icon={Pencil} onSelect={() => navigate(ROUTES.routine(routine.id))}>
                Editar
              </MenuItem>
              <MenuItem icon={Copy} onSelect={() => void duplicateRoutine(routine)}>
                Duplicar
              </MenuItem>
              <MenuItem
                icon={FolderOpen}
                disabled={routine.destinations.length === 0}
                onSelect={() => void openDestinationFolder(routine)}
              >
                Abrir pasta de destino
              </MenuItem>
              <MenuItem icon={History} onSelect={() => showHistoryFor(routine.id)}>
                Ver histórico
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onSelect={() => setConfirmDelete(true)}>
                Excluir
              </MenuItem>
            </MenuContent>
          </MenuRoot>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Excluir a rotina “${routine.name}”?`}
        description="As cópias já feitas continuam no destino. Esta ação não pode ser desfeita."
        confirmLabel="Excluir rotina"
        onConfirm={() => removeRoutine(routine)}
      />
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={`Parar “${routine.name}”?`}
        description="A cópia parcial será mantida no destino. A rotina continua agendada normalmente."
        confirmLabel="Parar backup"
        onConfirm={() => cancelRun(routine.id)}
      />
    </li>
  )
}

export function RoutinesScreen() {
  const routines = useApp((s) => s.routines)
  const progress = useApp((s) => s.progress)
  const nextRuns = useApp((s) => s.nextRuns)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const sorted = useMemo(() => {
    const rank = (r: Routine): number => {
      if (progressFor(progress, r.id)) return 0
      if (!r.enabled) return 4
      if (r.lastRun?.status === 'failed') return 1
      if (r.lastRun?.status === 'warning') return 2
      return 3
    }
    return [...routines].sort((a, b) => {
      const d = rank(a) - rank(b)
      if (d) return d
      const na = nextRuns[a.id] ?? '9999'
      const nb = nextRuns[b.id] ?? '9999'
      return na.localeCompare(nb) || a.name.localeCompare(b.name, 'pt-BR')
    })
  }, [routines, progress, nextRuns])

  const q = query.trim().toLocaleLowerCase('pt-BR')
  const visible = sorted.filter(
    (r) =>
      (filter === 'all' || (filter === 'active' ? r.enabled : !r.enabled)) &&
      (!q ||
        r.name.toLocaleLowerCase('pt-BR').includes(q) ||
        r.sources.some((s) => s.path.toLocaleLowerCase('pt-BR').includes(q)) ||
        r.destinations.some(
          (d) => d.path.toLocaleLowerCase('pt-BR').includes(q) || d.label?.toLowerCase().includes(q)
        ))
  )
  const active = routines.filter((r) => r.enabled).length

  return (
    <Page>
      <PageHeader
        title="Rotinas"
        description={
          routines.length
            ? `${plural(routines.length, 'rotina', 'rotinas')} · ${plural(active, 'ativa', 'ativas')}`
            : 'O que copiar, para onde e quando'
        }
        actions={
          <Button variant="primary" icon={Plus} onClick={() => navigate(ROUTES.newRoutine)}>
            Nova rotina
          </Button>
        }
      />

      {routines.length === 0 ? (
        <Card className="flex min-h-[380px] items-center justify-center rounded-xl p-10">
          <EmptyState
            icon={FolderSync}
            title="Vamos proteger seus arquivos"
            description="Crie sua primeira rotina: escolha o que copiar, para onde e quando. Leva menos de um minuto."
            action={
              <Button variant="primary" icon={Plus} onClick={() => navigate(ROUTES.newRoutine)}>
                Criar primeira rotina
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <Input
              icon={Search}
              placeholder="Buscar rotina, pasta ou destino…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full max-w-[320px]"
              aria-label="Buscar rotina"
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
            <div className="flex-1" />
            <Segmented
              label="Filtrar rotinas"
              value={filter}
              onChange={setFilter}
              className="w-[300px]"
              options={[
                { value: 'all', label: 'Todas', count: routines.length },
                { value: 'active', label: 'Ativas', count: active },
                { value: 'paused', label: 'Pausadas', count: routines.length - active }
              ]}
            />
          </div>
          {visible.length === 0 ? (
            <Card className="p-8">
              <EmptyState
                icon={SearchX}
                title="Nada encontrado"
                description="Tente outro termo ou limpe os filtros."
                action={
                  <Button
                    onClick={() => {
                      setQuery('')
                      setFilter('all')
                    }}
                  >
                    Limpar filtros
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {visible.map((r) => (
                  <RoutineRow key={r.id} routine={r} progress={progressFor(progress, r.id)} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Page>
  )
}
