// Revisão (QA #3): sair do app com um backup rodando (src/main/runner.ts → shutdown).
// O motor pode demorar a responder ao cancelamento (apagando a cópia parcial numa pasta de rede lenta)
// e o e-mail pode estar sendo enviado: o app fecha mesmo assim, mas a execução não pode sumir do histórico.
import { describe, expect, it, vi } from 'vitest'
import type { RunRecord, RunSummary } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { JobResult } from '../src/main/engine/types'
import { makeRoutine } from './helpers'

const engine = vi.hoisted(() => ({ mode: 'stuck' as 'stuck' | 'success' }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bcb-review-runner' },
  powerSaveBlocker: { start: () => 1, isStarted: () => false, stop: () => {} }
}))
vi.mock('../src/main/logger', () => ({
  log: { info: () => {}, warn: () => {}, error: () => {}, flush: async () => {} }
}))
vi.mock('../src/main/mail/smtp', async (orig) => ({
  ...(await orig<object>()),
  // Servidor de e-mail que não responde (o tempo limite real é de 2 min).
  sendMail: () => new Promise(() => {})
}))
vi.mock('../src/main/engine-host', () => ({
  startEngineJob: () => {
    const now = new Date().toISOString()
    const ok: JobResult = {
      status: 'success',
      finishedAt: now,
      filesTotal: 3,
      bytesTotal: 30,
      filesCopied: 3,
      bytesCopied: 30,
      filesSkipped: 0,
      warnings: 0,
      errors: 0,
      destinations: [],
      log: [{ t: now, level: 'info', message: 'Backup concluído com sucesso.' }]
    }
    return {
      // 'stuck': o cancelamento não chega a terminar antes do app fechar.
      result: engine.mode === 'stuck' ? new Promise<JobResult>(() => {}) : Promise.resolve(ok),
      cancel: () => {}
    }
  }
}))

const { RunManager } = await import('../src/main/runner')

function setup(routine = makeRoutine({ id: 'r1', name: 'Financeiro' }), smtpHost = '') {
  const records: RunRecord[] = []
  const progress: string[] = []
  const settings = {
    ...DEFAULT_SETTINGS,
    smtp: { ...DEFAULT_SETTINGS.smtp, host: smtpHost, fromEmail: smtpHost ? 'bc@empresa.com' : '' }
  }
  const runner = new RunManager({
    store: {
      settings,
      getRoutine: (id: string) => (id === routine.id ? routine : undefined),
      setRoutineState: () => {}
    } as never,
    history: { add: async (r: RunRecord) => void records.push(structuredClone(r)) } as never,
    outbox: () => null,
    nextRunFor: () => null,
    getSmtpPassword: async () => '',
    info: { version: '0.1.0', hostname: 'pc' },
    emitProgress: (p) => progress.push(p.phase),
    onFinished: (_s: RunSummary) => {},
    onQueueChange: () => {}
  })
  return { runner, records, progress }
}

describe('sair com backup em andamento', () => {
  it('motor não termina a tempo: a execução fica no histórico como cancelada', async () => {
    engine.mode = 'stuck'
    const { runner, records } = setup()
    const { runId } = runner.enqueue('r1', 'schedule')!
    await vi.waitFor(() => expect(runner.liveProgress).not.toBeNull())
    await runner.shutdown(50)
    expect(records.map((r) => [r.id, r.status])).toEqual([[runId, 'cancelled']])
    expect(records[0].log.at(-1)?.message).toMatch(/fechado/)
    expect(records[0].trigger).toBe('schedule')
  })

  it('backup já concluído, preso no envio do e-mail: fica como sucesso, com o e-mail não enviado', async () => {
    engine.mode = 'success'
    const routine = makeRoutine({
      id: 'r1',
      name: 'Financeiro',
      notification: {
        enabled: true,
        recipients: ['cliente@empresa.com'],
        bcc: [],
        onSuccess: true,
        onWarning: true,
        onFailure: true,
        attachLog: 'never'
      }
    })
    const { runner, records, progress } = setup(routine, 'smtp.empresa.com')
    runner.enqueue('r1', 'manual')
    await vi.waitFor(() => expect(progress).toContain('notifying'))
    await runner.shutdown(50)
    expect(records.length).toBe(1)
    expect(records[0].status).toBe('success')
    expect(records[0].filesCopied).toBe(3)
    expect(records[0].email).toBe('failed')
  })
})

describe('pedido de execução durante o encerramento', () => {
  it('não começa um backup novo enquanto o app fecha', async () => {
    engine.mode = 'stuck'
    const other = makeRoutine({ id: 'r2', name: 'Outra' })
    const routines = [makeRoutine({ id: 'r1', name: 'Financeiro' }), other]
    const records: RunRecord[] = []
    const runner = new RunManager({
      store: {
        settings: DEFAULT_SETTINGS,
        getRoutine: (id: string) => routines.find((r) => r.id === id),
        setRoutineState: () => {}
      } as never,
      history: { add: async (r: RunRecord) => void records.push(structuredClone(r)) } as never,
      outbox: () => null,
      nextRunFor: () => null,
      getSmtpPassword: async () => '',
      info: { version: '0.1.0', hostname: 'pc' },
      emitProgress: () => {},
      onFinished: () => {},
      onQueueChange: () => {}
    })
    runner.enqueue('r1', 'manual')
    await vi.waitFor(() => expect(runner.liveProgress).not.toBeNull())
    const closing = runner.shutdown(50)
    // "Executar agora" clicado na bandeja/janela durante a espera do encerramento.
    expect(runner.enqueue('r2', 'manual')).toBeNull()
    await closing
    expect(runner.active().map((p) => p.routineId)).not.toContain('r2')
  })
})
