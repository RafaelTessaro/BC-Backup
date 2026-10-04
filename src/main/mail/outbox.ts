// Fila de saída de e-mails (doc 01 §7): se o envio falhar (ex.: sem internet), tenta de novo
// a cada 15 min por até 24 h. Persistida em outbox.json. Node puro (o envio é injetado).

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from '../engine/fsutil'
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
      const raw: unknown = JSON.parse(await readFile(d.file, 'utf8'))
      const items = isObj(raw) && Array.isArray(raw.items) ? raw.items : []
      o.list = items.filter(
        (i): i is OutboxItem => isObj(i) && typeof i.id === 'string' && typeof i.runId === 'string' && isObj(i.mail)
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

  private arm(): void {
    this.stop()
    if (!this.list.length) return
    const now = this.now().getTime()
    const next = Math.min(...this.list.map((i) => Date.parse(i.nextAttemptAt) || now))
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
        if ((Date.parse(item.nextAttemptAt) || 0) > now) continue
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
