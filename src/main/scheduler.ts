// Agendador próprio (doc 01 §5 + guia §6). Node puro, sem electron: testável com fake timers.
//
// A cada tick (no máximo 30 s, e também em powerMonitor 'resume'/'unlock-screen'):
//   slot = último horário agendado <= agora (lastSlotAtOrBefore)
//   se slot > lastAttemptSlot (ou > createdAt, para rotina nova):
//      lastAttemptSlot = slot                 ← consome ANTES: N horários perdidos → 1 execução
//      agora − slot <= 2 min  → executa (trigger 'schedule')
//      senão, catchUpMissed   → UMA recuperação após ~3 min (trigger 'catch-up')
//                               (o app fechou antes dela: stop() devolve o horário como pendente)
//      senão                  → registra "backup atrasado não executado"
// Rotinas "startup" rodam uma vez, startupDelayMinutes após o app iniciar.
// Rotinas pausadas (enabled=false) nunca rodam pelo agendador.
// Relógio corrigido para trás: uma âncora (lastAttemptSlot/createdAt) mais de 1 dia no futuro só
// pode ter sido gravada com o relógio errado — é ignorada, senão a rotina ficaria parada até lá.

import type { ID, Routine, RunTrigger } from '@shared/types'
import { isClockSchedule, lastSlotAtOrBefore, nextRunAt } from '@shared/schedule'

export const TICK_MAX_MS = 30_000
export const ON_TIME_MS = 120_000
export const CATCH_UP_DELAY_MS = 3 * 60_000
/** Âncora no futuro além disto = gravada com o relógio adiantado (ajustes pequenos do NTP são tolerados). */
export const CLOCK_SKEW_TOLERANCE_MS = 24 * 3_600_000

export type SchedRoutine = Pick<Routine, 'id' | 'name' | 'enabled' | 'schedule' | 'createdAt'>

export type SlotDecision =
  | { kind: 'none' }
  | { kind: 'run'; slot: Date }
  | { kind: 'catch-up'; slot: Date }
  | { kind: 'missed'; slot: Date }

/** Decisão pura para uma rotina num instante. */
export function decideSlot(
  routine: SchedRoutine,
  lastAttemptSlot: string | null,
  now: Date,
  onTimeMs = ON_TIME_MS
): SlotDecision {
  if (!routine.enabled || !isClockSchedule(routine.schedule)) return { kind: 'none' }
  const slot = lastSlotAtOrBefore(routine.schedule, now)
  if (!slot) return { kind: 'none' }
  const anchor = Date.parse(lastAttemptSlot ?? routine.createdAt)
  const stale = anchor - now.getTime() > CLOCK_SKEW_TOLERANCE_MS
  if (Number.isFinite(anchor) && !stale && slot.getTime() <= anchor) return { kind: 'none' }
  if (now.getTime() - slot.getTime() <= onTimeMs) return { kind: 'run', slot }
  if (routine.schedule.catchUpMissed) return { kind: 'catch-up', slot }
  return { kind: 'missed', slot }
}

export interface SchedulerDeps {
  routines(): SchedRoutine[]
  getLastAttempt(id: ID): string | null
  setLastAttempt(id: ID, iso: string): void
  /** Coloca a rotina na fila global (o executor ignora se já estiver na fila/rodando). */
  enqueue(id: ID, trigger: RunTrigger): void
  onMissed?(routine: SchedRoutine, slot: Date): void
  /**
   * O app iniciou junto com o sistema? Rotinas "Ao ligar o computador" só rodam nesse caso — não a
   * cada vez que o usuário abre o app no meio do dia. Ausente = sempre (testes).
   */
  isSystemStart?(): boolean
  now?(): Date
  tickMaxMs?: number
  onTimeMs?: number
  catchUpDelayMs?: number
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private running = false
  /** Recuperações pendentes: id → instante previsto e o horário perdido que ela cobre. */
  private catchUps = new Map<ID, { at: number; timer: NodeJS.Timeout; slot: Date }>()
  /** Execuções "ao iniciar" pendentes: id → instante previsto. */
  private startups = new Map<ID, { at: number; timer: NodeJS.Timeout }>()

  constructor(private readonly d: SchedulerDeps) {}

  private now(): Date {
    return this.d.now ? this.d.now() : new Date()
  }

