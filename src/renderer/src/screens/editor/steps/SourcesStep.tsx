import {
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderPlus,
  LoaderCircle,
  RotateCcw,
  Upload,
  X
} from 'lucide-react'
import { Collapsible } from 'radix-ui'
import { useState, type DragEvent } from 'react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import { DEFAULT_EXCLUDES } from '@shared/defaults'
import { formatBytes } from '@shared/format'
import type { SourceItem, SourceKind } from '@shared/types'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { ChipInput } from '@renderer/components/ui/ChipInput'
import { Field, Input } from '@renderer/components/ui/Input'
import { NumberStepper } from '@renderer/components/ui/NumberStepper'
import { PathText } from '@renderer/components/ui/PathText'
import { Switch } from '@renderer/components/ui/Switch'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { bc, errorMessage } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { baseName, formatNumber, plural } from '@renderer/lib/format'
import { notify } from '@renderer/lib/toast'
import { NAME_MAX, newId, type Update } from '../model'
import type { SourceSizes } from '../sizes'
import { IssueList } from './shared'

type PathForFile = (file: File) => string

function pathForFile(): PathForFile | null {
  const fn = (window as unknown as { bc?: { pathForFile?: PathForFile } }).bc?.pathForFile
  return typeof fn === 'function' ? fn : null
}

/** Pasta onde o item está ("C:\Users\Ana\Desktop"); raízes devolvem o próprio caminho. */
function parentPath(path: string): string {
  const clean = path.replace(/[\\/]+$/, '')
  const unc = /^\\\\[^\\]+\\[^\\]+$/.test(clean)
  const cut = Math.max(clean.lastIndexOf('\\'), clean.lastIndexOf('/'))
  if (unc || cut < 0 || /^[A-Za-z]:$/.test(clean)) return path
  const parent = clean.slice(0, cut)
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  return parent || '/'
}

