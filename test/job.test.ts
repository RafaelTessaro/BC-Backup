import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, open, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunProgress, Routine } from '@shared/types'
import { BACKUP_ROOT_DIR, MANIFEST_FILE, ROUTINE_MARKER_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import { runJob, sourceSlots, type JobOptions } from '../src/main/engine/job'
import { readZipManifest } from '../src/main/engine/manifest'
import type { EngineEvent, JobSpec } from '../src/main/engine/types'
import { verifyZip } from '../src/main/engine/zip'
import { ProgressTracker } from '../src/main/engine/progress'
import { sanitizeName } from '../src/main/engine/fsutil'
import { makeRoutine, makeSnapshotDir, tempDir, writeTree } from './helpers'

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

const routineDir = (dest: string) => join(dir, dest, BACKUP_ROOT_DIR, 'Financeiro diário')
const stamp = backupStamp(new Date(2026, 9, 8, 18, 0, 0))

describe('runJob — modo pasta', () => {
  it('sucesso: estrutura, mtime preservado, manifesto, marcador e progresso', async () => {
    const { result, progress } = await run(routineWith())
    expect(result.status).toBe('success')
    expect(result.filesTotal).toBe(4)
    expect(result.filesCopied).toBe(4)
    expect(result.destinations[0].status).toBe('success')
    const out = join(routineDir('d1'), stamp)
    expect(result.destinations[0].outputPath).toBe(out)
    expect(await readFile(join(out, 'Docs', 'a.txt'), 'utf8')).toBe('hello')
    expect(await readFile(join(out, 'Docs', 'sub', 'b.txt'), 'utf8')).toBe('mundo')
    expect(await readFile(join(out, 'planilha.xlsx'), 'utf8')).toBe('planilha')
    await expect(stat(join(out, 'Docs', 'lixo.tmp'))).rejects.toThrow()
    expect((await stat(join(out, 'Docs', 'a.txt'))).mtime.toISOString()).toBe(MTIME.toISOString())
    const m = JSON.parse(await readFile(join(out, MANIFEST_FILE), 'utf8'))
    expect(m).toMatchObject({
      routineId: 'rot-1',
      snapshotId: 'run-1',
      status: 'success',
      files: 4,
      mode: 'copy',
      verified: true
    })
    const marker = JSON.parse(await readFile(join(routineDir('d1'), ROUTINE_MARKER_FILE), 'utf8'))
    expect(marker.routineId).toBe('rot-1')
    expect((await readdir(routineDir('d1'))).some((n) => n.endsWith('.em-andamento'))).toBe(false)
    // Progresso: fases e totais coerentes.
    const phases = new Set(progress.map((p) => p.phase))
    for (const ph of ['scanning', 'copying', 'verifying', 'done'])
      expect(phases.has(ph as RunProgress['phase'])).toBe(true)
    const lastCopy = progress.filter((p) => p.phase === 'copying').at(-1)!
    expect(lastCopy.bytesTotal).toBe(2 * 1024 * 1024 + 5 + 5 + 8)
    expect(result.log.some((l) => /concluído com sucesso/.test(l.message))).toBe(true)
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
    expect(await readdir(routineDir('d2'))).toContain(stamp)
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
    const left = await readdir(routineDir('d1'))
    expect(left.filter((n) => n !== ROUTINE_MARKER_FILE)).toEqual([])
  })

  it('retenção roda só depois do sucesso no destino e nunca apaga o que não tem manifesto', async () => {
    const rd = routineDir('d1')
    await mkdir(rd, { recursive: true })
    await writeFile(join(rd, ROUTINE_MARKER_FILE), JSON.stringify({ routineId: 'rot-1' }))
    const old = backupStamp(new Date(2026, 8, 1, 3))
    const foreign = backupStamp(new Date(2026, 8, 2, 3))
    await makeSnapshotDir(rd, old)
    await makeSnapshotDir(rd, foreign, null)
    // Sobra de execução que caiu: removida no início.
    await makeSnapshotDir(rd, `${backupStamp(new Date(2026, 9, 7, 3))}.em-andamento`, null)
    const { result } = await run(routineWith({ retention: { enabled: true, days: 7, minKeep: 1 } }))
    expect(result.status).toBe('success')
    expect(result.destinations[0].pruned).toEqual([join(rd, old)])
    const left = await readdir(rd)
    expect(left).toContain(foreign)
    expect(left).toContain(stamp)
    expect(left.some((n) => n.endsWith('.em-andamento'))).toBe(false)
  })

  it('pasta da rotina com o mesmo nome de OUTRA rotina → usa "<nome> (2)"', async () => {
    const rd = routineDir('d1')
    await mkdir(rd, { recursive: true })
    await writeFile(join(rd, ROUTINE_MARKER_FILE), JSON.stringify({ routineId: 'outra-rotina' }))
    const { result } = await run(routineWith())
    expect(result.destinations[0].outputPath).toBe(
      join(dir, 'd1', BACKUP_ROOT_DIR, 'Financeiro diário (2)', stamp)
    )
  })

  it('verificação completa (hash) passa numa cópia íntegra', async () => {
    const { result } = await run(routineWith({ verify: 'full' }))
    expect(result.status).toBe('success')
    expect(result.log.some((l) => /Verificação completa/.test(l.message))).toBe(true)
  })
})

describe('runJob — modo ZIP', () => {
  it('gera <carimbo>.zip com manifesto dentro e ao lado; verificação completa por CRC', async () => {
    const { result } = await run(routineWith({ mode: 'zip', verify: 'full', zipLevel: 6 }))
    expect(result.status).toBe('success')
    const zip = join(routineDir('d1'), `${stamp}.zip`)
    expect(result.destinations[0].outputPath).toBe(zip)
    const names = await readdir(routineDir('d1'))
    expect(names).toContain(`${stamp}.zip`)
    expect(names).toContain(`${stamp}.zip.manifesto.json`)
    expect(names.some((n) => n.endsWith('.em-andamento'))).toBe(false)
    const list = execFileSync('unzip', ['-Z1', zip]).toString().split('\n').filter(Boolean).sort()
    expect(list).toEqual(
      ['Docs/a.txt', 'Docs/grande.bin', 'Docs/sub/b.txt', MANIFEST_FILE, 'planilha.xlsx'].sort()
    )
    execFileSync('unzip', ['-tq', zip])
    const m = await readZipManifest(zip)
    expect(m).toMatchObject({ routineId: 'rot-1', mode: 'zip', files: 4, verified: true })
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
    execFileSync('unzip', ['-tq', join(routineDir('d1'), `${stamp}.zip`)])
  })

  it('verifyZip detecta corrupção (CRC-32)', async () => {
    const { result } = await run(routineWith({ mode: 'zip', zipLevel: 0, verify: 'none' }))
    const zip = result.destinations[0].outputPath!
    const tracker = new ProgressTracker(
      { runId: 'r', routineId: 'x', routineName: 'x', startedAt: '', destinationCount: 1 },
      () => {}
    )
    const expected = [{ name: 'Docs/grande.bin', bytes: 2 * 1024 * 1024 }]
    expect(await verifyZip(zip, expected, 'full', tracker, new AbortController().signal)).toEqual([])
    // Corrompe bytes no meio do arquivo armazenado (nível 0 = sem compressão).
    const fh = await open(zip, 'r+')
    const { size } = await fh.stat()
    await fh.write(Buffer.from([1, 2, 3]), 0, 3, Math.floor(size / 2))
    await fh.close()
    const issues = await verifyZip(zip, expected, 'full', tracker, new AbortController().signal)
    expect(issues.length).toBe(1)
    expect(issues[0].reason).toMatch(/CRC-32|corrompido/)
  })

  it('cancelamento no ZIP remove o arquivo parcial', async () => {
    const { result } = await run(routineWith({ mode: 'zip' }), {
      progressIntervalMs: 0,
      abortOn: (e) => e.type === 'progress' && e.progress.phase === 'copying' && e.progress.filesDone >= 1
    })
    expect(result.status).toBe('cancelled')
    const left = await readdir(routineDir('d1'))
    expect(left.filter((n) => n !== ROUTINE_MARKER_FILE)).toEqual([])
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
