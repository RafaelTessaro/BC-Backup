import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, open, readFile, readdir, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunProgress, Routine } from '@shared/types'
import { IN_PROGRESS_MARKER_FILE, LEGACY_ROOT_DIR, MANIFEST_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import { runJob, sourceSlots, type JobOptions } from '../src/main/engine/job'
import { readZipManifest } from '../src/main/engine/manifest'
import type { EngineEvent, JobSpec } from '../src/main/engine/types'
import { verifyZip } from '../src/main/engine/zip'
import { ProgressTracker } from '../src/main/engine/progress'
import { sanitizeName } from '../src/main/engine/fsutil'
import {
  inProgressMarker,
  makeInProgressDir,
  makeLegacyRoutineDir,
  makeRoutine,
  makeSnapshotDir,
  manifest,
  tempDir,
  writeTree
} from './helpers'

let dir: string
let cleanup: () => Promise<void>
const MTIME = new Date('2020-01-02T03:04:05.000Z')

beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-job-'))
  await writeTree(join(dir, 'origem', 'Docs'), {
    'a.txt': 'hello',
    'sub/b.txt': 'mundo',
    'lixo.tmp': 'x',
    'grande.bin': Buffer.alloc(2 * 1024 * 1024, 7)
  })
  await writeTree(join(dir, 'origem'), { 'planilha.xlsx': 'planilha' })
  await utimes(join(dir, 'origem', 'Docs', 'a.txt'), MTIME, MTIME)
  await mkdir(join(dir, 'd1'))
  await mkdir(join(dir, 'd2'))
})
afterEach(() => cleanup())

function routineWith(patch: Partial<Routine> = {}) {
  return makeRoutine({
    sources: [
      { id: 's1', path: join(dir, 'origem', 'Docs'), kind: 'folder' },
      { id: 's2', path: join(dir, 'origem', 'planilha.xlsx'), kind: 'file' }
    ],
    destinations: [{ id: 'd1', path: join(dir, 'd1'), label: 'HD azul' }],
    filters: { include: [], exclude: ['*.tmp'], skipHiddenAndSystem: true, maxFileSizeMB: null },
    verify: 'quick',
    retention: { enabled: true, days: 7, minKeep: 3 },
    ...patch
  })
}

function spec(routine: ReturnType<typeof routineWith>, startedAt = new Date(2026, 9, 8, 18, 0, 0)): JobSpec {
  return {
    runId: 'run-1',
    routine,
    trigger: 'manual',
    startedAt: startedAt.toISOString(),
    appVersion: '0.1.0',
    hostname: 'pc-teste'
  }
}

async function run(
  routine: ReturnType<typeof routineWith>,
  opts: JobOptions & { abortOn?: (e: EngineEvent) => boolean } = {}
) {
  const ac = new AbortController()
  const events: EngineEvent[] = []
  const result = await runJob(
    spec(routine),
    (e) => {
      events.push(e)
      if (opts.abortOn?.(e)) ac.abort()
    },
    ac.signal,
    { now: () => new Date(2026, 9, 8, 18, 0, 5), ...opts }
  )
  return {
    result,
    events,
    progress: events
      .filter((e) => e.type === 'progress')
      .map((e) => (e as { progress: RunProgress }).progress)
  }
}

const stamp = backupStamp(new Date(2026, 9, 8, 18, 0, 0))
/** O que existe na pasta do destino (a pasta escolhida pelo usuário). */
const ls = (dest: string) => readdir(join(dir, dest)).then((n) => n.sort())
const unzipList = (zip: string) =>
  execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter(Boolean).sort()

