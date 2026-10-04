// "Mover": revisão de segurança de dados (docs/research/04-mover-apos-copiar.md). Cada teste
// reproduz um caminho concreto em que a versão anterior apagava da origem algo que não podia
// (ou perdia a única cópia), e fica como regressão.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MoveSources, Routine, RunProgress } from '@shared/types'
import { BACKUP_ROOT_DIR, ROUTINE_MARKER_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import { runJob, type JobOptions } from '../src/main/engine/job'
import type { EngineEvent, JobSpec } from '../src/main/engine/types'
import { EXPORT_FORMAT, buildExport, planImport } from '../src/main/config-io'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { isBlockedMoveSource } from '../src/main/validate'
import { makeRoutine, makeSnapshotDir, manifest, tempDir, writeTree } from './helpers'

// Rename do backup "bloqueado" (antivírus) sob demanda: produz o keepWork sem depender do Windows.
// Leitura do manifesto "presa" (antivírus/indexador): EBUSY só para o manifesto, sob demanda.
const ctl = vi.hoisted(() => ({ failWork: false, manifestBusy: false }))
vi.mock('../src/main/engine/fsutil', async (orig) => {
  const real = await orig<typeof import('../src/main/engine/fsutil')>()
  return {
    ...real,
    renameRetry: async (from: string, to: string, attempts?: number, base?: number) => {
      if (ctl.failWork && from.endsWith('.em-andamento'))
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      return real.renameRetry(from, to, attempts, base)
    }
  }
})
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>()
  const readFileReal = real.readFile as (...a: unknown[]) => Promise<unknown>
  return {
    ...real,
    readFile: async (p: unknown, ...rest: unknown[]) => {
      if (ctl.manifestBusy && String(p).endsWith('bcbackup-manifesto.json'))
        throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
      return readFileReal(p, ...rest)
    }
  }
})

let dir: string
let cleanup: () => Promise<void>
let src: string

const ROUTINE_NAME = 'Backup do ERP'
const MOVE: MoveSources = { enabled: true, minAgeMinutes: 30, warnIfEmpty: true }
/** O relógio do motor 2 h à frente: os arquivos recém-criados já passaram da idade mínima. */
const later = () => new Date(Date.now() + 2 * 3600_000)
const ALL = ['erp-01.fbk', 'Diario/erp-02.fbk', 'Diario/Antigos/erp-00.fbk']
const srcPath = (rel: string) => join(src, ...rel.split('/'))
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false
  )

beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-move-safety-'))
  src = join(dir, 'Backup')
  await writeTree(src, {
    'erp-01.fbk': 'backup do dia 1',
    'Diario/erp-02.fbk': 'backup do dia 2 (maior)',
    'Diario/Antigos/erp-00.fbk': 'backup antigo'
  })
  await mkdir(join(dir, 'd1'))
  await mkdir(join(dir, 'd2'))
  ctl.failWork = false
  ctl.manifestBusy = false
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
  opts: JobOptions & { onEvent?: (e: EngineEvent) => void } = {}
) {
  const spec: JobSpec = {
    runId: 'run-1',
    routine,
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    hostname: 'pc-teste'
  }
  return runJob(spec, opts.onEvent ?? (() => {}), new AbortController().signal, {
    now: later,
    probeRetryMs: 1,
    ...opts
  })
}

/** Montagem "bind" (Linux, root): a mesma pasta por outro caminho, como \\PC\D$ ou uma unidade mapeada. */
function canBindMount(): boolean {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) return false
  const base = mkdtempSync(join(tmpdir(), 'bcb-bind-'))
  const a = join(base, 'a')
  const b = join(base, 'b')
  try {
    mkdirSync(a)
    mkdirSync(b)
    execFileSync('mount', ['--bind', a, b], { stdio: 'ignore' })
    execFileSync('umount', [b], { stdio: 'ignore' })
    return true
  } catch {
    return false
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}
const BIND = canBindMount()

