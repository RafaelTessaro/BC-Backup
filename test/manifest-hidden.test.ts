import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Routine } from '@shared/types'
import { MANIFEST_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import { runJob } from '../src/main/engine/job'
import { hideFile } from '../src/main/engine/fsutil'
import { makeRoutine, tempDir, writeTree } from './helpers'

// O manifesto ("bcbackup-manifesto.json" na pasta, "<carimbo>.zip.manifesto.json" ao lado do ZIP) é
// gravado oculto: o cliente vê só os arquivos dele. Esconder é só aparência — se falhar, o backup segue.

let dir: string
let cleanup: () => Promise<void>
const startedAt = new Date(2026, 9, 8, 18, 0, 0)
const stamp = backupStamp(startedAt)

beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-hide-'))
  await writeTree(join(dir, 'origem'), { 'a.txt': 'hello', 'sub/b.txt': 'mundo' })
  await mkdir(join(dir, 'd1'))
})
afterEach(() => cleanup())

function routine(patch: Partial<Routine> = {}) {
  return makeRoutine({
    sources: [{ id: 's1', path: join(dir, 'origem'), kind: 'folder' }],
    destinations: [{ id: 'd1', path: join(dir, 'd1') }],
    verify: 'full',
    ...patch
  })
}

async function run(r: ReturnType<typeof routine>, hide: (file: string) => Promise<unknown>) {
  return runJob(
    {
      runId: 'run-1',
      routine: r,
      trigger: 'manual',
      startedAt: startedAt.toISOString(),
      appVersion: '0.1.0',
      hostname: 'pc-teste'
    },
    () => {},
    new AbortController().signal,
    { now: () => new Date(2026, 9, 8, 18, 0, 5), hideFile: hide }
  )
}

describe('manifesto oculto', () => {
  it('modo pasta: esconde o manifesto depois de gravado (e só ele)', async () => {
    const hidden: string[] = []
    const res = await run(routine(), async (f) => {
      // No instante em que é escondido, o manifesto já está completo (nunca é regravado depois).
      const m = JSON.parse(await readFile(f, 'utf8'))
      expect(m.files).toBe(2)
      expect(m.verified).toBe(true)
      hidden.push(f)
    })
    expect(res.status).toBe('success')
    expect(hidden).toHaveLength(1)
    expect(basename(hidden[0])).toBe(MANIFEST_FILE)
    // O manifesto continua na pasta final (o rename leva junto o atributo de oculto).
    const out = join(dir, 'd1', stamp)
    expect((await readdir(out)).sort()).toEqual(['a.txt', MANIFEST_FILE, 'sub'].sort())
  })

  it('modo ZIP: esconde o "<carimbo>.zip.manifesto.json" ao lado do .zip', async () => {
    const hidden: string[] = []
    const res = await run(routine({ mode: 'zip' }), async (f) => {
      hidden.push(f)
    })
    expect(res.status).toBe('success')
    expect(hidden).toEqual([join(dir, 'd1', `${stamp}.zip.manifesto.json`)])
    expect((await readdir(join(dir, 'd1'))).sort()).toEqual([`${stamp}.zip`, `${stamp}.zip.manifesto.json`])
  })

  it('falha ao esconder não afeta o backup', async () => {
    const res = await run(routine(), () => Promise.reject(new Error('attrib falhou')))
    expect(res.status).toBe('success')
    expect(res.destinations[0].status).toBe('success')
    const m = JSON.parse(await readFile(join(dir, 'd1', stamp, MANIFEST_FILE), 'utf8'))
    expect(m.format).toBe('bcbackup-manifesto')
  })

  it('hideFile nunca lança: Linux não faz nada; sem attrib/chflags devolve false', async () => {
    const f = join(dir, 'origem', 'a.txt')
    await expect(hideFile(f, 'linux')).resolves.toBe(false)
    if (process.platform === 'linux') {
      await expect(hideFile(f, 'win32')).resolves.toBe(false)
      await expect(hideFile(f, 'darwin')).resolves.toBe(false)
    }
    await expect(hideFile(join(dir, 'nao-existe.json'))).resolves.toBeTypeOf('boolean')
  })
})
