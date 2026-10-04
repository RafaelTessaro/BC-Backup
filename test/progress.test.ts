import { describe, expect, it } from 'vitest'
import type { RunProgress } from '@shared/types'
import { ProgressTracker } from '../src/main/engine/progress'

describe('ProgressTracker', () => {
  function setup(destinationCount = 1) {
    let t = 0
    const events: RunProgress[] = []
    const tr = new ProgressTracker(
      {
        runId: 'r',
        routineId: 'x',
        routineName: 'X',
        startedAt: '2026-10-04T10:00:00.000Z',
        destinationCount
      },
      (p) => events.push(p),
      () => t
    )
    return { tr, events, advance: (ms: number) => (t += ms) }
  }

  it('no máximo 4 eventos por segundo (mudanças de fase sempre saem)', () => {
    const { tr, events, advance } = setup()
    tr.startDestination(0, '/d', 1000, 100_000_000)
    const before = events.length
    for (let i = 0; i < 1000; i++) {
      advance(10) // 10 s no total
      tr.addBytes(10_000)
    }
    const emitted = events.length - before
    expect(emitted).toBeGreaterThanOrEqual(39)
    expect(emitted).toBeLessThanOrEqual(41)
  })

  it('velocidade = média dos últimos ~3 s; ETA só depois de 5 s e inclui os destinos restantes', () => {
    const { tr, events, advance } = setup(2)
    tr.startDestination(0, '/d1', 10, 10_000_000)
    for (let i = 0; i < 16; i++) {
      advance(250)
      tr.addBytes(250_000) // 1 MB/s
    }
    let last = events.at(-1)!
    expect(last.speed).toBeGreaterThan(900_000)
    expect(last.speed).toBeLessThan(1_100_000)
    expect(last.etaMs).toBeUndefined() // 4 s copiando
    for (let i = 0; i < 8; i++) {
      advance(250)
      tr.addBytes(250_000)
    }
    last = events.at(-1)!
    expect(last.bytesDone).toBe(6_000_000)
    // Restam 4 MB neste destino + 10 MB no próximo, a ~1 MB/s → ~14 s.
    expect(last.etaMs).toBeGreaterThan(12_000)
    expect(last.etaMs).toBeLessThan(16_000)
    tr.phase('pruning')
    expect(events.at(-1)!.phase).toBe('pruning')
    expect(events.at(-1)!.etaMs).toBeUndefined()
  })
})
