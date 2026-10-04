import {
  CalendarRange,
  Download,
  Ellipsis,
  Hand,
  History,
  Play,
  Plus,
  SearchX,
  Trash2,
  Undo2
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { RunSummary } from '@shared/types'
import { formatDuration } from '@shared/format'
import { ROUTES } from '@shared/routes'
import { Page, PageHeader } from '@renderer/components/shell/Page'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { ConfirmDialog } from '@renderer/components/ui/Dialog'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '@renderer/components/ui/Menu'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Select } from '@renderer/components/ui/Select'
import { StatusPill } from '@renderer/components/ui/StatusPill'
import { PathText } from '@renderer/components/ui/PathText'
import { Tooltip, TruncatedText } from '@renderer/components/ui/Tooltip'
import { bc, errorMessage } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import {
  dayKey,
  formatDayHeading,
  formatFull,
  formatNumber,
  formatSize,
  formatTime,
  plural
} from '@renderer/lib/format'
import { navigate } from '@renderer/lib/router'
import { RUN_STATUS, TRIGGER_LABEL } from '@renderer/lib/status'
import { openRunDetail, refreshRuns, useApp } from '@renderer/lib/store'
import { notify } from '@renderer/lib/toast'

type Period = '7' | '14' | '30' | '90' | 'all'
type StatusFilter = 'all' | 'success' | 'warning' | 'failed'

const COLS = 'grid-cols-[112px_minmax(0,1fr)_116px_76px_84px_80px_minmax(0,140px)]'

