// Ponto de entrada do utilityProcess (motor de backup). Só APIs do Node aqui —
// nada de BrowserWindow, powerMonitor ou safeStorage.
// Protocolo: main → { type:'start', spec } | { type:'cancel' }
//            worker → progress | log | { type:'done', result } | { type:'crashed', message }

import { e2eJobOptions, runJob } from './job'
import type { FromWorker, ToWorker } from './types'

const ac = new AbortController()
let started = false

const post = (m: FromWorker) => process.parentPort.postMessage(m)

process.parentPort.on('message', (e: { data: ToWorker }) => {
  const msg = e.data
  if (msg.type === 'cancel') {
    ac.abort(Object.assign(new Error('Execução cancelada.'), { name: 'AbortError' }))
    return
  }
  if (msg.type !== 'start' || started) return
  started = true
  runJob(msg.spec, (ev) => post(ev), ac.signal, e2eJobOptions()).then(
    (result) => post({ type: 'done', result }),
    (err: unknown) => post({ type: 'crashed', message: err instanceof Error ? err.message : String(err) })
  )
})

process.on('uncaughtException', (err) => {
  post({ type: 'crashed', message: err instanceof Error ? err.message : String(err) })
})
