// "Mover": apagar da origem depois de copiar (docs/research/04-mover-apos-copiar.md §8).
// Cada teste reproduz um item do checklist que roda no Linux. O teste de uso exclusivo do Windows
// é simulado pelo gancho `beforeProbe` (a abertura com UV_FS_O_EXLOCK só existe no win32).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MoveSources, Routine } from '@shared/types'
import { BACKUP_ROOT_DIR, MANIFEST_FILE, ROUTINE_MARKER_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import { runJob, type JobOptions } from '../src/main/engine/job'
import { readZipManifest } from '../src/main/engine/manifest'
import {
  ageProblem,
  makeMoveFilter,
  previewMove,
  probeExclusive,
  type ProbeOptions
} from '../src/main/engine/move'
import type { JobSpec } from '../src/main/engine/types'
import { asMoveSources, asRoutineInput, asRoutineForValidation } from '../src/main/ipc-validate'
import { migrateConfig, migrateMoveSources, migrateRoutine } from '../src/main/store'
import { isBlockedMoveSource, isCloudSyncedPath, validateRoutine } from '../src/main/validate'
import { makeRoutine, makeSnapshotDir, manifest, tempDir, writeTree } from './helpers'

// Rename do backup "bloqueado" (antivírus) sob demanda: testa o keepWork sem depender do Windows.
const renameControl = vi.hoisted(() => ({ failWork: false }))
vi.mock('../src/main/engine/fsutil', async (orig) => {
  const real = await orig<typeof import('../src/main/engine/fsutil')>()
  return {
    ...real,
    renameRetry: async (from: string, to: string, attempts?: number, base?: number) => {
      if (renameControl.failWork && from.endsWith('.em-andamento'))
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      return real.renameRetry(from, to, attempts, base)
    }
  }
})

let dir: string
let cleanup: () => Promise<void>
let src: string

const ROUTINE_NAME = 'Backup do ERP'
const MOVE: MoveSources = { enabled: true, minAgeMinutes: 30, warnIfEmpty: true }
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
/** O relógio do motor 2 h à frente: os arquivos recém-criados já passaram da idade mínima. */
const later = () => new Date(Date.now() + 2 * 3600_000)

beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-move-'))
  src = join(dir, 'Backup')
  await writeTree(src, {
    'erp-01.fbk': 'backup do dia 1',
    'Diario/erp-02.fbk': 'backup do dia 2 (maior)',
    'Diario/Antigos/erp-00.fbk': 'backup antigo'
  })
  await mkdir(join(dir, 'd1'))
  await mkdir(join(dir, 'd2'))
  renameControl.failWork = false
})
afterEach(() => cleanup())

function routineWith(patch: Partial<Routine> = {}) {
  return makeRoutine({
    name: ROUTINE_NAME,
    sources: [{ id: 's1', path: src, kind: 'folder' }],
    destinations: [
      { id: 'd1', path: join(dir, 'd1'), label: 'HD 1' },
      { id: 'd2', path: join(dir, 'd2'), label: 'HD 2' }
    ],
    filters: { include: [], exclude: [], skipHiddenAndSystem: true, maxFileSizeMB: null },
    verify: 'full',
    retention: { enabled: true, days: 7, minKeep: 3 },
    moveSources: { ...MOVE },
    ...patch
  })
}

async function run(
  routine: ReturnType<typeof routineWith>,
  opts: JobOptions & { ac?: AbortController; dataPath?: string } = {}
) {
  const ac = opts.ac ?? new AbortController()
  const spec: JobSpec = {
    runId: 'run-1',
    routine,
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    hostname: 'pc-teste',
    dataPath: opts.dataPath
  }
  return runJob(spec, () => {}, ac.signal, { now: later, probeRetryMs: 1, ...opts })
}

const routineDir = (dest: string) => join(dir, dest, BACKUP_ROOT_DIR, ROUTINE_NAME)
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false
  )
const snapshots = async (dest: string) =>
  (await readdir(routineDir(dest)).catch(() => [] as string[])).filter((n) => /^\d{4}-/.test(n))
const ALL = ['erp-01.fbk', 'Diario/erp-02.fbk', 'Diario/Antigos/erp-00.fbk']
const srcPath = (rel: string) => join(src, ...rel.split('/'))

/** 3 backups antigos (há 10+ dias) com manifesto desta rotina. */
async function oldSnapshots(dest: string): Promise<string[]> {
  const rd = routineDir(dest)
  await mkdir(rd, { recursive: true })
  await writeFile(join(rd, ROUTINE_MARKER_FILE), JSON.stringify({ routineId: 'rot-1' }))
  const stamps = [10, 11, 12].map((d) => backupStamp(new Date(Date.now() - d * 86_400_000)))
  for (const s of stamps) await makeSnapshotDir(rd, s, manifest({ routineName: ROUTINE_NAME }))
  return stamps
}

