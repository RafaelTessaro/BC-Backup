// Integridade: árvores aleatórias (com semente) copiadas pelo motor real, em pasta e em ZIP, para um
// ou vários destinos — e conferidas byte a byte com leitura PRÓPRIA (sha256 relendo o disco; ZIP
// aberto com o yauzl, CRC-32 e sha256 de cada entrada). O relatório do motor não é usado como prova.
//
// A árvore tem: cadeia de 14 pastas aninhadas, nomes longos (255 bytes), unicode (NFC e NFD lado a
// lado no Linux, emoji, acentos, CJK, RTL), espaços e pontos, ≥ 3000 arquivos pequenos, arquivos
// vazios, pastas vazias e arquivos com tamanhos exatos nas fronteiras de buffer (0, 1, 64 KiB±1,
// 1 MiB±1, 4 MiB±1), com conteúdo incompressível (AES-CTR), zeros, texto e misto.
// BC_STRESS=1 acrescenta um arquivo de ~300 MB, 32 MiB±1 (limite da leitura em memória do ZIP) e um
// ZIP com mais de 65 535 entradas (Zip64).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupMode, SourceItem } from '@shared/types'
import { backupStamp } from '@shared/format'
import {
  BASE_SEED,
  BOUNDARY_SIZES,
  MiB,
  Rng,
  STRESS,
  integrityRoutine,
  leftovers,
  materialize,
  mergeMaps,
  planTree,
  prefixed,
  readSnapshot,
  runAt,
  scanTree,
  snapshotProblems,
  treeDiff,
  writeContent,
  type TreeMap,
  type TreePlan
} from './integrity-lib'
import { tempDir } from './helpers'

const SEED = BASE_SEED
let root: string
let cleanup: () => Promise<void>
let src: string
let plan: TreePlan
let expected: TreeMap

const hasUnzip = (() => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

beforeAll(async () => {
  ;({ dir: root, cleanup } = await tempDir('bcb-integ-tree-'))
  src = join(root, 'origem')
  plan = planTree(new Rng(SEED), {
    smallFiles: 3000,
    depth: 14,
    boundarySizes: BOUNDARY_SIZES,
    emptyDirs: 6,
    allNames: true
  })
  expected = await materialize(src, plan)
}, 120_000)
afterAll(() => cleanup())

let caseSeq = 0
/** Pastas de destino novas para cada caso. */
async function dests(n: number): Promise<string[]> {
  const base = join(root, `caso-${++caseSeq}`)
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    const d = join(base, `d${i}`)
    await mkdir(d, { recursive: true })
    out.push(d)
  }
  return out
}

const destList = (paths: string[]) =>
  paths.map((p, i) => ({ id: `d${i + 1}`, path: p, label: `Destino ${i + 1}` }))

/** Confere: a pasta do destino tem SÓ o backup desta execução; o conteúdo é idêntico ao esperado. */
async function expectExactSnapshot(
  dest: string,
  stamp: string,
  mode: BackupMode,
  want: TreeMap
): Promise<void> {
  const names = (await readdir(dest)).sort()
  if (mode === 'zip') expect(names).toEqual([`${stamp}.zip`, `${stamp}.zip.manifesto.json`])
  else expect(names).toEqual([stamp])
  const snap = join(dest, mode === 'zip' ? `${stamp}.zip` : stamp)
  expect(await snapshotProblems(snap, want, { routineId: 'rot-1' })).toEqual([])
  expect(await leftovers(dest)).toEqual([])
}

