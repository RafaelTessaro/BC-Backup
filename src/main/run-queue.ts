// Fila global de execuções: no máximo 1 rodando por vez; a mesma rotina nunca fica
// duas vezes na fila/rodando. Node puro (o executor real é injetado).

import { randomUUID } from 'node:crypto'
import type { ID, RunTrigger } from '@shared/types'

export interface QueueItem {
  runId: ID
  routineId: ID
  routineName: string
  trigger: RunTrigger
  enqueuedAt: string
}

export type Executor = (item: QueueItem, signal: AbortSignal) => Promise<void>

export class RunQueue {
  private queue: QueueItem[] = []
  private current: { item: QueueItem; controller: AbortController } | null = null
  private draining: Promise<void> | null = null

  constructor(
    private readonly exec: Executor,
    private readonly onChange: () => void = () => {},
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Enfileira; se a rotina já estiver na fila ou rodando, devolve o runId existente (added=false). */
  enqueue(routineId: ID, routineName: string, trigger: RunTrigger): { runId: ID; added: boolean } {
    const existing = this.find(routineId)
    if (existing) return { runId: existing.runId, added: false }
    const item: QueueItem = {
      runId: randomUUID(),
      routineId,
      routineName,
      trigger,
      enqueuedAt: this.now().toISOString()
    }
    this.queue.push(item)
    this.onChange()
    void this.drain()
    return { runId: item.runId, added: true }
  }

  find(idOrRunId: ID): QueueItem | undefined {
    if (
      this.current &&
      (this.current.item.routineId === idOrRunId || this.current.item.runId === idOrRunId)
    ) {
      return this.current.item
    }
    return this.queue.find((q) => q.routineId === idOrRunId || q.runId === idOrRunId)
  }

  isBusy(routineId: ID): boolean {
    return !!this.find(routineId)
  }

  get running(): QueueItem | null {
    return this.current?.item ?? null
  }

  get queued(): QueueItem[] {
    return [...this.queue]
  }

  /**
   * Cancela por routineId ou runId. Rodando → aborta (o executor registra 'cancelled');
   * na fila → remove e devolve o item para o chamador registrar.
   */
  cancel(idOrRunId: ID): { state: 'running' | 'queued'; item: QueueItem } | null {
    const cur = this.current
    if (cur && (cur.item.routineId === idOrRunId || cur.item.runId === idOrRunId)) {
      cur.controller.abort(Object.assign(new Error('Execução cancelada.'), { name: 'AbortError' }))
      return { state: 'running', item: cur.item }
    }
    const i = this.queue.findIndex((q) => q.routineId === idOrRunId || q.runId === idOrRunId)
    if (i < 0) return null
    const [item] = this.queue.splice(i, 1)
    this.onChange()
    return { state: 'queued', item }
  }

  /** Remove tudo que está na fila (não mexe no que está rodando). */
  clearQueued(): QueueItem[] {
    const items = this.queue
    this.queue = []
    if (items.length) this.onChange()
    return items
  }

  /** Resolve quando a fila esvaziar. */
  async idle(): Promise<void> {
    while (this.draining) await this.draining
  }

  private drain(): Promise<void> {
    if (this.draining) return this.draining
    this.draining = (async () => {
      for (let item = this.queue.shift(); item; item = this.queue.shift()) {
        const controller = new AbortController()
        this.current = { item, controller }
        this.onChange()
        try {
          await this.exec(item, controller.signal)
        } catch {
          // O executor registra as próprias falhas.
        } finally {
          this.current = null
          this.onChange()
        }
      }
    })().finally(() => {
      this.draining = null
      // Algo pode ter entrado na fila entre o fim do laço e este finally.
      if (this.queue.length) void this.drain()
    })
    return this.draining
  }
}
