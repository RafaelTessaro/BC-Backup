// Roteador interno mínimo (hash), usando as rotas compartilhadas com o main.
import { create } from 'zustand'
import { ROUTES, parseRoute, type ParsedRoute } from '@shared/routes'

type Blocker = (nextPath: string) => boolean

interface RouterState {
  path: string
  route: ParsedRoute
  /** Navegação aguardando confirmação (ex.: editor com alterações não salvas). */
  pending: string | null
  blocker: Blocker | null
  navigate(path: string, opts?: { force?: boolean; replace?: boolean }): void
  setBlocker(blocker: Blocker | null): void
  confirmPending(): void
  cancelPending(): void
}

function normalize(path: string): string {
  const clean = path.replace(/^#/, '')
  return clean.startsWith('/') ? clean : `/${clean}`
}

function initialPath(): string {
  const hash = typeof location !== 'undefined' ? location.hash : ''
  return hash.length > 1 ? normalize(hash) : ROUTES.dashboard
}

const first = initialPath()

export const useRouter = create<RouterState>((set, get) => ({
  path: first,
  route: parseRoute(first),
  pending: null,
  blocker: null,
  navigate(rawPath, opts) {
    const path = normalize(rawPath)
    const { blocker, path: current } = get()
    if (path === current) return
    if (!opts?.force && blocker && blocker(path)) {
      set({ pending: path })
      return
    }
    set({ path, route: parseRoute(path), pending: null })
    const url = `#${path}`
    if (opts?.replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
  },
  setBlocker(blocker) {
    set({ blocker })
  },
  confirmPending() {
    const { pending } = get()
    if (!pending) return
    set({ blocker: null })
    get().navigate(pending, { force: true })
  },
  cancelPending() {
    set({ pending: null })
  }
}))

/** Sincroniza voltar/avançar do navegador (botões do mouse) com o roteador. */
export function listenToHistory(): () => void {
  const onPop = (): void => {
    const path = initialPath()
    const state = useRouter.getState()
    if (path === state.path) return
    if (state.blocker && state.blocker(path)) {
      // desfaz a navegação e pede confirmação
      history.pushState(null, '', `#${state.path}`)
      useRouter.setState({ pending: path })
      return
    }
    useRouter.setState({ path, route: parseRoute(path) })
  }
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}

export const navigate = (path: string, opts?: { force?: boolean; replace?: boolean }): void =>
  useRouter.getState().navigate(path, opts)

export function useRoute(): ParsedRoute {
  return useRouter((s) => s.route)
}
