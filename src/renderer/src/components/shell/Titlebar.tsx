import { ChevronRight, LoaderCircle } from 'lucide-react'
import { Fragment } from 'react'
import { ROUTES, type ParsedRoute } from '@shared/routes'
import { cn } from '@renderer/lib/cn'
import { formatPercent } from '@renderer/lib/format'
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

/** Reserva à direita para os botões nativos (titleBarOverlay) no Windows/Linux. */
function overlayReserve(platform: string): string | undefined {
  if (platform !== 'win32' && platform !== 'linux') return undefined
  return 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 140px)))'
}

export function Titlebar({ platform }: { platform: string }) {
  const route = useRoute()
  const routines = useApp((s) => s.routines)
  const progress = useApp((s) => s.progress)
  const routineName = route.name === 'routine-edit' ? routines.find((r) => r.id === route.id)?.name : undefined
  const crumbs = crumbsFor(route, routineName)
  const active = Object.values(progress)
  const first = active[0]
  const pct = first && first.bytesTotal > 0 ? (first.bytesDone / first.bytesTotal) * 100 : undefined

  return (
    <div className="titlebar drag flex h-10 shrink-0 items-center" style={{ paddingRight: overlayReserve(platform) }}>
      <div className="mx-auto flex w-full max-w-[1080px] min-w-0 items-center gap-3 px-8">
        <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1 text-small">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <Fragment key={i}>
                {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle/70" strokeWidth={1.75} aria-hidden />}
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
          <button
            type="button"
            onClick={() => openLiveRun(first.routineId)}
            className="no-drag flex h-6 max-w-[280px] min-w-0 items-center gap-1.5 rounded-full bg-accent-soft pr-2.5 pl-2 text-caption font-medium text-accent-text transition-[filter] duration-[120ms] hover:brightness-[0.97] dark:hover:brightness-125"
          >
            <LoaderCircle className="size-3 shrink-0 animate-spin-slow" strokeWidth={2} aria-hidden />
            <span className="truncate">
              {active.length > 1 ? `${active.length} backups em execução` : first.routineName}
            </span>
            {active.length === 1 && pct !== undefined && <span className="tnum opacity-80">{formatPercent(pct)}</span>}
          </button>
        )}
      </div>
    </div>
  )
}