describe('runJob — modo pasta', () => {
  it('sucesso: "<destino>/<carimbo>/" direto na pasta escolhida, sem pasta da rotina nem marcador', async () => {
    const { result, progress } = await run(routineWith())
    expect(result.status).toBe('success')
    expect(result.filesTotal).toBe(4)
    expect(result.filesCopied).toBe(4)
    expect(result.destinations[0].status).toBe('success')
    const out = join(dir, 'd1', stamp)
    expect(result.destinations[0].outputPath).toBe(out)
    // A pasta do destino só tem o backup datado (nada de "BC Backup", nome da rotina ou marcador).
    expect(await ls('d1')).toEqual([stamp])
    // Duas origens → uma subpasta por origem (rótulo) dentro da pasta datada.
    expect(await readFile(join(out, 'Docs', 'a.txt'), 'utf8')).toBe('hello')
    expect(await readFile(join(out, 'Docs', 'sub', 'b.txt'), 'utf8')).toBe('mundo')
    expect(await readFile(join(out, 'planilha.xlsx'), 'utf8')).toBe('planilha')
    expect((await readdir(out)).sort()).toEqual(['Docs', MANIFEST_FILE, 'planilha.xlsx'])
    await expect(stat(join(out, 'Docs', 'lixo.tmp'))).rejects.toThrow()
    expect((await stat(join(out, 'Docs', 'a.txt'))).mtime.toISOString()).toBe(MTIME.toISOString())
    const m = JSON.parse(await readFile(join(out, MANIFEST_FILE), 'utf8'))
    expect(m).toMatchObject({
      routineId: 'rot-1',
      snapshotId: 'run-1',
      status: 'success',
      files: 4,
      mode: 'copy',
      verified: true,
      layout: 'subfolders'
    })
    // Progresso: fases e totais coerentes.
    const phases = new Set(progress.map((p) => p.phase))
    for (const ph of ['scanning', 'copying', 'verifying', 'done'])
      expect(phases.has(ph as RunProgress['phase'])).toBe(true)
    const lastCopy = progress.filter((p) => p.phase === 'copying').at(-1)!
    expect(lastCopy.bytesTotal).toBe(2 * 1024 * 1024 + 5 + 5 + 8)
    expect(result.log.some((l) => /concluído com sucesso/.test(l.message))).toBe(true)
  })

  it('uma pasta de origem: o conteúdo dela vai direto na pasta datada', async () => {
    const { result } = await run(
      routineWith({ sources: [{ id: 's1', path: join(dir, 'origem', 'Docs'), kind: 'folder', label: 'X' }] })
    )
    expect(result.status).toBe('success')
    const out = join(dir, 'd1', stamp)
    expect((await readdir(out)).sort()).toEqual([MANIFEST_FILE, 'a.txt', 'grande.bin', 'sub'].sort())
    expect(await readFile(join(out, 'sub', 'b.txt'), 'utf8')).toBe('mundo')
    const m = JSON.parse(await readFile(join(out, MANIFEST_FILE), 'utf8'))
    expect(m).toMatchObject({
      layout: 'direct',
      sources: [{ label: 'X', path: join(dir, 'origem', 'Docs') }]
    })
  })

  it('um arquivo de origem: o próprio arquivo, direto na pasta datada', async () => {
    const { result } = await run(
      routineWith({
        sources: [{ id: 's2', path: join(dir, 'origem', 'planilha.xlsx'), kind: 'file', label: 'Planilha' }]
      })
    )
    expect(result.status).toBe('success')
    const out = join(dir, 'd1', stamp)
    expect((await readdir(out)).sort()).toEqual([MANIFEST_FILE, 'planilha.xlsx'].sort())
    expect(await readFile(join(out, 'planilha.xlsx'), 'utf8')).toBe('planilha')
  })

  it('várias origens com o mesmo nome: subpastas únicas ("Docs", "Docs (2)")', async () => {
    await writeTree(join(dir, 'outra', 'Docs'), { 'c.txt': 'outro' })
    const { result } = await run(
      routineWith({
        sources: [
          { id: 's1', path: join(dir, 'origem', 'Docs'), kind: 'folder' },
          { id: 's3', path: join(dir, 'outra', 'Docs'), kind: 'folder' }
        ]
      })
    )
    expect(result.status).toBe('success')
    const out = join(dir, 'd1', stamp)
    expect(await readFile(join(out, 'Docs', 'a.txt'), 'utf8')).toBe('hello')
    expect(await readFile(join(out, 'Docs (2)', 'c.txt'), 'utf8')).toBe('outro')
  })

  it('origem com um arquivo chamado como o manifesto: o conteúdo vai para uma subpasta, sem colidir', async () => {
    await writeTree(join(dir, 'velho'), { [MANIFEST_FILE]: 'manifesto de outro backup', 'x.txt': 'x' })
    const { result } = await run(
      routineWith({ sources: [{ id: 's', path: join(dir, 'velho'), kind: 'folder' }] })
    )
    expect(result.status).toBe('success')
    const out = join(dir, 'd1', stamp)
    expect(await readFile(join(out, 'velho', MANIFEST_FILE), 'utf8')).toBe('manifesto de outro backup')
    expect(JSON.parse(await readFile(join(out, MANIFEST_FILE), 'utf8')).layout).toBe('subfolders')
  })

  it('arquivo em uso (EBUSY simulado) → pulado com aviso e status warning', async () => {
    const { result } = await run(routineWith(), {
      hooks: {
        beforeOpen: (item) => {
          if (item.rel.endsWith('a.txt'))
            throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
        }
      }
    })
    expect(result.status).toBe('warning')
    expect(result.filesSkipped).toBe(1)
    expect(result.warnings).toBe(1)
    const d = result.destinations[0]
    expect(d.status).toBe('warning')
    expect(d.skipped).toEqual([
      { path: join(dir, 'origem', 'Docs', 'a.txt'), reason: 'Arquivo em uso (ignorado)' }
    ])
    await expect(stat(join(d.outputPath!, 'Docs', 'a.txt'))).rejects.toThrow()
    const m = JSON.parse(await readFile(join(d.outputPath!, MANIFEST_FILE), 'utf8'))
    expect(m.status).toBe('warning')
  })

  it('destino indisponível → falha (com o outro destino ok, o status geral ainda é failed)', async () => {
    const r = routineWith({
      destinations: [
        { id: 'x', path: join(dir, 'disco-desconectado'), label: 'HD externo' },
        { id: 'd2', path: join(dir, 'd2') }
      ]
    })
    const { result } = await run(r)
    expect(result.status).toBe('failed')
    expect(result.destinations.map((d) => d.status)).toEqual(['failed', 'success'])
    expect(result.destinations[0].error).toBe('Destino indisponível: verifique se o disco está conectado.')
    expect(result.errorMessage).toContain('HD externo: Destino indisponível')
    expect(result.errors).toBe(1)
    expect(await ls('d2')).toEqual([stamp])
  })

  it('origem ausente → falha antes de copiar', async () => {
    const r = routineWith({ sources: [{ id: 's', path: join(dir, 'sumiu'), kind: 'folder' }] })
    const { result } = await run(r)
    expect(result.status).toBe('failed')
    expect(result.errorMessage).toMatch(/Origem não encontrada/)
    expect(result.destinations).toEqual([])
  })

  it('nada para copiar → falha (não gera backup vazio que a retenção contaria)', async () => {
    // (arquivos escolhidos explicitamente como origem sempre entram; aqui só a pasta)
    const r = routineWith({
      sources: [{ id: 's1', path: join(dir, 'origem', 'Docs'), kind: 'folder' }],
      filters: { include: ['*.inexistente'], exclude: [], skipHiddenAndSystem: true, maxFileSizeMB: null }
    })
    const { result } = await run(r)
    expect(result.status).toBe('failed')
    expect(result.errorMessage).toMatch(/Nenhum arquivo para copiar/)
  })

  it('cancelamento → status cancelled e a cópia parcial é removida', async () => {
    const { result } = await run(routineWith(), {
      progressIntervalMs: 0,
      abortOn: (e) => e.type === 'progress' && e.progress.phase === 'copying' && e.progress.filesDone >= 1
    })
    expect(result.status).toBe('cancelled')
    expect(await ls('d1')).toEqual([])
  })

  it('retenção roda só depois do sucesso no destino e nunca apaga o que não tem manifesto', async () => {
    const rd = join(dir, 'd1')
    const old = backupStamp(new Date(2026, 8, 1, 3))
    const foreign = backupStamp(new Date(2026, 8, 2, 3))
    await makeSnapshotDir(rd, old)
    await makeSnapshotDir(rd, foreign, null)
    // Sobra de execução desta rotina que caiu neste computador: removida no início.
    await makeInProgressDir(
      rd,
      `${backupStamp(new Date(2026, 9, 7, 3))}.em-andamento`,
      inProgressMarker({ hostname: 'pc-teste' })
    )
    const { result } = await run(routineWith({ retention: { enabled: true, days: 7, minKeep: 1 } }))
    expect(result.status).toBe('success')
    expect(result.destinations[0].pruned).toEqual([join(rd, old)])
    expect(await ls('d1')).toEqual([foreign, stamp].sort())
  })

  it('pasta compartilhada com outra rotina: nome com "_2", e nenhum backup dela é apagado', async () => {
    const rd = join(dir, 'd1')
    // Outra rotina gravou neste mesmo segundo e tem backups antigos aqui.
    await makeSnapshotDir(rd, stamp, manifest({ routineId: 'outra-rotina' }))
    const othersOld = backupStamp(new Date(2026, 8, 1, 3))
    await makeSnapshotDir(rd, othersOld, manifest({ routineId: 'outra-rotina' }))
    // E está copiando agora mesmo (outro computador): a cópia dela fica intacta.
    const running = `${backupStamp(new Date(2026, 9, 8, 17, 59))}.em-andamento`
    await makeInProgressDir(
      rd,
      running,
      inProgressMarker({ routineId: 'outra-rotina', hostname: 'outro-pc' })
    )
    const { result } = await run(routineWith({ retention: { enabled: true, days: 1, minKeep: 0 } }))
    expect(result.status).toBe('success')
    expect(result.destinations[0].outputPath).toBe(join(rd, `${stamp}_2`))
    expect(result.destinations[0].pruned).toEqual([])
    expect(await ls('d1')).toEqual([othersOld, stamp, `${stamp}_2`, running].sort())
    expect(await readdir(join(rd, running))).toContain('parcial.txt')
  })

  it('duas execuções no mesmo segundo → "<carimbo>" e "<carimbo>_2", nenhuma sobrescreve a outra', async () => {
    const a = await run(routineWith())
    const b = await run(routineWith())
    expect(a.result.destinations[0].outputPath).toBe(join(dir, 'd1', stamp))
    expect(b.result.destinations[0].outputPath).toBe(join(dir, 'd1', `${stamp}_2`))
    expect(b.result.destinations[0].pruned).toEqual([])
    expect(await ls('d1')).toEqual([stamp, `${stamp}_2`])
    for (const n of [stamp, `${stamp}_2`])
      expect(await readFile(join(dir, 'd1', n, 'Docs', 'a.txt'), 'utf8')).toBe('hello')
  })

  it('cópia em andamento da MESMA rotina em outro computador (recente) não é tocada', async () => {
    const rd = join(dir, 'd1')
    const running = `${backupStamp(new Date(2026, 9, 8, 17, 59))}.em-andamento`
    await makeInProgressDir(rd, running, inProgressMarker({ hostname: 'outro-pc' }))
    // Relógio real: a cópia do outro PC foi alterada "agora" (o relógio fixo dos testes é outro dia).
    const { result } = await run(routineWith(), { now: () => new Date() })
    expect(result.status).toBe('success')
    expect(await ls('d1')).toEqual([stamp, running].sort())
    expect(result.log.some((l) => /outro computador \(outro-pc\)/.test(l.message))).toBe(true)
  })

  it('backups da estrutura antiga ("BC Backup/<rotina>") saem no prazo; nada novo é criado lá', async () => {
    const legacy = await makeLegacyRoutineDir(join(dir, 'd1'))
    const olds = [1, 2, 3].map((d) => backupStamp(new Date(2026, 8, d, 3)))
    for (const s of olds) await makeSnapshotDir(legacy, s)
    const { result } = await run(routineWith({ retention: { enabled: true, days: 7, minKeep: 2 } }))
    expect(result.status).toBe('success')
    expect(result.destinations[0].outputPath).toBe(join(dir, 'd1', stamp))
    // Mantém o novo + o legado mais novo (mínimo 2); os 2 mais velhos saem.
    expect(result.destinations[0].pruned).toEqual([join(legacy, olds[0]), join(legacy, olds[1])])
    expect((await readdir(legacy)).filter((n) => /^\d{4}-/.test(n))).toEqual([olds[2]])
    expect(await ls('d1')).toEqual([LEGACY_ROOT_DIR, stamp].sort())
  })

  it('verificação completa (hash) passa numa cópia íntegra e confere CADA arquivo', async () => {
    const { result, progress } = await run(routineWith({ verify: 'full' }), { progressIntervalMs: 0 })
    expect(result.status).toBe('success')
    expect(result.log.some((l) => /Verificação completa/.test(l.message))).toBe(true)
    const v = progress.filter((p) => p.phase === 'verifying').at(-1)!
    expect([v.filesDone, v.filesTotal]).toEqual([4, 4])
    expect(v.bytesDone).toBe(2 * 1024 * 1024 + 5 + 5 + 8)
  })

  it('verificação completa relê o disco: corrupção silenciosa (mesmo tamanho e data) → falha', async () => {
    const { result } = await run(routineWith({ verify: 'full' }), {
      hooks: {
        beforeVerify: async (out) => {
          // Troca 1 byte no meio do maior arquivo e devolve a data original: só o sha256 pega.
          const f = join(out, 'Docs', 'grande.bin')
          const st = await stat(f)
          const fh = await open(f, 'r+')
          await fh.write(Buffer.from([9]), 0, 1, 1024 * 1024)
          await fh.close()
          await utimes(f, st.atime, st.mtime)
        }
      }
    })
    expect(result.status).toBe('failed')
    expect(result.destinations[0].error).toMatch(/grande\.bin: Conteúdo diferente do original \(hash\)/)
    // Nada com o nome final nem manifesto: a cópia ruim foi descartada.
    expect(await ls('d1')).toEqual([])
  })
})

