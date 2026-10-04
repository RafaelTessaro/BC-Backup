import { useEffect } from 'react'
import { bc } from './bc'
import { useMediaQuery } from './hooks'
import { useApp } from './store'
import { readLocal, writeLocal } from './storage'

export type ResolvedTheme = 'light' | 'dark'
const KEY = 'bc.resolvedTheme'

/** Antes do primeiro paint: aplica o último tema resolvido (ou o do sistema). */
export function applyInitialTheme(): void {
  const cached = readLocal(KEY)
  const theme =
    cached === 'light' || cached === 'dark'
      ? cached
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
  document.documentElement.dataset.theme = theme
}

function setTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  if (root.dataset.theme === theme) return
  // evita que cores "animem" durante a troca de tema
  root.setAttribute('data-theme-switching', '')
  root.dataset.theme = theme
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-theme-switching')))
}

/** Aplica `data-theme` conforme a preferência (Sistema segue o SO ao vivo) e avisa o main. */
export function useThemeSync(): ResolvedTheme {
  const pref = useApp((s) => s.settings?.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved: ResolvedTheme = pref === 'light' || pref === 'dark' ? pref : systemDark ? 'dark' : 'light'
  const loaded = pref !== undefined
  useEffect(() => {
    if (!loaded) return
    setTheme(resolved)
    writeLocal(KEY, resolved)
    void bc.app.setResolvedTheme(resolved).catch(() => undefined)
  }, [resolved, loaded])
  return resolved
}
