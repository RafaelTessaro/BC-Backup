// Integridade + retenção ao longo de 30 "dias" simulados (relógio injetado: JobOptions.now e
// spec.startedAt). Duas rotinas gravam na MESMA pasta de destino (uma em pasta, outra em ZIP, às vezes
// no mesmo segundo → "_2"), com pastas LEGADAS ("<destino>/BC Backup/<rotina>/") e coisas do usuário
// misturadas. A rotina A também grava num segundo destino só dela, que fica indisponível no dia 5.
//
// Depois de CADA execução, com leitura própria:
//  - sobram exatamente os backups que a regra (dias=7, mínimo=3, por dia de calendário, contando os
//    legados) manda manter — calculado por um modelo independente, por rotina e por destino;
//  - cada backup que sobrou continua byte a byte igual à origem do dia em que foi feito;
//  - nada que não é da rotina (outra rotina, legado de outra rotina, arquivos do usuário, pasta com
//    nome de backup sem manifesto, ZIP qualquer) é tocado; nenhuma sobra fica na pasta.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LEGACY_ROOT_DIR, MANIFEST_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import {
  BASE_SEED,
  KINDS,
  KiB,
  Rng,
  integrityRoutine,
  leftovers,
  materialize,
  planTree,
  prefixed,
  mergeMaps,
  runAt,
  scanTree,
  sha256File,
  snapshotProblems,
  treeDiff,
  writeContent,
  type TreeMap
} from './integrity-lib'
import { makeLegacyRoutineDir, manifest, tempDir } from './helpers'

const SEED = BASE_SEED + 100
const DAYS = 7
const MIN_KEEP = 3

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => {
  ;({ dir: root, cleanup } = await tempDir('bcb-integ-ret-'))
})
afterAll(() => cleanup())

/* ------------------------- modelo independente ------------------------- */

interface ModelSnap {
  /** Pasta onde o backup está (destino ou pasta legada). */
  dir: string
  name: string
  date: Date
  seq: number
  content: TreeMap
}

function parseName(name: string): { date: Date; seq: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_(\d+))?(?:\.zip)?$/.exec(name)
  if (!m) throw new Error(`nome inesperado: ${name}`)
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  return { date: new Date(y, mo - 1, d, h, mi, s), seq: m[7] ? Number(m[7]) : 1 }
}

/** Doc 01 §6, escrito de novo aqui: manter os dos últimos `DAYS` dias de calendário, nunca menos que MIN_KEEP. */
function survivors(all: ModelSnap[], now: Date, created: ModelSnap): ModelSnap[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1)).getTime()
  const sorted = [...all].sort((a, b) => b.date.getTime() - a.date.getTime() || b.seq - a.seq)
  const kept = (s: ModelSnap) => s === created || s.date.getTime() >= cutoff
  const keep = sorted.filter(kept)
  const cands = sorted.filter((s) => !kept(s))
  return [...keep, ...cands.slice(0, Math.max(0, MIN_KEEP - keep.length))]
}

/* ------------------------------ origens -------------------------------- */

/** Origem viva: o mapa esperado acompanha cada alteração feita pelo teste. */
class LiveSource {
  state: TreeMap = new Map()
  private seq = 0
  constructor(
    readonly path: string,
    private readonly rng: Rng
  ) {}
  async init(files: number): Promise<void> {
    this.state = await materialize(
      this.path,
      planTree(this.rng.fork('init'), { smallFiles: files, depth: 3, maxSmall: 8 * KiB })
    )
    // Um arquivo maior (acima de 64 KiB, vários blocos de leitura) que muda de vez em quando.
    this.state.set(
      'banco/dados.fdb',
      await writeContent(join(this.path, 'banco', 'dados.fdb'), 192 * KiB + 1, 'mixed', 'db0')
    )
  }
  /** Um "dia de trabalho": altera, cria e apaga alguns arquivos. */
  async mutate(day: number): Promise<void> {
    const r = this.rng.fork(`dia-${day}`)
    const rels = [...this.state.keys()].sort()
    for (let i = r.int(1, 3); i > 0; i--) {
      const rel = r.pick(rels)
      const size = rel === 'banco/dados.fdb' ? 192 * KiB + r.int(-2, 2) * 4096 + 1 : r.int(0, 16 * KiB)
      this.state.set(
        rel,
        await writeContent(this.abs(rel), size, r.pick(KINDS), `${rel}@${day}#${this.seq++}`)
      )
    }
    for (let i = r.int(0, 1); i > 0; i--) {
      const rel = `dia ${String(day).padStart(2, '0')}/novo ${i} ç.txt`
      this.state.set(
        rel,
        await writeContent(this.abs(rel), r.int(0, 4 * KiB), r.pick(KINDS), `${rel}#${this.seq++}`)
      )
    }
    if (rels.length > 10 && r.chance(0.7)) {
      const victim = r.pick(rels.filter((x) => x !== 'banco/dados.fdb'))
      await rm(this.abs(victim))
      this.state.delete(victim)
    }
  }
  abs(rel: string): string {
    return join(this.path, ...rel.split('/'))
  }
}

