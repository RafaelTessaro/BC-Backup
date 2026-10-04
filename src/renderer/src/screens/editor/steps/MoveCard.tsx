// Card "Mover: apagar da origem depois de copiar" do passo Origem (docs/research/04-mover-apos-copiar.md §3).
import { Clock3, FileCheck2, FolderOutput, LoaderCircle, ScanSearch } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MovePreview, RoutineInput, ValidationIssue } from '@shared/api'
import { DEFAULT_MOVE_SOURCES, MOVE_MIN_AGE_RANGE } from '@shared/defaults'
import { formatBytes } from '@shared/format'
import type { Filters, MoveSources } from '@shared/types'
import { Card } from '@renderer/components/ui/Card'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { ConfirmDialog } from '@renderer/components/ui/Dialog'
import { NumberStepper } from '@renderer/components/ui/NumberStepper'
import { Switch } from '@renderer/components/ui/Switch'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { bc } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { formatNumber, plural } from '@renderer/lib/format'
import { useDebounced } from '@renderer/lib/hooks'
import type { Update } from '../model'
import { IssueList } from './shared'

const TITLE = 'Mover: apagar da origem depois de copiar'

/** "C:\Backup" · "C:\A" e "C:\B" · "C:\A", "C:\B" e "C:\C" */
function quotedList(paths: string[]): string {
  const q = paths.map((p) => `“${p}”`)
  if (q.length <= 1) return q[0] ?? ''
  return `${q.slice(0, -1).join(', ')} e ${q[q.length - 1]}`
}

/** Texto da confirmação ao ligar (mostra a retenção atual: é ela que decide por quanto tempo). */
export function moveConfirmText(draft: RoutineInput): string {
  const folders = draft.sources.filter((s) => s.kind === 'folder').map((s) => s.path)
  const what = folders.length ? `Os arquivos de ${quotedList(folders)}` : 'Os arquivos das pastas de origem'
  const r = draft.retention
  const kept = r.enabled
    ? `guardados conforme a retenção (últimos ${plural(r.days, 'dia', 'dias')}, mínimo ${formatNumber(r.minKeep)})`
    : 'guardados sem prazo (a retenção está desligada)'
  return `${what} serão apagados deste computador depois de copiados e conferidos em todos os destinos. Eles passarão a existir só nos destinos, ${kept}.`
}

function previewSentence(p: MovePreview): string {
  if (!p.files && !p.waiting) return 'Agora: nenhum arquivo para mover.'
  const parts: string[] = []
  parts.push(
    p.files
      ? `${plural(p.files, 'arquivo', 'arquivos')} (${formatBytes(p.bytes)}) ${p.files === 1 ? 'seria movido' : 'seriam movidos'}`
      : 'nenhum arquivo seria movido'
  )
  if (p.waiting)
    parts.push(`${formatNumber(p.waiting)} ${p.waiting === 1 ? 'recente aguardando' : 'recentes aguardando'}`)
  return `Agora: ${parts.join(' · ')}${p.partial ? ' (contagem parcial)' : ''}.`
}

