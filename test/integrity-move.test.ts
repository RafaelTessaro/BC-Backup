// Integridade do "Mover" ao longo de vários dias: uma pasta de ERP recebe um backup novo por dia e a
// rotina copia para 3 destinos e apaga da origem. Depois de CADA execução, com leitura própria:
//  - todo arquivo que sumiu da origem está, byte a byte igual ao que era, no backup desta execução em
//    TODOS os destinos;
//  - nada mais sumiu nem mudou na origem (programas, .ini, vazios, ocultos, temporários nunca saem);
//  - o relatório do motor ("removed") bate exatamente com o que sumiu;
//  - os backups que sobraram (retenção 7/3, modelo próprio) continuam byte a byte iguais.
// Dias com falha injetada: arquivo em uso na varredura, destino 2 desligado, arquivo crescendo durante
// a cópia, arquivo alterado entre destinos, cópia corrompida antes da verificação, arquivo preso na
// exclusão e cancelamento no meio da exclusão.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appendFile, mkdir, open, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupMode, MoveSources } from '@shared/types'
import type { EngineHooks } from '../src/main/engine/copy'
import {
  BASE_SEED,
  KINDS,
  KiB,
  MiB,
  Rng,
  integrityRoutine,
  leftovers,
  readSnapshot,
  runAt,
  scanTree,
  sha256File,
  snapshotProblems,
  writeContent,
  type FileSig,
  type TreeMap
} from './integrity-lib'
import { tempDir } from './helpers'

const SEED = BASE_SEED + 200
const MOVE: MoveSources = { enabled: true, minAgeMinutes: 30, warnIfEmpty: true }
const DAYS = 14

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => {
  ;({ dir: root, cleanup } = await tempDir('bcb-integ-move-'))
})
afterAll(() => cleanup())

/** Arquivos que o "Mover" nunca copia nem apaga. */
const NEVER: Record<string, string | Buffer> = {
  'ERP.exe': Buffer.alloc(3000, 0x4d),
  'config.ini': '[erp]\nbanco=C:\\ERP\\dados.fdb\n',
  'Backup/vazio.fbk': '',
  'Backup/~lock.tmp': 'trava',
  '.oculto.fbk': 'oculto',
  'Backup/script.bat': '@echo off'
}

/** Dia simulado: sempre ≥ 10 h depois de agora (os arquivos recém-criados já passaram da idade mínima). */
function dayAt(d: number): Date {
  const t = new Date()
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1 + d, 10, 0, 0)
}

interface Snap {
  name: string
  date: Date
  content: TreeMap
}

function survivors(all: Snap[], now: Date, created: Snap): Snap[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime()
  const sorted = [...all].sort((a, b) => b.date.getTime() - a.date.getTime())
  const kept = (s: Snap) => s === created || s.date.getTime() >= cutoff
  const keep = sorted.filter(kept)
  return [...keep, ...sorted.filter((s) => !kept(s)).slice(0, Math.max(0, 3 - keep.length))]
}

async function flipByte(path: string, at: 'middle' | number = 'middle'): Promise<void> {
  const fh = await open(path, 'r+')
  try {
    const { size } = await fh.stat()
    const pos = at === 'middle' ? Math.floor(size / 2) : at
    const b = Buffer.alloc(1)
    await fh.read(b, 0, 1, pos)
    b[0] ^= 0x20
    await fh.write(b, 0, 1, pos)
  } finally {
    await fh.close()
  }
}

