// Log do aplicativo em <userData>/logs/bc-backup.log (rotação simples em 5 MB) + console.
// Node puro. O log de cada execução fica no histórico, não aqui.

import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024

let file: string | null = null
let chain: Promise<void> = Promise.resolve()

export function initLogger(logsDir: string): void {
  file = join(logsDir, 'bc-backup.log')
  chain = chain.then(() => mkdir(logsDir, { recursive: true }).then(() => undefined)).catch(() => {})
}

function write(level: string, args: unknown[]): void {
  const text = args
    .map((a) =>
      a instanceof Error
        ? `${a.message}${a.stack ? `\n${a.stack}` : ''}`
        : typeof a === 'string'
          ? a
          : JSON.stringify(a)
    )
    .join(' ')
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${text}\n`
  if (level === 'ERROR') console.error(line.trimEnd())
  else if (level === 'WARN') console.warn(line.trimEnd())
  else if (process.env.BC_DEBUG) console.log(line.trimEnd())
  const target = file
  if (!target) return
  chain = chain
    .then(async () => {
      const st = await stat(target).catch(() => null)
      if (st && st.size > MAX_BYTES) await rename(target, `${target}.1`).catch(() => {})
      await appendFile(target, line, 'utf8')
    })
    .catch(() => {})
}

export const log = {
  info: (...args: unknown[]) => write('INFO', args),
  warn: (...args: unknown[]) => write('WARN', args),
  error: (...args: unknown[]) => write('ERROR', args),
  flush: () => chain
}
