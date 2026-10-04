import {
  CircleCheck,
  CircleX,
  Copy,
  Download,
  FolderOpen,
  Mail,
  Play,
  Search,
  TriangleAlert,
  Ban,
  type LucideIcon
} from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useEffect, useMemo, useState } from 'react'
import type { DestinationResult, LogEntry, RunRecord } from '@shared/types'
import { backupStamp, formatBytes, formatDuration } from '@shared/format'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Drawer } from '@renderer/components/ui/Drawer'
import { Input } from '@renderer/components/ui/Input'
import { PathText } from '@renderer/components/ui/PathText'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { StatusPill } from '@renderer/components/ui/StatusPill'
import { Tooltip, TruncatedText } from '@renderer/components/ui/Tooltip'
import { runNow } from '@renderer/lib/actions'
import { bc, errorMessage } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import { formatFull, formatNumber, formatTime, formatWhen, plural } from '@renderer/lib/format'
import { RUN_STATUS, TRIGGER_LABEL } from '@renderer/lib/status'
import { closeRunDetail, useApp } from '@renderer/lib/store'
import { notify } from '@renderer/lib/toast'

const LEVEL: Record<LogEntry['level'], { label: string; cls: string }> = {
  info: { label: 'INFO', cls: 'text-fg-subtle' },
  warn: { label: 'AVISO', cls: 'text-warning' },
  error: { label: 'ERRO', cls: 'text-danger' }
}

const DEST_ICON: Record<string, { icon: LucideIcon; cls: string }> = {
  success: { icon: CircleCheck, cls: 'text-success' },
  warning: { icon: TriangleAlert, cls: 'text-warning' },
  failed: { icon: CircleX, cls: 'text-danger' },
  cancelled: { icon: Ban, cls: 'text-fg-subtle' }
}

const EMAIL_TEXT: Record<string, string> = {
  sent: 'Enviado',
  queued: 'Na fila — nova tentativa a cada 15 min',
  failed: 'Não foi possível enviar',
  skipped: 'Não enviado (regra da rotina)',
  not_configured: 'Não configurado'
}

const EMAIL_HINT: Record<string, string> = {
  queued: 'Sem conexão com o servidor agora. O BC Backup tenta de novo por até 24 h.',
  skipped: 'A rotina só avisa em alguns resultados, ou a execução foi cancelada.',
  not_configured: 'Notificação desligada, sem destinatários ou servidor de e-mail não configurado.'
}

function logTime(iso: string): string {
  const d = new Date(iso)
  return `${formatTime(d)}:${String(d.getSeconds()).padStart(2, '0')}`
}

function logText(log: LogEntry[]): string {
  return log.map((l) => `${logTime(l.t)}  ${LEVEL[l.level].label.padEnd(5)}  ${l.message}`).join('\n')
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption font-medium text-fg-subtle">{label}</span>
      <span className={cn('text-body font-medium text-fg tnum', tone)}>{value}</span>
    </div>
  )
}