for (const mode of ['copy', 'zip'] as BackupMode[]) {
  describe(`"Mover" (${mode}) por ${DAYS} dias, 3 destinos (semente ${SEED})`, () => {
    it('o que sai da origem está íntegro em todos os destinos; nada mais sai; falhas fecham a porta', async () => {
      const rng = new Rng(SEED).fork(mode)
      const base = join(root, mode)
      const erp = join(base, 'ERP')
      const dests = [1, 2, 3].map((i) => join(base, `d${i}`))
      for (const d of dests) await mkdir(d, { recursive: true })
      for (const [rel, c] of Object.entries(NEVER)) {
        await mkdir(join(erp, ...rel.split('/').slice(0, -1)), { recursive: true })
        await writeFile(join(erp, ...rel.split('/')), c)
      }
      const neverSigs = new Map<string, FileSig>()
      for (const rel of Object.keys(NEVER)) neverSigs.set(rel, await sha256File(join(erp, ...rel.split('/'))))
      // Backups antigos que já estavam lá antes do primeiro dia.
      for (let k = 1; k <= 3; k++)
        await writeContent(
          join(erp, 'Backup', 'antigos', `erp-antigo-${k}.fbk`),
          rng.int(1, 300 * KiB),
          'random',
          `old${k}`
        )

      const routine = integrityRoutine({
        name: 'Backup do ERP',
        sources: [{ id: 's1', path: erp, kind: 'folder' }],
        destinations: dests.map((p, i) => ({ id: `d${i + 1}`, path: p, label: `HD ${i + 1}` })),
        mode,
        filters: { include: [], exclude: [], skipHiddenAndSystem: true, maxFileSizeMB: null },
        retention: { enabled: true, days: 7, minKeep: 3 },
        moveSources: { ...MOVE }
      })
      const model: Snap[][] = dests.map(() => [])
      const everMoved = new Map<string, FileSig>()

      for (let day = 1; day <= DAYS; day++) {
        const label = `${mode} dia ${day}`
        const r = rng.fork(day)
        // O ERP grava o backup do dia (às vezes também um log).
        const today = `Backup/erp-${String(day).padStart(2, '0')}.fbk`
        await writeContent(
          join(erp, ...today.split('/')),
          r.int(1, 1536) * KiB + r.int(0, 1023),
          r.pick(KINDS),
          `erp${day}`
        )
        if (day % 3 === 0)
          await writeContent(
            join(erp, 'Backup', 'Logs', `log ${day} ç.txt`),
            r.int(0, 20 * KiB),
            'text',
            `log${day}`
          )

        const pre = (await scanTree(erp)).files
        const abs = (rel: string) => join(erp, ...rel.split('/'))
        /** Versões conhecidas de cada arquivo (as que os ganchos gravarem no meio da execução). */
        const versions = new Map<string, Set<string>>([...pre].map(([k, v]) => [k, new Set([v.sha256])]))
        const touch = async (rel: string, text: string) => {
          await appendFile(abs(rel), text)
          versions.get(rel)!.add((await sha256File(abs(rel))).sha256)
        }
        const hooks: EngineHooks = {}
        const ac = new AbortController()
        let expectStatus: string = 'success'
        /** Arquivos que devem ficar na origem hoje (além dos NEVER). null = nada pode sair. */
        let stay: Set<string> | null = new Set()
        let d2Off = false

        switch (day) {
          case 3: // em uso na varredura (teste exclusivo do Windows simulado) → fica para amanhã
            hooks.beforeProbe = (item, stage) => {
              if (stage === 'scan' && item.abs === abs(today))
                throw Object.assign(new Error('busy'), { code: 'EBUSY' })
            }
            stay!.add(today)
            expectStatus = 'warning'
            break
          case 5: // destino 2 desligado → nada é apagado
            d2Off = true
            stay = null
            expectStatus = 'failed'
            break
          case 7: {
            // o ERP ainda está gravando: cresce durante a 1ª leitura → copiado de novo, mas fica na origem
            let n = 0
            hooks.afterRead = async (item) => {
              if (item.abs === abs(today) && n++ === 0) await touch(today, 'mais dados')
            }
            stay!.add(today)
            expectStatus = 'warning'
            break
          }
          case 9: // alterado entre o destino 1 e o 2 → hashes diferentes → fica
            hooks.afterDestination = async (i) => {
              if (i === 0) await touch(today, 'alterado entre destinos')
            }
            stay!.add(today)
            expectStatus = 'warning'
            break
          case 11: // cópia corrompida no destino 2 antes da verificação → falha → nada é apagado
            hooks.beforeVerify = async (out, i) => {
              if (i !== 1) return
              await flipByte(mode === 'zip' ? out : join(out, ...today.split('/')))
            }
            stay = null
            expectStatus = 'failed'
            break
          case 12: // preso na exclusão (EBUSY no unlink) → fica; o resto sai
            hooks.beforeUnlink = (item) => {
              if (item.abs === abs(today)) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
            }
            stay!.add(today)
            expectStatus = 'warning'
            break
          case 13: {
            // cancelado no meio da exclusão: só o 1º arquivo sai
            let n = 0
            hooks.beforeUnlink = () => {
              if (n++ === 0) ac.abort()
            }
            stay = null // conferido abaixo: exatamente 1 arquivo sai
            expectStatus = 'cancelled'
            break
          }
        }

        const before = await Promise.all(dests.map((d) => readdir(d)))
        if (d2Off) await rename(dests[1], `${dests[1]}-desligado`)
        let res
        try {
          res = await runAt(routine, dayAt(day), {
            signal: ac.signal,
            runId: `run-${mode}-${day}`,
            // ZIP: acima de 256 KiB direto no ZIP (montagem refeita com cópia estável se mudar na leitura).
            job: { hooks, zipBufferMax: mode === 'zip' ? 256 * KiB : undefined }
          })
        } finally {
          if (d2Off) await rename(`${dests[1]}-desligado`, dests[1])
        }
        expect(res.status, `${label}: ${res.errorMessage}`).toBe(expectStatus)

        const post = (await scanTree(erp)).files
        const gone = [...pre.keys()].filter((k) => !post.has(k))

        // 1) NEVER: sempre na origem, intactos.
        for (const [rel, sig] of neverSigs) expect(post.get(rel), `${label}: ${rel}`).toEqual(sig)

        // 2) o que ficou não mudou (a não ser pelos próprios ganchos), nada apareceu do nada.
        for (const [rel, sig] of post) {
          expect(pre.has(rel), `${label}: ${rel} apareceu`).toBe(true)
          expect(versions.get(rel)!.has(sig.sha256), `${label}: ${rel} mudou`).toBe(true)
        }

        // 3) o que devia sair saiu, e só isso.
        const eligible = [...pre.keys()].filter((k) => !neverSigs.has(k))
        if (day === 13) expect(gone.length, label).toBe(1)
        else if (stay === null) expect(gone, label).toEqual([])
        else expect(gone.sort(), label).toEqual(eligible.filter((k) => !stay!.has(k)).sort())

        // 4) o relatório do motor bate exatamente com o que sumiu.
        expect((res.move?.removed ?? []).map((x) => x.path).sort(), label).toEqual(gone.map(abs).sort())

        // 5) os backups novos: um por destino que concluiu; conteúdo = elegíveis (versão conhecida);
        //    e cada arquivo que saiu está lá, byte a byte igual ao que era, em TODOS os destinos.
        for (const [i, d] of dests.entries()) {
          const added = (await readdir(d)).filter(
            (n) => !before[i].includes(n) && !n.endsWith('.manifesto.json')
          )
          const failedHere = (day === 5 && i === 1) || (day === 11 && i === 1)
          if (failedHere) {
            expect(added, `${label} d${i + 1}`).toEqual([])
            continue
          }
          expect(added.length, `${label} d${i + 1}: ${added.join(', ')}`).toBe(1)
          const snapPath = join(d, added[0])
          const snap = await readSnapshot(snapPath)
          expect(snap.problems, label).toEqual([])
          const copiedHere = eligible.filter((k) => !(day === 3 && k === today))
          expect([...snap.files.keys()].sort(), `${label} d${i + 1}`).toEqual(copiedHere.sort())
          for (const [rel, sig] of snap.files)
            expect(versions.get(rel)?.has(sig.sha256), `${label} d${i + 1}: ${rel}`).toBe(true)
          for (const rel of gone)
            expect(snap.files.get(rel), `${label} d${i + 1}: ${rel}`).toEqual(pre.get(rel))
          expect(await snapshotProblems(snapPath, snap.files, { routineId: 'rot-1' }), label).toEqual([])
          const created: Snap = { name: added[0], date: dayAt(day), content: snap.files }
          model[i] = survivors([...model[i], created], dayAt(day), created)
        }
        for (const rel of gone) everMoved.set(rel, pre.get(rel)!)

        // 6) retenção: em cada destino, exatamente os previstos, todos ainda byte a byte iguais.
        for (const [i, d] of dests.entries()) {
          const want = model[i].flatMap((s) =>
            mode === 'zip' ? [s.name, `${s.name}.manifesto.json`] : [s.name]
          )
          expect((await readdir(d)).sort(), `${label} d${i + 1}`).toEqual(want.sort())
          for (const s of model[i])
            expect(await snapshotProblems(join(d, s.name), s.content, { routineId: 'rot-1' }), label).toEqual(
              []
            )
          expect(await leftovers(d), label).toEqual([])
        }
      }
      // Sanidade do cenário: tudo o que o ERP gerou até o dia 12 saiu (o do dia 13 ficou pelo cancelamento,
      // o do dia 14 saiu); os antigos também.
      expect(everMoved.size).toBeGreaterThanOrEqual(DAYS + 3)
      for (let k = 1; k <= 3; k++) expect(everMoved.has(`Backup/antigos/erp-antigo-${k}.fbk`)).toBe(true)
    }, 120_000)
  })
}

