// Painel da bandeja (docs/research/05-painel-da-bandeja.md §3): cabeçalho · status (hero) ·
// últimos backups · próximo · ações. 360×480, nos tokens do design system, claro e escuro.
import {
  CalendarClock,
  ChevronDown,
  Ellipsis,
  History,
  Pause,
  Play,
  Power,
  Settings,
  type LucideIcon
} from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject
} from 'react'
import { summarizeHealth } from '@shared/health'
import { ROUTES } from '@shared/routes'
import type { ID, Routine, RunSummary } from '@shared/types'
import { Button } from '@renderer/components/ui/Button'
import { Wordmark } from '@renderer/components/ui/Logo'
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/Menu'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { Tooltip, TooltipProvider } from '@renderer/components/ui/Tooltip'
import { bc } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { startClock, useNow } from '@renderer/lib/clock'
import {
  calendarDiff,
  formatAgo,
  formatDayMonth,
  formatFull,
  formatSize,
  formatTime,
  formatWhen,
  plural
} from '@renderer/lib/format'
import { useMediaQuery } from '@renderer/lib/hooks'
import { setInputModality } from '@renderer/lib/modality'
import { RUN_STATUS, TONE_TEXT } from '@renderer/lib/status'
import { HERO_GLOW, HERO_TONE, TrayHero } from './TrayHero'
import { loadTray, refreshActive, RUNS_SHOWN, subscribeTray, useTray } from './useTray'

const ROW_HEIGHT = 40

/* ------------------------------------------------------------------ */
/* Ações (todas que abrem o app escondem o painel antes — no main)      */
/* ------------------------------------------------------------------ */

const openMain = (route?: string): void => void bc.tray.openMain(route).catch(() => undefined)
const hidePanel = (): void => void bc.tray.hide({ restoreFocus: true }).catch(() => undefined)
const setAllPaused = (paused: boolean): void => void bc.tray.setAllPaused(paused).catch(() => undefined)
const quit = (): void => void bc.tray.quit().catch(() => undefined)

async function runNow(id: ID): Promise<void> {
  try {
    await bc.routines.runNow(id)
  } catch {
    // Rotina removida nesse meio-tempo: a lista se atualiza pelo routinesChanged.
  }
  // O hero vira "Backup em andamento" na hora, sem esperar o primeiro evento de progresso.
  await refreshActive()
}

/* ------------------------------------------------------------------ */
/* Tema, entrada animada, Esc                                          */
/* ------------------------------------------------------------------ */

/** Mesmo tema do app: preferência salva (Claro/Escuro) ou o do sistema. Sem avisar o main. */
function useTrayTheme(): void {
  const pref = useTray((s) => s.settings?.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved = pref === 'light' || pref === 'dark' ? pref : systemDark ? 'dark' : 'light'
  useEffect(() => {
    const root = document.documentElement
    if (root.dataset.theme === resolved) return
    root.setAttribute('data-theme-switching', '') // sem cores "animando" na troca
    root.dataset.theme = resolved
    requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')))
  }, [resolved])
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Entrada dos flyouts do Windows 11: opacidade 0→1 + translateY(4px)→0 em 180 ms. */
function reveal(el: HTMLElement | null): void {
  const root = document.documentElement
  delete root.dataset.trayHidden
  if (!el || window.matchMedia(REDUCED_MOTION).matches) return
  if (el.getAnimations().some((a) => a.playState === 'running')) return
  el.animate(
    [
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'none' }
    ],
    { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
  )
}

/** Esc fecha o painel e devolve o teclado à área de notificação — a não ser que um menu esteja aberto. */
function useEscToHide(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.isComposing) return
      if (document.querySelector('[role="menu"]')) return // o Radix fecha só o menu
      e.preventDefault()
      hidePanel()
    }
    // Captura na janela: roda antes do Radix (que fecharia o menu e removeria o [role=menu]).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}

/** Quantas linhas de 40 px cabem na lista (o hero cresce em alguns estados). */
function useRowsThatFit(ref: RefObject<HTMLElement | null>, max: number): number {
  const [rows, setRows] = useState(max)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setRows(Math.max(1, Math.min(max, Math.floor(el.clientHeight / ROW_HEIGHT))))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, max])
  return rows
}

