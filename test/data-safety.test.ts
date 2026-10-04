// Revisão de segurança de dados: cada teste reproduz um bug concreto encontrado na revisão
// (apagar/perder backups, recursão destino-dentro-da-origem, agendador parado etc.).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Routine, Schedule } from '@shared/types'
import { BACKUP_ROOT_DIR, MANIFEST_FILE, ROUTINE_MARKER_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import { runJob, sourceSlots, type JobOptions } from '../src/main/engine/job'
import { cleanupLeftovers, selectForDeletion } from '../src/main/engine/retention'
import { sanitizeName } from '../src/main/engine/fsutil'
import type { JobSpec } from '../src/main/engine/types'
import { Scheduler, decideSlot, type SchedRoutine } from '../src/main/scheduler'
import { buildExport, planImport } from '../src/main/config-io'
import { checkOpenablePath } from '../src/main/ipc-validate'
import { JsonFile } from '../src/main/store'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { makeRoutine, makeSnapshotDir, manifest, tempDir, writeTree } from './helpers'

let dir: string
let cleanup: () => Promise<void>

beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-safety-'))
  await writeTree(join(dir, 'origem'), { 'a.txt': 'hello', 'sub/b.txt': 'mundo' })
  await mkdir(join(dir, 'd1'))
})
afterEach(() => cleanup())

function routineWith(patch: Partial<Routine> = {}) {
  return makeRoutine({
    sources: [{ id: 's1', path: join(dir, 'origem'), kind: 'folder' }],
    destinations: [{ id: 'd1', path: join(dir, 'd1') }],
    filters: { include: [], exclude: [], skipHiddenAndSystem: true, maxFileSizeMB: null },
    verify: 'quick',
    retention: { enabled: true, days: 7, minKeep: 3 },
    ...patch
  })
}

async function run(
  routine: ReturnType<typeof routineWith>,
  startedAt: Date,
  now: Date,
  opts: JobOptions = {}
) {
  const spec: JobSpec = {
    runId: 'run-1',
    routine,
    trigger: 'manual',
    startedAt: startedAt.toISOString(),
    appVersion: '0.1.0',
    hostname: 'pc-teste'
  }
  return runJob(spec, () => {}, new AbortController().signal, { now: () => now, ...opts })
}

const routineDir = (dest = 'd1') => join(dir, dest, BACKUP_ROOT_DIR, 'Financeiro diário')

describe('retenção nunca apaga o backup que acabou de ser criado', () => {
  it('execução que atravessa a meia-noite com dias=1 e mínimo=0 mantém o backup novo', async () => {
    const start = new Date(2026, 9, 8, 23, 59, 50)
    const result = await run(
      routineWith({ retention: { enabled: true, days: 1, minKeep: 0 } }),
      start,
      new Date(2026, 9, 9, 0, 0, 10)
    )
    expect(result.status).toBe('success')
    const out = result.destinations[0].outputPath!
    expect(out).toBe(join(routineDir(), backupStamp(start)))
    expect(result.destinations[0].pruned).toEqual([])
    expect((await stat(out)).isDirectory()).toBe(true)
  })

  it('backup "do futuro" (relógio errado) não faz o backup novo ser excluído pelo mínimo', () => {
    const now = new Date(2026, 9, 9, 0, 0, 10)
    const fresh = { name: 'novo', date: new Date(2026, 9, 8, 23, 59, 50) }
    const future = { name: 'futuro', date: new Date(2030, 0, 1, 3) }
    const del = selectForDeletion([fresh, future], { enabled: true, days: 1, minKeep: 1 }, now, (s) =>
      s === fresh
    )
    expect(del).toEqual([])
  })
})

describe('backup sem nenhum arquivo copiado não conta como backup', () => {
  for (const mode of ['copy', 'zip'] as const) {
    it(`todos os arquivos em uso (${mode}) → destino falha e a retenção não apaga os antigos`, async () => {
      const rd = routineDir()
      await mkdir(rd, { recursive: true })
      await writeFile(join(rd, ROUTINE_MARKER_FILE), JSON.stringify({ routineId: 'rot-1' }))
      // 3 backups bons e antigos (fora da janela de 1 dia).
      const old = [1, 2, 3].map((d) => backupStamp(new Date(2026, 8, d, 3)))
      for (const s of old) await makeSnapshotDir(rd, s)
      const start = new Date(2026, 9, 8, 18)
      const result = await run(
        routineWith({ mode, retention: { enabled: true, days: 1, minKeep: 1 } }),
        start,
        new Date(2026, 9, 8, 18, 1),
        {
          hooks: {
            beforeOpen: () => {
              throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
            }
          }
        }
      )
      expect(result.status).toBe('failed')
      expect(result.destinations[0].status).toBe('failed')
      expect(result.destinations[0].error).toMatch(/Nenhum arquivo/)
      expect(result.destinations[0].pruned).toEqual([])
      const left = await readdir(rd)
      for (const s of old) expect(left).toContain(s)
      // Nenhum "backup" vazio finalizado.
      expect(left.filter((n) => n.startsWith(backupStamp(start).slice(0, 10)))).toEqual([])
    })
  }
})