describe(`árvore aleatória (semente ${SEED}): ${'≥'}3000 arquivos, 14 níveis, unicode, fronteiras de buffer`, () => {
  it('a árvore gerada tem o que o teste promete', () => {
    expect(plan.files.length).toBeGreaterThanOrEqual(3000)
    expect(Math.max(...plan.files.map((f) => f.rel.split('/').length))).toBeGreaterThanOrEqual(15)
    expect(plan.files.filter((f) => f.size === 0).length).toBeGreaterThan(50)
    for (const s of BOUNDARY_SIZES) expect(plan.files.some((f) => f.size === s)).toBe(true)
    expect(plan.files.some((f) => Buffer.byteLength(f.rel.split('/').at(-1)!, 'utf8') === 255)).toBe(true)
    expect(plan.emptyDirs.length).toBeGreaterThan(0)
  })

  it('pasta: uma origem — idêntica byte a byte à origem, layout plano "<destino>/<carimbo>/…"', async () => {
    const ds = await dests(1)
    const at = new Date(2026, 2, 10, 18, 0, 0)
    const r = await runAt(
      integrityRoutine({ sources: [{ id: 's1', path: src, kind: 'folder' }], destinations: destList(ds) }),
      at
    )
    expect(r.status, r.errorMessage).toBe('success')
    await expectExactSnapshot(ds[0], backupStamp(at), 'copy', expected)
    // Pastas vazias (comportamento documentado): o backup é de ARQUIVOS — pastas vazias não são
    // recriadas no destino. (As que têm arquivos, inclusive só arquivos de 0 bytes, existem.)
    const snap = await readSnapshot(join(ds[0], backupStamp(at)))
    for (const e of plan.emptyDirs) expect(snap.dirs.has(e), e).toBe(false)
  }, 120_000)

  it('ZIP: uma origem — mesmas entradas, nenhuma a mais/a menos/repetida, sha256 e CRC-32 ok', async () => {
    const ds = await dests(1)
    const at = new Date(2026, 2, 10, 19, 0, 0)
    const r = await runAt(
      integrityRoutine({
        sources: [{ id: 's1', path: src, kind: 'folder' }],
        destinations: destList(ds),
        mode: 'zip',
        zipLevel: 6
      }),
      at
    )
    expect(r.status, r.errorMessage).toBe('success')
    await expectExactSnapshot(ds[0], backupStamp(at), 'zip', expected)
    // Segunda opinião (Info-ZIP), quando existe: testa todas as entradas.
    if (hasUnzip)
      execFileSync('unzip', ['-tqq', join(ds[0], `${backupStamp(at)}.zip`)], {
        env: { ...process.env, LC_ALL: 'C.UTF-8' }
      })
  }, 120_000)
})

describe('vários destinos: todos idênticos à origem (e entre si)', () => {
  let med: string
  let medWant: TreeMap
  beforeAll(async () => {
    med = join(root, 'media')
    medWant = await materialize(
      med,
      planTree(new Rng(SEED + 2), {
        smallFiles: 120,
        depth: 12,
        boundarySizes: [0, 1, 64 * 1024 - 1, 64 * 1024 + 1, MiB - 1, MiB + 1],
        emptyDirs: 2,
        allNames: true
      })
    )
  }, 60_000)

  for (const mode of ['copy', 'zip'] as const) {
    it(`${mode}: 3 destinos — cada um com exatamente o mesmo conteúdo da origem`, async () => {
      const ds = await dests(3)
      const at = new Date(2026, 2, 10, 20, mode === 'zip' ? 30 : 0, 0)
      const r = await runAt(
        integrityRoutine({
          sources: [{ id: 's1', path: med, kind: 'folder' }],
          destinations: destList(ds),
          mode
        }),
        at
      )
      expect(r.status, r.errorMessage).toBe('success')
      for (const d of ds) await expectExactSnapshot(d, backupStamp(at), mode, medWant)
    }, 60_000)
  }

  it('ZIP com limite de memória em 1 MiB e sem compressão: 1 MiB−1 pelo buffer, 1 MiB+1 direto no ZIP', async () => {
    const ds = await dests(2)
    const at = new Date(2026, 2, 10, 21, 0, 0)
    const r = await runAt(
      integrityRoutine({
        sources: [{ id: 's1', path: med, kind: 'folder' }],
        destinations: destList(ds),
        mode: 'zip',
        zipLevel: 0
      }),
      at,
      { job: { zipBufferMax: MiB } }
    )
    expect(r.status, r.errorMessage).toBe('success')
    for (const d of ds) await expectExactSnapshot(d, backupStamp(at), 'zip', medWant)
  }, 60_000)

  it('ZIP com tudo direto no ZIP (limite 0) e compressão máxima', async () => {
    const ds = await dests(1)
    const at = new Date(2026, 2, 10, 22, 0, 0)
    const r = await runAt(
      integrityRoutine({
        sources: [{ id: 's1', path: med, kind: 'folder' }],
        destinations: destList(ds),
        mode: 'zip',
        zipLevel: 9
      }),
      at,
      { job: { zipBufferMax: 0 } }
    )
    expect(r.status, r.errorMessage).toBe('success')
    await expectExactSnapshot(ds[0], backupStamp(at), 'zip', medWant)
  }, 60_000)

  it('a origem média continua intacta', async () => {
    expect(treeDiff(medWant, (await scanTree(med)).files)).toEqual([])
  })
})

