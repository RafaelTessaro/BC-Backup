// config.json bloqueado por instantes (antivírus/indexador no login do Windows) não é "corrompido".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import { JsonFile } from '../src/main/store'
import { HistoryStore } from '../src/main/history'
import type { RunRecord } from '@shared/types'
import { tempDir } from './helpers'

vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-store-retry-'))
})
afterEach(() => cleanup())

describe('JsonFile.load', () => {
  it('erro passageiro de leitura (EBUSY/EPERM) → tenta de novo; não troca o arquivo bom pelo .bak', async () => {
    const file = join(dir, 'config.json')
    await fsp.writeFile(file, JSON.stringify({ v: 'atual' }))
    await fsp.writeFile(`${file}.bak`, JSON.stringify({ v: 'antigo' }))
    const busy = (code: string) => Object.assign(new Error(`${code}: resource busy or locked`), { code })
    vi.mocked(fsp.readFile).mockRejectedValueOnce(busy('EBUSY')).mockRejectedValueOnce(busy('EPERM'))
    const jf = await JsonFile.load(file, (raw) => raw as { v: string })
    expect(jf.data).toEqual({ v: 'atual' })
    expect((await fsp.readdir(dir)).some((n) => n.includes('.corrupt-'))).toBe(false)
  })

  it('JSON inválido continua indo para "*.corrupt-<ts>" e o .bak é usado', async () => {
    const file = join(dir, 'config.json')
    await fsp.writeFile(file, '{ quebrado')
    await fsp.writeFile(`${file}.bak`, JSON.stringify({ v: 'antigo' }))
    const jf = await JsonFile.load(file, (raw) => raw as { v: string })
    expect(jf.data).toEqual({ v: 'antigo' })
    expect((await fsp.readdir(dir)).some((n) => n.includes('.corrupt-'))).toBe(true)
  })
})

describe('HistoryStore.update', () => {
  it('log da execução que não pôde ser lido NÃO é sobrescrito só com a linha nova', async () => {
    const h = await HistoryStore.open(dir, 180)
    const rec: RunRecord = {
      id: 'run-1',
      routineId: 'r',
      routineName: 'R',
      status: 'failed',
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      filesTotal: 0,
      filesCopied: 0,
      filesSkipped: 0,
      bytesTotal: 0,
      bytesCopied: 0,
      warnings: 0,
      errors: 1,
      destinationCount: 1,
      destinations: [],
      log: [{ t: 'x', level: 'error', message: 'linha original importante' }]
    }
    await h.add(rec)
    const io = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })
    vi.mocked(fsp.readFile).mockRejectedValueOnce(io)
    await h.update('run-1', { email: 'sent' }, [{ t: 'y', level: 'info', message: 'E-mail enviado' }])
    const log = JSON.parse(await fsp.readFile(join(dir, 'runs', 'run-1.json'), 'utf8'))
    expect(log.map((l: { message: string }) => l.message)).toContain('linha original importante')
    expect((await h.getMeta('run-1'))?.email).toBe('sent')
  })
})
