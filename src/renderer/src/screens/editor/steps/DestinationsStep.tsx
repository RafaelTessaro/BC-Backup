import {
  FileArchive,
  FolderOpen,
  FolderTree,
  HardDrive,
  Plus,
  Server,
  Usb,
  X,
  type LucideIcon
} from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { useEffect, useRef, useState, type Ref } from 'react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import { backupStamp, formatBytes } from '@shared/format'
import type { Destination, DiskSpace, DriveInfo } from '@shared/types'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { DiskUsageBar } from '@renderer/components/ui/DiskUsageBar'
import { Field, Input } from '@renderer/components/ui/Input'
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/Menu'
import { PathText } from '@renderer/components/ui/PathText'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { bc, errorMessage } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import { baseName, formatPercent, isNetworkPath } from '@renderer/lib/format'
import { useApp } from '@renderer/lib/store'
import { notify } from '@renderer/lib/toast'
import { ZIP_LEVELS, backupExamplePath, isDriveRoot, joinPath, newId, pathKey, type Update } from '../model'
import type { SourceSizes } from '../sizes'
import { IssueList, SectionTitle } from './shared'

function driveIcon(path: string, drive?: DriveInfo): LucideIcon {
  if (isNetworkPath(path) || drive?.network) return Server
  return drive?.removable ? Usb : HardDrive
}

function DriveIcon({ path, drive, className }: { path: string; drive?: DriveInfo; className?: string }) {
  if (isNetworkPath(path) || drive?.network) return <Server className={className} strokeWidth={1.75} />
  return drive?.removable ? (
    <Usb className={className} strokeWidth={1.75} />
  ) : (
    <HardDrive className={className} strokeWidth={1.75} />
  )
}

function findDrive(drives: DriveInfo[], path: string): DriveInfo | undefined {
  const up = path.toUpperCase()
  return [...drives]
    .sort((a, b) => b.path.length - a.path.length)
    .find((d) => up.startsWith(d.path.toUpperCase().replace(/\\$/, '')))
}

const isRootPath = (p: string): boolean =>
  /^[A-Za-z]:[\\/]?$/.test(p) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(p) || p === '/'

/** O destino está dentro da origem (ou a origem dentro do destino)? Comparação só pelo texto. */
function overlaps(a: string, b: string): boolean {
  const x = pathKey(a, true)
  const y = pathKey(b, true)
  const inside = (c: string, p: string): boolean =>
    c === p || c.startsWith(p.endsWith('\\') ? p : `${p}\\`) || c.startsWith(p.endsWith('/') ? p : `${p}/`)
  return inside(x, y) || inside(y, x)
}

const driveLetter = (p: string): string | null => (/^[A-Za-z]:/.test(p) ? p[0].toUpperCase() : null)

/**
 * Distribui os problemas da etapa entre os cartões: pelo caminho citado na mensagem ou, nas
 * mensagens genéricas do main ("dentro da origem", "mesmo disco"), pela checagem local.
 */