describe('layouts: várias origens, origem arquivo e nomes de subpastas', () => {
  let multi: { sources: SourceItem[]; want: TreeMap }
  let single: { path: string; sig: { sha256: string; size: number } }

  beforeAll(async () => {
    const rng = new Rng(SEED + 1)
    const a = join(root, 'multi', 'Financeiro')
    const b = join(root, 'multi', 'outra', 'Docs')
    const c = join(root, 'multi', 'rotulada')
    const ta = await materialize(
      a,
      planTree(rng.fork('a'), { smallFiles: 150, depth: 12, boundarySizes: [0, 1, MiB + 1] })
    )
    const tb = await materialize(b, planTree(rng.fork('b'), { smallFiles: 80, depth: 3 }))
    const tc = await materialize(c, planTree(rng.fork('c'), { smallFiles: 40, depth: 2, allNames: true }))
    const f1 = join(root, 'multi', 'soltos', 'relatório 😀.pdf')
    const f2 = join(root, 'multi', 'soltos2', 'relatório 😀.pdf')
    const s1 = await writeContent(f1, 4 * MiB + 1, 'random', 'f1')
    const s2 = await writeContent(f2, 777, 'text', 'f2')
    multi = {
      sources: [
        { id: 's1', path: a, kind: 'folder' },
        { id: 's2', path: b, kind: 'folder' },
        { id: 's3', path: f1, kind: 'file' },
        { id: 's4', path: f2, kind: 'file' },
        { id: 's5', path: c, kind: 'folder', label: 'Rótulo: especial?' }
      ],
      // Nomes esperados escritos à mão (não pelo motor): pasta → nome dela; arquivo homônimo → " (2)";
      // rótulo com caracteres proibidos no Windows → "_".
      want: mergeMaps(
        prefixed(ta, 'Financeiro'),
        prefixed(tb, 'Docs'),
        new Map([
          ['relatório 😀.pdf', s1],
          ['relatório 😀 (2).pdf', s2]
        ]),
        prefixed(tc, 'Rótulo_ especial_')
      )
    }
    const f3 = join(root, 'single', 'Contábil 日本 ç.fdb')
    single = { path: f3, sig: await writeContent(f3, 4 * MiB - 1, 'mixed', 'f3') }
  }, 60_000)

  for (const mode of ['copy', 'zip'] as const) {
    it(`${mode}: várias origens → uma subpasta (ou arquivo) por origem dentro da pasta datada, 2 destinos iguais`, async () => {
      const ds = await dests(2)
      const at = new Date(2026, 2, 11, 18, 0, 0)
      const r = await runAt(
        integrityRoutine({ sources: multi.sources, destinations: destList(ds), mode }),
        at
      )
      expect(r.status, r.errorMessage).toBe('success')
      for (const d of ds) await expectExactSnapshot(d, backupStamp(at), mode, multi.want)
    }, 60_000)

    it(`${mode}: origem do tipo arquivo → o próprio arquivo direto na pasta datada`, async () => {
      const ds = await dests(2)
      const at = new Date(2026, 2, 11, 19, 0, 0)
      const r = await runAt(
        integrityRoutine({
          sources: [{ id: 's1', path: single.path, kind: 'file' }],
          destinations: destList(ds),
          mode
        }),
        at
      )
      expect(r.status, r.errorMessage).toBe('success')
      for (const d of ds)
        await expectExactSnapshot(d, backupStamp(at), mode, new Map([['Contábil 日本 ç.fdb', single.sig]]))
    }, 60_000)
  }
})

