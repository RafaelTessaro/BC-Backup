// "Mover" no executor (src/main/runner.ts): o motor pode ser encerrado no meio da fase "moving"
// (vigia de travamento, crash, saída do app). O que já saiu da origem precisa ficar registrado.
import { describe, expect, it, vi } from 'vitest'
import type { RunRecord, RunSummary } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { EngineEvent, JobSpec } from '../src/main/engine/types'
import { makeRoutine } from './helpers'

const appLog = vi.hoisted(() => ({ info: [] as string[] }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bcb-runner' },
  powerSaveBlocker: { start: () => 1, isStarted: () => false, stop: () => {} }
}))
vi.mock('../src/main/logger', () => ({
  log: {
    info: (...a: unknown[]) => appLog.info.push(a.map(String).join(' ')),
    warn: () => {},
    error: () => {},
    flush: async () => {}
  }
}))
/** Motor que apaga 6.000 arquivos e "trava" (o vigia o encerra) antes de devolver o relatório. */
vi.mock('../src/main/engine-host', () => ({
  startEngineJob: (_spec: JobSpec, onEvent: (e: EngineEvent) => void) => ({
    result: (async () => {
      const t = new Date().toISOString()
      onEvent({ type: 'log', entry: { t, level: 'info', message: 'Início do backup "ERP".' } })
      for (let i = 0; i < 6000; i++)
        onEvent({
          type: 'log',
          entry: {
            t,
            level: 'info',
            message: `Movido: /erp/Backup/f${i}.fbk (1 KB), conferido em 2 destinos.`
          }
        })
      throw new Error('O backup travou: nenhum progresso em 30 min.')
    })(),
    cancel: () => {}
  })
}))

const { RunManager } = await import('../src/main/runner')

describe('motor encerrado no meio da fase "moving"', () => {
  it('o histórico diz quantos arquivos saíram da origem e cada um fica no log do aplicativo', async () => {
    const routine = makeRoutine({
      id: 'r1',
      name: 'ERP',
      moveSources: { enabled: true, minAgeMinutes: 30, warnIfEmpty: true }
    })
    const records: RunRecord[] = []
    let finished!: (s: RunSummary) => void
    const done = new Promise<RunSummary>((r) => (finished = r))
    const runner = new RunManager({
      store: {
        settings: DEFAULT_SETTINGS,
        getRoutine: (id: string) => (id === 'r1' ? routine : undefined),
        setRoutineState: () => {}
      } as never,
      history: { add: async (r: RunRecord) => void records.push(r) } as never,
      outbox: () => null,
      nextRunFor: () => null,
      getSmtpPassword: async () => '',
      info: { version: '0.1.0', hostname: 'pc' },
      emitProgress: () => {},
      onFinished: (s) => finished(s),
      onQueueChange: () => {}
    })
    runner.enqueue('r1', 'manual')
    await done
    const rec = records[0]
    expect(rec.status).toBe('failed')
    expect(rec.notice).toBe(
      'A execução parou antes de terminar; 6.000 arquivos já tinham sido apagados da origem (veja o log).'
    )
    // Auditoria fora do histórico: sobrevive mesmo se o app fechar antes de gravá-lo.
    const moved = appLog.info.filter((l) => l.includes('Movido: /erp/Backup/'))
    expect(moved.length).toBe(6000)
    expect(moved[0]).toContain('[ERP] Movido: /erp/Backup/f0.fbk')
  })
})