/* ------------------------------- cenário ------------------------------- */

describe(`retenção ao longo de 30 dias (semente ${SEED}): dias=${DAYS}, mínimo=${MIN_KEEP}`, () => {
  it('pasta compartilhada por 2 rotinas + legados + arquivos do usuário: só sai o que a regra manda, o resto fica íntegro', async () => {
    const rng = new Rng(SEED)
    const shared = join(root, 'compartilhado')
    const priv = join(root, 'privado')
    await mkdir(shared, { recursive: true })
    await mkdir(priv, { recursive: true })

    const srcA = new LiveSource(join(root, 'origem-A'), rng.fork('A'))
    const srcB = new LiveSource(join(root, 'origem-B'), rng.fork('B'))
    await srcA.init(8)
    await srcB.init(5)
    const fileB = join(root, 'soltos', 'planilha fiscal.xlsx')
    let fileBSig = await writeContent(fileB, 30 * KiB, 'text', 'fb0')
    // A origem gerada é exatamente o que o teste acha que é.
    expect(treeDiff(srcA.state, (await scanTree(srcA.path)).files)).toEqual([])

    const A = integrityRoutine({
      id: 'rot-A',
      name: 'Financeiro',
      sources: [{ id: 'a1', path: srcA.path, kind: 'folder' }],
      destinations: [
        { id: 'S', path: shared, label: 'Servidor' },
        { id: 'P', path: priv, label: 'HD externo' }
      ],
      mode: 'copy',
      retention: { enabled: true, days: DAYS, minKeep: MIN_KEEP }
    })
    const B = integrityRoutine({
      id: 'rot-B',
      name: 'Contábil',
      sources: [
        { id: 'b1', path: srcB.path, kind: 'folder' },
        { id: 'b2', path: fileB, kind: 'file' }
      ],
      destinations: [{ id: 'S', path: shared }],
      mode: 'zip',
      retention: { enabled: true, days: DAYS, minKeep: MIN_KEEP }
    })

    /* ----- legados e coisas do usuário na pasta compartilhada ----- */
    const legacy = async (name: string, id: string, days: number[]): Promise<ModelSnap[]> => {
      const dir = await makeLegacyRoutineDir(shared, name, id)
      const out: ModelSnap[] = []
      for (const d of days) {
        const date = new Date(2026, 0, d, 9, 30, 0)
        const sname = backupStamp(date)
        const p = join(dir, sname)
        const content: TreeMap = new Map([
          ['antigo.txt', await writeContent(join(p, 'antigo.txt'), 1000 + d, 'random', `${id}${d}`)]
        ])
        await writeFile(
          join(p, MANIFEST_FILE),
          JSON.stringify(
            manifest({
              routineId: id,
              routineName: name,
              snapshotId: `legado-${d}`,
              files: 1,
              bytes: 1000 + d,
              verify: 'full',
              verified: true
            })
          )
        )
        out.push({ dir, name: sname, date, seq: 1, content })
      }
      return out
    }
    // Dias ≤ 0 = dezembro de 2025 (o Date normaliza).
    const legacyA = await legacy('Financeiro', 'rot-A', [-20, -15, -9, -8, -3, -1])
    const legacyB = await legacy('Contábil', 'rot-B', [-12, -2])
    const legacyC = await legacy('Outra rotina', 'rot-C', [-30, -25, -2])
    const legacyDirA = legacyA[0].dir
    const legacyDirB = legacyB[0].dir

    const foreign: Record<string, string | Buffer> = {
      'LEIA-ME.txt': 'Pasta de backups do escritório — não apagar.',
      'Fotos/férias 2025/praia.jpg': Buffer.alloc(5000, 7),
      // nome de backup, sem manifesto
      '2025-12-31_23-59-59/importante.docx': 'documento do usuário',
      // ZIP qualquer com nome de backup, sem manifesto
      '2025-12-29_10-00-00.zip': Buffer.from('não é um zip de verdade'),
      // backup de OUTRA rotina (manifesto rot-C), antigo
      '2025-12-30_10-00-00/x.txt': 'da rotina C',
      [`2025-12-30_10-00-00/${MANIFEST_FILE}`]: JSON.stringify(manifest({ routineId: 'rot-C' })),
      // ZIP de OUTRA rotina com manifesto ao lado
      '2025-12-28_10-00-00.zip': Buffer.from('zip da rotina C'),
      '2025-12-28_10-00-00.zip.manifesto.json': JSON.stringify(manifest({ routineId: 'rot-C', mode: 'zip' }))
    }
    for (const [rel, content] of Object.entries(foreign)) {
      await mkdir(join(shared, ...rel.split('/').slice(0, -1)), { recursive: true })
      await writeFile(join(shared, ...rel.split('/')), content)
    }
    const foreignTop = [...new Set(Object.keys(foreign).map((k) => k.split('/')[0]))]
    const foreignWant = (await scanTree(shared)).files
    for (const k of [...foreignWant.keys()]) if (k.startsWith(`${LEGACY_ROOT_DIR}/`)) foreignWant.delete(k)
    const legacyCWant = (await scanTree(legacyC[0].dir)).files

    /* ----- modelo por (rotina, destino) ----- */
    const model = {
      AS: [...legacyA] as ModelSnap[],
      AP: [] as ModelSnap[],
      BS: [...legacyB] as ModelSnap[]
    }

    /** `full` = relê e confere o conteúdo de TODOS os backups que sobraram (uma vez por dia). */
    const check = async (label: string, full = true): Promise<void> => {
      // 1) cada backup previsto existe e é byte a byte o do dia; nenhum outro desta rotina.
      for (const [key, routineId] of full
        ? ([
            ['AS', 'rot-A'],
            ['AP', 'rot-A'],
            ['BS', 'rot-B']
          ] as const)
        : []) {
        for (const s of model[key]) {
          const problems = await snapshotProblems(join(s.dir, s.name), s.content, { routineId })
          expect(problems, `${label}: ${key} ${s.name}`).toEqual([])
        }
      }
      // 2) a pasta compartilhada tem exatamente: coisas do usuário + legados + backups previstos.
      const expectShared = new Set<string>([
        ...foreignTop,
        LEGACY_ROOT_DIR,
        ...model.AS.filter((s) => s.dir === shared).map((s) => s.name),
        ...model.BS.filter((s) => s.dir === shared).flatMap((s) => [s.name, `${s.name}.manifesto.json`])
      ])
      expect((await readdir(shared)).sort(), label).toEqual([...expectShared].sort())
      expect((await readdir(priv)).sort(), label).toEqual(model.AP.map((s) => s.name).sort())
      // 3) legados: a pasta e o marcador ficam; dentro, só os backups previstos.
      const legacyNames = (dir: string, m: ModelSnap[]) => [
        '.bcbackup-rotina.json',
        ...m.filter((s) => s.dir === dir).map((s) => s.name)
      ]
      expect((await readdir(legacyDirA)).sort(), label).toEqual(legacyNames(legacyDirA, model.AS).sort())
      expect((await readdir(legacyDirB)).sort(), label).toEqual(legacyNames(legacyDirB, model.BS).sort())
      // 4) o que não é destas rotinas está byte a byte igual.
      for (const [rel, sig] of foreignWant)
        expect(await sha256File(join(shared, ...rel.split('/'))), `${label}: ${rel}`).toEqual(sig)
      expect(treeDiff(legacyCWant, (await scanTree(legacyC[0].dir)).files), label).toEqual([])
      // 5) nenhuma sobra.
      expect(await leftovers(shared), label).toEqual([])
      expect(await leftovers(priv), label).toEqual([])
    }
    await check('início')

    /** Roda e atualiza o modelo dos destinos em que o backup foi concluído (leitura própria). */
    const runAndModel = async (
      routine: typeof A,
      at: Date,
      targets: Array<{ key: keyof typeof model; dir: string; available: boolean }>,
      content: TreeMap
    ) => {
      const before = new Map(targets.map((t) => [t.key, [] as string[]]))
      for (const t of targets) before.set(t.key, await readdir(t.dir).catch(() => []))
      const r = await runAt(routine, at, { runId: `${routine.id}-${at.getTime()}` })
      const now = new Date(at.getTime() + 1000)
      for (const t of targets) {
        const before0 = before.get(t.key)!
        const added = (await readdir(t.dir).catch(() => [] as string[])).filter(
          (n) => !before0.includes(n) && !n.endsWith('.manifesto.json')
        )
        if (!t.available) {
          expect(added, `${routine.id} ${t.key} indisponível`).toEqual([])
          continue
        }
        expect(added.length, `${routine.id} ${t.key}: ${added.join(', ')}`).toBe(1)
        const created: ModelSnap = {
          dir: t.dir,
          name: added[0],
          ...parseName(added[0]),
          content: new Map(content)
        }
        model[t.key] = survivors([...model[t.key], created], now, created)
      }
      return r
    }

    /* ----- 30 dias ----- */
    for (let day = 1; day <= 30; day++) {
      await srcA.mutate(day)
      await srcB.mutate(day)
      if (day % 4 === 0) fileBSig = await writeContent(fileB, 30 * KiB + day, 'text', `fb${day}`)
      const wantB = mergeMaps(prefixed(srcB.state, 'origem-B'), new Map([['planilha fiscal.xlsx', fileBSig]]))
      const at = new Date(2026, 0, day, 10, 0, 0)

      const aRuns = day >= 12 && day <= 21 ? [] : day === 25 ? [at, new Date(2026, 0, day, 22, 0, 0)] : [at]
      for (const when of aRuns) {
        const privOff = day === 5
        if (privOff) await rename(priv, `${priv}-desligado`)
        let r
        try {
          r = await runAndModel(
            A,
            when,
            [
              { key: 'AS', dir: shared, available: true },
              { key: 'AP', dir: priv, available: !privOff }
            ],
            srcA.state
          )
        } finally {
          if (privOff) await rename(`${priv}-desligado`, priv)
        }
        expect(r.status, `dia ${day} A: ${r.errorMessage}`).toBe(privOff ? 'failed' : 'success')
        await check(`dia ${day} A ${when.getHours()}h`, false)
      }
      // B no mesmo segundo que A (quando A roda): "<carimbo>_2.zip", sem tocar no backup de A.
      const rb = await runAndModel(B, at, [{ key: 'BS', dir: shared, available: true }], wantB)
      expect(rb.status, `dia ${day} B: ${rb.errorMessage}`).toBe('success')
      if (aRuns.length) expect(model.BS.some((s) => s.name === `${backupStamp(at)}_2.zip`)).toBe(true)
      await check(`dia ${day} B`)
    }

    // Sanidade do próprio cenário: os legados de A e B saíram no prazo; o PC desligado (dias 12–21)
    // fez o mínimo segurar 2 backups antigos de A no dia 22.
    expect(model.AS.some((s) => s.dir === legacyDirA)).toBe(false)
    expect(model.BS.some((s) => s.dir === legacyDirB)).toBe(false)
    expect(model.AS.map((s) => s.name).sort()).toEqual(
      [24, 25, 26, 27, 28, 29, 30]
        .map((d) => backupStamp(new Date(2026, 0, d, 10)))
        .concat(backupStamp(new Date(2026, 0, 25, 22)))
        .sort()
    )
    expect(model.AP.length).toBe(8)
  }, 180_000)
})