describe('porta de exclusão: arquivo reaberto durante o teste de uso', () => {
  it('o ERP reabre, acrescenta e fecha enquanto o teste de uso espera (EBUSY): o arquivo fica', async () => {
    let reopened = false
    const r = await run(routineWith(), {
      hooks: {
        beforeProbe: async (item, stage) => {
          if (stage !== 'delete' || !item.rel.endsWith('erp-01.fbk') || reopened) return
          // 1ª tentativa: o ERP está com o arquivo aberto (EBUSY) e grava mais dados; antes da
          // nova tentativa ele fecha. O conteúdo novo nunca foi copiado para os destinos.
          reopened = true
          await appendFile(item.abs, ' + dados novos')
          throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
        }
      }
    })
    expect(reopened).toBe(true)
    expect(await readFile(srcPath('erp-01.fbk'), 'utf8')).toBe('backup do dia 1 + dados novos')
    expect(r.move?.kept.map((k) => k.path)).toEqual([srcPath('erp-01.fbk')])
    expect(r.move?.removedCount).toBe(2)
    expect(r.status).toBe('warning')
  })
})

describe('destinos que são a mesma pasta não contam como cópias diferentes', () => {
  it('2º destino é um link para o 1º: Falha e nada é apagado', async () => {
    await symlink(join(dir, 'd1'), join(dir, 'd1-atalho'))
    const r = await run(
      routineWith({
        destinations: [
          { id: 'd1', path: join(dir, 'd1'), label: 'HD 1' },
          { id: 'd2', path: join(dir, 'd1-atalho'), label: 'HD 2' }
        ]
      })
    )
    expect(r.status).toBe('failed')
    expect(r.destinations.map((d) => d.status)).toEqual(['success', 'failed'])
    expect(r.destinations[1].error).toMatch(/mesma pasta/)
    expect(r.move?.removedCount).toBe(0)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
  })

  it('o mesmo caminho duas vezes (configuração importada não passa pelo editor): Falha', async () => {
    const r = await run(
      routineWith({
        destinations: [
          { id: 'd1', path: join(dir, 'd1'), label: 'HD 1' },
          { id: 'd2', path: join(dir, 'd1'), label: 'HD 2' }
        ]
      })
    )
    expect(r.status).toBe('failed')
    expect(r.destinations[1].error).toMatch(/mesma pasta/)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
  })

  it('2 destinos diferentes continuam movendo normalmente', async () => {
    const r = await run(routineWith())
    expect(r.status).toBe('success')
    expect(r.move?.removedCount).toBe(3)
  })
})

describe.skipIf(!BIND)(
  'destino que é a origem por outra grafia (sem link: \\\\PC\\D$, unidade mapeada)',
  () => {
    it('é recusado pela identidade da pasta, não só pelo texto do caminho', async () => {
      const alias = join(dir, 'mesma-pasta')
      await mkdir(alias)
      execFileSync('mount', ['--bind', src, alias], { stdio: 'ignore' })
      try {
        const r = await run(
          routineWith({
            destinations: [
              { id: 'd1', path: alias, label: 'Rede' },
              { id: 'd2', path: join(dir, 'd2') }
            ]
          })
        )
        expect(r.status).toBe('failed')
        expect(r.destinations[0].error).toMatch(/dentro da origem/)
        expect(await exists(join(src, BACKUP_ROOT_DIR))).toBe(false)
        for (const f of ALL) expect(await exists(srcPath(f))).toBe(true)
        // Sem "Mover" também: o backup copiaria a si mesmo a cada execução.
        await mkdir(join(src, 'Sub'))
        const r2 = await run(
          routineWith({ moveSources: undefined, destinations: [{ id: 'd1', path: join(alias, 'Sub') }] })
        )
        expect(r2.status).toBe('failed')
        expect(r2.destinations[0].error).toMatch(/dentro da origem/)
      } finally {
        execFileSync('umount', [alias], { stdio: 'ignore' })
      }
    })
  }
)

