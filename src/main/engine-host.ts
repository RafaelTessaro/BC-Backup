// Lado main do motor de backup: roda o job num utilityProcess (uma varredura de 100 mil
// arquivos não trava a bandeja nem o IPC, e um crash do motor não derruba o app).
// BC_ENGINE_INPROCESS=1 roda no próprio main (depuração); se o fork falhar, também cai para o main.

import { utilityProcess } from 'electron'
import enginePath from './engine/worker?modulePath'
import { runJob } from './engine/job'
import type { EngineEvent, FromWorker, JobResult, JobSpec, ToWorker } from './engine/types'
import { log } from './logger'

export interface EngineJob {
  result: Promise<JobResult>
  cancel(): void
}

function inProcess(spec: JobSpec, onEvent: (e: EngineEvent) => void): EngineJob {
  const ac = new AbortController()
  return {
    result: runJob(spec, onEvent, ac.signal),
    cancel: () => ac.abort(Object.assign(new Error('Execução cancelada.'), { name: 'AbortError' }))
  }
}

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
  const result = new Promise<JobResult>((resolve, reject) => {
    child.once('spawn', () => send({ type: 'start', spec }))
    child.on('message', (m: FromWorker) => {
      if (m.type === 'progress' || m.type === 'log') {
        onEvent(m)
        return
      }
      settled = true
      if (m.type === 'done') resolve(m.result)
      else reject(new Error(m.message))
      setTimeout(() => child.kill(), 50)
    })
    child.once('exit', (code) => {
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
