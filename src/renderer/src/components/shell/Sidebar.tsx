import { CalendarClock, History, LayoutDashboard, Plus, Settings, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { ROUTES } from '@shared/routes'
import { Badge } from '@renderer/components/ui/Badge'
import { BrandMark, Wordmark } from '@renderer/components/ui/Logo'
import { Shortcut, TOOLTIP_KBD } from '@renderer/components/ui/Kbd'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { cn } from '@renderer/lib/cn'
import { useNow } from '@renderer/lib/clock'
import { formatWhen } from '@renderer/lib/format'
import { navigate, useRoute } from '@renderer/lib/router'
import { useApp } from '@renderer/lib/store'

interface NavItemProps {
  icon: LucideIcon
  label: string
  active: boolean
  collapsed: boolean
  onClick: () => void
  badge?: ReactNode
}

function NavItem({ icon: Icon, label, active, collapsed, onClick, badge }: NavItemProps) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'group relative flex h-8 w-full items-center rounded-md text-small font-medium transition-colors duration-[120ms]',
        collapsed ? 'justify-center' : 'gap-2.5 px-2.5',
        active ? 'bg-surface-hover text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', active ? 'text-accent-text' : 'text-fg-subtle group-hover:text-fg-muted')}
        strokeWidth={1.75}
        aria-hidden
      />
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
      {!collapsed && badge}
      {collapsed && badge && (
        <span className="absolute top-1 right-2 size-1.5 rounded-full bg-danger ring-2 ring-surface" aria-hidden />
      )}
    </button>
  )
  return collapsed ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  )
}

export function Sidebar({ collapsed, platform }: { collapsed: boolean; platform: string }) {
  const route = useRoute()
  const routines = useApp((s) => s.routines)
  const runs = useApp((s) => s.runs)
  const seenAt = useApp((s) => s.historySeenAt)
  const stats = useApp((s) => s.stats)
  const now = useNow()
  const unseenFailures = runs.filter((r) => r.status === 'failed' && r.startedAt > seenAt).length
  const activeRoutines = routines.filter((r) => r.enabled).length
  const mac = platform === 'darwin'

  const schedulerLabel = activeRoutines > 0 ? 'Agendador ativo' : 'Nenhuma rotina ativa'
  const schedulerHint = stats?.nextRun
    ? `Próximo: ${formatWhen(stats.nextRun.at, now)} — ${stats.nextRun.routineName}`
    : 'Nenhuma execução agendada'

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-[180ms] ease-in-out',
        collapsed ? 'w-16' : 'w-[232px]'
      )}
    >
      {/* Cabeçalho = parte da barra de título (arrastável) */}
      <div
        className={cn(
          'titlebar drag flex h-10 shrink-0 items-center',
          collapsed ? 'justify-center' : 'px-4',
          mac && !collapsed && 'pl-[78px]'
        )}
      >
        {!(mac && collapsed) &&
          (collapsed ? (
            <BrandMark size={22} />
          ) : (
            <button
              type="button"
              className="no-drag -mx-1 rounded-sm px-1 py-0.5"
              onClick={() => navigate(ROUTES.dashboard)}
              aria-label="BC Backup — Painel"
            >
              <Wordmark size={15} />
            </button>
          ))}
      </div>

      <div className={cn('pt-3 pb-4', collapsed ? 'px-3' : 'px-3')}>
        {collapsed ? (
          <Tooltip
            label={
              <span className="flex items-center gap-2">
                Nova rotina <Shortcut keys={['Ctrl', 'N']} className={TOOLTIP_KBD} />
              </span>
            }
            side="right"
          >
            <button
              type="button"
              aria-label="Nova rotina"
              onClick={() => navigate(ROUTES.newRoutine)}
              className="flex h-8 w-full items-center justify-center rounded-md border border-border-strong bg-surface-raised text-fg shadow-xs transition-colors duration-[120ms] hover:bg-surface-hover"
            >
              <Plus className="size-4" strokeWidth={1.75} />
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={() => navigate(ROUTES.newRoutine)}
            className="flex h-8 w-full items-center gap-2 rounded-md border border-border-strong bg-surface-raised pr-1.5 pl-2.5 text-small font-medium text-fg shadow-xs transition-colors duration-[120ms] hover:bg-surface-hover"
          >
            <Plus className="size-4 text-fg-muted" strokeWidth={1.75} />
            <span className="flex-1 text-left">Nova rotina</span>
            <Shortcut keys={['Ctrl', 'N']} />
          </button>
        )}
      </div>

      <nav className="flex flex-col gap-0.5 px-3" aria-label="Navegação principal">
        <NavItem
          icon={LayoutDashboard}
          label="Painel"
          collapsed={collapsed}
          active={route.name === 'dashboard'}
          onClick={() => navigate(ROUTES.dashboard)}
        />
        <NavItem
          icon={CalendarClock}
          label="Rotinas"
          collapsed={collapsed}
          active={route.name === 'routines' || route.name === 'routine-new' || route.name === 'routine-edit'}
          onClick={() => navigate(ROUTES.routines)}
          badge={routines.length > 0 && !collapsed ? <Badge>{routines.length}</Badge> : undefined}
        />
        <NavItem
          icon={History}
          label="Histórico"
          collapsed={collapsed}
          active={route.name === 'history'}
          onClick={() => navigate(ROUTES.history)}
          badge={
            unseenFailures > 0 ? (
              <Tooltip label={`${unseenFailures} ${unseenFailures === 1 ? 'falha não vista' : 'falhas não vistas'}`} side="right">
                <span>
                  <Badge tone="danger">{unseenFailures}</Badge>
                </span>
              </Tooltip>
            ) : undefined
          }
        />
      </nav>

      <div className="flex-1" />

      <div className="flex flex-col gap-0.5 px-3 pb-3">
        <div className="mx-0.5 mb-2 h-px bg-border" />
        <Tooltip label={schedulerHint} side={collapsed ? 'right' : 'top'} align={collapsed ? 'center' : 'start'}>
          <div
            className={cn(
              'flex h-8 items-center text-caption font-medium text-fg-subtle',
              collapsed ? 'justify-center' : 'gap-2.5 px-2.5'
            )}
            aria-label={collapsed ? schedulerLabel : undefined}
          >
            <span className="relative flex size-4 items-center justify-center" aria-hidden>
              <span
                className={cn(
                  'size-2 rounded-full',
                  activeRoutines > 0 ? 'animate-pulse-dot bg-success' : 'bg-fg-subtle'
                )}
              />
            </span>
            {!collapsed && <span className="truncate">{schedulerLabel}</span>}
          </div>
        </Tooltip>
        <NavItem
          icon={Settings}
          label="Configurações"
          collapsed={collapsed}
          active={route.name === 'settings'}
          onClick={() => navigate(ROUTES.settings)}
        />
      </div>
    </aside>
  )
}