export function SourcesStep({
  draft,
  update,
  sizes,
  issues,
  autoFocus
}: {
  draft: RoutineInput
  update: Update
  sizes: SourceSizes
  issues: ValidationIssue[]
  autoFocus: boolean
}) {
  const [nameTouched, setNameTouched] = useState(draft.name.trim().length > 0)
  const [dragging, setDragging] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const nameIssues = issues.filter((i) => /\bnome\b/i.test(i.message))
  const nameError = nameIssues.find((i) => i.level === 'error')
  const nameWarning = nameError ? undefined : nameIssues.find((i) => i.level === 'warning')
  const otherIssues = issues.filter((i) => !nameIssues.includes(i))
  const sourcesError = otherIssues.some((i) => i.level === 'error')

  const addPaths = (paths: string[], kind: SourceKind | ((p: string) => SourceKind)): void => {
    update((d) => {
      const existing = new Set(d.sources.map((s) => s.path.toLowerCase()))
      const added: SourceItem[] = paths
        .filter((p) => !existing.has(p.toLowerCase()))
        .map((p) => ({ id: newId('src'), path: p, kind: typeof kind === 'function' ? kind(p) : kind }))
      const next = { ...d, sources: [...d.sources, ...added] }
      if (!nameTouched && !d.name.trim() && added[0]) next.name = baseName(added[0].path)
      return next
    })
  }

  const pick = async (kind: SourceKind): Promise<void> => {
    try {
      const r =
        kind === 'folder'
          ? await bc.system.pickFolders({ multi: true, title: 'Escolha as pastas para copiar' })
          : await bc.system.pickFiles({ title: 'Escolha os arquivos para copiar' })
      if (!r.canceled && r.paths.length) addPaths(r.paths, kind)
    } catch (err) {
      notify.error('Não foi possível abrir o seletor', { description: errorMessage(err) })
    }
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const toPath = pathForFile()
    if (!toPath) {
      notify.info('Use os botões para adicionar', {
        description: 'Arrastar arquivos para cá ainda não está disponível nesta versão.'
      })
      return
    }
    const items = [...e.dataTransfer.items]
    const entries: { path: string; kind: SourceKind }[] = []
    items.forEach((item, i) => {
      const file = e.dataTransfer.files[i]
      if (!file) return
      const entry = item.webkitGetAsEntry?.()
      entries.push({ path: toPath(file), kind: entry?.isDirectory ? 'folder' : 'file' })
    })
    const kinds = new Map(entries.map((x) => [x.path, x.kind]))
    addPaths(entries.map((x) => x.path).filter(Boolean), (p) => kinds.get(p) ?? 'folder')
  }

  const f = draft.filters
  const total = sizes.total
  const empty = draft.sources.length === 0
  const excludeCount = f.exclude.length

  // Os botões acima fazem o mesmo para teclado e leitor de tela; a área é só um atalho para o mouse.
  const dropZone = (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={() => void pick('folder')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex w-full items-center justify-center gap-3 rounded-lg border border-dashed text-small transition-[background-color,border-color,color] duration-[120ms]',
        empty ? 'h-36 flex-col' : 'h-14',
        dragging
          ? 'border-accent bg-accent-soft text-accent-text'
          : 'border-border-strong text-fg-subtle hover:border-fg-subtle/60 hover:bg-surface-hover/50 hover:text-fg-muted'
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-lg',
          empty ? 'size-10 bg-surface-hover text-fg-muted' : 'size-auto'
        )}
      >
        <Upload className={empty ? 'size-5' : 'size-4'} strokeWidth={1.75} />
      </span>
      <span className="flex flex-col items-center gap-0.5">
        <span className={cn(empty && 'font-medium text-fg')}>Arraste pastas ou arquivos para cá</span>
        {empty && <span className="text-caption text-fg-subtle">ou clique para escolher uma pasta</span>}
      </span>
    </button>
  )

  return (
    <div className="flex flex-col gap-7">
      <Field
        label="Nome da rotina"
        error={nameError?.message}
        description={
          nameWarning ? (
            <span className="text-warning">{nameWarning.message}</span>
          ) : (
            'Aparece na lista, no histórico e nos e-mails.'
          )
        }
      >
        {(id) => (
          <Input
            id={id}
            autoFocus={autoFocus}
            value={draft.name}
            maxLength={NAME_MAX}
            invalid={!!nameError}
            placeholder="Ex.: Documentos do escritório"
            onChange={(e) => {
              setNameTouched(true)
              const name = e.target.value
              update((d) => ({ ...d, name }))
            }}
            className="max-w-[420px]"
          />
        )}
      </Field>

      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h3 className="text-small font-medium text-fg">O que copiar</h3>
            <p className="mt-0.5 text-caption text-fg-subtle">
              Pastas e arquivos avulsos, de qualquer disco.
            </p>
          </div>
          {!empty && (
            <span className="flex items-center gap-1.5 text-caption text-fg-muted tnum">
              {sizes.loading ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin-slow" strokeWidth={2} /> Calculando tamanho…
                </>
              ) : total ? (
                <>
                  ≈ <span className="font-medium text-fg">{formatBytes(total.bytes)}</span> em{' '}
                  {plural(total.files, 'arquivo', 'arquivos')}
                  {total.partial && <span className="text-fg-subtle">(parcial)</span>}
                </>
              ) : null}
            </span>
          )}
        </div>

        {!empty && (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card">
            {draft.sources.map((s) => {
              const est = sizes.get(s.path)
              const Icon = s.kind === 'folder' ? Folder : File
              return (
                <li key={s.id} className="group flex h-14 items-center gap-3 px-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Tooltip
                      label={<span className="font-mono text-[11.5px]">{s.path}</span>}
                      align="start"
                    >
                      <span className="truncate text-small font-medium text-fg">{baseName(s.path)}</span>
                    </Tooltip>
                    <PathText path={parentPath(s.path)} className="text-fg-subtle" tooltip="never" />
                  </div>
                  <span className="w-[120px] shrink-0 text-right text-caption text-fg-muted tnum">
                    {est === undefined ? (
                      <span className="inline-block h-3 w-14 animate-pulse rounded-xs bg-surface-hover align-middle" />
                    ) : est === 'error' ? (
                      <Tooltip label="Não foi possível ler esta origem agora.">
                        <span className="text-warning">Indisponível</span>
                      </Tooltip>
                    ) : (
                      <>
                        {formatBytes(est.bytes)}
                        {s.kind === 'folder' && (
                          <span className="block text-fg-subtle">
                            {plural(est.files, 'arquivo', 'arquivos')}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                  <IconButton
                    icon={X}
                    label={`Remover ${baseName(s.path)}`}
                    onClick={() => update((d) => ({ ...d, sources: d.sources.filter((x) => x.id !== s.id) }))}
                  />
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex items-center gap-2" data-invalid={sourcesError && empty ? '' : undefined}>
          <Button icon={FolderPlus} onClick={() => void pick('folder')}>
            Adicionar pastas
          </Button>
          <Button icon={FilePlus} onClick={() => void pick('file')}>
            Adicionar arquivos
          </Button>
        </div>
        {dropZone}
        <IssueList issues={otherIssues} />
      </section>

      <Collapsible.Root open={advancedOpen} onOpenChange={setAdvancedOpen} className="flex flex-col">
        <Collapsible.Trigger className="group -ml-1 flex w-fit items-center gap-1.5 rounded-sm px-1 py-0.5 text-small font-medium text-fg-muted hover:text-fg">
          <ChevronRight
            className="size-4 transition-transform duration-[180ms] ease-out group-data-[state=open]:rotate-90"
            strokeWidth={1.75}
          />
          Avançado
          <span className="font-normal text-fg-subtle">
            · {plural(excludeCount, 'exclusão', 'exclusões')}
            {f.include.length ? ` · ${plural(f.include.length, 'inclusão', 'inclusões')}` : ''}
            {f.skipHiddenAndSystem ? ' · ocultos ignorados' : ''}
            {f.maxFileSizeMB ? ` · até ${formatNumber(f.maxFileSizeMB)} MB` : ''}
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
          <div className="mt-4 flex flex-col gap-5 rounded-lg border border-border bg-surface-raised p-5 shadow-card">
            <Field
              label="Não copiar"
              description="Padrões como *.tmp ou **/node_modules/**. Os mais comuns já vêm preenchidos."
              aside={
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  className="-my-1 h-6"
                  onClick={() =>
                    update((d) => ({ ...d, filters: { ...d.filters, exclude: [...DEFAULT_EXCLUDES] } }))
                  }
                >
                  Restaurar padrão
                </Button>
              }
            >
              {(id) => (
                <ChipInput
                  id={id}
                  mono
                  values={f.exclude}
                  placeholder="Ex.: *.bak"
                  onChange={(exclude) => update((d) => ({ ...d, filters: { ...d.filters, exclude } }))}
                />
              )}
            </Field>
            <Field
              label="Copiar somente"
              description="Vazio = tudo. Se preencher, só arquivos que combinam entram no backup (ex.: *.xml)."
            >
              {(id) => (
                <ChipInput
                  id={id}
                  mono
                  values={f.include}
                  placeholder="Ex.: *.xml"
                  onChange={(include) => update((d) => ({ ...d, filters: { ...d.filters, include } }))}
                />
              )}
            </Field>
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="text-small font-medium text-fg">Ignorar arquivos ocultos e de sistema</p>
                <p className="text-caption text-fg-subtle">
                  Recomendado: evita arquivos temporários do Windows.
                </p>
              </div>
              <Switch
                label="Ignorar arquivos ocultos e de sistema"
                checked={f.skipHiddenAndSystem}
                onCheckedChange={(v) =>
                  update((d) => ({ ...d, filters: { ...d.filters, skipHiddenAndSystem: v } }))
                }
              />
            </div>
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="text-small font-medium text-fg">Ignorar arquivos muito grandes</p>
                <p className="text-caption text-fg-subtle">Útil para pular vídeos e imagens de disco.</p>
              </div>
              <div className="flex items-center gap-3">
                {f.maxFileSizeMB !== null && (
                  <NumberStepper
                    label="Tamanho máximo em MB"
                    value={f.maxFileSizeMB}
                    min={1}
                    max={102400}
                    step={100}
                    suffix="MB"
                    onChange={(v) => update((d) => ({ ...d, filters: { ...d.filters, maxFileSizeMB: v } }))}
                  />
                )}
                <Switch
                  label="Ignorar arquivos muito grandes"
                  checked={f.maxFileSizeMB !== null}
                  onCheckedChange={(v) =>
                    update((d) => ({ ...d, filters: { ...d.filters, maxFileSizeMB: v ? 1024 : null } }))
                  }
                />
              </div>
            </div>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}