function DestinationItem({ d }: { d: DestinationResult }) {
  const s = DEST_ICON[d.status] ?? DEST_ICON.success
  const Icon = s.icon
  return (
    <li className="flex gap-3 px-4 py-3">
      <Icon className={cn('mt-0.5 size-4 shrink-0', s.cls)} strokeWidth={1.75} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-small font-medium text-fg">{d.label ? `${d.label}` : d.path}</p>
          {d.status !== 'failed' && (
            <span className="shrink-0 text-caption text-fg-subtle tnum">
              {formatNumber(d.filesCopied)} arq. · {formatBytes(d.bytesCopied)}
            </span>
          )}
        </div>
        {d.error ? (
          <p className="text-small text-danger">{d.error}</p>
        ) : d.outputPath ? (
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <PathText path={d.outputPath} className="text-fg-muted" />
            </div>
            <IconButton
              icon={FolderOpen}
              label="Abrir pasta"
              size="sm"
              className="-my-1 size-6"
              onClick={() => void bc.app.openPath(d.outputPath!)}
            />
          </div>
        ) : (
          <PathText path={d.path} className="text-fg-muted" />
        )}
        <p className="text-caption text-fg-subtle tnum">
          {[
            d.freeBytesAfter !== undefined ? `${formatBytes(d.freeBytesAfter)} livres depois` : null,
            d.pruned.length
              ? plural(d.pruned.length, 'backup antigo removido', 'backups antigos removidos')
              : null,
            d.skipped.length ? plural(d.skipped.length, 'arquivo ignorado', 'arquivos ignorados') : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </li>
  )
}

function Summary({ r }: { r: RunRecord }) {
  const skipped = r.destinations.flatMap((d) => d.skipped)
  const uniqueSkipped = skipped.filter((s, i) => skipped.findIndex((x) => x.path === s.path) === i)
  return (
    <div className="flex flex-col gap-6 px-5 py-5">
      {r.status === 'failed' && r.errorMessage && (
        <Callout tone="danger" title="O que aconteceu">
          {r.errorMessage}
        </Callout>
      )}
      <section className="grid grid-cols-3 gap-x-6 gap-y-4 rounded-lg bg-surface-sunken p-4 dark:bg-surface">
        <Metric label="Arquivos" value={formatNumber(r.filesCopied)} />
        <Metric label="Dados" value={formatBytes(r.bytesCopied)} />
        <Metric label="Duração" value={r.durationMs !== undefined ? formatDuration(r.durationMs) : '—'} />
        <Metric
          label="Avisos"
          value={formatNumber(r.warnings)}
          tone={r.warnings ? 'text-warning' : undefined}
        />
        <Metric label="Erros" value={formatNumber(r.errors)} tone={r.errors ? 'text-danger' : undefined} />
        <Metric label="Origem" value={TRIGGER_LABEL[r.trigger] ?? r.trigger} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-caption font-medium text-fg-subtle">Destinos</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {r.destinations.map((d) => (
            <DestinationItem key={d.destinationId} d={d} />
          ))}
        </ul>
      </section>

      {uniqueSkipped.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-caption font-medium text-fg-subtle">Arquivos ignorados</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {uniqueSkipped.map((s) => (
              <li key={s.path} className="flex flex-col gap-0.5 px-4 py-2.5">
                <PathText path={s.path} className="text-fg" />
                <span className="text-caption text-warning">{s.reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-fg-subtle">
            Arquivos em uso não impedem o backup. Feche o programa que os usa para que entrem na próxima
            cópia.
          </p>
        </section>
      )}

      <section className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
        <Mail className="size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
        <span className="flex-1 text-small text-fg-muted">E-mail</span>
        <Tooltip label={EMAIL_HINT[r.email ?? 'not_configured']}>
          <span
            className={cn(
              'text-small font-medium',
              r.email === 'sent'
                ? 'text-success'
                : r.email === 'failed'
                  ? 'text-danger'
                  : r.email === 'queued'
                    ? 'text-warning'
                    : 'text-fg-muted'
            )}
          >
            {EMAIL_TEXT[r.email ?? 'not_configured']}
          </span>
        </Tooltip>
      </section>
      {r.emailError && <p className="-mt-4 text-caption text-danger">{r.emailError}</p>}
    </div>
  )
}