function assignIssues(
  issues: ValidationIssue[],
  dests: Destination[],
  sources: string[]
): { byDest: Map<string, ValidationIssue[]>; general: ValidationIssue[] } {
  const byDest = new Map<string, ValidationIssue[]>(dests.map((d) => [d.id, []]))
  const general: ValidationIssue[] = []
  for (const issue of issues) {
    const tagged = issue.destinationId ? dests.find((d) => d.id === issue.destinationId) : undefined
    if (tagged) {
      byDest.get(tagged.id)!.push(issue)
      continue
    }
    const cited = dests
      .filter((d) => issue.message.includes(d.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    let owners: Destination[] = cited ? [cited] : []
    if (!owners.length && /dentro d[ao] (origem|destino)/i.test(issue.message))
      owners = dests.filter((d) => sources.some((s) => overlaps(d.path, s)))
    else if (!owners.length && /mesmo disco/i.test(issue.message))
      owners = dests.filter((d) => {
        const l = driveLetter(d.path)
        return (
          l !== null && sources.some((s) => driveLetter(s) === l) && !sources.some((s) => overlaps(d.path, s))
        )
      })
    if (owners.length) for (const d of owners) byDest.get(d.id)!.push(issue)
    else general.push(issue)
  }
  return { byDest, general }
}

function useSpace(path: string): DiskSpace | null | undefined {
  const [state, setState] = useState<{ path: string; space: DiskSpace | null } | null>(null)
  useEffect(() => {
    let alive = true
    bc.system
      .diskSpace(path)
      .then((space) => alive && setState({ path, space }))
      .catch(() => alive && setState({ path, space: null }))
    return () => {
      alive = false
    }
  }, [path])
  return state && state.path === path ? state.space : undefined
}

function DestinationCard({
  dest,
  drive,
  incoming,
  issues,
  sourcePaths,
  onChange,
  onRemove
}: {
  dest: Destination
  drive?: DriveInfo
  incoming?: number
  issues: ValidationIssue[]
  sourcePaths: string[]
  onChange: (patch: Partial<Destination>) => void
  onRemove: () => void
}) {
  const space = useSpace(dest.path)
  const enabled = dest.enabled !== false
  const lacking = space && incoming ? incoming - space.free : 0
  const network = isNetworkPath(dest.path) || !!drive?.network
  // Pasta dentro de uma unidade: o nome é a pasta ("Backup"), não a unidade ("Windows").
  const own = isRootPath(dest.path) ? drive?.label || dest.path : baseName(dest.path)
  const name = dest.label?.trim() || own
  const where = drive && drive.label.toLowerCase() !== name.toLowerCase() ? drive.label : null
  const reportedUnavailable = issues.some((i) => /indispon|acessar/i.test(i.message))
  const placeholder = network
    ? 'Ex.: Servidor do escritório (opcional)'
    : drive?.removable
      ? 'Ex.: HD externo azul (opcional)'
      : 'Ex.: Disco de dados (opcional)'
  return (
    <li className={cn('flex flex-col gap-4 p-4', !enabled && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
          <DriveIcon path={dest.path} drive={drive} className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-small font-medium text-fg">
            {name}
            {where && <span className="font-normal text-fg-subtle"> · {where}</span>}
          </span>
          <PathText path={dest.path} className="text-fg-subtle" />
        </div>
        <Switch
          label={`Usar ${name} nas execuções`}
          checked={enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
        />
        <IconButton icon={X} label={`Remover ${name}`} onClick={onRemove} />
      </div>
      {space === undefined ? (
        <div className="h-[26px] animate-pulse rounded-xs bg-surface-hover/70" />
      ) : space ? (
        <DiskUsageBar total={space.total} free={space.free} incoming={enabled ? incoming : undefined} />
      ) : (
        !reportedUnavailable && (
          <p className="text-caption text-warning">
            Destino indisponível agora — {network ? 'verifique a rede e o acesso à pasta' : 'conecte o disco'}{' '}
            antes do horário do backup.
          </p>
        )
      )}
      {lacking > 0 && enabled && (
        <p className="-mt-2 text-caption text-danger">
          Sem espaço para um backup completo: faltam {formatBytes(lacking)}.
        </p>
      )}
      {!enabled && (
        <p className="-mt-2 text-caption text-fg-subtle">Desligado: fica guardado, mas não recebe backups.</p>
      )}
      <div className="flex items-center gap-3">
        <label className="shrink-0 text-caption font-medium text-fg-muted" htmlFor={`label-${dest.id}`}>
          Apelido
        </label>
        <Input
          id={`label-${dest.id}`}
          value={dest.label ?? ''}
          placeholder={placeholder}
          maxLength={60}
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-7 text-small"
        />
      </div>
      <IssueList issues={issues} paths={[dest.path, ...sourcePaths]} />
    </li>
  )
}

function AddDestinationMenu({
  drives,
  used,
  onAdd,
  variant = 'secondary',
  buttonRef,
  onCancelTyping
}: {
  drives: DriveInfo[]
  used: string[]
  onAdd: (path: string, label?: string) => void
  variant?: 'primary' | 'secondary'
  buttonRef?: Ref<HTMLButtonElement>
  /** O campo de caminho de rede fechou sem adicionar (o foco volta para o botão). */
  onCancelTyping?: () => void
}) {
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [tried, setTried] = useState(false)
  const usedSet = new Set(used.map((p) => pathKey(p, true)))

  const pickFolder = async (): Promise<void> => {
    try {
      const r = await bc.system.pickFolders({ multi: false, title: 'Escolha a pasta de destino' })
      if (!r.canceled && r.paths[0]) onAdd(r.paths[0])
    } catch (err) {
      notify.error('Não foi possível abrir o seletor', { description: errorMessage(err) })
    }
  }

  if (typing) {
    // "//SERVIDOR/backup" também vale: vira "\\SERVIDOR\backup".
    const value = typed.trim().startsWith('//') ? typed.trim().replace(/\//g, '\\') : typed.trim()
    const valid = /^(\\\\[^\\]+\\[^\\]+|[A-Za-z]:\\|\/)/.test(value)
    const close = (added = false): void => {
      setTyping(false)
      setTyped('')
      setTried(false)
      if (!added) onCancelTyping?.()
    }
    return (
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          setTried(true)
          if (!valid) return
          onAdd(value)
          close(true)
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            icon={Server}
            value={typed}
            invalid={tried && !valid}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="\\SERVIDOR\backup"
            className="w-[320px]"
            inputClassName="font-mono text-[13px]"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
            aria-label="Caminho de rede"
            aria-describedby="caminho-rede-ajuda"
          />
          <Button type="submit" variant="primary">
            Adicionar
          </Button>
          <Button variant="ghost" onClick={() => close()}>
            Cancelar
          </Button>
        </div>
        <p
          id="caminho-rede-ajuda"
          className={cn('text-caption', tried && !valid ? 'text-danger' : 'text-fg-subtle')}
        >
          {tried && !valid
            ? 'Use o formato \\\\SERVIDOR\\pasta (ou uma unidade, como E:\\).'
            : 'Formato: \\\\SERVIDOR\\pasta. O computador precisa ter acesso a essa pasta.'}
        </p>
      </form>
    )
  }

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button ref={buttonRef} variant={variant} icon={Plus} className="w-fit">
          Adicionar destino
        </Button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[360px]">
        <MenuLabel>Unidades deste computador</MenuLabel>
        {drives.length === 0 && (
          <MenuItem icon={HardDrive} disabled>
            Nenhuma unidade encontrada
          </MenuItem>
        )}
        {drives.map((d) => {
          const Icon = driveIcon(d.path, d)
          const added = usedSet.has(pathKey(d.path, true))
          const pct = d.total ? ((d.total - d.free) / d.total) * 100 : 0
          // Unidade de rede: o rótulo costuma repetir o nome do servidor que já está no caminho.
          const redundant = d.path.toLowerCase().includes(d.label.toLowerCase())
          return (
            <MenuItem
              key={d.path}
              icon={Icon}
              disabled={added}
              onSelect={() => onAdd(d.path, d.removable || d.network ? d.label : undefined)}
              hint={
                added ? (
                  'Adicionado'
                ) : (
                  <span className={cn('tnum', pct > 90 && 'text-danger')}>
                    {formatBytes(d.free)} livres{pct > 90 ? ` · ${formatPercent(pct)} usado` : ''}
                  </span>
                )
              }
            >
              <span className="flex min-w-0 items-baseline gap-1.5">
                {!redundant && <span className="truncate">{d.label}</span>}
                <span
                  className={cn(
                    'font-mono text-mono',
                    redundant ? 'truncate text-fg' : 'shrink-0 text-fg-subtle'
                  )}
                >
                  {d.path}
                </span>
              </span>
            </MenuItem>
          )
        })}
        <MenuSeparator />
        <MenuItem icon={FolderOpen} onSelect={() => void pickFolder()}>
          Escolher uma pasta…
        </MenuItem>
        <MenuItem icon={Server} onSelect={() => setTyping(true)}>
          Digitar caminho de rede…
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  )
}

function ModeCard({
  value,
  icon: Icon,
  title,
  description,
  active
}: {
  value: string
  icon: LucideIcon
  title: string
  description: string
  active: boolean
}) {
  return (
    <RadioGroup.Item
      value={value}
      className={cn(
        'flex flex-1 items-start gap-3 rounded-lg border p-4 text-left transition-[border-color,background-color,box-shadow] duration-[120ms]',
        active
          ? 'border-accent-edge bg-accent-soft/50 shadow-[0_0_0_1px_var(--accent-edge)]'
          : 'border-border bg-surface-raised shadow-card hover:border-border-strong'
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-accent text-accent-foreground' : 'bg-surface-hover text-fg-muted'
        )}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-small font-medium text-fg">{title}</span>
        <span className="text-caption text-fg-subtle">{description}</span>
      </span>
    </RadioGroup.Item>
  )
}

export function DestinationsStep({
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
  const drives = useApp((s) => s.drives)
  const now = useNow()
  const addRef = useRef<HTMLButtonElement>(null)
  const [focusAdd, setFocusAdd] = useState(0)
  const incoming = sizes.total ? sizes.total.bytes * (draft.mode === 'zip' ? 0.6 : 1) : undefined
  const hasNetwork = draft.destinations.some((d) => isNetworkPath(d.path))
  const sourcePaths = draft.sources.map((s) => s.path)
  const { byDest, general } = assignIssues(issues, draft.destinations, sourcePaths)
  const missing = general.some((i) => i.level === 'error') && draft.destinations.length === 0
  // Exemplo com o destino de caminho mais curto (o mais legível).
  const example = [...draft.destinations].sort((a, b) => a.path.length - b.path.length)[0]
  // Destino na raiz do disco: os backups ficariam soltos na raiz (sugere uma pasta, ex.: E:\Backups).
  const rootDest = draft.destinations.find((d) => isDriveRoot(d.path))

  // Depois de adicionar ou remover, o foco volta para "Adicionar destino" (o menu fechado ou o
  // cartão removido não existem mais).
  useEffect(() => {
    if (!focusAdd) return
    const t = setTimeout(() => addRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [focusAdd])

  const add = (path: string, label?: string): void => {
    if (draft.destinations.some((x) => pathKey(x.path, true) === pathKey(path, true))) {
      notify.info('Esse destino já está na lista', { description: path })
      return
    }
    update((d) => ({
      ...d,
      destinations: [...d.destinations, { id: newId('dst'), path, label, enabled: true }]
    }))
    setFocusAdd((n) => n + 1)
  }

  const patch = (id: string, p: Partial<Destination>): void =>
    update((d) => ({ ...d, destinations: d.destinations.map((x) => (x.id === id ? { ...x, ...p } : x)) }))

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        {draft.destinations.length === 0 ? (
          <div
            className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border-strong p-6"
            data-invalid={missing ? '' : undefined}
          >
            <span className="flex size-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
              <HardDrive className="size-6" strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="text-section font-semibold text-fg">Nenhum destino ainda</h3>
              <p className="text-small text-fg-muted">
                Adicione um disco externo, outra unidade ou uma pasta de rede.
              </p>
            </div>
            <AddDestinationMenu
              drives={drives}
              used={[]}
              onAdd={add}
              variant="primary"
              buttonRef={addRef}
              onCancelTyping={() => setFocusAdd((n) => n + 1)}
            />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card">
              {draft.destinations.map((d) => (
                <DestinationCard
                  key={d.id}
                  dest={d}
                  drive={findDrive(drives, d.path)}
                  incoming={incoming}
                  issues={byDest.get(d.id) ?? []}
                  sourcePaths={sourcePaths}
                  onChange={(p) => patch(d.id, p)}
                  onRemove={() => {
                    update((x) => ({ ...x, destinations: x.destinations.filter((y) => y.id !== d.id) }))
                    setFocusAdd((n) => n + 1)
                  }}
                />
              ))}
            </ul>
            <AddDestinationMenu
              drives={drives}
              used={draft.destinations.map((d) => d.path)}
              onAdd={add}
              buttonRef={addRef}
              onCancelTyping={() => setFocusAdd((n) => n + 1)}
            />
          </>
        )}
        <IssueList issues={general} paths={[...draft.destinations.map((d) => d.path), ...sourcePaths]} />
        {!hasNetwork && draft.destinations.length < 2 && (
          <Callout tone="info">
            <span className="font-medium">Dica:</span> um segundo destino em outro disco ou em outro
            computador (\\servidor\pasta) protege contra a falha de um deles.
          </Callout>
        )}
        {rootDest && (
          <Callout tone="info">
            <span className="font-medium">Dica:</span> escolha uma pasta, ex.:{' '}
            {joinPath(rootDest.path, 'Backups')}. Os backups ficam direto na pasta escolhida, um por data e
            hora.
          </Callout>
        )}
        {example && (
          <div className="flex flex-col gap-1.5 rounded-md bg-surface-hover/70 px-3 py-2.5">
            <span className="text-caption text-fg-subtle">
              Cada execução cria {draft.mode === 'zip' ? 'um arquivo novo' : 'uma pasta nova'} direto no
              destino, com a data e a hora, por exemplo:
            </span>
            <span className="font-mono text-mono break-all text-fg-muted" data-selectable>
              {backupExamplePath(example.path, backupStamp(now), draft.mode)}
            </span>
            {draft.sources.length > 1 && (
              <span className="text-caption text-fg-subtle">
                Com várias origens, cada uma fica numa subpasta dentro{' '}
                {draft.mode === 'zip' ? 'do ZIP' : 'dela'}.
              </span>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Formato da cópia" />
        <RadioGroup.Root
          value={draft.mode}
          onValueChange={(v) => update((d) => ({ ...d, mode: v as RoutineInput['mode'] }))}
          className="flex gap-3"
          aria-label="Formato da cópia"
        >
          <ModeCard
            value="copy"
            icon={FolderTree}
            title="Pastas (cópia simples)"
            description="Abre em qualquer computador, sem programa nenhum. Recomendado."
            active={draft.mode === 'copy'}
          />
          <ModeCard
            value="zip"
            icon={FileArchive}
            title="Compactar em ZIP"
            description="Ocupa menos espaço. Bom para muitos arquivos pequenos."
            active={draft.mode === 'zip'}
          />
        </RadioGroup.Root>
        {draft.mode === 'zip' && (
          <Field label="Compressão">
            {(id) => (
              <Select
                id={id}
                className="w-[260px]"
                value={String(draft.zipLevel)}
                onChange={(v) => update((d) => ({ ...d, zipLevel: Number(v) }))}
                options={ZIP_LEVELS}
              />
            )}
          </Field>
        )}
      </section>
    </div>
  )
}