/* ------------------------------------------------------------------ */
/* Pedaços                                                             */
/* ------------------------------------------------------------------ */

/** Estado do agendador (não repete o hero) — mesma linguagem do rodapé da barra lateral. */
function SchedulerPill({ routines }: { routines: Routine[] }) {
  const active = routines.filter((r) => r.enabled).length
  if (!routines.length)
    return (
      <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-surface-hover px-2 text-caption font-medium text-fg-subtle">
        <span className="size-1.5 rounded-full bg-fg-subtle/70" aria-hidden />
        Sem rotinas
      </span>
    )
  if (!active)
    return (
      <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-surface-hover px-2 text-caption font-medium text-fg-muted">
        <Pause className="size-3" strokeWidth={2} aria-hidden />
        Pausado
      </span>
    )
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-success-soft px-2 text-caption font-medium text-success">
      <span className="size-1.5 rounded-full bg-success animate-pulse-dot" aria-hidden />
      Agendador ativo
    </span>
  )
}

/** "há 2 h" (hoje) · "ontem 23:30" · "sex 22:00" (na semana) · "05/10". */
function shortWhen(iso: string, now: Date): string {
  const d = new Date(iso)
  const diff = calendarDiff(d, now)
  if (diff === 0) {
    const ago = formatAgo(d, now)
    return ago === 'agora mesmo' ? 'agora' : ago
  }
  if (diff === -1) return `ontem ${formatTime(d)}`
  if (diff > -7)
    return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${formatTime(d)}`
  return formatDayMonth(d)
}

function RunValue({ run }: { run: RunSummary }) {
  switch (run.status) {
    case 'success':
      return <span className="text-fg-muted">{formatSize(run.bytesCopied)}</span>
    case 'warning':
      return (
        <span className="text-warning">
          {plural(Math.max(1, run.warnings || run.filesSkipped), 'aviso', 'avisos')}
        </span>
      )
    case 'failed':
      return (
        <Tooltip label={run.errorMessage} side="top" align="end">
          <span className="text-danger">Falhou</span>
        </Tooltip>
      )
    default:
      return <span className="text-fg-subtle">Cancelado</span>
  }
}

function valueText(run: RunSummary): string {
  if (run.status === 'success') return formatSize(run.bytesCopied)
  if (run.status === 'warning')
    return plural(Math.max(1, run.warnings || run.filesSkipped), 'aviso', 'avisos')
  if (run.status === 'failed') return run.errorMessage ? `Falhou: ${run.errorMessage}` : 'Falhou'
  return 'Cancelado'
}

function RunRow({ run }: { run: RunSummary }) {
  const now = useNow()
  const meta = RUN_STATUS[run.status]
  const Icon = meta.icon
  const at = run.finishedAt ?? run.startedAt
  const when = shortWhen(at, now)
  return (
    <li>
      <button
        type="button"
        onClick={() => openMain(ROUTES.run(run.id))}
        aria-label={`${run.routineName}, ${meta.label}, ${formatWhen(at, now)}, ${valueText(run)}. Abrir detalhes`}
        className={cn(
          'mx-2 flex h-[40px] w-[calc(100%-16px)] items-center gap-2.5 rounded-sm px-2 text-left',
          'transition-colors duration-[120ms] hover:bg-surface-hover active:bg-surface-hover',
          'focus-visible:outline-offset-[-2px]'
        )}
      >
        <Icon className={cn('size-[16px] shrink-0', TONE_TEXT[meta.tone])} strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-small font-medium text-fg">{run.routineName}</span>
        <Tooltip label={formatFull(at)} side="top">
          <span className="shrink-0 text-caption text-fg-subtle tnum">{when}</span>
        </Tooltip>
        <span className="w-[68px] shrink-0 truncate text-right text-caption font-medium tnum">
          <RunValue run={run} />
        </span>
      </button>
    </li>
  )
}

/** Botão quadrado do rodapé (só ícone): Tooltip + aria-label obrigatórios (§8). */
const FooterIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string
    icon: LucideIcon
    ghost?: boolean
    wide?: boolean
    extra?: ReactNode
  }
>(function FooterIconButton({ label, icon: Icon, ghost, wide, extra, className, ...rest }, ref) {
  return (
    <Tooltip label={label} side="top">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          'inline-flex h-[32px] shrink-0 items-center justify-center gap-0.5 rounded-md transition-[background-color,border-color,color] duration-[120ms]',
          'disabled:pointer-events-none disabled:opacity-45',
          wide ? 'w-[44px]' : 'w-[32px]',
          ghost
            ? 'text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-hover data-[state=open]:bg-surface-hover data-[state=open]:text-fg'
            : 'border border-border-strong bg-surface-raised text-fg shadow-xs hover:bg-surface-hover active:bg-surface-hover data-[state=open]:bg-surface-hover',
          className
        )}
        {...rest}
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        {extra}
      </button>
    </Tooltip>
  )
})

/* ------------------------------------------------------------------ */
/* Painel                                                              */
/* ------------------------------------------------------------------ */

export function TrayPanel() {
  const ready = useTray((s) => s.ready)
  const routines = useTray((s) => s.routines)
  const runs = useTray((s) => s.runs)
  const stats = useTray((s) => s.stats)
  const progress = useTray((s) => s.progress)
  const now = useNow()
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useTrayTheme()
  useEscToHide()

  useEffect(() => {
    startClock()
    const shown = (): void => {
      setRunMenuOpen(false)
      setMoreMenuOpen(false)
      setInputModality('pointer') // aberto pelo mouse quase sempre: foco sem anel até a 1ª tecla
      reveal(contentRef.current)
      primaryRef.current?.focus({ preventScroll: true })
    }
    const off = subscribeTray(shown)
    setInputModality('pointer')
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') document.documentElement.dataset.trayHidden = ''
      else reveal(contentRef.current)
    }
    document.addEventListener('visibilitychange', onVisibility)
    void loadTray()
    primaryRef.current?.focus({ preventScroll: true })
    return () => {
      off()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const health = useMemo(() => summarizeHealth(routines, progress), [routines, progress])
  const tone = HERO_TONE[health.kind]
  const lastOk =
    runs.find((r) => r.status === 'success' || r.status === 'warning') ??
    (stats?.lastRun && (stats.lastRun.status === 'success' || stats.lastRun.status === 'warning')
      ? stats.lastRun
      : undefined)
  const anyEnabled = routines.some((r) => r.enabled)
  /** Sem rotinas o botão continua "Pausar" (desativado); com tudo pausado vira "Retomar". */
  const canPause = anyEnabled || !routines.length
  const busy = new Set(Object.values(progress).map((p) => p.routineId))
  const sorted = useMemo(
    () => [...routines].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [routines]
  )
  const rowsThatFit = useRowsThatFit(listRef, RUNS_SHOWN)
  const shownRuns = runs.slice(0, rowsThatFit)
  const next = stats?.nextRun

  let nextText: ReactNode
  if (!routines.length || !next)
    nextText = anyEnabled || !routines.length ? 'Nenhum backup agendado' : 'Agendamentos pausados'
  else
    nextText = (
      <>
        Próximo: <span className="font-medium text-fg">{formatWhen(next.at, now)}</span> · {next.routineName}
      </>
    )

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={250}>
      <div
        ref={contentRef}
        className="relative flex h-full flex-col overflow-hidden bg-surface-raised text-fg"
      >
        {/* Brilho do tom do status atrás do cabeçalho e do hero (como o hero do Painel). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[180px] opacity-80 transition-[background] duration-[260ms] dark:opacity-60"
          style={{ background: `radial-gradient(90% 100% at 0% 0%, ${HERO_GLOW[tone]}, transparent 70%)` }}
        />

        <header className="relative flex h-[48px] shrink-0 items-center justify-between px-4">
          <Wordmark size={15} />
          {ready && <SchedulerPill routines={routines} />}
        </header>

        {ready ? (
          <TrayHero
            health={health}
            lastOk={lastOk}
            openMain={openMain}
            resumeAll={() => setAllPaused(false)}
          />
        ) : (
          <div className="flex min-h-[104px] shrink-0 items-start gap-3 px-4 py-4" aria-hidden>
            <Skeleton className="size-[40px] rounded-full" />
            <div className="flex flex-1 flex-col gap-2 pt-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
          </div>
        )}

        <section
          aria-labelledby="ultimos"
          data-tray-divider
          className="relative flex min-h-0 flex-1 flex-col border-t border-border"
        >
          {/* 31 px + 1 px da divisória = 32: com o hero de 104, cabem as 5 linhas de 40 px. */}
          <div className="flex h-[31px] shrink-0 items-end justify-between px-4 pb-0.5">
            <h2 id="ultimos" className="text-overline text-fg-subtle">
              Últimos backups
            </h2>
            {runs.length > 0 && (
              <Button variant="link" size="sm" onClick={() => openMain(ROUTES.history)}>
                Ver histórico
              </Button>
            )}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-hidden">
            {!ready ? null : shownRuns.length ? (
              <ul aria-label="Últimos backups">
                {shownRuns.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </ul>
            ) : !routines.length ? (
              <p className="px-4 pt-2 text-small text-fg-subtle">
                Os backups aparecem aqui assim que uma rotina rodar.
              </p>
            ) : (
              <p className="px-4 pt-2 text-small text-fg-subtle">
                Nenhum backup ainda.{' '}
                <Button
                  variant="link"
                  className="text-small"
                  onClick={() => (routines.length === 1 ? void runNow(routines[0].id) : setRunMenuOpen(true))}
                >
                  Executar agora
                </Button>
              </p>
            )}
          </div>
        </section>

        <div
          data-tray-divider
          className="relative flex h-[40px] shrink-0 items-center gap-2 border-t border-border px-4 text-small text-fg-muted"
        >
          <CalendarClock className="size-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 truncate">{ready ? nextText : ''}</span>
        </div>

        <footer
          data-tray-divider
          className="relative flex h-[56px] shrink-0 items-center gap-2 border-t border-border bg-bg px-4"
        >
          <Button
            ref={primaryRef}
            variant="primary"
            className="h-[32px] min-w-0 flex-1"
            onClick={() => openMain()}
          >
            Abrir o BC Backup
          </Button>

          <MenuRoot open={runMenuOpen} onOpenChange={setRunMenuOpen}>
            <MenuTrigger asChild>
              <FooterIconButton
                label="Executar agora"
                icon={Play}
                wide
                disabled={!routines.length}
                extra={<ChevronDown className="size-3 opacity-70" strokeWidth={2} aria-hidden />}
              />
            </MenuTrigger>
            <MenuContent
              side="top"
              align="end"
              className="max-h-[min(var(--radix-dropdown-menu-content-available-height),300px)] w-[248px] overflow-y-auto"
            >
              <MenuLabel>Executar agora</MenuLabel>
              {sorted.map((r) => (
                <MenuItem
                  key={r.id}
                  icon={Play}
                  disabled={busy.has(r.id)}
                  hint={busy.has(r.id) ? 'Em execução' : !r.enabled ? 'Pausada' : undefined}
                  onSelect={() => void runNow(r.id)}
                >
                  {r.name}
                </MenuItem>
              ))}
            </MenuContent>
          </MenuRoot>

          <FooterIconButton
            label={canPause ? 'Pausar todas as rotinas' : 'Retomar rotinas'}
            icon={canPause ? Pause : Play}
            disabled={!routines.length}
            onClick={() => setAllPaused(canPause)}
          />

          <MenuRoot open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
            <MenuTrigger asChild>
              <FooterIconButton label="Mais opções" icon={Ellipsis} ghost />
            </MenuTrigger>
            <MenuContent side="top" align="end" className="w-[220px]">
              <MenuItem icon={Settings} onSelect={() => openMain(ROUTES.settings)}>
                Configurações
              </MenuItem>
              <MenuItem icon={History} onSelect={() => openMain(ROUTES.history)}>
                Histórico
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={Power} onSelect={quit}>
                Sair do BC Backup
              </MenuItem>
            </MenuContent>
          </MenuRoot>
        </footer>
      </div>
    </TooltipProvider>
  )
}