function Preview({ folders, filters, minAge }: { folders: string[]; filters: Filters; minAge: number }) {
  const key = JSON.stringify([folders, filters, minAge])
  const debounced = useDebounced(key, 350)
  const [result, setResult] = useState<{ key: string; preview: MovePreview | null } | null>(null)

  useEffect(() => {
    const [paths, f, age] = JSON.parse(debounced) as [string[], Filters, number]
    if (!paths.length) return
    let alive = true
    bc.system
      .previewMove(paths, f, { ...DEFAULT_MOVE_SOURCES, enabled: true, minAgeMinutes: age })
      .then((preview) => alive && setResult({ key: debounced, preview }))
      .catch(() => alive && setResult({ key: debounced, preview: null }))
    return () => {
      alive = false
    }
  }, [debounced])

  if (!folders.length)
    return (
      <p className="text-small text-fg-muted">
        Adicione a pasta onde o sistema grava os backups para ver o que seria movido agora.
      </p>
    )
  const current = result?.key === key ? result : null
  if (!current)
    return (
      <p className="flex items-center gap-2 text-small text-fg-muted" role="status">
        <LoaderCircle className="size-3.5 animate-spin-slow" strokeWidth={2} aria-hidden /> Conferindo a
        pasta…
      </p>
    )
  if (!current.preview)
    return <p className="text-small text-warning">Não foi possível ler a pasta de origem agora.</p>
  const p = current.preview
  const names = [
    ...p.names.map((name) => ({ name, reason: null as string | null })),
    ...p.waitingItems.map((w) => ({ name: w.name, reason: w.reason as string | null }))
  ].slice(0, 10)
  return (
    <div className="flex flex-col gap-2.5" role="status">
      <p className="text-small text-fg tnum">{previewSentence(p)}</p>
      {names.length > 0 && (
        <ul className="flex flex-col gap-1">
          {names.map((n) => (
            <li key={`${n.reason ? 'w' : 'm'}:${n.name}`} className="flex min-w-0 items-center gap-2">
              {n.reason ? (
                <Clock3 className="size-3.5 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
              ) : (
                <FileCheck2 className="size-3.5 shrink-0 text-success" strokeWidth={1.75} aria-hidden />
              )}
              <span
                className={cn('min-w-0 truncate font-mono text-mono', n.reason ? 'text-fg-muted' : 'text-fg')}
                title={n.name}
              >
                {n.name}
              </span>
              {n.reason && (
                <Tooltip label={n.reason}>
                  <span className="shrink-0 text-caption text-fg-subtle">aguardando</span>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MoveCard({
  draft,
  update,
  issues
}: {
  draft: RoutineInput
  update: Update
  /** Problemas da validação com topic 'move' (passo Origem). */
  issues: ValidationIssue[]
}) {
  const [confirming, setConfirming] = useState(false)
  const move: MoveSources = { ...DEFAULT_MOVE_SOURCES, ...draft.moveSources }
  const enabled = draft.moveSources?.enabled === true
  const folders = draft.sources.filter((s) => s.kind === 'folder').map((s) => s.path)
  const set = (patch: Partial<MoveSources>): void =>
    update((d) => ({ ...d, moveSources: { ...DEFAULT_MOVE_SOURCES, ...d.moveSources, ...patch } }))

  return (
    <section className="flex flex-col gap-3" aria-label="Mover">
      <Card
        className={cn('overflow-hidden transition-colors duration-[180ms]', enabled && 'border-accent/35')}
      >
        <div className="flex items-start gap-4 px-5 py-4">
          <span
            className={cn(
              'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-[180ms]',
              enabled ? 'bg-accent-soft text-accent-text' : 'bg-surface-hover text-fg-muted'
            )}
          >
            <FolderOutput className="size-4" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-small font-medium text-fg">{TITLE}</p>
            <p className="mt-0.5 text-caption text-fg-subtle">
              Para a pasta onde o sistema (ERP) grava os próprios backups. Cada arquivo só é apagado depois de
              copiado e conferido em todos os destinos. As pastas são mantidas.
            </p>
          </div>
          <Switch
            className="mt-1"
            label={TITLE}
            checked={enabled}
            onCheckedChange={(v) => (v ? setConfirming(true) : set({ enabled: false }))}
          />
        </div>

        {enabled && (
          <>
            <div className="flex items-center justify-between gap-6 border-t border-border px-5 py-4">
              <div className="min-w-0">
                <p className="text-small font-medium text-fg">
                  Só mover arquivos sem alteração há pelo menos
                </p>
                <p className="mt-0.5 text-caption text-fg-subtle">
                  Evita pegar um backup que o sistema ainda está gravando. Agende o BC Backup para depois do
                  horário em que o sistema termina.
                </p>
              </div>
              <NumberStepper
                className="shrink-0"
                label="Minutos sem alteração"
                value={move.minAgeMinutes}
                min={MOVE_MIN_AGE_RANGE.min}
                max={MOVE_MIN_AGE_RANGE.max}
                step={5}
                suffix={move.minAgeMinutes === 1 ? 'minuto' : 'minutos'}
                onChange={(minAgeMinutes) => set({ minAgeMinutes })}
              />
            </div>
            <div className="border-t border-border px-5 py-4">
              <Checkbox
                checked={move.warnIfEmpty}
                onCheckedChange={(warnIfEmpty) => set({ warnIfEmpty })}
                label={<span className="font-medium text-fg">Avisar se não houver arquivo novo</span>}
              />
              <p className="mt-1 pl-6 text-caption text-fg-subtle">
                A execução termina em “Atenção” quando não houver nada para mover, um sinal de que o sistema
                não gerou o backup.
              </p>
            </div>
            <div className="flex gap-3 border-t border-border bg-surface-sunken/70 px-5 py-4 dark:bg-surface/60">
              <ScanSearch className="mt-0.5 size-4 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
              <div className="min-w-0 flex-1">
                <Preview folders={folders} filters={draft.filters} minAge={move.minAgeMinutes} />
              </div>
            </div>
          </>
        )}
      </Card>
      <IssueList issues={issues} paths={draft.sources.map((s) => s.path)} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Apagar arquivos da origem?"
        description={moveConfirmText(draft)}
        confirmLabel="Ativar “Mover”"
        onConfirm={() => set({ enabled: true })}
      >
        <p className="mt-3 text-small text-fg-subtle">
          Dica: crie uma rotina só para a pasta de backup do sistema. Documentos e outros arquivos ficam em
          outra rotina, sem “Mover”.
        </p>
      </ConfirmDialog>
    </section>
  )
}