describe('fluxo completo', () => {
  it('2 destinos: copia, confere, apaga só os arquivos e mantém todas as pastas', async () => {
    const r = await run(routineWith())
    expect(r.status).toBe('success')
    expect(r.move?.removedCount).toBe(3)
    expect(r.filesMoved).toBe(3)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(false)
    // Pastas (inclusive a raiz e subpastas vazias) continuam.
    expect((await stat(src)).isDirectory()).toBe(true)
    expect((await stat(join(src, 'Diario', 'Antigos'))).isDirectory()).toBe(true)
    // As cópias existem nos 2 destinos, iguais ao original.
    for (const d of ['d1', 'd2']) {
      const out = r.destinations.find((x) => x.destinationId === d)!.outputPath!
      expect(await readFile(join(out, 'Backup', 'erp-01.fbk'), 'utf8')).toBe('backup do dia 1')
      expect(await readFile(join(out, 'Backup', 'Diario', 'erp-02.fbk'), 'utf8')).toBe(
        'backup do dia 2 (maior)'
      )
      const m = JSON.parse(await readFile(join(out, MANIFEST_FILE), 'utf8'))
      expect(m).toMatchObject({ moveSources: true, verify: 'full', verified: true })
    }
    // Auditoria: caminho, bytes e sha256 de cada arquivo apagado.
    const removed = r.move!.removed.find((x) => x.path === srcPath('erp-01.fbk'))!
    expect(removed).toEqual({ path: srcPath('erp-01.fbk'), bytes: 15, sha256: sha('backup do dia 1') })
    expect(r.move!.removedBytes).toBe(15 + 23 + 13)
    expect(r.bytesMoved).toBe(15 + 23 + 13)
    expect(r.log.filter((l) => l.message.startsWith('Movido: ')).length).toBe(3)
    expect(r.log.some((l) => /conferido em 2 destinos/.test(l.message))).toBe(true)
  })

  it('verificação é sempre completa no "Mover", mesmo com a rotina gravada como "quick"', async () => {
    const r = await run(routineWith({ verify: 'quick' }))
    expect(r.status).toBe('success')
    const m = JSON.parse(await readFile(join(r.destinations[0].outputPath!, MANIFEST_FILE), 'utf8'))
    expect(m.verify).toBe('full')
    expect(r.move?.removedCount).toBe(3)
  })

  it('rotina sem "Mover" nunca apaga nada da origem', async () => {
    const r = await run(routineWith({ moveSources: undefined }))
    expect(r.status).toBe('success')
    expect(r.move).toBeUndefined()
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
  })

  it('"Mover" desligado (enabled: false) também não apaga', async () => {
    const r = await run(routineWith({ moveSources: { ...MOVE, enabled: false } }))
    expect(r.move).toBeUndefined()
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
  })
})

