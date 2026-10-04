import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFile, readFile, readdir } from 'node:fs/promises'
import type { RunRecord } from '@shared/types'
import { HistoryStore } from '../src/main/history'
import { computeStats } from '../src/main/stats'
import { makeRoutine, tempDir } from './helpers'

function rec(id: string, startedAt: Date, patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    routineId: 'rot-1',
    routineName: 'Financeiro diário',
    status: 'success',
    trigger: 'schedule',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(startedAt.getTime() + 60_000).toISOString(),
    durationMs: 60_000,
    filesTotal: 10,
    filesCopied: 10,
    filesSkipped: 0,
    bytesTotal: 1000,
    bytesCopied: 1000,
    warnings: 0,
    errors: 0,
    destinationCount: 1,
    destinations: [],
    log: [{ t: startedAt.toISOString(), level: 'info', message: `log de ${id}` }],
    ...patch
  }
}

describe('HistoryStore', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-hist-'))
  })
  afterEach(() => cleanup())

  it('grava, lista (mais novo primeiro, com filtros), detalha com log e atualiza', async () => {
    const h = await HistoryStore.open(dir, 180)
    const now = Date.now()
    await h.add(rec('a', new Date(now - 3 * 3_600_000)))
    await h.add(rec('b', new Date(now - 2 * 3_600_000), { status: 'failed', routineId: 'rot-2' }))
    await h.add(rec('c', new Date(now - 1 * 3_600_000), { status: 'warning' }))
    expect(h.list().map((r) => r.id)).toEqual(['c', 'b', 'a'])
    expect(h.list({ routineId: 'rot-1' }).map((r) => r.id)).toEqual(['c', 'a'])
    expect(h.list({ status: 'failed' }).map((r) => r.id)).toEqual(['b'])
    expect(h.list({ limit: 1 }).map((r) => r.id)).toEqual(['c'])
    expect(h.list()[0]).not.toHaveProperty('log')
    expect(h.list()[0]).not.toHaveProperty('destinations')
    const full = await h.get('a')
    expect(full?.log[0].message).toBe('log de a')
    await h.update('a', { email: 'sent' }, [
      { t: new Date().toISOString(), level: 'info', message: 'reenviado' }
    ])
    expect((await h.get('a'))?.email).toBe('sent')
    expect((await h.get('a'))?.log.map((l) => l.message)).toEqual(['log de a', 'reenviado'])
    expect(h.latestByRoutine().get('rot-1')?.id).toBe('c')

    // Reabrir: última linha de cada id vence; linha truncada é ignorada.
    await appendFile(h.file, '{"id":"trunc')
    const h2 = await HistoryStore.open(dir, 180)
    expect(h2.list().map((r) => r.id)).toEqual(['c', 'b', 'a'])
    expect(h2.getMeta('a')?.email).toBe('sent')
    const lines = (await readFile(h2.file, 'utf8')).trim().split('\n')
    expect(lines.length).toBe(3) // compactado
  })

  it('poda registros mais antigos que historyDays (com os logs) e limpa tudo', async () => {
    const h = await HistoryStore.open(dir, 180)
    await h.add(rec('velho', new Date(Date.now() - 40 * 86_400_000)))
    await h.add(rec('novo', new Date()))
    expect(await h.prune(30)).toBe(1)
    expect(h.list().map((r) => r.id)).toEqual(['novo'])
    expect(await readdir(h.logsDir)).toEqual(['novo.json'])
    await h.clear()
    expect(h.list()).toEqual([])
    expect(await readdir(h.logsDir)).toEqual([])
  })
})

describe('computeStats', () => {
  it('7 dias, taxa de sucesso, bytes, 14 dias com o pior status e próximas execuções', () => {
    const now = new Date(2026, 9, 14, 12)
    const day = (d: number, h = 10) => new Date(2026, 9, d, h)
    const runs = [
      rec('1', day(14), { status: 'success', bytesCopied: 100 }),
      rec('2', day(14, 11), { status: 'failed', bytesCopied: 0 }),
      rec('3', day(13), { status: 'warning', bytesCopied: 50 }),
      rec('4', day(12), { status: 'cancelled', bytesCopied: 0 }),
      rec('5', day(7), { status: 'success', bytesCopied: 999 }), // fora dos 7 dias
      rec('6', day(1), { status: 'failed' }), // 1º dia da janela de 14 dias
      rec('7', new Date(2026, 8, 30, 10), { status: 'failed' }) // fora dos 14 dias
    ].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    const routines = [
      makeRoutine({ id: 'r1', name: 'A' }),
      makeRoutine({ id: 'r2', name: 'B', enabled: false })
    ]
    const stats = computeStats(routines, runs, { r1: '2026-10-15T21:00:00.000Z', r2: null }, now)
    expect(stats.routinesTotal).toBe(2)
    expect(stats.routinesActive).toBe(1)
    expect(stats.runsLast7d).toBe(4)
    expect(stats.successRate7d).toBeCloseTo(66.7, 1)
    expect(stats.bytesLast7d).toBe(150)
    expect(stats.lastRun?.id).toBe('2')
    expect(stats.nextRun).toEqual({ routineId: 'r1', routineName: 'A', at: '2026-10-15T21:00:00.000Z' })
    expect(stats.days.length).toBe(14)
    expect(stats.days[0].date).toBe('2026-10-01')
    expect(stats.days[13]).toEqual({ date: '2026-10-14', status: 'failed', runs: 2 })
    expect(stats.days[12]).toEqual({ date: '2026-10-13', status: 'warning', runs: 1 })
    expect(stats.days[11]).toEqual({ date: '2026-10-12', status: 'cancelled', runs: 1 })
    expect(stats.days[10]).toEqual({ date: '2026-10-11', status: null, runs: 0 })
    expect(stats.days[6]).toEqual({ date: '2026-10-07', status: 'success', runs: 1 })
    expect(stats.days[0]).toEqual({ date: '2026-10-01', status: 'failed', runs: 1 })
  })

  it('sem execuções → taxa null', () => {
    const s = computeStats([], [], {}, new Date())
    expect(s.successRate7d).toBeNull()
    expect(s.lastRun).toBeUndefined()
  })
})