describe('integridade: arquivo alterado DURANTE a cópia (leitura rasgada)', () => {
  const appendDuring = (match: string, times: number) => {
    let n = 0
    return {
      afterRead: async (item: { rel: string; abs: string }) => {
        if (item.rel.endsWith(match) && n++ < times) await appendFile(item.abs, ' + gravado no meio')
      }
    }
  }

  it('mudou uma vez → copiado de novo e confere com a versão nova', async () => {
    const { result } = await run(routineWith({ verify: 'full' }), { hooks: appendDuring('a.txt', 1) })
    expect(result.status).toBe('success')
    const out = result.destinations[0].outputPath!
    expect(await readFile(join(out, 'Docs', 'a.txt'), 'utf8')).toBe('hello + gravado no meio')
  })

  it('mudou de novo na 2ª leitura → pulado ("Arquivo alterado durante a cópia"), aviso, nada certificado', async () => {
    const { result } = await run(routineWith({ verify: 'full' }), { hooks: appendDuring('a.txt', 2) })
    expect(result.status).toBe('warning')
    const d = result.destinations[0]
    expect(d.skipped).toEqual([
      { path: join(dir, 'origem', 'Docs', 'a.txt'), reason: 'Arquivo alterado durante a cópia' }
    ])
    // A cópia rasgada não fica no backup e o manifesto não a conta.
    await expect(stat(join(d.outputPath!, 'Docs', 'a.txt'))).rejects.toThrow()
    const m = JSON.parse(await readFile(join(d.outputPath!, MANIFEST_FILE), 'utf8'))
    expect(m).toMatchObject({ files: 3, skipped: 1, status: 'warning', verified: true })
  })

  it('ZIP, arquivo pequeno: mudou 2× → fica de fora do ZIP; 1× → entra com a versão nova', async () => {
    const twice = await run(routineWith({ mode: 'zip', verify: 'full' }), { hooks: appendDuring('a.txt', 2) })
    expect(twice.result.status).toBe('warning')
    expect(twice.result.destinations[0].skipped[0].reason).toBe('Arquivo alterado durante a cópia')
    const zip = twice.result.destinations[0].outputPath!
    expect(unzipList(zip)).not.toContain('Docs/a.txt')
    execFileSync('unzip', ['-tq', zip])
    await import('node:fs/promises').then((fs) => fs.rm(zip))
    await import('node:fs/promises').then((fs) => fs.rm(`${zip}.manifesto.json`))
    const once = await run(routineWith({ mode: 'zip', verify: 'full' }), { hooks: appendDuring('a.txt', 1) })
    expect(once.result.status).toBe('success')
    expect(
      execFileSync('unzip', ['-p', once.result.destinations[0].outputPath!, 'Docs/a.txt']).toString()
    ).toMatch(/^hello( \+ gravado no meio)+$/)
  })

  it('ZIP, arquivo grande (direto no ZIP): mudou → o ZIP é montado de novo com uma cópia estável', async () => {
    const logs: string[] = []
    const { result } = await run(routineWith({ mode: 'zip', verify: 'full' }), {
      zipBufferMax: 1024, // "grande" = acima de 1 KB, para não precisar de arquivos de 32 MB no teste
      hooks: appendDuring('grande.bin', 1),
      abortOn: (e) => {
        if (e.type === 'log') logs.push(e.entry.message)
        return false
      }
    })
    expect(result.status).toBe('success')
    expect(logs.some((m) => /montado de novo \(tentativa 2\)/.test(m))).toBe(true)
    const zip = result.destinations[0].outputPath!
    execFileSync('unzip', ['-tq', zip])
    const big = execFileSync('unzip', ['-p', zip, 'Docs/grande.bin'], { maxBuffer: 8 << 20 })
    expect(big.length).toBe(2 * 1024 * 1024 + ' + gravado no meio'.length)
    // A pasta reservada (com a cópia temporária) sumiu.
    expect(await ls('d1')).toEqual([`${stamp}.zip`, `${stamp}.zip.manifesto.json`])
  })

  it('ZIP, arquivo grande que nunca para de mudar → fica de fora (sem montar o ZIP para sempre)', async () => {
    const { result } = await run(routineWith({ mode: 'zip', verify: 'full' }), {
      zipBufferMax: 1024,
      hooks: appendDuring('grande.bin', 100)
    })
    expect(result.status).toBe('warning')
    expect(result.destinations[0].skipped).toEqual([
      { path: join(dir, 'origem', 'Docs', 'grande.bin'), reason: 'Arquivo alterado durante a cópia' }
    ])
    expect(unzipList(result.destinations[0].outputPath!)).not.toContain('Docs/grande.bin')
  })
})