describe.runIf(STRESS)('BC_STRESS: arquivos enormes e muitas entradas', () => {
  it('~300 MB num arquivo só (pasta e ZIP): fluxo gerado, conferido byte a byte', async () => {
    const big = join(root, 'stress', 'grande')
    const want = new Map([
      ['banco.fbk', await writeContent(join(big, 'banco.fbk'), 300 * MiB + 12345, 'mixed', 'big')]
    ])
    for (const mode of ['copy', 'zip'] as const) {
      const ds = await dests(1)
      const at = new Date(2026, 2, 12, mode === 'zip' ? 19 : 18, 0, 0)
      const r = await runAt(
        integrityRoutine({
          sources: [{ id: 's1', path: big, kind: 'folder' }],
          destinations: destList(ds),
          mode,
          zipLevel: 1
        }),
        at
      )
      expect(r.status, r.errorMessage).toBe('success')
      await expectExactSnapshot(ds[0], backupStamp(at), mode, want)
    }
  }, 600_000)

  it('ZIP: 32 MiB−1, 32 MiB e 32 MiB+1 (limite real da leitura em memória)', async () => {
    const d32 = join(root, 'stress', '32')
    const want: TreeMap = new Map()
    for (const [i, s] of [32 * MiB - 1, 32 * MiB, 32 * MiB + 1].entries())
      want.set(
        `f${s}.bin`,
        await writeContent(join(d32, `f${s}.bin`), s, i === 1 ? 'random' : 'mixed', `b32-${s}`)
      )
    const ds = await dests(1)
    const at = new Date(2026, 2, 12, 20, 0, 0)
    const r = await runAt(
      integrityRoutine({
        sources: [{ id: 's1', path: d32, kind: 'folder' }],
        destinations: destList(ds),
        mode: 'zip'
      }),
      at
    )
    expect(r.status, r.errorMessage).toBe('success')
    await expectExactSnapshot(ds[0], backupStamp(at), 'zip', want)
  }, 600_000)

  it('ZIP com 70 000 entradas (Zip64 no diretório central)', async () => {
    const many = join(root, 'stress', 'many')
    const want = await materialize(
      many,
      planTree(new Rng(SEED + 7), { smallFiles: 70_000, depth: 2, maxSmall: 64 })
    )
    const ds = await dests(1)
    const at = new Date(2026, 2, 12, 21, 0, 0)
    const r = await runAt(
      integrityRoutine({
        sources: [{ id: 's1', path: many, kind: 'folder' }],
        destinations: destList(ds),
        mode: 'zip',
        zipLevel: 1
      }),
      at
    )
    expect(r.status, r.errorMessage).toBe('success')
    await expectExactSnapshot(ds[0], backupStamp(at), 'zip', want)
  }, 900_000)
})

describe('a origem nunca é alterada por um backup', () => {
  it('depois de todas as execuções acima, a origem continua byte a byte igual à gerada', async () => {
    const now = await scanTree(src)
    expect(treeDiff(expected, now.files)).toEqual([])
    for (const e of plan.emptyDirs) expect(now.dirs.has(e)).toBe(true)
  }, 60_000)
})

