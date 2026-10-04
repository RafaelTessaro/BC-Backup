import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

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

/** Elemento que abriu um overlay. Se o foco estava num item de menu, devolve o gatilho do menu. */
function openerOf(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null
  const menu = el.closest('[role="menu"]')
  const triggerId = menu?.getAttribute('aria-labelledby')
  if (triggerId) return document.getElementById(triggerId) ?? null
  return el
}

/**
 * Devolve o foco a quem abriu o overlay (drawer/dialog) ao fechar — mesmo quando ele foi aberto
 * por um item de menu que já não existe mais. Use o retorno em `onCloseAutoFocus` do Radix.
 */
export function useReturnFocus(open: boolean): (e: Event) => void {
  const opener = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (open) opener.current = openerOf(document.activeElement)
  }, [open])
  return (e: Event) => {
    const el = opener.current
    opener.current = null
    if (el && el.isConnected) {
      e.preventDefault()
      el.focus({ preventScroll: true })
    }
  }
}