describe('a mesma pasta configurada duas vezes (direto e por um link)', () => {
  for (const mode of ['copy', 'zip'] as const) {
    it(`${mode}: dias=1, mínimo=0 — os 2 backups de hoje ficam íntegros, os de ontem saem`, async () => {
      const base = join(root, `duas-vezes-${mode}`)
      const dest = join(base, 'backups')
      await mkdir(dest, { recursive: true })
      const link = join(base, 'atalho-para-backups')
      await symlink(dest, link, 'dir')
      const src = new LiveSource(join(base, 'origem'), new Rng(SEED + 1).fork(mode))
      await src.init(6)
      const routine = integrityRoutine({
        sources: [{ id: 's1', path: src.path, kind: 'folder' }],
        destinations: [
          { id: 'a', path: dest },
          { id: 'b', path: dest },
          { id: 'c', path: link }
        ],
        mode,
        retention: { enabled: true, days: 1, minKeep: 0 }
      })
      for (let day = 1; day <= 3; day++) {
        await src.mutate(day)
        const at = new Date(2026, 1, day, 18, 0, 0)
        const r = await runAt(routine, at, { runId: `dup-${mode}-${day}` })
        expect(r.status, r.errorMessage).toBe('success')
        const stamp = backupStamp(at)
        const names = [stamp, `${stamp}_2`, `${stamp}_3`].map((n) => (mode === 'zip' ? `${n}.zip` : n))
        const listing = (await readdir(dest)).filter((n) => !n.endsWith('.manifesto.json')).sort()
        expect(listing, `dia ${day}`).toEqual(names.sort())
        for (const n of names)
          expect(
            await snapshotProblems(join(dest, n), src.state, { routineId: 'rot-1' }),
            `dia ${day} ${n}`
          ).toEqual([])
        expect(await leftovers(dest)).toEqual([])
      }
    }, 60_000)
  }
})
