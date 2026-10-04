import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

/** Media query reativa (sem setState em efeito). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}

/** Atalho global de teclado (ex.: Ctrl+N). */
export function useHotkey(
  match: (e: KeyboardEvent) => boolean,
  handler: (e: KeyboardEvent) => void,
  enabled = true
): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (match(e)) {
        e.preventDefault()
        ref.current(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [match, enabled])
}

/** Valor com atraso (debounce). */
export function useDebounced<T>(value: T, ms: number): T {
  const [state, setState] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setState(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return state
}

/** Data atual atualizada a cada `ms` (para cronômetros). */
export function useTick(ms: number, enabled = true): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms, enabled])
  return now
}
