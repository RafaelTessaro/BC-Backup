// Fila de saída de e-mails (doc 01 §7): se o envio falhar (ex.: sem internet), tenta de novo
// a cada 15 min por até 24 h. Persistida em outbox.json. Node puro (o envio é injetado).
// Relógio corrigido para trás: próxima tentativa além de 15 min no futuro (ou criação no futuro)
// só pode ter sido gravada com o relógio errado — o item é tentado já e a janela de 24 h recomeça.

import { randomUUID } from 'node:crypto'
import { readFileRetry, writeJsonAtomic } from '../engine/fsutil'
import { isObj } from '../store'
import type { OutgoingMail } from './smtp'

export const RETRY_EVERY_MS = 15 * 60_000
export const MAX_AGE_MS = 24 * 60 * 60_000

export interface OutboxItem {
  id: string
  runId: string
  createdAt: string
  attempts: number
  nextAttemptAt: string
  lastError?: string
  mail: OutgoingMail
}

export interface OutboxDeps {
  file: string
  send(mail: OutgoingMail): Promise<void>
  onSent(item: OutboxItem): void | Promise<void>
  onExpired(item: OutboxItem, lastError: string): void | Promise<void>
  errorMessage(e: unknown): string
  now?(): Date
  retryEveryMs?: number
  maxAgeMs?: number
}

export class Outbox {
  private list: OutboxItem[] = []
  private timer: NodeJS.Timeout | null = null
  private busy: Promise<void> | null = null

  private constructor(private readonly d: OutboxDeps) {}

  static async open(d: OutboxDeps): Promise<Outbox> {
    const o = new Outbox(d)
    try {
      const raw: unknown = JSON.parse(await readFileRetry(d.file))
      const items = isObj(raw) && Array.isArray(raw.items) ? raw.items : []
      o.list = items.filter(
        (i): i is OutboxItem =>
          isObj(i) && typeof i.id === 'string' && typeof i.runId === 'string' && isObj(i.mail)
      )
    } catch {
      o.list = []
    }
    return o
  }

  private now(): Date {
    return this.d.now ? this.d.now() : new Date()
  }

  items(): OutboxItem[] {
    return [...this.list]
  }

  private save(): Promise<void> {
    return writeJsonAtomic(this.d.file, { items: this.list }).catch(() => {})
  }

  /** Coloca na fila um e-mail cujo primeiro envio falhou. */
  async add(runId: string, mail: OutgoingMail, error: string): Promise<OutboxItem> {
    const now = this.now()
    const item: OutboxItem = {
      id: randomUUID(),
      runId,
      createdAt: now.toISOString(),
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + (this.d.retryEveryMs ?? RETRY_EVERY_MS)).toISOString(),
      lastError: error,
      mail
    }
    this.list.push(item)
    await this.save()
    this.arm()
    return item
  }

  start(): void {
    this.arm()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Instante da próxima tentativa; "agora" se o valor gravado for inválido ou do relógio adiantado. */
  private dueAt(item: OutboxItem, now: number): number {
    const t = Date.parse(item.nextAttemptAt)
    if (!Number.isFinite(t) || t - now > (this.d.retryEveryMs ?? RETRY_EVERY_MS)) return now
    return t
  }

  private arm(): void {
    this.stop()
    if (!this.list.length) return
    const now = this.now().getTime()
    const next = Math.min(...this.list.map((i) => this.dueAt(i, now)))
    const wait = Math.max(1_000, Math.min(next - now, 60 * 60_000))
    this.timer = setTimeout(() => void this.processDue(), wait)
    this.timer.unref?.()
  }

  /** Tenta os itens vencidos (em sequência). */
  processDue(): Promise<void> {
    if (this.busy) return this.busy
    this.busy = (async () => {
      const retryEvery = this.d.retryEveryMs ?? RETRY_EVERY_MS
      const maxAge = this.d.maxAgeMs ?? MAX_AGE_MS
      for (const item of [...this.list]) {
        const now = this.now().getTime()
        if (this.dueAt(item, now) > now) continue
        if (!((Date.parse(item.createdAt) || 0) <= now)) item.createdAt = new Date(now).toISOString()
        try {
          await this.d.send(item.mail)
          this.list = this.list.filter((i) => i.id !== item.id)
          await this.save()
          await this.d.onSent(item)
        } catch (e) {
          item.attempts++
          item.lastError = this.d.errorMessage(e)
          const age = now - (Date.parse(item.createdAt) || now)
          if (age + retryEvery > maxAge) {
            this.list = this.list.filter((i) => i.id !== item.id)
            await this.save()
            await this.d.onExpired(item, item.lastError)
          } else {
            item.nextAttemptAt = new Date(now + retryEvery).toISOString()
            await this.save()
          }
        }
      }
    })().finally(() => {
      this.busy = null
      this.arm()
    })
    return this.busy
  }
}
