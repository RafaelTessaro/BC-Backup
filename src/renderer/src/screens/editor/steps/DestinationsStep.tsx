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
import { useEffect, useState } from 'react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import { BACKUP_ROOT_DIR } from '@shared/defaults'
import { backupStamp, formatBytes } from '@shared/format'
import type { Destination, DiskSpace, DriveInfo, VerifyMode } from '@shared/types'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { DiskUsageBar } from '@renderer/components/ui/DiskUsageBar'
import { Field, Input } from '@renderer/components/ui/Input'
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuTrigger } from '@renderer/components/ui/Menu'
import { PathText } from '@renderer/components/ui/PathText'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { bc, errorMessage } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import { formatPercent, isNetworkPath } from '@renderer/lib/format'
import { useApp } from '@renderer/lib/store'
import { notify } from '@renderer/lib/toast'
import { newId, type Update } from '../model'
import type { SourceSizes } from '../sizes'
import { IssueList, SectionTitle } from './shared'

const VERIFY_TEXT: Record<VerifyMode, string> = {
  none: 'Mais rápido, porém sem garantia de que a cópia ficou íntegra.',
  quick: 'Confere tamanho e data de cada arquivo copiado. Rápido e recomendado.',
  full: 'Relê os arquivos no destino e compara o conteúdo. Mais seguro, porém mais lento.'
}

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
  onChange,
  onRemove
}: {
  dest: Destination
  drive?: DriveInfo
  incoming?: number
  issues: ValidationIssue[]
  onChange: (patch: Partial<Destination>) => void
  onRemove: () => void
}) {
  const space = useSpace(dest.path)
  const enabled = dest.enabled !== false
  const lacking = space && incoming ? incoming - space.free : 0
  const name = dest.label || drive?.label || dest.path
  return (
    <li className={cn('flex flex-col gap-4 p-4', !enabled && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-hover text-fg-muted">
          <DriveIcon path={dest.path} drive={drive} className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-small font-medium text-fg">
            {name}
            {drive && dest.label && dest.label.toLowerCase() !== drive.label.toLowerCase() && (
              <span className="font-normal text-fg-subtle"> · {drive.label}</span>
            )}
          </span>
          <PathText path={dest.path} className="text-fg-subtle" />
        </div>
        <Switch label="Usar este destino" checked={enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        <IconButton icon={X} label="Remover destino" onClick={onRemove} />
      </div>
      {space === undefined ? (
        <div className="h-[26px] animate-pulse rounded-xs bg-surface-hover/70" />
      ) : space ? (
        <DiskUsageBar total={space.total} free={space.free} incoming={enabled ? incoming : undefined} />
      ) : (
        <p className="text-caption text-warning">Destino indisponível agora — conecte o disco ou verifique a rede.</p>
      )}
      {lacking > 0 && enabled && (
        <p className="-mt-2 text-caption text-danger">
          Sem espaço suficiente para uma cópia completa (faltam {formatBytes(lacking)}).
        </p>
      )}
      <div className="flex items-center gap-3">
        <label className="shrink-0 text-caption font-medium text-fg-muted" htmlFor={`label-${dest.id}`}>
          Apelido
        </label>
        <Input
          id={`label-${dest.id}`}
          value={dest.label ?? ''}
          placeholder="Ex.: HD externo azul (opcional)"
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-7 text-small"
        />
      </div>
      <IssueList issues={issues} />
    </li>
  )
}

function AddDestinationMenu({
  drives,
  used,
  onAdd,
  variant = 'secondary'
}: {
  drives: DriveInfo[]
  used: string[]
  onAdd: (path: string, label?: string) => void
  variant?: 'primary' | 'secondary'
}) {
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const usedSet = new Set(used.map((p) => p.toUpperCase()))

  const pickFolder = async (): Promise<void> => {
    try {
      const r = await bc.system.pickFolders({ multi: false, title: 'Escolha a pasta de destino' })
      if (!r.canceled && r.paths[0]) onAdd(r.paths[0])
    } catch (err) {
      notify.error('Não foi possível abrir o seletor', { description: errorMessage(err) })
    }
  }

  if (typing) {
    const valid = /^(\\\\[^\\]+\\[^\\]+|[A-Za-z]:\\|\/)/.test(typed.trim())
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd(typed.trim())
          setTyped('')
          setTyping(false)
        }}
      >
        <Input
          autoFocus
          icon={Server}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="\\SERVIDOR\backup"
          className="w-[320px]"
          inputClassName="font-mono text-[13px]"
          onKeyDown={(e) => e.key === 'Escape' && setTyping(false)}
          aria-label="Caminho de rede"
        />
        <Button type="submit" variant="primary" disabled={!valid}>
          Adicionar
        </Button>
        <Button variant="ghost" onClick={() => setTyping(false)}>
          Cancelar
        </Button>
      </form>
    )
  }

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button variant={variant} icon={Plus} className="w-fit">
          Adicionar destino
        </Button>
      </MenuTrigger>
      <MenuContent align="start" className="w-[340px]">
        <MenuLabel>Unidades deste computador</MenuLabel>
        {drives.map((d) => {
          const Icon = driveIcon(d.path, d)
          const used = usedSet.has(d.path.toUpperCase())
          const pct = d.total ? ((d.total - d.free) / d.total) * 100 : 0
          return (
            <MenuItem
              key={d.path}
              icon={Icon}
              disabled={used}
              onSelect={() => onAdd(d.path, d.removable || d.network ? d.label : undefined)}
              hint={
                used ? (
                  'Adicionado'
                ) : (
                  <span className={cn(pct > 90 && 'text-danger')}>
                    {formatBytes(d.free)} livres{pct > 90 ? ` · ${formatPercent(pct)}` : ''}
                  </span>
                )
              }
            >
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate">{d.label}</span>
                <span className="shrink-0 font-mono text-mono text-fg-subtle">{d.path}</span>
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
          ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_1px_var(--accent)]'
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
  const incoming = sizes.total ? sizes.total.bytes * (draft.mode === 'zip' ? 0.6 : 1) : undefined
  const hasNetwork = draft.destinations.some((d) => isNetworkPath(d.path))
  const example = draft.destinations[0]
  const general = issues.filter((i) => !draft.destinations.some((d) => i.message.includes(d.path)))

  const add = (path: string, label?: string): void => {
    update((d) => {
      if (d.destinations.some((x) => x.path.toUpperCase() === path.toUpperCase())) return d
      return { ...d, destinations: [...d.destinations, { id: newId('dst'), path, label, enabled: true }] }
    })
  }

  const patch = (id: string, p: Partial<Destination>): void =>
    update((d) => ({ ...d, destinations: d.destinations.map((x) => (x.id === id ? { ...x, ...p } : x)) }))

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        {draft.destinations.length === 0 ? (
          <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border-strong p-6">
            <span className="flex size-12 items-center justify-center rounded-lg bg-surface-hover text-fg-muted">
              <HardDrive className="size-6" strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="text-section font-semibold text-fg">Nenhum destino ainda</h3>
              <p className="text-small text-fg-muted">Adicione um disco externo, outra unidade ou uma pasta de rede.</p>
            </div>
            <AddDestinationMenu drives={drives} used={[]} onAdd={add} variant="primary" />
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
                  issues={issues.filter((i) => i.message.includes(d.path))}
                  onChange={(p) => patch(d.id, p)}
                  onRemove={() => update((x) => ({ ...x, destinations: x.destinations.filter((y) => y.id !== d.id) }))}
                />
              ))}
            </ul>
            <AddDestinationMenu drives={drives} used={draft.destinations.map((d) => d.path)} onAdd={add} />
          </>
        )}
        <IssueList issues={general} />
        {!hasNetwork && (
          <Callout tone="info">
            <span className="font-medium">Dica:</span> um destino em outro computador (\\servidor\pasta) protege contra falha
            do disco local.
          </Callout>
        )}
        {example && (
          <div className="flex flex-col gap-1.5 rounded-md bg-surface-hover/70 px-3 py-2.5">
            <span className="text-caption text-fg-subtle">Cada execução cria uma pasta nova, por exemplo:</span>
            <PathText
              path={`${example.path.replace(/[\\/]+$/, '')}\\${BACKUP_ROOT_DIR}\\${draft.name.trim() || 'Rotina'}\\${backupStamp(now)}${draft.mode === 'zip' ? '.zip' : ''}`}
              className="text-fg-muted"
              tooltip="auto"
            />
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
            title="Pasta datada"
            description="Abre em qualquer computador, sem programa nenhum. Recomendado."
            active={draft.mode === 'copy'}
          />
          <ModeCard
            value="zip"
            icon={FileArchive}
            title="Arquivo ZIP"
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
                options={[
                  { value: '1', label: 'Rápida', description: 'Arquivo maior, termina antes' },
                  { value: '6', label: 'Equilibrada', description: 'Padrão recomendado' },
                  { value: '9', label: 'Máxima', description: 'Arquivo menor, mais demorado' }
                ]}
              />
            )}
          </Field>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle title="Verificar cópia" description={VERIFY_TEXT[draft.verify]} />
        <Segmented<VerifyMode>
          label="Verificar cópia"
          value={draft.verify}
          onChange={(v) => update((d) => ({ ...d, verify: v }))}
          className="w-[360px]"
          options={[
            { value: 'none', label: 'Não verificar' },
            { value: 'quick', label: 'Rápida' },
            { value: 'full', label: 'Completa' }
          ]}
        />
      </section>
    </div>
  )
}