describe('destino dentro da origem é recusado na execução (não só no editor)', () => {
  it('destino é subpasta da origem → falha sem criar "BC Backup" dentro da origem', async () => {
    const inside = join(dir, 'origem', 'backups')
    await mkdir(inside)
    const result = await run(
      routineWith({ destinations: [{ id: 'x', path: inside }] }),
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 8, 18, 1)
    )
    expect(result.status).toBe('failed')
    expect(result.destinations[0].error).toMatch(/dentro da origem/)
    expect(await readdir(inside)).toEqual([])
  })

  it('origem == destino → falha', async () => {
    const result = await run(
      routineWith({ destinations: [{ id: 'x', path: join(dir, 'origem') }] }),
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 8, 18, 1)
    )
    expect(result.status).toBe('failed')
    expect(result.destinations[0].error).toMatch(/dentro da origem/)
    expect(await readdir(join(dir, 'origem'))).not.toContain(BACKUP_ROOT_DIR)
  })

  it('destino que é um link para dentro da origem → falha (compara o caminho real)', async () => {
    await mkdir(join(dir, 'origem', 'alvo'))
    await symlink(join(dir, 'origem', 'alvo'), join(dir, 'atalho'), 'dir')
    const result = await run(
      routineWith({ destinations: [{ id: 'x', path: join(dir, 'atalho') }] }),
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 8, 18, 1)
    )
    expect(result.status).toBe('failed')
    expect(result.destinations[0].error).toMatch(/dentro da origem/)
  })

  it('origem dentro da pasta "BC Backup" do destino (backup dos backups) → falha', async () => {
    const bcRoot = join(dir, 'd1', BACKUP_ROOT_DIR)
    await writeTree(bcRoot, { 'x.txt': '1' })
    const result = await run(
      routineWith({ sources: [{ id: 's', path: bcRoot, kind: 'folder' }] }),
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 8, 18, 1)
    )
    expect(result.status).toBe('failed')
    expect(result.destinations[0].error).toMatch(/dentro da origem/)
  })

  it('o outro destino (fora da origem) continua funcionando', async () => {
    const inside = join(dir, 'origem', 'backups')
    await mkdir(inside)
    const result = await run(
      routineWith({
        destinations: [
          { id: 'x', path: inside },
          { id: 'd1', path: join(dir, 'd1') }
        ]
      }),
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 8, 18, 1)
    )
    expect(result.destinations.map((d) => d.status)).toEqual(['failed', 'success'])
    expect(result.status).toBe('failed')
  })
})

describe('limpeza de sobras só apaga o que é comprovadamente lixo desta rotina', () => {
  it('".em-andamento" com manifesto de OUTRA rotina não é apagado', async () => {
    const name = `${backupStamp(new Date(2026, 9, 1, 3))}.em-andamento`
    await makeSnapshotDir(dir, name, manifest({ routineId: 'outra-rotina' }))
    await cleanupLeftovers(dir, 'rot-1')
    expect(await readdir(dir)).toContain(name)
  })

  it('".em-andamento" completo desta rotina cujo nome final já existe não é apagado', async () => {
    const stamp = backupStamp(new Date(2026, 9, 1, 3))
    await makeSnapshotDir(dir, stamp)
    await makeSnapshotDir(dir, `${stamp}.em-andamento`, manifest({ snapshotId: 'outro-run' }))
    await cleanupLeftovers(dir, 'rot-1')
    const left = await readdir(dir)
    expect(left).toContain(stamp)
    expect(left).toContain(`${stamp}.em-andamento`)
  })
})

describe('importar configurações gera ids novos (outro PC não compartilha a pasta da rotina)', () => {
  it('mesmo sem colisão local, o id importado é novo', () => {
    const r = makeRoutine({ id: 'r1', name: 'Docs' })
    const file = buildExport(DEFAULT_SETTINGS, [r], '0.1.0')
    const plan = planImport(JSON.parse(JSON.stringify(file)), [])
    expect(plan.routines[0].id).not.toBe('r1')
    expect(plan.routines[0].name).toBe('Docs')
  })

  it('cenário: rotina exportada do PC A e importada no PC B, mesmo destino de rede → pastas separadas', async () => {
    const a = routineWith({ id: 'id-pc-a' })
    const [b] = planImport(JSON.parse(JSON.stringify(buildExport(DEFAULT_SETTINGS, [a], '0.1.0'))), []).routines
    // O PC A está no meio de uma cópia neste destino.
    const rdA = routineDir()
    await mkdir(rdA, { recursive: true })
    await writeFile(join(rdA, ROUTINE_MARKER_FILE), JSON.stringify({ routineId: a.id }))
    const running = `${backupStamp(new Date(2026, 9, 8, 17, 59))}.em-andamento`
    await makeSnapshotDir(rdA, running, null)
    const result = await run(b, new Date(2026, 9, 8, 18), new Date(2026, 9, 8, 18, 1))
    expect(result.status).toBe('success')
    expect(await readdir(rdA)).toContain(running)
  })
})

