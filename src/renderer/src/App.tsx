import { useEffect, useRef } from 'react'
import { Toaster } from 'sonner'
import { ROUTES } from '@shared/routes'
import { LiveRunDrawer } from './components/run/LiveRunDrawer'
import { RunDetailDrawer } from './components/run/RunDetailDrawer'
import { ErrorBoundary } from './components/shell/ErrorBoundary'
import { NavigationGuard } from './components/shell/NavigationGuard'
import { Sidebar } from './components/shell/Sidebar'
import { Titlebar } from './components/shell/Titlebar'
import { TooltipProvider } from './components/ui/Tooltip'
import { toastRunFinished } from './lib/actions'
import { startClock } from './lib/clock'
import { useHotkey, useMediaQuery } from './lib/hooks'
import { listenToHistory, navigate, useRoute, useRouter } from './lib/router'
import { loadAll, markHistorySeen, onRunFinished, openRunDetail, subscribeAll, useApp } from './lib/store'
import { useThemeSync } from './lib/theme'
import { DashboardScreen } from './screens/dashboard/DashboardScreen'
import { EditorScreen } from './screens/editor/EditorScreen'
import { HistoryScreen } from './screens/history/HistoryScreen'
import { RoutinesScreen } from './screens/routines/RoutinesScreen'
import { SettingsScreen } from './screens/settings/SettingsScreen'

const isNewRoutineKey = (e: KeyboardEvent): boolean =>
  (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n'
const isSettingsKey = (e: KeyboardEvent): boolean => (e.ctrlKey || e.metaKey) && e.key === ','

function Screen() {
  const route = useRoute()
  switch (route.name) {
    case 'dashboard':
      return <DashboardScreen />
    case 'routines':
      return <RoutinesScreen />
    case 'routine-new':
      return <EditorScreen key="new" />
    case 'routine-edit':
      return <EditorScreen key={route.id} routineId={route.id} />
    case 'history':
      return <HistoryScreen />
    case 'settings':
      return <SettingsScreen tab={route.tab} />
  }
}

export function App() {
  const ready = useApp((s) => s.ready)
  const platform = useApp((s) => s.info?.platform ?? 'browser')
  const route = useRoute()
  const path = useRouter((s) => s.path)
  const collapsed = useMediaQuery('(max-width: 1039px)')
  const mainRef = useRef<HTMLElement>(null)
  useThemeSync()

  useEffect(() => {
    startClock()
    onRunFinished(toastRunFinished)
    const offEvents = subscribeAll()
    const offHistory = listenToHistory()
    void loadAll()
    return () => {
      offEvents()
      offHistory()
    }
  }, [])

  useHotkey(isNewRoutineKey, () => navigate(ROUTES.newRoutine))
  useHotkey(isSettingsKey, () => navigate(ROUTES.settings))

  useEffect(() => {
    if (route.name !== 'history') return
    markHistorySeen()
    if (route.runId) openRunDetail(route.runId)
  }, [route])

  // cada tela começa do topo
  const section = path.split('/')[1] ?? ''
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [path])

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={250}>
      <div className="flex h-full bg-bg text-fg">
        <Sidebar collapsed={collapsed} platform={platform} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Titlebar platform={platform} />
          <main ref={mainRef} id="conteudo" className="@container relative min-h-0 flex-1 overflow-y-auto">
            {ready && (
              <div key={route.name === 'settings' ? section : path} className="flex min-h-full flex-col animate-fade-in">
                <ErrorBoundary resetKey={path}>
                  <Screen />
                </ErrorBoundary>
              </div>
            )}
          </main>
        </div>
      </div>
      <LiveRunDrawer />
      <RunDetailDrawer />
      <NavigationGuard />
      <Toaster position="bottom-right" visibleToasts={3} offset={16} gap={8} toastOptions={{ unstyled: true }} />
    </TooltipProvider>
  )
}