function toCsv(runs: RunSummary[]): string {
  const esc = (v: string | number | undefined): string => {
    const s = v === undefined ? '' : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = [
    'Início',
    'Fim',
    'Rotina',
    'Status',
    'Origem',
    'Duração (s)',
    'Arquivos',
    'Bytes',
    'Avisos',
    'Erros',
    'Mensagem'
  ]
  const rows = runs.map((r) =>
    [
      new Date(r.startedAt).toLocaleString('pt-BR'),
      r.finishedAt ? new Date(r.finishedAt).toLocaleString('pt-BR') : '',
      r.routineName,
      RUN_STATUS[r.status].label,
      TRIGGER_LABEL[r.trigger] ?? r.trigger,
      r.durationMs !== undefined ? Math.round(r.durationMs / 1000) : '',
      r.filesCopied,
      r.bytesCopied,
      r.warnings,
      r.errors,
      r.errorMessage ?? ''
    ]
      .map(esc)
      .join(';')
  )
  return '﻿' + [header.join(';'), ...rows].join('\r\n')
}

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function RunRow({ r, dest }: { r: RunSummary; dest?: string }) {
  const meta = RUN_STATUS[r.status]
  const failed = r.status === 'failed'
  return (
    // Linha inteira clicável com o mouse; para teclado/leitor de tela a ação é o botão do nome.
    <div
      role="row"
      onClick={() => openRunDetail(r.id)}
      className={cn(
        'grid h-11 w-full items-center gap-3 rounded-md px-3 text-left text-small transition-colors duration-[120ms] hover:bg-surface-hover',
        'has-[[data-row-main]:focus-visible]:outline-2 has-[[data-row-main]:focus-visible]:outline-offset-2 has-[[data-row-main]:focus-visible]:outline-ring',
        COLS
      )}
    >
      <span role="cell">
        <StatusPill meta={meta} />
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          data-row-main
          aria-label={`Ver detalhes: ${r.routineName}, ${meta.label}, ${formatFull(r.startedAt)}`}
          className="min-w-0 text-left font-medium text-fg focus-visible:outline-none"
        >
          <TruncatedText>{r.routineName}</TruncatedText>
        </button>
        {r.trigger !== 'schedule' && (
          <Tooltip label={TRIGGER_LABEL[r.trigger]}>
            <span className="text-fg-subtle">
              {r.trigger === 'manual' ? (
                <Hand className="size-3.5" strokeWidth={1.75} aria-label={TRIGGER_LABEL[r.trigger]} />
              ) : (
                <Undo2 className="size-3.5" strokeWidth={1.75} aria-label={TRIGGER_LABEL[r.trigger]} />
              )}
            </span>
          </Tooltip>
        )}
      </span>
      <Tooltip label={formatFull(r.startedAt)}>
        <span role="cell" className="text-fg-muted tnum">
          {formatTime(r.startedAt)}
          {r.finishedAt && (
            <span className="text-fg-subtle">
              {' '}
              <span aria-hidden>→</span>
              <span className="sr-only">até</span> {formatTime(r.finishedAt)}
            </span>
          )}
        </span>
      </Tooltip>
      {failed ? (
        <Tooltip label={r.errorMessage}>
          <span role="cell" className="col-span-3 truncate text-right text-danger">
            {r.errorMessage?.split(':')[0] ?? 'Falhou'}
          </span>
        </Tooltip>
      ) : (
        <>
          <span role="cell" className="text-right text-fg-muted tnum">
            {r.durationMs !== undefined ? formatDuration(r.durationMs) : '—'}
          </span>
          <span role="cell" className="text-right text-fg-muted tnum">
            {formatNumber(r.filesCopied)}
          </span>
          <span role="cell" className="text-right font-medium text-fg tnum">
            {formatSize(r.bytesCopied)}
          </span>
        </>
      )}
      <span role="cell" className="min-w-0 pl-2 text-fg-subtle">
        {dest && (
          <PathText
            path={dest}
            suffix={
              r.destinationCount > 1 ? (
                <span className="text-caption tnum">+{r.destinationCount - 1}</span>
              ) : undefined
            }
          />
        )}
      </span>
    </div>
  )
}

export function HistoryScreen() {
  const runs = useApp((s) => s.runs)
  const routines = useApp((s) => s.routines)
  const routineFilter = useApp((s) => s.historyRoutine)
  const now = useNow()
  const [period, setPeriod] = useState<Period>('14')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [confirmClear, setConfirmClear] = useState(false)
  const setRoutineFilter = (v: string): void => useApp.setState({ historyRoutine: v })

  const nowMs = now.getTime()
  const filtered = useMemo(() => {
    const limit = period === 'all' ? Infinity : Number(period) * 86_400_000
    return runs.filter(
      (r) =>
        nowMs - new Date(r.startedAt).getTime() <= limit &&
        (routineFilter === 'all' || r.routineId === routineFilter) &&
        (status === 'all' || r.status === status)
    )
  }, [runs, period, routineFilter, status, nowMs])

  const groups = useMemo(() => {
    const map = new Map<string, RunSummary[]>()
    for (const r of filtered) {
      const k = dayKey(r.startedAt)
      const list = map.get(k) ?? []
      list.push(r)
      map.set(k, list)
    }
    return [...map.entries()]
  }, [filtered])

  const destOf = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of routines) m[r.id] = r.destinations[0]?.path ?? ''
    return m
  }, [routines])

  const counts = useMemo(() => {
    const limit = period === 'all' ? Infinity : Number(period) * 86_400_000
    const base = runs.filter(
      (r) =>
        nowMs - new Date(r.startedAt).getTime() <= limit &&
        (routineFilter === 'all' || r.routineId === routineFilter)
    )
    return {
      all: base.length,
      success: base.filter((r) => r.status === 'success').length,
      warning: base.filter((r) => r.status === 'warning').length,
      failed: base.filter((r) => r.status === 'failed').length
    }
  }, [runs, period, routineFilter, nowMs])

  const clearFilters = (): void => {
    setStatus('all')
    setPeriod('all')
    setRoutineFilter('all')
  }

  const header = (
    <PageHeader
      title="Histórico"
      description="Cada execução, com o resultado por destino e o log completo"
      actions={
        runs.length > 0 && (
          <>
            <Button
              icon={Download}
              onClick={() => {
                download(`bc-backup-historico-${dayKey(new Date())}.csv`, toCsv(filtered))
                notify.success('Histórico exportado', {
                  description: plural(filtered.length, 'execução', 'execuções')
                })
              }}
              disabled={filtered.length === 0}
            >
              Exportar CSV
            </Button>
            <MenuRoot>
              <MenuTrigger asChild>
                <IconButton icon={Ellipsis} label="Mais ações" variant="secondary" size="md" />
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={Trash2} danger onSelect={() => setConfirmClear(true)}>
                  Limpar histórico
                </MenuItem>
              </MenuContent>
            </MenuRoot>
          </>
        )
      }
    />
  )

  if (runs.length === 0) {
    return (
      <Page>
        {header}
        <Card className="flex min-h-[380px] items-center justify-center rounded-xl p-10">
          <EmptyState
            icon={History}
            title="Nenhuma execução ainda"
            description="Assim que uma rotina rodar, o resultado aparece aqui."
            action={
              <Button
                variant="primary"
                icon={routines.length ? Play : Plus}
                onClick={() => navigate(routines.length ? ROUTES.routines : ROUTES.newRoutine)}
              >
                {routines.length ? 'Executar uma rotina agora' : 'Criar primeira rotina'}
              </Button>
            }
          />
        </Card>
      </Page>
    )
  }

  return (
    <Page>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select<Period>
          value={period}
          onChange={setPeriod}
          label="Período"
          className="w-[168px]"
          icon={<CalendarRange className="size-4 text-fg-subtle" strokeWidth={1.75} />}
          options={[
            { value: '7', label: 'Últimos 7 dias' },
            { value: '14', label: 'Últimos 14 dias' },
            { value: '30', label: 'Últimos 30 dias' },
            { value: '90', label: 'Últimos 90 dias' },
            { value: 'all', label: 'Todo o período' }
          ]}
        />
        <Select<string>
          value={routineFilter}
          onChange={setRoutineFilter}
          label="Rotina"
          className="w-[200px]"
          options={[
            { value: 'all', label: 'Todas as rotinas' },
            ...routines.map((r) => ({ value: r.id, label: r.name }))
          ]}
        />
        <div className="flex-1" />
        <Segmented<StatusFilter>
          label="Filtrar por status"
          value={status}
          onChange={setStatus}
          className="w-[460px]"
          options={[
            { value: 'all', label: 'Todos', count: counts.all },
            { value: 'success', label: 'Concluído', count: counts.success },
            { value: 'warning', label: 'Com avisos', count: counts.warning },
            { value: 'failed', label: 'Falhou', count: counts.failed }
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8">
          <EmptyState
            icon={SearchX}
            title="Nada encontrado"
            description="Nenhuma execução corresponde aos filtros. Tente outro período ou limpe os filtros."
            action={<Button onClick={clearFilters}>Limpar filtros</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden" role="table" aria-label="Execuções">
          <div
            role="row"
            className={cn(
              'grid h-9 items-center gap-3 border-b border-border px-5 text-caption font-medium text-fg-subtle',
              COLS
            )}
          >
            <span role="columnheader">Status</span>
            <span role="columnheader">Rotina</span>
            <span role="columnheader">Horário</span>
            <span role="columnheader" className="text-right">
              Duração
            </span>
            <span role="columnheader" className="text-right">
              Arquivos
            </span>
            <span role="columnheader" className="text-right">
              Tamanho
            </span>
            <span role="columnheader" className="pl-2">
              Destino
            </span>
          </div>
          {groups.map(([key, list]) => (
            <div key={key} role="rowgroup" className="border-b border-border last:border-b-0">
              <div className="flex items-baseline justify-between px-5 pt-4 pb-1.5">
                <span className="text-overline text-fg-subtle">
                  {formatDayHeading(list[0].startedAt, now)}
                </span>
                <span className="text-caption text-fg-subtle tnum">
                  {plural(list.length, 'execução', 'execuções')}
                </span>
              </div>
              <div className="px-2 pb-2">
                {list.map((r) => (
                  <RunRow key={r.id} r={r} dest={destOf[r.routineId]} />
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Limpar todo o histórico?"
        description="Os registros e logs das execuções serão apagados. Os backups nos destinos não são afetados."
        confirmLabel="Limpar histórico"
        onConfirm={async () => {
          try {
            await bc.runs.clear()
            await refreshRuns()
            notify.info('Histórico limpo')
          } catch (err) {
            notify.error('Não foi possível limpar', { description: errorMessage(err) })
          }
        }}
      />
    </Page>
  )
}