describe('"Mover": cancelamento a cada passo da exclusão (sorteado)', () => {
  it('em qualquer ponto, cada arquivo que saiu está íntegro em todos os destinos e o resto ficou', async () => {
    const rng = new Rng(SEED + 1)
    for (let round = 0; round < 8; round++) {
      const base = join(root, `cancel-${round}`)
      const erp = join(base, 'ERP')
      const dests = [join(base, 'd1'), join(base, 'd2')]
      for (const d of dests) await mkdir(d, { recursive: true })
      const n = rng.int(3, 12)
      for (let k = 0; k < n; k++)
        await writeContent(
          join(erp, `sub ${k % 3}`, `erp-${k}.fbk`),
          rng.int(0, 200) * KiB + 1,
          rng.pick(KINDS),
          `c${round}-${k}`
        )
      const pre = (await scanTree(erp)).files
      // As 3 primeiras rodadas cobrem as pontas: no 1º, no último e nunca.
      const stopAt = [0, n - 1, n][round] ?? rng.int(0, n)
      const ac = new AbortController()
      let calls = 0
      const mode = rng.pick(['copy', 'zip'] as const)
      const res = await runAt(
        integrityRoutine({
          sources: [{ id: 's1', path: erp, kind: 'folder' }],
          destinations: dests.map((p, i) => ({ id: `d${i}`, path: p })),
          mode,
          moveSources: { ...MOVE }
        }),
        dayAt(1),
        {
          signal: ac.signal,
          job: {
            hooks: {
              beforeUnlink: () => {
                if (calls++ === stopAt) ac.abort()
              }
            }
          }
        }
      )
      const post = (await scanTree(erp)).files
      const gone = [...pre.keys()].filter((k) => !post.has(k))
      const label = `rodada ${round} (${mode}, ${n} arquivos, para no ${stopAt})`
      expect(gone.length, label).toBe(Math.min(n, stopAt + 1))
      expect(res.status, label).toBe(stopAt < n ? 'cancelled' : 'success')
      for (const [rel, sig] of post) expect(sig, label).toEqual(pre.get(rel))
      for (const d of dests) {
        const names = (await readdir(d)).filter((x) => !x.endsWith('.manifesto.json'))
        expect(names.length, label).toBe(1)
        const snap = await readSnapshot(join(d, names[0]))
        // O backup foi concluído antes da exclusão: está completo, com TODOS os arquivos.
        expect(await snapshotProblems(join(d, names[0]), pre, { routineId: 'rot-1' }), label).toEqual([])
        for (const rel of gone) expect(snap.files.get(rel), label).toEqual(pre.get(rel))
      }
    }
  }, 60_000)
})

describe('"Mover": arquivo grande (vários blocos) e origem com 1 destino só', () => {
  it('1 destino: relê a origem antes de apagar; o arquivo grande sai íntegro', async () => {
    const base = join(root, 'um-destino')
    const erp = join(base, 'ERP')
    const d1 = join(base, 'd1')
    await mkdir(d1, { recursive: true })
    const big = await writeContent(join(erp, 'banco.fbk'), 6 * MiB + 3, 'mixed', 'um-destino')
    const res = await runAt(
      integrityRoutine({
        sources: [{ id: 's1', path: erp, kind: 'folder' }],
        destinations: [{ id: 'd1', path: d1 }],
        moveSources: { ...MOVE }
      }),
      dayAt(2)
    )
    expect(res.status, res.errorMessage).toBe('success')
    expect((await scanTree(erp)).files.size).toBe(0)
    const [name] = await readdir(d1)
    expect(
      await snapshotProblems(join(d1, name), new Map([['banco.fbk', big]]), { routineId: 'rot-1' })
    ).toEqual([])
  }, 30_000)
})
