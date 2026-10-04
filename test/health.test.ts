// Regra única de "saúde" (src/shared/health.ts): ícone da bandeja, painel da bandeja e Painel.
import { describe, expect, it } from 'vitest'
import { summarizeHealth, type HealthRoutine } from '@shared/health'
import type { RunProgress, RunSummary } from '@shared/types'

function routine(id: string, patch: Partial<HealthRoutine> = {}, last?: Partial<RunSummary>): HealthRoutine {
  return {
    id,
    name: `Rotina ${id}`,
    enabled: true,
    lastRun: last
      ? ({
          id: `run-${id}`,
          routineId: id,
          routineName: `Rotina ${id}`,
          status: 'success',
          trigger: 'schedule',
          startedAt: '2026-10-04T10:00:00.000Z',
          finishedAt: '2026-10-04T10:05:00.000Z',
          filesTotal: 1,
          filesCopied: 1,
          filesSkipped: 0,
          bytesTotal: 1,
          bytesCopied: 1,
          warnings: 0,
          errors: 0,
          destinationCount: 1,
          ...last
        } as RunSummary)
      : undefined,
    ...patch
  }
}

function progress(runId: string, phase: RunProgress['phase']): RunProgress {
  return {
    runId,
    routineId: 'a',
    routineName: 'Rotina a',
    phase,
    filesTotal: 0,
    filesDone: 0,
    bytesTotal: 0,
    bytesDone: 0,
    speed: 0,
    destinationIndex: 0,
    destinationCount: 1,
    startedAt: '2026-10-04T12:00:00.000Z'
  }
}

describe('summarizeHealth', () => {
  const failed = routine('f', {}, { status: 'failed', finishedAt: '2026-10-03T23:30:00.000Z' })
  const failedNewer = routine('g', {}, { status: 'failed', finishedAt: '2026-10-04T08:00:00.000Z' })
  const warned = routine('w', {}, { status: 'warning' })
  const ok = routine('o', {}, { status: 'success' })

  it('execução em andamento vence tudo (e conta a fila)', () => {
    const h = summarizeHealth([failed], [progress('q', 'queued'), progress('r', 'copying')])
    expect(h.kind).toBe('running')
    expect(h.run?.runId).toBe('r')
    expect(h.count).toBe(1)
  })

  it('só na fila', () => {
    const h = summarizeHealth([ok], { q: progress('q', 'queued') })
    expect(h.kind).toBe('queued')
    expect(h.run?.runId).toBe('q')
  })

  it('fases "done" não contam como execução ativa', () => {
    expect(summarizeHealth([ok], [progress('d', 'done')]).kind).toBe('ok')
  })

  it('falha antes de aviso; a mais recente primeiro', () => {
    const h = summarizeHealth([warned, failed, failedNewer, ok], [])
    expect(h.kind).toBe('failed')
    expect(h.count).toBe(2)
    expect(h.routine?.id).toBe('g')
    expect(h.affected.map((r) => r.id)).toEqual(['g', 'f'])
  })

  it('avisos', () => {
    const h = summarizeHealth([ok, warned], [])
    expect(h.kind).toBe('warning')
    expect(h.routine?.id).toBe('w')
  })

  it('rotina pausada que falhou não deixa o estado vermelho', () => {
    const paused = routine('p', { enabled: false }, { status: 'failed' })
    expect(summarizeHealth([paused, ok], []).kind).toBe('ok')
  })

  it('sem rotinas, tudo pausado e ok', () => {
    expect(summarizeHealth([], []).kind).toBe('empty')
    expect(summarizeHealth([routine('x', { enabled: false })], []).kind).toBe('paused')
    expect(summarizeHealth([routine('n')], []).kind).toBe('ok')
  })
})
