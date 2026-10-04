// No Windows, o readdir do libuv marca como "link" qualquer ponto de reanálise (OneDrive,
// deduplicação do Windows Server…). Simulamos isso para garantir que esses arquivos entram no backup
// e que só links de verdade (confirmados pelo lstat) são ignorados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const opendir: typeof real.opendir = async (path, opts) => {
    const dir = await real.opendir(path, opts)
    async function* entries() {
      for await (const ent of dir) {
        if (ent.name.startsWith('nuvem-')) {
          // Como o Windows reporta um arquivo/pasta do OneDrive: isSymbolicLink() = true.
          Object.defineProperties(ent, {
            isSymbolicLink: { value: () => true },
            isFile: { value: () => false },
            isDirectory: { value: () => false }
          })
        }
        yield ent
      }
    }
    return Object.assign(Object.create(dir), { [Symbol.asyncIterator]: entries, close: () => dir.close() })
  }
  return { ...real, opendir, default: { ...real, opendir } }
})

const { walk, makeFilter, emptyWalkStats } = await import('../src/main/engine/walk')
const { tempDir, writeTree } = await import('./helpers')

describe('walk com pontos de reanálise do Windows', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-reparse-'))
    await writeTree(join(dir, 'src'), {
      'nuvem-planilha.xlsx': 'dados do OneDrive',
      'nuvem-pasta/contrato.pdf': 'pdf',
      'local.txt': 'ok'
    })
  })
  afterEach(() => cleanup())

  it('arquivos e pastas do OneDrive entram no backup; só symlinks reais são ignorados', async () => {
    await symlink(join(dir, 'src', 'local.txt'), join(dir, 'src', 'nuvem-atalho-real'))
    const issues: never[] = []
    const stats = emptyWalkStats()
    const rels: string[] = []
    const filter = makeFilter(
      { include: [], exclude: [], skipHiddenAndSystem: false, maxFileSizeMB: null },
      'linux'
    )
    for await (const f of walk(join(dir, 'src'), filter, issues, stats)) rels.push(f.rel)
    expect(rels.sort()).toEqual(['local.txt', 'nuvem-pasta/contrato.pdf', 'nuvem-planilha.xlsx'])
    expect(stats.links).toBe(1)
    expect(issues).toEqual([])
  })
})