describe('agendador com relógio corrigido para trás', () => {
  const daily: Schedule = {
    kind: 'daily',
    times: ['02:00'],
    weekdays: [],
    intervalMinutes: 60,
    window: null,
    startupDelayMinutes: 5,
    catchUpMissed: true
  }
  const r: SchedRoutine = {
    id: 'r1',
    name: 'R',
    enabled: true,
    schedule: daily,
    createdAt: '2026-01-01T00:00:00.000Z'
  }

  it('lastAttemptSlot no futuro distante (relógio estava adiantado) não para os backups', () => {
    const wrong = new Date(2027, 5, 1, 2).toISOString() // gravado quando o relógio marcava 2027
    expect(decideSlot(r, wrong, new Date(2026, 9, 5, 2, 1))).toEqual({
      kind: 'run',
      slot: new Date(2026, 9, 5, 2)
    })
  })

  it('rotina criada com o relógio adiantado também volta a rodar', () => {
    const created = { ...r, createdAt: new Date(2027, 0, 1).toISOString() }
    expect(decideSlot(created, null, new Date(2026, 9, 5, 2, 1)).kind).toBe('run')
  })

  it('recuperação pendente não roda depois que a rotina passa a "Somente manual"', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 4, 9, 0))
      const list = [r]
      const runs: string[] = []
      const s = new Scheduler({
        routines: () => list,
        getLastAttempt: () => '2026-09-30T00:00:00.000Z',
        setLastAttempt: () => {},
        enqueue: (id, t) => runs.push(`${id}:${t}`)
      })
      s.start() // agenda a recuperação para daqui a ~3 min
      list[0] = { ...r, schedule: { ...daily, kind: 'manual' } }
      s.tick()
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(runs).toEqual([])
      expect(s.nextRuns().r1).toBeNull()
      s.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pequeno ajuste do relógio (NTP) não gera execução extra', () => {
    const slot = new Date(2026, 9, 5, 2)
    const now = new Date(2026, 9, 5, 1, 59, 58) // voltou 2 s depois de disparar
    expect(decideSlot(r, slot.toISOString(), now).kind).toBe('none')
  })
})

describe('nomes', () => {
  it('arquivo de origem chamado "bcbackup-manifesto.json" não é sobrescrito pelo manifesto', () => {
    const slots = sourceSlots([{ id: '1', path: `/x/${MANIFEST_FILE}`, kind: 'file' }])
    expect(slots[0].name.toLowerCase()).not.toBe(MANIFEST_FILE)
  })

  it('sanitizeName cobre CONIN$, CONOUT$, COM¹ e "CON .txt"', () => {
    for (const n of ['CONIN$', 'conout$', 'COM¹', 'LPT³', 'CON .txt', 'nul .tar.gz'])
      expect(sanitizeName(n).startsWith('_')).toBe(true)
    expect(sanitizeName('CONTAS')).toBe('CONTAS')
    expect(sanitizeName('Console')).toBe('Console')
  })
})

describe('abrir caminhos vindos da interface', () => {
  it('pastas e .zip podem ser abertos; executáveis e outros arquivos não', async () => {
    await writeFile(join(dir, 'virus.exe'), 'MZ')
    await writeFile(join(dir, 'script.bat'), 'echo')
    await writeFile(join(dir, 'backup.zip'), 'PK')
    await symlink(join(dir, 'virus.exe'), join(dir, 'disfarce.zip'))
    expect(await checkOpenablePath(join(dir, 'origem'))).toBe(join(dir, 'origem'))
    expect(await checkOpenablePath(join(dir, 'backup.zip'))).toBe(join(dir, 'backup.zip'))
    await expect(checkOpenablePath(join(dir, 'virus.exe'))).rejects.toThrow(/pastas/)
    await expect(checkOpenablePath(join(dir, 'script.bat'))).rejects.toThrow(/pastas/)
    await expect(checkOpenablePath(join(dir, 'disfarce.zip'))).rejects.toThrow(/pastas/)
    await expect(checkOpenablePath(join(dir, 'nao-existe'))).rejects.toThrow(/não encontrado/)
  })
})

describe('persistência', () => {
  it('gravação que falhou é refeita no flush (ao sair do app) em vez de perder a alteração', async () => {
    const file = join(dir, 'state.json')
    const jf = await JsonFile.load<{ v: number }>(file, () => ({ v: 1 }))
    // Simula uma falha de gravação: um diretório não vazio no lugar do arquivo.
    await mkdir(join(file, 'x'), { recursive: true })
    jf.data.v = 2
    await expect(jf.save()).rejects.toThrow()
    await rm(file, { recursive: true })
    await jf.flush()
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ v: 2 })
  })
})

