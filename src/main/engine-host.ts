// Lado main do motor de backup: roda o job num utilityProcess (uma varredura de 100 mil
// arquivos não trava a bandeja nem o IPC, e um crash do motor não derruba o app).
// BC_ENGINE_INPROCESS=1 roda no próprio main (depuração); se o fork falhar, também cai para o main.

import { utilityProcess } from 'electron'
import enginePath from './engine/worker?modulePath'
import { e2eJobOptions, runJob } from './engine/job'
import type { EngineEvent, FromWorker, JobResult, JobSpec, ToWorker } from './engine/types'
import { log } from './logger'

export interface EngineJob {
  result: Promise<JobResult>
  cancel(): void
}

function inProcess(spec: JobSpec, onEvent: (e: EngineEvent) => void): EngineJob {
  const ac = new AbortController()
  return {
    result: runJob(spec, onEvent, ac.signal, e2eJobOptions()),
    cancel: () => ac.abort(Object.assign(new Error('Execução cancelada.'), { name: 'AbortError' }))
  }
}

/**
 * Sem nenhum evento do motor por este tempo, a execução é considerada travada (ex.: pasta de rede
 * que parou de responder no meio de uma leitura) e o processo é encerrado, liberando a fila.
 * Generoso de propósito: apagar um backup antigo enorme não emite progresso.
 */
export const STALL_TIMEOUT_MS = Number(process.env.BC_ENGINE_STALL_MS) || 30 * 60_000

function forked(spec: JobSpec, onEvent: (e: EngineEvent) => void): EngineJob {
  const child = utilityProcess.fork(enginePath, [], { serviceName: 'BC Backup Engine', stdio: 'pipe' })
  child.stdout?.on('data', (d: Buffer) => log.info(`[motor] ${d.toString().trimEnd()}`))
  child.stderr?.on('data', (d: Buffer) => log.warn(`[motor] ${d.toString().trimEnd()}`))
  let settled = false
  const send = (m: ToWorker) => {
    try {
      child.postMessage(m)
    } catch {
      // processo já encerrado
    }
  }
  let lastActivity = Date.now()
  let watchdog: NodeJS.Timeout | undefined
  const result = new Promise<JobResult>((resolve, reject) => {
    watchdog = setInterval(
      () => {
        if (settled || Date.now() - lastActivity < STALL_TIMEOUT_MS) return
        settled = true
        clearInterval(watchdog)
        const min = Math.round(STALL_TIMEOUT_MS / 60_000)
        log.warn(`Motor sem progresso há ${min} min em "${spec.routine.name}"; encerrando.`)
        reject(
          new Error(
            `O backup travou: nenhum progresso em ${min} min. Verifique se o disco ou a pasta de rede está respondendo.`
          )
        )
        child.kill()
      },
      Math.min(30_000, STALL_TIMEOUT_MS)
    )
    watchdog.unref()
    child.once('spawn', () => send({ type: 'start', spec }))
    child.on('message', (m: FromWorker) => {
      lastActivity = Date.now()
      if (m.type === 'progress' || m.type === 'log') {
        onEvent(m)
        return
      }
      if (settled) return
      settled = true
      clearInterval(watchdog)
      if (m.type === 'done') resolve(m.result)
      else reject(new Error(m.message))
      setTimeout(() => child.kill(), 50)
    })
    child.once('exit', (code) => {
      clearInterval(watchdog)
      if (!settled) {
        settled = true
        reject(new Error(`O motor de backup parou inesperadamente (código ${code}).`))
      }
    })
  })
  return {
    result,
    cancel() {
      send({ type: 'cancel' })
      // Se travar numa chamada de sistema (disco de rede morto), encerra à força.
      setTimeout(() => {
        if (!settled) child.kill()
      }, 15_000).unref()
    }
  }
}

export function startEngineJob(spec: JobSpec, onEvent: (e: EngineEvent) => void): EngineJob {
  if (process.env.BC_ENGINE_INPROCESS === '1') return inProcess(spec, onEvent)
  try {
    return forked(spec, onEvent)
  } catch (e) {
    log.warn('utilityProcess indisponível; rodando o motor no processo principal', e)
    return inProcess(spec, onEvent)
  }
}