function LogView({ log, fileStamp }: { log: LogEntry[]; fileStamp: string }) {
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [query, setQuery] = useState('')
  const lines = useMemo(() => {
    const q = query.trim().toLowerCase()
    return log.filter(
      (l) => (!onlyIssues || l.level !== 'info') && (!q || l.message.toLowerCase().includes(q))
    )
  }, [log, onlyIssues, query])

  const save = (): void => {
    const url = URL.createObjectURL(new Blob([logText(log)], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `bc-backup-log-${fileStamp}.txt`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(logText(lines))
      notify.success('Log copiado', { description: plural(lines.length, 'linha', 'linhas') })
    } catch {
      notify.error('Não foi possível copiar o log')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-3">
        <Input
          icon={Search}
          placeholder="Buscar no log"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1"
          aria-label="Buscar no log"
        />
        <Checkbox checked={onlyIssues} onCheckedChange={setOnlyIssues} label="Só erros e avisos" />
        <div className="flex items-center gap-1">
          <IconButton
            icon={Copy}
            label="Copiar log"
            variant="secondary"
            size="md"
            onClick={() => void copy()}
          />
          <IconButton icon={Download} label="Salvar como .txt" variant="secondary" size="md" onClick={save} />
        </div>
      </div>
      <div
        className="mx-5 mb-5 min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-surface py-2 font-mono text-mono"
        data-selectable
        role="region"
        aria-label={`Log · ${plural(lines.length, 'linha', 'linhas')}`}
      >
        {lines.length === 0 ? (
          <p className="px-3 py-2 font-sans text-small text-fg-subtle">
            Nenhuma linha corresponde ao filtro.
          </p>
        ) : (
          lines.map((l, i) => {
            const lv = LEVEL[l.level]
            return (
              <div
                key={i}
                className={cn(
                  'grid grid-cols-[64px_44px_1fr] gap-2 px-3 py-px select-text',
                  l.level === 'error' && 'bg-danger-soft/60',
                  l.level === 'warn' && 'bg-warning-soft/50'
                )}
              >
                <span className={cn('tnum', l.level === 'info' ? 'text-fg-subtle' : 'text-fg-muted')}>
                  {logTime(l.t)}
                </span>
                <span className={cn('font-medium', lv.cls)}>{lv.label}</span>
                <span className="break-words whitespace-pre-wrap text-fg">{l.message}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** Mesma geometria do Resumo enquanto o registro carrega (sem salto ao chegar). */
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-5 py-5" aria-hidden>
      <div className="flex gap-5 border-b border-border pb-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-10" />
      </div>
      <div className="grid grid-cols-3 gap-x-6 gap-y-4 rounded-lg bg-surface-sunken p-4 dark:bg-surface">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-16" />
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-72" />
        </div>
      </div>
    </div>
  )
}

/** Drawer de detalhes de uma execução (§7e): Resumo | Log. */
export function RunDetailDrawer() {
  const runId = useApp((s) => s.detailRunId)
  const routines = useApp((s) => s.routines)
  const now = useNow()
  const [loaded, setLoaded] = useState<{ id: string; record: RunRecord | null } | null>(null)
  const [tab, setTab] = useState('resumo')

  useEffect(() => {
    if (!runId) return
    let alive = true
    bc.runs
      .get(runId)
      .then((record) => alive && setLoaded({ id: runId, record }))
      .catch((err) => {
        if (!alive) return
        setLoaded({ id: runId, record: null })
        notify.error('Não foi possível abrir a execução', { description: errorMessage(err) })
      })
    return () => {
      alive = false
    }
  }, [runId])

  const current = loaded && loaded.id === runId ? loaded : null
  const r = current?.record ?? null
  const notFound = current !== null && current.record === null
  const routine = r ? routines.find((x) => x.id === r.routineId) : undefined
  const output = r?.destinations.find((d) => d.outputPath)?.outputPath
  const firstDest = r?.destinations[0]

  return (
    <Drawer
      open={runId !== null}
      onOpenChange={(open) => {
        if (!open) {
          closeRunDetail()
          setTab('resumo')
        }
      }}
      title={
        r ? (
          <>
            <TruncatedText>{r.routineName}</TruncatedText>
            <StatusPill meta={RUN_STATUS[r.status]} />
          </>
        ) : notFound ? (
          <span className="text-fg-muted">Execução não encontrada</span>
        ) : (
          <>
            <span className="sr-only">Carregando execução…</span>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-[22px] w-24 rounded-full" />
          </>
        )
      }
      subtitle={
        r ? (
          <span className="flex min-w-0 items-center gap-1.5 tnum">
            <Tooltip label={formatFull(r.startedAt)}>
              <span>{formatWhen(r.startedAt, now)}</span>
            </Tooltip>
            {r.durationMs !== undefined && <span>· {formatDuration(r.durationMs)}</span>}
            {firstDest && (
              <span className="truncate">
                · {firstDest.label || firstDest.path}
                {r.destinations.length > 1 ? ` +${r.destinations.length - 1}` : ''}
              </span>
            )}
          </span>
        ) : undefined
      }
      footer={
        r ? (
          <>
            {output && (
              <Button variant="secondary" icon={FolderOpen} onClick={() => void bc.app.openPath(output)}>
                Abrir pasta
              </Button>
            )}
            {routine && (
              <Button
                variant={r.status === 'failed' ? 'primary' : 'secondary'}
                icon={Play}
                onClick={() => {
                  closeRunDetail()
                  void runNow(routine, { openDrawer: true })
                }}
              >
                Executar novamente
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {!r && !notFound && <DetailSkeleton />}
      {notFound && (
        <p className="px-5 py-6 text-small text-fg-muted">
          Este registro não existe mais — o histórico pode ter sido limpo ou ficado mais antigo que o período
          guardado.
        </p>
      )}
      {r && (
        <Tabs.Root value={tab} onValueChange={setTab} className="flex h-full flex-col">
          <Tabs.List
            className="sticky top-0 z-10 flex shrink-0 gap-5 border-b border-border bg-surface-raised px-5"
            aria-label="Detalhes da execução"
          >
            {[
              { v: 'resumo', l: 'Resumo' },
              { v: 'log', l: 'Log', n: r.log.length }
            ].map((t) => (
              <Tabs.Trigger
                key={t.v}
                value={t.v}
                className={cn(
                  'relative -mb-px flex h-10 items-center gap-1.5 border-b-2 border-transparent text-small font-medium text-fg-muted transition-colors duration-[120ms] hover:text-fg',
                  'data-[state=active]:border-accent data-[state=active]:text-fg focus-visible:outline-offset-[-2px]'
                )}
              >
                {t.l}
                {t.n !== undefined && <span className="text-caption text-fg-subtle tnum">{t.n}</span>}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {/* tabIndex -1: os painéis já têm conteúdo focável; evita uma parada de Tab sem indicador */}
          <Tabs.Content value="resumo" tabIndex={-1} className="focus-visible:outline-none">
            <Summary r={r} />
          </Tabs.Content>
          <Tabs.Content value="log" tabIndex={-1} className="min-h-0 flex-1 focus-visible:outline-none">
            <LogView
              log={r.log}
              fileStamp={`${r.routineName.replace(/[\\/:*?"<>|]+/g, '-')}-${backupStamp(new Date(r.startedAt))}`}
            />
          </Tabs.Content>
        </Tabs.Root>
      )}
    </Drawer>
  )
}