// Linux/macOS aceitam nomes que um ZIP não guarda como estão: "C:…" no começo do caminho (o yazl recusa
// como "caminho absoluto") e "\" dentro do nome (no ZIP vira separador de pasta: "a\b.txt" viraria a
// pasta "a" com "b.txt", colidindo com um "a/b.txt" de verdade). Antes, o 1º caso fazia o destino
// falhar em TODA execução (nenhum outro arquivo ficava protegido) e o 2º gravava outra estrutura.
describe.runIf(process.platform !== 'win32')('ZIP: nomes que o formato ZIP não representa', () => {
  it('ficam de fora com aviso (o resto do ZIP íntegro); no modo pasta, copiados como estão', async () => {
    const odd = join(root, 'nomes-zip')
    const w: TreeMap = new Map()
    for (const [rel, size] of [
      ['C:notas.txt', 10],
      ['a\\b.txt', 20],
      ['a/b.txt', 30],
      ['sub/C:dentro.txt', 40],
      ['ok.txt', 50]
    ] as const)
      w.set(rel, await writeContent(join(odd, ...rel.split('/')), size, 'random', rel))
    const zipWant = new Map([...w].filter(([k]) => k !== 'C:notas.txt' && k !== 'a\\b.txt'))
    for (const mode of ['zip', 'copy'] as const) {
      const ds = await dests(1)
      const at = new Date(2026, 2, 13, 10, mode === 'zip' ? 0 : 1)
      const r = await runAt(
        integrityRoutine({
          sources: [{ id: 's1', path: odd, kind: 'folder' }],
          destinations: destList(ds),
          mode
        }),
        at
      )
      if (mode === 'copy') {
        expect(r.status, r.errorMessage).toBe('success')
        await expectExactSnapshot(ds[0], backupStamp(at), mode, w)
        continue
      }
      expect(r.status, r.errorMessage).toBe('warning')
      expect(r.destinations[0].skipped.map((s) => s.path).sort()).toEqual(
        [join(odd, 'C:notas.txt'), join(odd, 'a\\b.txt')].sort()
      )
      const snap = join(ds[0], `${backupStamp(at)}.zip`)
      const problems = await snapshotProblems(snap, zipWant, { routineId: 'rot-1' })
      expect(problems).toEqual([])
    }
  })
})

// Datas de modificação fora do comum (arquivos de câmeras/sistemas com relógio errado, extraídos de
// pacotes antigos ou com data zerada — no Windows aparecem como 01/01/1601). O yazl gravava o horário
// Unix com writeUInt32LE de um número NEGATIVO para datas antes de 1970 → RangeError lançado FORA da
// cadeia de promessas: o motor travava (no app, o processo do motor "caía") e a rotina ZIP nunca mais
// gerava backup enquanto o arquivo existisse.
describe('datas de modificação extremas', () => {
  const DATES: Array<[string, Date]> = [
    ['1601', new Date('1601-01-01T00:00:00Z')],
    ['1960', new Date('1960-05-05T12:00:00Z')],
    ['1969-12-31', new Date('1969-12-31T23:59:59Z')],
    ['1970', new Date(0)],
    ['1979', new Date('1979-06-01T00:00:00Z')],
    ['2040', new Date('2040-02-29T10:00:00Z')],
    ['2110', new Date('2110-01-01T00:00:00Z')]
  ]
  let odd: string
  let w: TreeMap
  beforeAll(async () => {
    odd = join(root, 'datas')
    w = new Map()
    for (const [i, [label, d]] of DATES.entries()) {
      // um pequeno (lido para a memória no ZIP) e um "grande" (direto no ZIP com limite 0) por data
      const rel = `${label}/arquivo ${i}.bin`
      w.set(rel, await writeContent(join(odd, ...rel.split('/')), 1000 + i, 'random', rel))
      await utimes(join(odd, ...rel.split('/')), d, d)
    }
  })
  for (const [mode, zipBufferMax] of [
    ['copy', undefined],
    ['zip', undefined],
    ['zip', 0]
  ] as const) {
    it(`${mode}${zipBufferMax === 0 ? ' (direto no ZIP)' : ''}: backup completo e íntegro`, async () => {
      const ds = await dests(1)
      const at = new Date(2026, 2, 14, 10, mode === 'copy' ? 0 : zipBufferMax === 0 ? 2 : 1)
      const r = await runAt(
        integrityRoutine({
          sources: [{ id: 's1', path: odd, kind: 'folder' }],
          destinations: destList(ds),
          mode
        }),
        at,
        { job: { zipBufferMax } }
      )
      expect(r.status, r.errorMessage).toBe('success')
      await expectExactSnapshot(ds[0], backupStamp(at), mode, w)
    }, 20_000)
  }
})
