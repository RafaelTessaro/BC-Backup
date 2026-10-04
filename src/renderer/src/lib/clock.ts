// Relógio compartilhado (atualiza a cada 30 s) para datas relativas ("há 5 min").
import { create } from 'zustand'

interface ClockState {
  now: number
}

export const useClock = create<ClockState>(() => ({ now: Date.now() }))

let started = false
export function startClock(): void {
  if (started) return
  started = true
  setInterval(() => useClock.setState({ now: Date.now() }), 30_000)
}

/** Data atual (re-renderiza a cada 30 s). */
export function useNow(): Date {
  const now = useClock((s) => s.now)
  return new Date(now)
}