  start(): void {
    if (this.running) return
    this.running = true
    const now = this.now().getTime()
    const systemStart = this.d.isSystemStart ? this.d.isSystemStart() : true
    for (const r of this.d.routines()) {
      if (!systemStart) break
      if (!r.enabled || r.schedule.kind !== 'startup') continue
      const delay = Math.max(0, r.schedule.startupDelayMinutes) * 60_000
      const timer = setTimeout(() => {
        this.startups.delete(r.id)
        const cur = this.d.routines().find((x) => x.id === r.id)
        if (cur?.enabled && cur.schedule.kind === 'startup') this.d.enqueue(r.id, 'startup')
      }, delay)
      this.startups.set(r.id, { at: now + delay, timer })
    }
    this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    // Recuperação que não chegou a rodar (app fechando): o horário volta a ficar pendente. O slot já
    // foi consumido ao marcá-la; sem isto o próximo início o veria como tratado e o backup perdido
    // nunca rodaria.
    for (const [id, c] of this.catchUps) {
      clearTimeout(c.timer)
      this.d.setLastAttempt(id, new Date(c.slot.getTime() - 1).toISOString())
    }
    for (const s of this.startups.values()) clearTimeout(s.timer)
    this.catchUps.clear()
    this.startups.clear()
  }

  /** Reavalia agora (chamar em resume/unlock e quando rotinas mudam). */
  tick = (): void => {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    const now = this.now()
    const tickMax = this.d.tickMaxMs ?? TICK_MAX_MS
    let soonest = now.getTime() + tickMax
    const routines = this.d.routines()
    for (const r of routines) {
      const decision = decideSlot(r, this.d.getLastAttempt(r.id), now, this.d.onTimeMs)
      if (decision.kind !== 'none') {
        this.d.setLastAttempt(r.id, decision.slot.toISOString())
        if (decision.kind === 'run') {
          // Um horário no tempo certo torna a recuperação pendente redundante.
          this.cancelCatchUp(r.id)
          this.d.enqueue(r.id, 'schedule')
        } else if (decision.kind === 'catch-up') this.scheduleCatchUp(r.id, now, decision.slot)
        else this.d.onMissed?.(r, decision.slot)
      }
      if (r.enabled && isClockSchedule(r.schedule)) {
        const next = nextRunAt(r.schedule, now)
        if (next) soonest = Math.min(soonest, next.getTime())
      }
    }
    // Rotinas removidas/pausadas/que deixaram de ter horário: descarta recuperações pendentes.
    for (const [id, c] of this.catchUps) {
      const r = routines.find((x) => x.id === id)
      if (!r || !r.enabled || !isClockSchedule(r.schedule)) {
        clearTimeout(c.timer)
        this.catchUps.delete(id)
      }
    }
    const wait = Math.min(tickMax, Math.max(1_000, soonest - now.getTime() + 50))
    this.timer = setTimeout(this.tick, wait)
  }

  private cancelCatchUp(id: ID): void {
    const c = this.catchUps.get(id)
    if (!c) return
    clearTimeout(c.timer)
    this.catchUps.delete(id)
  }

  private scheduleCatchUp(id: ID, now: Date, slot: Date): void {
    if (this.catchUps.has(id)) return
    const delay = this.d.catchUpDelayMs ?? CATCH_UP_DELAY_MS
    const timer = setTimeout(() => {
      this.catchUps.delete(id)
      const cur = this.d.routines().find((x) => x.id === id)
      if (cur?.enabled && isClockSchedule(cur.schedule)) this.d.enqueue(id, 'catch-up')
    }, delay)
    this.catchUps.set(id, { at: now.getTime() + delay, timer, slot })
  }

  /** Próxima execução prevista (ISO) por rotina; null para manual/pausada/sem horário. */
  nextRuns(): Record<ID, string | null> {
    const now = this.now()
    const out: Record<ID, string | null> = {}
    for (const r of this.d.routines()) out[r.id] = this.nextRunFor(r, now)
    return out
  }

  nextRunFor(r: SchedRoutine, now: Date = this.now()): string | null {
    if (!r.enabled) return null
    const candidates: number[] = []
    const cu = this.catchUps.get(r.id)
    if (cu) candidates.push(cu.at)
    if (r.schedule.kind === 'startup') {
      const st = this.startups.get(r.id)
      if (st) candidates.push(st.at)
    } else if (isClockSchedule(r.schedule)) {
      const next = nextRunAt(r.schedule, now)
      if (next) candidates.push(next.getTime())
    }
    if (!candidates.length) return null
    return new Date(Math.min(...candidates)).toISOString()
  }
}