describe('keepWork: a única cópia daquele destino não pode sumir na limpeza de sobras', () => {
  it('manifesto momentaneamente ilegível (EBUSY) não faz apagar o backup completo', async () => {
    ctl.failWork = true
    const r1 = await run(routineWith())
    expect(r1.move?.removedCount).toBe(3)
    const work = r1.destinations[0].outputPath!
    expect(work.endsWith('.em-andamento')).toBe(true)
    for (const f of ALL) expect(await exists(srcPath(f))).toBe(false)

    // Próxima execução (arquivo novo do ERP); o antivírus segura o manifesto por um instante.
    ctl.failWork = false
    await writeFile(srcPath('erp-03.fbk'), 'backup do dia 3')
    ctl.manifestBusy = true
    const r2 = await run(routineWith(), { now: () => new Date(Date.now() + 3 * 3600_000) })
    ctl.manifestBusy = false
    expect(r2.destinations.every((d) => d.status !== 'failed')).toBe(true)
    expect(await readFile(join(work, 'Backup', 'erp-01.fbk'), 'utf8')).toBe('backup do dia 1')
    expect(await readFile(join(work, 'Backup', 'Diario', 'erp-02.fbk'), 'utf8')).toBe(
      'backup do dia 2 (maior)'
    )
  })
})

describe('releitura da origem (1 destino) não fica muda', () => {
  it('emite progresso enquanto relê um arquivo grande (o vigia de 30 min não mata o motor)', async () => {
    await writeFile(srcPath('grande.fbk'), Buffer.alloc(6 * 1024 * 1024 + 1, 7))
    const events: RunProgress[] = []
    const r = await run(routineWith({ destinations: [{ id: 'd1', path: join(dir, 'd1') }] }), {
      progressIntervalMs: 0,
      onEvent: (e) => {
        if (e.type === 'progress') events.push(e.progress)
      }
    })
    expect(r.status).toBe('success')
    expect(r.move?.removedCount).toBe(4)
    const during = events.filter((p) => p.phase === 'moving' && p.currentFile?.endsWith('grande.fbk'))
    // 7 blocos de 1 MB lidos de novo: pelo menos um evento por bloco.
    expect(during.length).toBeGreaterThanOrEqual(7)
  })
})

describe('varredura do "Mover" não fica muda', () => {
  it('arquivos em uso (teste exclusivo esperando entre tentativas) emitem progresso', async () => {
    await writeTree(src, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`lote/${i}.fbk`, 'x'])))
    const events: RunProgress[] = []
    const r = await run(routineWith(), {
      progressIntervalMs: 0,
      hooks: {
        beforeProbe: (item, stage) => {
          if (stage === 'scan' && item.rel.includes('/lote/'))
            throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        }
      },
      onEvent: (e) => {
        if (e.type === 'progress') events.push(e.progress)
      }
    })
    expect(r.move?.postponedCount).toBe(20)
    // Um evento por arquivo examinado (cada um em uso espera ~4 s no Windows).
    expect(events.filter((p) => p.phase === 'scanning').length).toBeGreaterThanOrEqual(23)
  })
})

describe('importar configurações não liga o "Mover" sem a confirmação do editor', () => {
  it('a rotina importada chega com "Mover" desligado (as outras opções ficam)', async () => {
    const exported = buildExport(
      DEFAULT_SETTINGS,
      [routineWith({ moveSources: { enabled: true, minAgeMinutes: 90, warnIfEmpty: false } })],
      '0.1.0'
    )
    expect(exported.format).toBe(EXPORT_FORMAT)
    const plan = planImport(JSON.parse(JSON.stringify(exported)), [])
    expect(plan.routines[0].moveSources).toEqual({ enabled: false, minAgeMinutes: 90, warnIfEmpty: false })
    expect(plan.moveDisabled).toBe(1)
    // Rotina sem "Mover" fica sem o campo.
    const plain = planImport(
      JSON.parse(
        JSON.stringify(buildExport(DEFAULT_SETTINGS, [routineWith({ moveSources: undefined })], '0.1.0'))
      ),
      []
    )
    expect(plain.routines[0].moveSources).toBeUndefined()
    expect(plain.moveDisabled).toBe(0)
    // Nada foi lido do disco por engano.
    expect(await readdir(src)).toContain('erp-01.fbk')
  })
})