describe('elegibilidade (idade e uso)', () => {
  it('arquivo recente não é copiado nem apagado; sem backup novo e sem retenção', async () => {
    const old = await oldSnapshots('d1')
    const r = await run(routineWith({ retention: { enabled: true, days: 1, minKeep: 0 } }), {
      now: () => new Date()
    })
    expect(r.status).toBe('warning')
    expect(r.move?.nothingNew).toBe(true)
    expect(r.move?.postponedCount).toBe(3)
    expect(r.move?.postponed[0].reason).toMatch(/Alterado há menos de 1 min, pode estar sendo gravado/)
    expect(r.move?.notice).toBe('3 arquivos ainda em gravação/em uso; serão movidos na próxima execução.')
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
    // Nenhum backup novo; os antigos ficam (a retenção nem roda).
    expect((await snapshots('d1')).sort()).toEqual(old.sort())
    expect(await exists(join(dir, 'd2', BACKUP_ROOT_DIR))).toBe(false)
    expect(r.destinations.map((d) => d.status)).toEqual(['success', 'success'])
    expect(r.destinations.every((d) => d.pruned.length === 0)).toBe(true)
  })

  it('mtime antigo com ctime/birthtime recentes (arquivo copiado/extraído) fica aguardando', async () => {
    await utimes(srcPath('erp-01.fbk'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    // Relógio do motor 10 min à frente: o ctime (agora) tem 10 min.
    const r = await run(routineWith(), { now: () => new Date(Date.now() + 10 * 60_000) })
    expect(r.status).toBe('warning')
    expect(r.move?.postponed.find((p) => p.path === srcPath('erp-01.fbk'))?.reason).toMatch(
      /^Alterado há (9|10) min, pode estar sendo gravado$/
    )
    expect(await exists(srcPath('erp-01.fbk'))).toBe(true)
  })

  it('data no futuro (relógio errado) fica aguardando; o resto é movido', async () => {
    const future = new Date(Date.now() + 2 * 86_400_000)
    await utimes(srcPath('erp-01.fbk'), future, future)
    const r = await run(routineWith())
    expect(r.status).toBe('warning')
    expect(r.move?.postponed).toEqual([
      { path: srcPath('erp-01.fbk'), reason: 'Data no futuro (confira o relógio)' }
    ])
    expect(r.move?.removedCount).toBe(2)
    expect(await exists(srcPath('erp-01.fbk'))).toBe(true)
    expect(await exists(srcPath('Diario/erp-02.fbk'))).toBe(false)
    // O arquivo aguardando nem foi copiado.
    expect(await exists(join(r.destinations[0].outputPath!, 'Backup', 'erp-01.fbk'))).toBe(false)
  })

  it('ageProblem usa o mais recente entre mtime, ctime e birthtime', () => {
    const now = new Date('2026-10-04T12:00:00Z').getTime()
    const old = new Date('2026-10-04T10:00:00Z')
    const recent = new Date('2026-10-04T11:50:00Z')
    expect(ageProblem({ mtime: old, ctime: old }, now, 30)).toBeNull()
    expect(ageProblem({ mtime: old, ctime: recent }, now, 30)).toMatch(/há 10 min/)
    expect(ageProblem({ mtime: old, ctime: old, birthtime: recent }, now, 30)).toMatch(/há 10 min/)
    expect(ageProblem({ mtime: recent, ctime: old }, now, 5)).toBeNull()
    expect(ageProblem({ mtime: new Date(now + 6 * 60_000), ctime: old }, now, 30)).toBe(
      'Data no futuro (confira o relógio)'
    )
    // Folga de 5 min para relógios levemente diferentes (rede): não é "futuro", mas é recente.
    expect(ageProblem({ mtime: new Date(now + 4 * 60_000), ctime: old }, now, 5)).toBe(
      'Alterado há menos de 1 min, pode estar sendo gravado'
    )
  })

  it('em uso (EBUSY no teste exclusivo) fica aguardando, com 3 tentativas', async () => {
    const calls: string[] = []
    const r = await run(routineWith(), {
      hooks: {
        beforeProbe: (item, stage) => {
          calls.push(`${stage}:${item.rel}`)
          if (item.rel.endsWith('erp-01.fbk'))
            throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
        }
      }
    })
    expect(r.status).toBe('warning')
    expect(r.move?.postponed).toEqual([{ path: srcPath('erp-01.fbk'), reason: 'Em uso por outro programa' }])
    expect(calls.filter((c) => c === 'scan:Backup/erp-01.fbk').length).toBe(3)
    // Os outros passam de novo pelo teste antes de apagar.
    expect(calls.filter((c) => c.startsWith('delete:')).length).toBe(2)
    expect(await exists(srcPath('erp-01.fbk'))).toBe(true)
    expect(r.move?.removedCount).toBe(2)
  })

  it('sem permissão no teste exclusivo (EPERM/EACCES) fica aguardando; ENOENT é ignorado', async () => {
    const r = await run(routineWith(), {
      hooks: {
        beforeProbe: (item, stage) => {
          if (stage !== 'scan') return
          if (item.rel.endsWith('erp-01.fbk')) throw Object.assign(new Error('x'), { code: 'EPERM' })
          if (item.rel.endsWith('erp-00.fbk')) throw Object.assign(new Error('x'), { code: 'ENOENT' })
        }
      }
    })
    expect(r.move?.postponed).toEqual([{ path: srcPath('erp-01.fbk'), reason: 'Sem permissão' }])
    expect(r.move?.postponedCount).toBe(1)
    // O "sumido" não entra em lugar nenhum (nem copiado, nem apagado).
    expect(await exists(srcPath('Diario/Antigos/erp-00.fbk'))).toBe(true)
    expect(r.move?.removedCount).toBe(1)
  })

  it('probeExclusive: no Linux só o gancho participa; EBUSY persistente devolve EBUSY', async () => {
    const item = { abs: srcPath('erp-01.fbk') } as Parameters<typeof probeExclusive>[0]
    let n = 0
    const opts: ProbeOptions = {
      retryMs: 1,
      hooks: {
        beforeProbe: () => {
          n++
          if (n < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        }
      }
    }
    // Antivírus segurou 2 vezes e soltou: livre na 3ª tentativa.
    expect(await probeExclusive(item, 'scan', opts)).toBeNull()
    n = -10
    expect(await probeExclusive(item, 'scan', opts)).toBe('EBUSY')
  })
})

describe('lista congelada e arquivo alterado', () => {
  it('arquivo criado durante a execução não é apagado (nem copiado)', async () => {
    const r = await run(routineWith(), {
      hooks: {
        afterDestination: async (i) => {
          if (i === 0) await writeFile(join(src, 'novo.fbk'), 'gerado durante o backup')
        }
      }
    })
    expect(r.status).toBe('success')
    expect(await readFile(join(src, 'novo.fbk'), 'utf8')).toBe('gerado durante o backup')
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(false)
    expect(r.move?.removed.some((x) => x.path.endsWith('novo.fbk'))).toBe(false)
  })

  it('arquivo alterado entre a cópia e a exclusão é mantido e copiado de novo na próxima execução', async () => {
    const r = await run(routineWith(), {
      hooks: {
        afterDestination: async (i) => {
          if (i === 1) await appendFile(srcPath('erp-01.fbk'), ' + acréscimo')
        }
      }
    })
    expect(r.status).toBe('warning')
    expect(r.move?.kept).toEqual([
      {
        path: srcPath('erp-01.fbk'),
        reason: 'Alterado depois da cópia; será copiado de novo na próxima execução'
      }
    ])
    expect(r.move?.removedCount).toBe(2)
    expect(await readFile(srcPath('erp-01.fbk'), 'utf8')).toBe('backup do dia 1 + acréscimo')
    // Próxima execução (o relógio do motor já está 2 h à frente): copia a versão nova e apaga.
    const r2 = await run(routineWith(), { now: () => new Date(Date.now() + 3 * 3600_000) })
    expect(r2.status).toBe('success')
    expect(r2.move?.removed.map((x) => x.path)).toEqual([srcPath('erp-01.fbk')])
    expect(r2.move?.removed[0].sha256).toBe(sha('backup do dia 1 + acréscimo'))
    expect(await exists(srcPath('erp-01.fbk'))).toBe(false)
  })

  it('alteração do mesmo tamanho também é pega (mtime/ctime)', async () => {
    const r = await run(routineWith(), {
      hooks: {
        afterDestination: async (i) => {
          if (i === 1) await writeFile(srcPath('erp-01.fbk'), 'BACKUP DO DIA 1')
        }
      }
    })
    expect(r.move?.kept.map((k) => k.path)).toEqual([srcPath('erp-01.fbk')])
    expect(await readFile(srcPath('erp-01.fbk'), 'utf8')).toBe('BACKUP DO DIA 1')
  })

  it('arquivo que cresce durante a cópia (bytes ≠ tamanho da varredura) é mantido', async () => {
    let grown = false
    const r = await run(routineWith(), {
      hooks: {
        beforeOpen: async (item) => {
          if (!grown && item.rel.endsWith('erp-01.fbk')) {
            grown = true
            await appendFile(item.abs, '++++')
          }
        }
      }
    })
    expect(r.move?.kept).toEqual([{ path: srcPath('erp-01.fbk'), reason: 'Alterado durante a cópia' }])
    expect(await exists(srcPath('erp-01.fbk'))).toBe(true)
    expect(r.status).toBe('warning')
  })

  it('hash diferente entre os destinos → mantido', async () => {
    let opened = 0
    const r = await run(routineWith(), {
      hooks: {
        beforeOpen: async (item) => {
          // Mesmo tamanho, conteúdo diferente só na leitura do 2º destino.
          if (item.rel.endsWith('erp-01.fbk') && ++opened === 2) await writeFile(item.abs, 'BACKUP DO DIA 1')
        }
      }
    })
    expect(r.move?.kept).toEqual([{ path: srcPath('erp-01.fbk'), reason: 'Alterado durante a cópia' }])
    expect(await exists(srcPath('erp-01.fbk'))).toBe(true)
  })

  it('1 destino só: relê a origem e compara o sha256 antes de apagar', async () => {
    const r = await run(routineWith({ destinations: [{ id: 'd1', path: join(dir, 'd1') }] }), {
      hooks: {
        afterDestination: async () => {
          // Mesmo tamanho: só a releitura do sha256 (passo b) pega antes do lstat.
          await writeFile(srcPath('erp-01.fbk'), 'BACKUP DO DIA 1')
        }
      }
    })
    expect(r.move?.kept).toEqual([{ path: srcPath('erp-01.fbk'), reason: 'Alterado durante a cópia' }])
    expect(r.move?.removedCount).toBe(2)
    expect(r.log.some((l) => /conferido em 1 destino\./.test(l.message))).toBe(true)
  })

  it('EBUSY no unlink → mantido com Atenção; os outros são apagados', async () => {
    const r = await run(routineWith(), {
      hooks: {
        beforeUnlink: (item) => {
          if (item.rel.endsWith('erp-02.fbk')) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        }
      }
    })
    expect(r.status).toBe('warning')
    expect(r.move?.kept).toEqual([
      {
        path: srcPath('Diario/erp-02.fbk'),
        reason: 'Em uso por outro programa; será apagado numa próxima execução'
      }
    ])
    expect(await exists(srcPath('Diario/erp-02.fbk'))).toBe(true)
    expect(r.move?.removedCount).toBe(2)
  })

  it('EPERM no unlink → mantido com a dica de permissão', async () => {
    const r = await run(routineWith(), {
      hooks: {
        beforeUnlink: (item) => {
          if (item.rel.endsWith('erp-01.fbk')) throw Object.assign(new Error('x'), { code: 'EPERM' })
        }
      }
    })
    expect(r.move?.kept[0].reason).toMatch(/ajuste a permissão da pasta para o usuário do BC Backup/)
  })

  it('arquivo apagado por outro programa antes do unlink é só informação', async () => {
    const r = await run(routineWith(), {
      hooks: {
        afterDestination: async (i) => {
          if (i === 1) await import('node:fs/promises').then((fs) => fs.rm(srcPath('erp-01.fbk')))
        }
      }
    })
    expect(r.status).toBe('success')
    expect(r.move?.removedCount).toBe(2)
    expect(r.move?.keptCount).toBe(0)
    expect(r.log.some((l) => l.message.startsWith('Já tinha sido removido por outro programa'))).toBe(true)
  })
})

describe('porta de exclusão: qualquer destino com falha → nada é apagado', () => {
  it('destino B indisponível: Falha, origem intacta e retenção só em A', async () => {
    const oldA = await oldSnapshots('d1')
    const routine = routineWith({
      retention: { enabled: true, days: 1, minKeep: 1 },
      destinations: [
        { id: 'd1', path: join(dir, 'd1'), label: 'HD 1' },
        { id: 'd2', path: join(dir, 'nao-existe'), label: 'HD 2' }
      ]
    })
    const r = await run(routine)
    expect(r.status).toBe('failed')
    expect(r.destinations.map((d) => d.status)).toEqual(['success', 'failed'])
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
    expect(r.move?.removedCount).toBe(0)
    expect(r.move?.notDeletedReason).toBe('Nada foi apagado da origem porque HD 2 falhou.')
    expect(r.move?.keptCount).toBe(3)
    // Retenção rodou em A (o backup novo ficou, os antigos saíram).
    expect(r.destinations[0].pruned.length).toBe(oldA.length)
    expect(r.log.some((l) => l.message === 'Nada foi apagado da origem porque HD 2 falhou.')).toBe(true)
  })

  it('verificação de B falha (cópia corrompida): Falha e origem intacta', async () => {
    const r = await run(routineWith(), {
      hooks: {
        beforeVerify: async (out, i) => {
          if (i === 1) await writeFile(join(out, 'Backup', 'erp-01.fbk'), 'BACKUP DO DIA 1')
        }
      }
    })
    expect(r.status).toBe('failed')
    expect(r.destinations[1].error).toMatch(/verificação/i)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
    expect(r.move?.removedCount).toBe(0)
  })

  it('cancelar antes da fase "moving": nada é apagado', async () => {
    const ac = new AbortController()
    const r = await run(routineWith(), {
      ac,
      hooks: {
        afterDestination: (i) => {
          if (i === 1) ac.abort()
        }
      }
    })
    expect(r.status).toBe('cancelled')
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
    expect(r.move?.removedCount).toBe(0)
    expect(r.move?.notDeletedReason).toMatch(/cancelada/)
  })

  it('cancelar durante a cópia: nada é apagado', async () => {
    const ac = new AbortController()
    const r = await run(routineWith(), {
      ac,
      hooks: {
        beforeOpen: (item) => {
          if (item.rel.endsWith('erp-02.fbk')) ac.abort()
        }
      }
    })
    expect(r.status).toBe('cancelled')
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
  })

  it('cancelar no meio da exclusão: "removed" bate exatamente com o que sumiu', async () => {
    const ac = new AbortController()
    let n = 0
    const r = await run(routineWith(), {
      ac,
      hooks: {
        beforeUnlink: () => {
          if (++n === 2) ac.abort()
        }
      }
    })
    expect(r.status).toBe('cancelled')
    const vanished: string[] = []
    for (const f of ALL) if (!(await exists(srcPath(f)))) vanished.push(srcPath(f))
    expect(r.move!.removed.map((x) => x.path).sort()).toEqual(vanished.sort())
    expect(r.move!.removedCount).toBe(vanished.length)
    expect(vanished.length).toBeGreaterThanOrEqual(1)
    expect(r.move!.removedCount + (r.move!.keptCount ?? 0)).toBe(3)
  })

  it('keepWork (rename bloqueado): backup completo com manifesto conta e a origem é apagada', async () => {
    renameControl.failWork = true
    const r = await run(routineWith())
    expect(r.destinations.every((d) => d.outputPath?.endsWith('.em-andamento'))).toBe(true)
    expect(r.status).toBe('warning')
    expect(r.move?.removedCount).toBe(3)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(false)
  })
})

describe('modo ZIP', () => {
  it('sha256 por arquivo durante a compactação e a mesma regra de exclusão', async () => {
    const r = await run(routineWith({ mode: 'zip' }))
    expect(r.status).toBe('success')
    expect(r.move?.removedCount).toBe(3)
    expect(r.move?.removed.find((x) => x.path === srcPath('erp-01.fbk'))?.sha256).toBe(sha('backup do dia 1'))
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(false)
    const m = await readZipManifest(r.destinations[0].outputPath!)
    expect(m).toMatchObject({ moveSources: true, verified: true, files: 3 })
  })

  it('ZIP corrompido em um destino: Falha e origem intacta', async () => {
    const r = await run(routineWith({ mode: 'zip', zipLevel: 0 }), {
      hooks: {
        beforeVerify: async (zip, i) => {
          if (i !== 0) return
          const fh = await open(zip, 'r+')
          // "backup do dia 1" fica guardado sem compressão (nível 0): troca um byte dele.
          const buf = await readFile(zip)
          const at = buf.indexOf('backup do dia 1')
          await fh.write(Buffer.from('X'), 0, 1, at)
          await fh.close()
        }
      }
    })
    expect(r.status).toBe('failed')
    expect(r.destinations[0].error).toMatch(/verificação/i)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
  })
})

describe('sem arquivo novo', () => {
  beforeEach(async () => {
    await import('node:fs/promises').then((fs) => fs.rm(src, { recursive: true }))
    await mkdir(join(src, 'Diario'), { recursive: true })
  })

  it('pasta vazia com "Avisar" → Atenção, sem backup, sem retenção, destino conferido', async () => {
    const old = await oldSnapshots('d1')
    const r = await run(routineWith({ retention: { enabled: true, days: 7, minKeep: 3 } }))
    expect(r.status).toBe('warning')
    expect(r.move?.nothingNew).toBe(true)
    expect(r.move?.notice).toBe(`Nenhum arquivo novo em ${src}. O sistema pode não ter gerado o backup.`)
    expect(r.warnings).toBe(1)
    // ERP parado há 10 dias com retenção 7/3: nenhum backup antigo é apagado.
    expect((await snapshots('d1')).sort()).toEqual(old.sort())
    expect(r.destinations.every((d) => d.status === 'success' && d.pruned.length === 0)).toBe(true)
    expect((await stat(join(src, 'Diario'))).isDirectory()).toBe(true)
  })

  it('pasta vazia sem "Avisar" → Sucesso ("Nada novo para mover")', async () => {
    const r = await run(routineWith({ moveSources: { ...MOVE, warnIfEmpty: false } }))
    expect(r.status).toBe('success')
    expect(r.move?.notice).toBe('Nada novo para mover.')
    expect(await exists(join(dir, 'd1', BACKUP_ROOT_DIR))).toBe(false)
  })

  it('pasta vazia, mas destino indisponível → Falha', async () => {
    const r = await run(
      routineWith({
        destinations: [
          { id: 'd1', path: join(dir, 'd1') },
          { id: 'd2', path: join(dir, 'nao-existe') }
        ]
      })
    )
    expect(r.status).toBe('failed')
    expect(r.errorMessage).toMatch(/Destino indisponível/)
  })

  it('só MOVE_NEVER na pasta (ex.: um .bat) não conta como backup', async () => {
    await writeTree(src, { 'limpar.bat': 'del *.*', 'erp.ini': '[x]' })
    const r = await run(routineWith())
    expect(r.status).toBe('warning')
    expect(r.move?.nothingNew).toBe(true)
    expect(await exists(join(src, 'limpar.bat'))).toBe(true)
  })
})

describe('proteções da origem', () => {
  it('MOVE_NEVER e filtros: programas, temporários e excluídos nem copiados nem apagados', async () => {
    await writeTree(src, {
      'setup.exe': 'x',
      'SETUP2.EXE': 'x',
      'lib.dll': 'x',
      'rodar.bat': 'x',
      'atalho.lnk': 'x',
      'erp.ini': 'x',
      'app.config': 'x',
      'nota.tmp': 'x',
      'baixando.part': 'x',
      '~bloqueio.fbk': 'x',
      'relatorio.log': 'x'
    })
    const r = await run(
      routineWith({
        filters: { include: [], exclude: ['*.log'], skipHiddenAndSystem: true, maxFileSizeMB: null }
      })
    )
    expect(r.status).toBe('success')
    expect(r.move?.removedCount).toBe(3)
    const left = (await readdir(src)).sort()
    expect(left).toEqual(
      [
        'Diario',
        'SETUP2.EXE',
        'app.config',
        'atalho.lnk',
        'baixando.part',
        'erp.ini',
        'lib.dll',
        'nota.tmp',
        'relatorio.log',
        'rodar.bat',
        'setup.exe',
        '~bloqueio.fbk'
      ].sort()
    )
    const copied = await readdir(join(r.destinations[0].outputPath!, 'Backup'))
    expect(copied.sort()).toEqual(['Diario', 'erp-01.fbk'])
    expect(r.log.some((l) => /10 arquivo\(s\) de programa, atalho ou temporário/.test(l.message))).toBe(true)
  })

  it('makeMoveFilter ignora maiúsculas mesmo no Linux', () => {
    const f = makeMoveFilter(
      { include: [], exclude: [], skipHiddenAndSystem: false, maxFileSizeMB: null },
      'linux'
    )
    expect(f.fileVerdict('Backup/SETUP.EXE', 'SETUP.EXE', 1)).toBe('excluded')
    expect(f.fileVerdict('Backup/erp.FBK', 'erp.FBK', 1)).toBe('ok')
    expect(f.neverCount).toBe(1)
  })

  it('link simbólico dentro da origem não é seguido nem apagado (e o alvo fica intacto)', async () => {
    const outside = join(dir, 'fora')
    await writeTree(outside, { 'importante.fbk': 'não pode sumir' })
    await symlink(join(outside, 'importante.fbk'), join(src, 'link.fbk'))
    await symlink(outside, join(src, 'pasta-link'))
    const r = await run(routineWith())
    expect(r.status).toBe('success')
    expect(await readFile(join(outside, 'importante.fbk'), 'utf8')).toBe('não pode sumir')
    expect(
      (await import('node:fs/promises').then((fs) => fs.lstat(join(src, 'link.fbk')))).isSymbolicLink()
    ).toBe(true)
    expect(await exists(join(src, 'pasta-link'))).toBe(true)
  })

  it('o motor recusa unidade inteira/pasta pessoal mesmo sem o editor ("Mover" recusado)', async () => {
    const r = await run(routineWith({ sources: [{ id: 's1', path: homedir(), kind: 'folder' }] }))
    expect(r.status).toBe('failed')
    expect(r.errorMessage).toMatch(/^"Mover" recusado: .* é uma unidade inteira ou pasta do sistema/)
    expect(await exists(join(dir, 'd1', BACKUP_ROOT_DIR))).toBe(false)
  })

  it('o motor confere o caminho real: link para a raiz "/" é recusado', async () => {
    await symlink('/', join(dir, 'raiz'))
    const r = await run(routineWith({ sources: [{ id: 's1', path: join(dir, 'raiz'), kind: 'folder' }] }))
    expect(r.status).toBe('failed')
    expect(r.errorMessage).toMatch(/"Mover" recusado/)
  })

  it('origem que contém a pasta de dados do BC Backup é recusada', async () => {
    const r = await run(routineWith(), { dataPath: join(src, 'Diario', 'BC Backup') })
    expect(r.status).toBe('failed')
    expect(r.errorMessage).toMatch(/"Mover" recusado/)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
  })

  it('origem do tipo arquivo é recusada ("só funciona com pastas")', async () => {
    const r = await run(routineWith({ sources: [{ id: 's1', path: srcPath('erp-01.fbk'), kind: 'file' }] }))
    expect(r.status).toBe('failed')
    expect(r.errorMessage).toMatch(/não é uma pasta/)
    expect(await exists(srcPath('erp-01.fbk'))).toBe(true)
  })

  it('origens sobrepostas: cada arquivo é conferido e apagado uma vez só', async () => {
    const r = await run(
      routineWith({
        sources: [
          { id: 's1', path: src, kind: 'folder' },
          { id: 's2', path: join(src, 'Diario'), kind: 'folder' }
        ]
      })
    )
    expect(r.status).toBe('success')
    expect(r.move?.removedCount).toBe(3)
    expect(r.move?.keptCount).toBe(0)
  })
})

describe('prévia do editor', () => {
  it('conta elegíveis e aguardando com as mesmas regras do motor', async () => {
    await writeTree(src, { 'setup.exe': 'x' })
    const now = new Date(Date.now() + 2 * 3600_000)
    const p = await previewMove([src], undefined, { minAgeMinutes: 30 }, { now })
    expect(p.files).toBe(3)
    expect(p.bytes).toBe(15 + 23 + 13)
    expect(p.names.sort()).toEqual(['Diario/Antigos/erp-00.fbk', 'Diario/erp-02.fbk', 'erp-01.fbk'])
    expect(p.waiting).toBe(0)
    const fresh = await previewMove([src], undefined, { minAgeMinutes: 30 })
    expect(fresh.files).toBe(0)
    expect(fresh.waiting).toBe(3)
    expect(fresh.waitingItems[0].reason).toMatch(/pode estar sendo gravado/)
  })
})

describe('persistência e IPC', () => {
  it('rotinas antigas sem moveSources carregam iguais (sem o campo)', () => {
    const r = migrateRoutine({ name: 'Docs', sources: ['C:\\Dados'], destinations: ['E:\\'] })
    expect('moveSources' in r).toBe(false)
  })

  it('migrateMoveSources limita a 5–1440, corrige tipos e descarta lixo', () => {
    expect(migrateMoveSources(undefined)).toBeUndefined()
    expect(migrateMoveSources('sim')).toBeUndefined()
    expect(migrateMoveSources([1])).toBeUndefined()
    expect(migrateMoveSources({})).toEqual({ enabled: false, minAgeMinutes: 30, warnIfEmpty: true })
    expect(migrateMoveSources({ enabled: true, minAgeMinutes: 1, warnIfEmpty: false })).toEqual({
      enabled: true,
      minAgeMinutes: 5,
      warnIfEmpty: false
    })
    expect(migrateMoveSources({ enabled: 'true', minAgeMinutes: 99999 })).toEqual({
      enabled: false,
      minAgeMinutes: 1440,
      warnIfEmpty: true
    })
    expect(migrateMoveSources({ enabled: true, minAgeMinutes: '45' })?.minAgeMinutes).toBe(45)
  })

  it('ida e volta pelo config.json mantém moveSources', () => {
    const routine = routineWith({ moveSources: { enabled: true, minAgeMinutes: 90, warnIfEmpty: false } })
    const cfg = migrateConfig(JSON.parse(JSON.stringify({ routines: [routine] })))
    expect(cfg.routines[0].moveSources).toEqual({ enabled: true, minAgeMinutes: 90, warnIfEmpty: false })
    const again = migrateConfig(JSON.parse(JSON.stringify(cfg)))
    expect(again.routines[0].moveSources).toEqual(cfg.routines[0].moveSources)
  })

  it('o IPC sanitiza moveSources (asRoutineInput, validação e prévia)', () => {
    const raw = {
      ...routineWith(),
      moveSources: { enabled: true, minAgeMinutes: 2, warnIfEmpty: 'x', extra: 1 }
    }
    expect(asRoutineInput(raw).moveSources).toEqual({ enabled: true, minAgeMinutes: 5, warnIfEmpty: true })
    expect(asRoutineForValidation(raw).moveSources?.enabled).toBe(true)
    expect(asRoutineInput({ ...raw, moveSources: 'ligado' }).moveSources).toBeUndefined()
    expect(asMoveSources({ enabled: true, minAgeMinutes: 60 })).toEqual({
      enabled: true,
      minAgeMinutes: 60,
      warnIfEmpty: true
    })
    expect(() => asMoveSources(null)).toThrow(/Mover/)
  })
})

describe('validate.ts: pastas bloqueadas e avisos', () => {
  const env = {
    SystemDrive: 'C:',
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramData: 'C:\\ProgramData',
    USERPROFILE: 'C:\\Users\\Ana',
    PUBLIC: 'C:\\Users\\Public',
    OneDrive: 'C:\\Users\\Ana\\OneDrive - Padaria'
  }
  const win = { platform: 'win32' as const, env, homedir: 'C:\\Users\\Ana' }

  it('Windows: unidade, sistema, perfis e pastas conhecidas são bloqueados; subpastas não', () => {
    for (const p of [
      'C:\\',
      'D:\\',
      'C:',
      '\\\\SERVIDOR\\backup',
      '\\\\SERVIDOR\\backup\\',
      'C:\\Windows',
      'C:\\Windows\\x',
      'c:\\windows\\System32\\config',
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\ProgramData',
      'C:\\Users',
      'C:\\Users\\Ana',
      'C:\\Users\\ana\\',
      'C:\\Users\\Joao',
      'C:\\Users\\Public',
      'C:\\Users\\Ana\\Desktop',
      'C:\\Users\\Ana\\Documents',
      'C:\\Users\\Ana\\Downloads',
      'C:\\Users\\Ana\\Pictures',
      'C:\\Users\\Ana\\OneDrive',
      'C:\\Users\\Ana\\OneDrive - Padaria',
      'C:\\Users\\Ana\\OneDrive - Padaria\\Documentos'
    ])
      expect([p, isBlockedMoveSource(p, win)]).toEqual([p, true])
    for (const p of [
      'C:\\Program Files (x86)\\ERP\\Backup',
      'C:\\ERP\\Backup',
      'C:\\Backup',
      'D:\\Sistema\\Backup',
      'C:\\Users\\Ana\\Documents\\ERP\\Backup',
      '\\\\SERVIDOR\\backup\\ERP'
    ])
      expect([p, isBlockedMoveSource(p, win)]).toEqual([p, false])
    // Pasta de dados do BC Backup: quem a contém e quem está dentro dela.
    const dataPath = 'C:\\Users\\Ana\\AppData\\Roaming\\BC Backup'
    expect(isBlockedMoveSource('C:\\Users\\Ana\\AppData', { ...win, dataPath })).toBe(true)
    expect(isBlockedMoveSource(`${dataPath}\\logs`, { ...win, dataPath })).toBe(true)
    expect(isBlockedMoveSource('C:\\ERP\\Backup', { ...win, dataPath })).toBe(false)
  })

  it('macOS/Linux: /, /Users, /home, a pasta pessoal e pastas do sistema', () => {
    const lin = { platform: 'linux' as const, env: {}, homedir: '/home/ana' }
    for (const p of [
      '/',
      '/home',
      '/Users',
      '/home/ana',
      '/home/ana/',
      '/home/bia',
      '/usr',
      '/etc',
      '/var',
      '/System',
      '/home/ana/Downloads'
    ])
      expect([p, isBlockedMoveSource(p, lin)]).toEqual([p, true])
    for (const p of ['/srv/erp/backup', '/home/ana/erp/backup', '/var/backups/erp', '/tmp/x'])
      expect([p, isBlockedMoveSource(p, lin)]).toEqual([p, false])
  })

  it('nuvem: OneDrive, Dropbox, Google Drive', () => {
    expect(isCloudSyncedPath('C:\\Users\\Ana\\OneDrive - Padaria\\ERP')).toBe(true)
    expect(isCloudSyncedPath('C:\\Users\\Ana\\Dropbox\\Backup')).toBe(true)
    expect(isCloudSyncedPath('G:\\Meu Drive\\Backup')).toBe(true)
    expect(isCloudSyncedPath('C:\\ERP\\Backup')).toBe(false)
  })

  const base = {
    ...createInput(),
    sources: [{ id: 's1', path: 'C:\\ERP\\Backup', kind: 'folder' as const }],
    destinations: [
      { id: 'd1', path: 'E:\\', enabled: true },
      { id: 'd2', path: '\\\\SERVIDOR\\backup', enabled: true }
    ],
    moveSources: { ...MOVE }
  }
  function createInput() {
    const r = makeRoutine({ name: 'ERP' })
    const { createdAt: _c, updatedAt: _u, ...rest } = r
    return rest
  }
  const ctx = { existing: [], smtpConfigured: true, checkFs: false, ...win }

  it('erros: arquivo como origem e pastas bloqueadas (com o texto da especificação)', async () => {
    const issues = await validateRoutine(
      {
        ...base,
        sources: [
          { id: 's1', path: 'C:\\', kind: 'folder' },
          { id: 's2', path: 'C:\\ERP\\banco.fbk', kind: 'file' },
          { id: 's3', path: 'C:\\Windows\\Temp', kind: 'folder' }
        ]
      },
      ctx
    )
    const errors = issues.filter((i) => i.level === 'error')
    expect(errors.map((i) => i.message).sort()).toEqual(
      [
        '"Mover" só funciona com pastas. Troque o arquivo pela pasta que o contém.',
        'Não é possível usar "Mover" em uma unidade inteira ou pasta do sistema (C:\\, C:\\Windows, C:\\Users\\Ana…). Escolha a pasta onde o sistema grava os backups.'
      ].sort()
    )
    expect(errors.every((i) => i.step === 'origem' && i.topic === 'move')).toBe(true)
    // Com "Mover" desligado, as mesmas origens não geram esses erros.
    const off = await validateRoutine({ ...base, moveSources: { ...MOVE, enabled: false } }, ctx)
    expect(off.some((i) => i.topic === 'move')).toBe(false)
  })

  it('permite C:\\Program Files (x86)\\ERP\\Backup sem erro', async () => {
    const issues = await validateRoutine(
      { ...base, sources: [{ id: 's1', path: 'C:\\Program Files (x86)\\ERP\\Backup', kind: 'folder' }] },
      ctx
    )
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('avisos: 1 destino, retenção desligada, outra rotina, nuvem e agendamento por intervalo', async () => {
    const issues = await validateRoutine(
      {
        ...base,
        sources: [{ id: 's1', path: 'C:\\Users\\Ana\\OneDrive - Padaria\\ERP\\Backup', kind: 'folder' }],
        destinations: [{ id: 'd1', path: 'E:\\', enabled: true }],
        retention: { enabled: false, days: 7, minKeep: 3 },
        schedule: { ...base.schedule, kind: 'interval', intervalMinutes: 240 }
      },
      {
        ...ctx,
        existing: [
          {
            id: 'outra',
            name: 'Documentos',
            sources: [{ id: 'x', path: 'C:\\Users\\Ana\\OneDrive - Padaria', kind: 'folder' }]
          }
        ]
      }
    )
    const w = issues
      .filter((i) => i.level === 'warning' && i.topic === 'move')
      .map((i) => [i.step, i.message])
    expect(w).toEqual(
      expect.arrayContaining([
        [
          'destinos',
          'Só há 1 destino ativo: depois de mover, o backup existirá em um único lugar. Recomendamos 2 destinos.'
        ],
        ['retencao', 'A retenção está desligada: os destinos vão acumular todos os backups movidos.'],
        [
          'origem',
          'A rotina "Documentos" também usa esta pasta e pode não encontrar os arquivos depois que eles forem movidos.'
        ],
        ['origem', 'Esta pasta é sincronizada com a nuvem (OneDrive/Dropbox): apagar aqui também apaga lá.'],
        ['agendamento', 'Com execuções a cada 4 horas, desmarque "Avisar se não houver arquivo novo".']
      ])
    )
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
  })

  it('aviso de mesmo disco troca o texto quando "Mover" está ligado', async () => {
    const issues = await validateRoutine(
      { ...base, destinations: [{ id: 'd1', path: 'C:\\Backups', enabled: true }, base.destinations[1]] },
      { ...ctx, checkFs: true }
    )
    expect(issues.map((i) => i.message)).toContain(
      'O destino C:\\Backups fica no mesmo disco da origem: "Mover" não libera espaço nesse disco.'
    )
    expect(issues.some((i) => /se o disco falhar, perde os dois/.test(i.message))).toBe(false)
  })

  it('sem aviso de intervalo quando "Avisar se não houver arquivo novo" está desmarcado', async () => {
    const issues = await validateRoutine(
      {
        ...base,
        moveSources: { ...MOVE, warnIfEmpty: false },
        schedule: { ...base.schedule, kind: 'interval', intervalMinutes: 30 }
      },
      ctx
    )
    expect(issues.some((i) => /desmarque/.test(i.message))).toBe(false)
  })
})

describe('e2eJobOptions (ajuste de relógio só para E2E)', () => {
  it('sem BC_E2E=1 nunca altera o relógio do "Mover"', async () => {
    const { e2eJobOptions } = await import('../src/main/engine/job')
    expect(e2eJobOptions({ BC_E2E_MOVE_SKEW_MIN: '120' })).toEqual({})
    expect(e2eJobOptions({ BC_E2E: '0', BC_E2E_MOVE_SKEW_MIN: '120' })).toEqual({})
    expect(e2eJobOptions({ BC_E2E: '1' })).toEqual({})
    expect(e2eJobOptions({ BC_E2E: '1', BC_E2E_MOVE_SKEW_MIN: '120' })).toEqual({ moveAgeSkewMs: 7_200_000 })
  })
})
