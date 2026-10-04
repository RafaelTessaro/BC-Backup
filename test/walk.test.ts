import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_EXCLUDES } from '@shared/defaults'
import {
  emptyWalkStats,
  estimateSize,
  isHiddenOrSystem,
  makeFilter,
  normalizePattern,
  walk,
  type FileItem,
  type WalkIssue
} from '../src/main/engine/walk'
import { tempDir, writeTree } from './helpers'

describe('normalizePattern', () => {
  it('converte padrões simples em globs', () => {
    expect(normalizePattern('*.tmp')).toBe('**/*.tmp')
    expect(normalizePattern('node_modules/')).toBe('**/node_modules/**')
    expect(normalizePattern('/Temp')).toBe('Temp')
    expect(normalizePattern('Docs\\*.bak')).toBe('Docs/*.bak')
    expect(normalizePattern('./a/b')).toBe('a/b')
    expect(normalizePattern('**/x/**')).toBe('**/x/**')
    expect(normalizePattern('   ')).toBeNull()
  })
})

describe('makeFilter', () => {
  const f = makeFilter(
    { include: [], exclude: DEFAULT_EXCLUDES, skipHiddenAndSystem: false, maxFileSizeMB: null },
    'linux'
  )
  it('exclusões padrão', () => {
    expect(f.fileVerdict('a/Thumbs.db', 'Thumbs.db', 1)).toBe('excluded')
    expect(f.fileVerdict('a/~$plan.xlsx', '~$plan.xlsx', 1)).toBe('excluded')
    expect(f.fileVerdict('x.tmp', 'x.tmp', 1)).toBe('excluded')
    expect(f.dirExcluded('$RECYCLE.BIN', '$RECYCLE.BIN')).toBe(true)
    expect(f.dirExcluded('System Volume Information', 'System Volume Information')).toBe(true)
    expect(f.fileVerdict('docs/a.docx', 'a.docx', 1)).toBe('ok')
  })
  it('incluir: só os padrões pedidos, em qualquer pasta', () => {
    const inc = makeFilter({ include: ['*.docx', '*.XLSX'], exclude: [] }, 'win32')
    expect(inc.fileVerdict('a/b/c.docx', 'c.docx', 1)).toBe('ok')
    expect(inc.fileVerdict('c.xlsx', 'c.xlsx', 1)).toBe('ok') // sem diferenciar maiúsculas no Windows
    expect(inc.fileVerdict('c.pdf', 'c.pdf', 1)).toBe('excluded')
  })
  it('maiúsculas importam no Linux', () => {
    const inc = makeFilter({ include: ['*.XLSX'], exclude: [] }, 'linux')
    expect(inc.fileVerdict('c.xlsx', 'c.xlsx', 1)).toBe('excluded')
  })
  it('tamanho máximo e ocultos/sistema', () => {
    const g = makeFilter({ include: [], exclude: [], skipHiddenAndSystem: true, maxFileSizeMB: 1 }, 'linux')
    expect(g.fileVerdict('big.bin', 'big.bin', 2 * 1024 * 1024)).toBe('too-big')
    expect(g.fileVerdict('.env', '.env', 1)).toBe('hidden')
    expect(g.fileVerdict('a/desktop.ini', 'desktop.ini', 1)).toBe('hidden')
    expect(g.dirExcluded('.git', '.git')).toBe(true)
    expect(isHiddenOrSystem('NTUSER.DAT')).toBe(true)
    expect(isHiddenOrSystem('relatorio.pdf')).toBe(false)
  })
})

describe('walk', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-walk-'))
    await writeTree(join(dir, 'src'), {
      'docs/a.txt': 'hello',
      'docs/b.tmp': 'junk',
      'docs/node_modules/x/i.js': 'x',
      'docs/.oculto': 'h',
      'big.bin': Buffer.alloc(3 * 1024 * 1024, 7),
      'sub/deep/c.txt': 'c'
    })
  })
  afterEach(() => cleanup())

  async function collect(filters: Parameters<typeof makeFilter>[0]) {
    const issues: WalkIssue[] = []
    const stats = emptyWalkStats()
    const items: FileItem[] = []
    for await (const f of walk(join(dir, 'src'), makeFilter(filters, 'linux'), issues, stats)) items.push(f)
    return { items, issues, stats }
  }

  it('aplica exclusões, poda pastas e conta ignorados', async () => {
    await symlink(join(dir, 'src', 'docs'), join(dir, 'src', 'link-docs'))
    const { items, stats } = await collect({
      include: [],
      exclude: ['node_modules/', '*.tmp'],
      skipHiddenAndSystem: true,
      maxFileSizeMB: 2
    })
    expect(items.map((i) => i.rel).sort()).toEqual(['docs/a.txt', 'sub/deep/c.txt'])
    expect(stats.tooBig).toBe(1)
    expect(stats.hidden).toBe(1)
    expect(stats.links).toBe(1)
  })

  it('origem que é um arquivo', async () => {
    const issues: WalkIssue[] = []
    const out: FileItem[] = []
    for await (const f of walk(
      join(dir, 'src', 'docs', 'a.txt'),
      makeFilter(undefined),
      issues,
      emptyWalkStats()
    ))
      out.push(f)
    expect(out.map((o) => [o.rel, o.size])).toEqual([['a.txt', 5]])
  })

  it('cancelamento interrompe a varredura', async () => {
    const ac = new AbortController()
    ac.abort()
    const it = walk(join(dir, 'src'), makeFilter(undefined), [], emptyWalkStats(), ac.signal)
    await expect(it.next()).rejects.toThrow()
  })

  it('estimateSize soma com filtros e ignora origens inexistentes', async () => {
    const r = await estimateSize([join(dir, 'src'), join(dir, 'nao-existe')], {
      include: [],
      exclude: ['*.bin']
    })
    expect(r.partial).toBe(false)
    expect(r.files).toBe(5)
    expect(r.bytes).toBe(5 + 4 + 1 + 1 + 1)
  })

  it('estimateSize com tempo esgotado devolve parcial', async () => {
    const r = await estimateSize([join(dir, 'src')], undefined, 0)
    expect(r.partial).toBe(true)
  })
})