describe('arquivo vazio (0 bytes) não conta como backup do sistema', () => {
  it('ERP que passou a gerar só arquivos vazios: sem backup novo, sem retenção, Atenção', async () => {
    // 4 backups reais antigos (10 a 13 dias) com manifesto desta rotina; retenção 7 dias, mínimo 3.
    const rd = join(dir, 'd1', BACKUP_ROOT_DIR, ROUTINE_NAME)
    await mkdir(rd, { recursive: true })
    await writeFile(join(rd, ROUTINE_MARKER_FILE), JSON.stringify({ routineId: 'rot-1' }))
    const old = [10, 11, 12, 13].map((d) => backupStamp(new Date(Date.now() - d * 86_400_000)))
    for (const s of old) await makeSnapshotDir(rd, s, manifest({ routineName: ROUTINE_NAME }))
    // O gbak falhou: deixou o arquivo do dia com 0 bytes.
    await rm(src, { recursive: true })
    await writeTree(src, { 'erp-04.fbk': '' })
    const r = await run(routineWith({ destinations: [{ id: 'd1', path: join(dir, 'd1') }] }))
    expect(r.status).toBe('warning')
    expect(r.move?.nothingNew).toBe(true)
    expect(r.move?.notice).toMatch(/O sistema pode não ter gerado o backup/)
    expect((await readdir(rd)).filter((n) => /^\d{4}-/.test(n)).sort()).toEqual(old.sort())
    expect(await exists(srcPath('erp-04.fbk'))).toBe(true)
  })

  it('arquivo vazio junto com um backup de verdade: só o de verdade é movido', async () => {
    await writeTree(src, { 'vazio.fbk': '' })
    const r = await run(routineWith())
    expect(r.move?.removedCount).toBe(3)
    expect(await exists(srcPath('vazio.fbk'))).toBe(true)
    expect(r.log.some((l) => /1 arquivo\(s\) vazio\(s\)/.test(l.message))).toBe(true)
  })
})

describe('pastas bloqueadas: outra forma Unicode do mesmo nome (macOS)', () => {
  it('Documentos do perfil em NFD com a pasta pessoal em NFC continua bloqueado', () => {
    const ctx = { platform: 'darwin' as const, env: {}, homedir: '/Users/Jos\u00e9' }
    expect(isBlockedMoveSource('/Users/Jos\u00e9/Documents', ctx)).toBe(true)
    expect(isBlockedMoveSource('/Users/Jose\u0301/Documents', ctx)).toBe(true)
    expect(isBlockedMoveSource('/Users/Jose\u0301/Desktop', ctx)).toBe(true)
    expect(isBlockedMoveSource('/Users/Jose\u0301/ERP/Backup', ctx)).toBe(false)
  })
})

describe('exclusão nunca sai da pasta de origem', () => {
  it('subpasta trocada por um link durante a execução: o arquivo lá fora não é apagado', async () => {
    const fora = join(dir, 'Arquivo-morto')
    await mkdir(fora)
    const r = await run(routineWith(), {
      hooks: {
        afterDestination: async (i) => {
          if (i !== 1) return
          // Um script de arquivamento leva "Diario" para outro disco e deixa um link no lugar
          // (move + mklink /J): os arquivos são os mesmos (tamanho, mtime e ctime iguais).
          await rename(join(src, 'Diario'), join(fora, 'Diario'))
          await symlink(join(fora, 'Diario'), join(src, 'Diario'))
        }
      }
    })
    expect(await readFile(join(fora, 'Diario', 'erp-02.fbk'), 'utf8')).toBe('backup do dia 2 (maior)')
    expect(await readFile(join(fora, 'Diario', 'Antigos', 'erp-00.fbk'), 'utf8')).toBe('backup antigo')
    expect(r.move?.removed.map((x) => x.path)).toEqual([srcPath('erp-01.fbk')])
    expect(r.move?.kept.map((k) => k.reason)).toEqual([
      'Fora da pasta de origem (não apagado)',
      'Fora da pasta de origem (não apagado)'
    ])
    expect(r.status).toBe('warning')
  })
})