describe('runJob — modo ZIP', () => {
  it('gera "<destino>/<carimbo>.zip" com manifesto dentro e ao lado; verificação completa por CRC', async () => {
    const { result } = await run(routineWith({ mode: 'zip', verify: 'full', zipLevel: 6 }))
    expect(result.status).toBe('success')
    const zip = join(dir, 'd1', `${stamp}.zip`)
    expect(result.destinations[0].outputPath).toBe(zip)
    expect(await ls('d1')).toEqual([`${stamp}.zip`, `${stamp}.zip.manifesto.json`])
    expect(unzipList(zip)).toEqual(
      ['Docs/a.txt', 'Docs/grande.bin', 'Docs/sub/b.txt', MANIFEST_FILE, 'planilha.xlsx'].sort()
    )
    execFileSync('unzip', ['-tq', zip])
    const m = await readZipManifest(zip)
    expect(m).toMatchObject({ routineId: 'rot-1', mode: 'zip', files: 4, verified: true })
  })

  it('uma origem: o conteúdo dela direto na raiz do ZIP', async () => {
    const { result } = await run(
      routineWith({ mode: 'zip', sources: [{ id: 's1', path: join(dir, 'origem', 'Docs'), kind: 'folder' }] })
    )
    expect(result.status).toBe('success')
    expect(unzipList(result.destinations[0].outputPath!)).toEqual(
      ['a.txt', 'grande.bin', 'sub/b.txt', MANIFEST_FILE].sort()
    )
  })

  it('mesmo segundo já usado por um backup em pasta → "<carimbo>_2.zip"', async () => {
    await makeSnapshotDir(join(dir, 'd1'), stamp, manifest({ routineId: 'outra-rotina' }))
    const { result } = await run(routineWith({ mode: 'zip' }))
    expect(result.destinations[0].outputPath).toBe(join(dir, 'd1', `${stamp}_2.zip`))
  })

  it('arquivo em uso é pulado sem corromper o ZIP', async () => {
    const { result } = await run(routineWith({ mode: 'zip' }), {
      hooks: {
        beforeOpen: (item) => {
          if (item.rel === 'planilha.xlsx') throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
        }
      }
    })
    expect(result.status).toBe('warning')
    execFileSync('unzip', ['-tq', join(dir, 'd1', `${stamp}.zip`)])
  })

  it('verifyZip detecta corrupção (CRC-32) e entradas a mais', async () => {
    const { result } = await run(routineWith({ mode: 'zip', zipLevel: 0, verify: 'none' }))
    const zip = result.destinations[0].outputPath!
    const tracker = new ProgressTracker(
      { runId: 'r', routineId: 'x', routineName: 'x', startedAt: '', destinationCount: 1 },
      () => {}
    )
    const signal = new AbortController().signal
    const expected = [
      { name: 'Docs/a.txt', bytes: 5 },
      { name: 'Docs/grande.bin', bytes: 2 * 1024 * 1024 },
      { name: 'Docs/sub/b.txt', bytes: 5 },
      { name: 'planilha.xlsx', bytes: 8 }
    ]
    expect(await verifyZip(zip, expected, 'full', tracker, signal)).toEqual([])
    // O ZIP precisa ter EXATAMENTE o que foi copiado.
    expect(await verifyZip(zip, expected.slice(1), 'quick', tracker, signal)).toEqual([
      { path: 'Docs/a.txt', reason: 'Entrada inesperada dentro do ZIP' }
    ])
    // Corrompe bytes no meio do arquivo armazenado (nível 0 = sem compressão).
    const fh = await open(zip, 'r+')
    const { size } = await fh.stat()
    await fh.write(Buffer.from([1, 2, 3]), 0, 3, Math.floor(size / 2))
    await fh.close()
    const issues = await verifyZip(zip, expected, 'full', tracker, signal)
    expect(issues.length).toBe(1)
    expect(issues[0].reason).toMatch(/CRC-32|corrompido/)
  })

  it('cancelamento no ZIP remove o arquivo parcial', async () => {
    const { result } = await run(routineWith({ mode: 'zip' }), {
      progressIntervalMs: 0,
      abortOn: (e) => e.type === 'progress' && e.progress.phase === 'copying' && e.progress.filesDone >= 1
    })
    expect(result.status).toBe('cancelled')
    expect(await ls('d1')).toEqual([])
  })

  it('marcador de "em andamento" existe durante a cópia (e sai no fim)', async () => {
    let seen: string[] = []
    const { result } = await run(routineWith({ mode: 'zip' }), {
      hooks: {
        beforeVerify: async () => {
          seen = await readdir(join(dir, 'd1', `${stamp}.em-andamento`))
        }
      }
    })
    expect(result.status).toBe('success')
    expect(seen.sort()).toEqual([IN_PROGRESS_MARKER_FILE, `${stamp}.zip`].sort())
    expect(await ls('d1')).toEqual([`${stamp}.zip`, `${stamp}.zip.manifesto.json`])
  })
})

describe('nomes', () => {
  it('sanitizeName (Windows)', () => {
    expect(sanitizeName('CON')).toBe('_CON')
    expect(sanitizeName('a:b?. ')).toBe('a_b_')
    expect(sanitizeName('   ')).toBe('Rotina')
    expect(sanitizeName('Financeiro/Diário')).toBe('Financeiro_Diário')
  })
  it('sourceSlots: rótulos únicos, disco raiz e arquivos soltos', () => {
    const slots = sourceSlots([
      { id: '1', path: '/a/Docs', kind: 'folder' },
      { id: '2', path: '/b/docs', kind: 'folder' },
      { id: '3', path: 'C:\\', kind: 'folder' },
      { id: '4', path: '/x/relatorio.pdf', kind: 'file' },
      { id: '5', path: '/y/relatorio.pdf', kind: 'file' },
      { id: '6', path: '/z/banco.fdb', kind: 'file', label: 'Banco' }
    ])
    expect(slots.map((s) => [s.name, s.folder])).toEqual([
      ['Docs', true],
      ['docs (2)', true],
      ['Disco C', true],
      ['relatorio.pdf', false],
      ['relatorio (2).pdf', false],
      ['Banco', true]
    ])
  })
})
