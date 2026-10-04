import { ChevronRight, Clock, LoaderCircle } from 'lucide-react'
import { Fragment } from 'react'
import { ROUTES, type ParsedRoute } from '@shared/routes'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { cn } from '@renderer/lib/cn'
import { formatPercent } from '@renderer/lib/format'
import { isQueued, overallPercent, primaryRun } from '@renderer/lib/progress'
import { navigate, useRoute } from '@renderer/lib/router'
import { openLiveRun, useApp } from '@renderer/lib/store'

interface Crumb {
  label: string
  to?: string
}

const SETTINGS_TAB: Record<string, string> = { geral: 'Geral', email: 'E-mail', sobre: 'Sobre' }

function crumbsFor(route: ParsedRoute, routineName?: string): Crumb[] {
  switch (route.name) {
    case 'dashboard':
      return [{ label: 'Painel' }]
    case 'routines':
      return [{ label: 'Rotinas' }]
    case 'routine-new':
      return [{ label: 'Rotinas', to: ROUTES.routines }, { label: 'Nova rotina' }]
    case 'routine-edit':
      return [{ label: 'Rotinas', to: ROUTES.routines }, { label: routineName ?? 'Editar rotina' }]
    case 'history':
      return [{ label: 'Histórico' }]
    case 'settings':
      return [{ label: 'Configurações', to: ROUTES.settings }, { label: SETTINGS_TAB[route.tab] }]
  }
}

/**
 * Reserva à direita para os botões nativos (titleBarOverlay) no Windows/Linux, descontando a
 * margem que o contêiner centralizado (max-w 1080) já tem — assim o breadcrumb continua
 * alinhado com o título da página em qualquer largura e nada fica sob ─ ▢ ✕.
 */
function overlayPadding(platform: string): string | undefined {
  if (platform !== 'win32' && platform !== 'linux') return undefined
  const reserve = 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 144px)))'
  return `max(2rem, calc(${reserve} + 12px - max(0px, (100% - 1080px) / 2)))`
}

export function Titlebar({ platform }: { platform: string }) {
  const route = useRoute()
  const routines = useApp((s) => s.routines)
  const progress = useApp((s) => s.progress)
  const routineName =
    route.name === 'routine-edit' ? routines.find((r) => r.id === route.id)?.name : undefined
  const crumbs = crumbsFor(route, routineName)
  const active = Object.values(progress)
  const first = primaryRun(progress)
  const pct = first ? overallPercent(first) : undefined
  const queuedOnly = active.length > 0 && active.every(isQueued)

  return (
    <div className="titlebar drag flex h-10 shrink-0 items-center">
      <div
        className="mx-auto flex w-full max-w-[1080px] min-w-0 items-center gap-3 px-8"
        style={{ paddingRight: overlayPadding(platform) }}
      >
        <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1 text-small">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <Fragment key={i}>
                {i > 0 && (
                  <ChevronRight
                    className="size-3.5 shrink-0 text-fg-subtle/70"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                )}
                {c.to && !last ? (
                  <button
                    type="button"
                    onClick={() => navigate(c.to!)}
                    className="no-drag truncate rounded-sm px-1 text-fg-subtle transition-colors duration-[120ms] hover:text-fg"
                  >
                    {c.label}
                  </button>
                ) : (
                  <span
                    className={cn('truncate px-1', last ? 'font-medium text-fg-muted' : 'text-fg-subtle')}
                    aria-current={last ? 'page' : undefined}
                  >
                    {c.label}
                  </span>
                )}
              </Fragment>
            )
          })}
        </nav>
        <div className="flex-1" />
        {first && (
          <Tooltip label={`${first.routineName} — ver progresso`} side="bottom" align="end">
            <button
              type="button"
              onClick={() => openLiveRun(first.routineId)}
              aria-label={`Ver progresso: ${first.routineName}${
                queuedOnly ? ', na fila' : pct !== undefined ? `, ${formatPercent(pct)}` : ''
              }${active.length > 1 ? ` (+${active.length - 1} na fila)` : ''}`}
              className="no-drag flex h-6 max-w-[300px] min-w-0 items-center gap-1.5 rounded-full bg-accent-soft pr-2.5 pl-2 text-caption font-medium text-accent-text transition-[filter] duration-[120ms] hover:brightness-[0.97] dark:hover:brightness-125"
            >
              {queuedOnly ? (
                <Clock className="size-3 shrink-0" strokeWidth={2} aria-hidden />
              ) : (
                <LoaderCircle className="size-3 shrink-0 animate-spin-slow" strokeWidth={2} aria-hidden />
              )}
              <span className="truncate">
                {active.length > 1
                  ? `${first.routineName} + ${active.length - 1} na fila`
                  : queuedOnly
                    ? `${first.routineName} · na fila`
                    : first.routineName}
              </span>
              {active.length === 1 && pct !== undefined && (
                <span className="flex shrink-0 items-center gap-1.5 tnum">
                  <span className="h-3 w-px bg-current opacity-25" aria-hidden />
                  {formatPercent(pct)}
                </span>
              )}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
