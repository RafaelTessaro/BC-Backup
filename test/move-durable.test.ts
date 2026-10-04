// "Mover": a cópia precisa estar gravada no disco (fsync) antes de a origem ser apagada — numa queda de
// energia logo depois, o cache do sistema perderia a cópia e a origem já teria sumido.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'

const writeOpts: unknown[] = []
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const createWriteStream = ((path: string, opts?: unknown) => {
    writeOpts.push(opts)
    return real.createWriteStream(path, opts as never)
  }) as typeof real.createWriteStream
  return { ...real, createWriteStream, default: { ...real, createWriteStream } }
})

const { copyTree } = await import('../src/main/engine/copy')
const { ProgressTracker } = await import('../src/main/engine/progress')
const { makeMoveFilter } = await import('../src/main/engine/move')
const { tempDir, writeTree } = await import('./helpers')

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-durable-'))
  writeOpts.length = 0
})
afterEach(() => cleanup())

async function copyOnce(durable: boolean | undefined) {
  await writeTree(join(dir, 'src'), { 'erp.fbk': 'dados do ERP' })
  const st = await stat(join(dir, 'src', 'erp.fbk'))
  const item = {
    abs: join(dir, 'src', 'erp.fbk'),
    rel: 'erp.fbk',
    size: st.size,
    mtime: st.mtime,
    atime: st.atime,
    ctime: st.ctime,
    mtimeMs: st.mtimeMs,
    ctimeMs: st.ctimeMs
  }
  const tracker = new ProgressTracker(
    { runId: 'r', routineId: 'x', routineName: 'x', startedAt: '', destinationCount: 1 },
    () => {}
  )
  const out = join(dir, `out-${String(durable)}`)
  return copyTree([item], out, tracker, new AbortController().signal, { hash: true, durable })
}

describe('gravação durável no "Mover"', () => {
  it('com durable, o arquivo copiado é gravado com flush (fsync antes de fechar)', async () => {
    const r = await copyOnce(true)
    expect(r.copied).toHaveLength(1)
    expect(writeOpts).toContainEqual(expect.objectContaining({ flags: 'wx', flush: true }))
  })

  it('cópia comum (sem "Mover") não paga o custo do fsync por arquivo', async () => {
    await copyOnce(undefined)
    expect(writeOpts).toContainEqual(expect.objectContaining({ flags: 'wx', flush: false }))
  })
})

describe('MOVE_NEVER cobre scripts e executáveis em qualquer caixa', () => {
  it.each(['instalar.JS', 'tarefa.wsf', 'rotina.py', 'chave.REG', 'proteção.scr', 'app.jar', 'vírus.com'])(
    '%s nunca é movido',
    (name) => {
      const f = makeMoveFilter(
        { include: [], exclude: [], skipHiddenAndSystem: false, maxFileSizeMB: null },
        'linux'
      )
      expect(f.fileVerdict(`Backup/${name}`, name, 10)).toBe('excluded')
    }
  )
  it('backups comuns de ERP continuam elegíveis', () => {
    const f = makeMoveFilter(
      { include: [], exclude: [], skipHiddenAndSystem: false, maxFileSizeMB: null },
      'linux'
    )
    for (const n of ['erp.fbk', 'erp.GBK', 'banco.bak', 'dump.sql', 'backup.zip', 'notas.xml']) {
      expect(f.fileVerdict(`Backup/${n}`, n, 10)).toBe('ok')
    }
  })
})
