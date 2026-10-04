// Revisão de segurança de dados: cada teste reproduz um bug concreto encontrado na revisão
// (apagar/perder backups, recursão destino-dentro-da-origem, agendador parado etc.).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Routine, Schedule } from '@shared/types'
import { MANIFEST_FILE } from '@shared/defaults'
import { backupStamp } from '@shared/format'
import { runJob, sourceSlots, type JobOptions } from '../src/main/engine/job'
import { copyTree } from '../src/main/engine/copy'
import { ProgressTracker } from '../src/main/engine/progress'
import { applyRetention, cleanupLeftovers, selectForDeletion } from '../src/main/engine/retention'
import { sanitizeName } from '../src/main/engine/fsutil'
import type { JobSpec } from '../src/main/engine/types'
import { Scheduler, decideSlot, type SchedRoutine } from '../src/main/scheduler'
import { buildExport, planImport } from '../src/main/config-io'
import { checkOpenablePath } from '../src/main/ipc-validate'
import { JsonFile } from '../src/main/store'
import { Outbox } from '../src/main/mail/outbox'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import {
  inProgressMarker,
  makeInProgressDir,
  makeRoutine,
  makeSnapshotDir,
  manifest,
  tempDir,
  writeTree
} from './helpers'

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

/** A pasta escolhida pelo usuário: os backups ficam direto nela. */
const destDir = (dest = 'd1') => join(dir, dest)
const cleanupCtx = (routineId = 'rot-1') => ({
  routineId,
  runId: 'run-atual',
  hostname: 'pc-teste',
  now: new Date()
})

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
    expect(out).toBe(join(destDir(), backupStamp(start)))
    expect(result.destinations[0].pruned).toEqual([])
    expect((await stat(out)).isDirectory()).toBe(true)
  })

  it('backup "do futuro" (relógio errado) não faz o backup novo ser excluído pelo mínimo', () => {
    const now = new Date(2026, 9, 9, 0, 0, 10)
    const fresh = { name: 'novo', date: new Date(2026, 9, 8, 23, 59, 50) }
    const future = { name: 'futuro', date: new Date(2030, 0, 1, 3) }
    const del = selectForDeletion(
      [fresh, future],
      { enabled: true, days: 1, minKeep: 1 },
      now,
      (s) => s === fresh
    )
    expect(del).toEqual([])
  })
})

describe('backup sem nenhum arquivo copiado não conta como backup', () => {
  for (const mode of ['copy', 'zip'] as const) {
    it(`todos os arquivos em uso (${mode}) → destino falha e a retenção não apaga os antigos`, async () => {
      const rd = destDir()
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
      // Nenhum "backup" vazio finalizado (nem a pasta reservada sobrou).
      expect(left.filter((n) => n.startsWith(backupStamp(start).slice(0, 10)))).toEqual([])
      expect(left.sort()).toEqual([...old].sort())
    })
  }
})

describe('destino dentro da origem é recusado na execução (não só no editor)', () => {
  it('destino é subpasta da origem → falha sem criar nada dentro da origem', async () => {
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
    expect((await readdir(join(dir, 'origem'))).sort()).toEqual(['a.txt', 'sub'])
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

  it('origem dentro da pasta do destino (backup dos backups) → falha', async () => {
    const inDest = join(dir, 'd1', 'Pasta dentro do destino')
    await writeTree(inDest, { 'x.txt': '1' })
    const result = await run(
      routineWith({ sources: [{ id: 's', path: inDest, kind: 'folder' }] }),
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
    await cleanupLeftovers(dir, cleanupCtx())
    expect(await readdir(dir)).toContain(name)
  })

  it('".em-andamento" sem marcador (de quem?) nunca é apagado, por mais antigo que seja', async () => {
    const name = `${backupStamp(new Date(2026, 9, 1, 3))}.em-andamento`
    await makeInProgressDir(dir, name, null, 30 * 86_400_000)
    await cleanupLeftovers(dir, cleanupCtx())
    expect(await readdir(join(dir, name))).toContain('parcial.txt')
  })

  it('".em-andamento" completo desta rotina cujo nome final já existe não é apagado', async () => {
    const stamp = backupStamp(new Date(2026, 9, 1, 3))
    await makeSnapshotDir(dir, stamp)
    await makeSnapshotDir(dir, `${stamp}.em-andamento`, manifest({ snapshotId: 'outro-run' }))
    await cleanupLeftovers(dir, cleanupCtx())
    const left = await readdir(dir)
    expect(left).toContain(stamp)
    expect(left).toContain(`${stamp}.em-andamento`)
  })
})

describe('links/junções na pasta do destino nunca são seguidos na limpeza nem na retenção', () => {
  it('link com nome de sobra ou de backup antigo não é tocado (nem o alvo)', async () => {
    const rd = join(dir, 'rotina')
    await mkdir(rd)
    const alvo = join(dir, 'pasta-importante')
    await writeTree(alvo, { 'contrato.pdf': 'x' })
    // Alvo com manifesto desta rotina (ex.: o usuário "atalhou" um backup para outro disco).
    await writeFile(join(alvo, MANIFEST_FILE), JSON.stringify(manifest()))
    const inProgress = `${backupStamp(new Date(2026, 8, 1, 3))}.em-andamento`
    const oldSnap = backupStamp(new Date(2026, 8, 2, 3))
    await symlink(alvo, join(rd, inProgress), 'dir')
    await symlink(alvo, join(rd, oldSnap), 'dir')
    await cleanupLeftovers(rd, cleanupCtx())
    const pruned = await applyRetention(
      rd,
      'rot-1',
      { enabled: true, days: 1, minKeep: 0 },
      new Date(2026, 9, 8)
    )
    expect(pruned).toEqual([])
    expect((await readdir(rd)).sort()).toEqual([inProgress, oldSnap].sort())
    expect(await readFile(join(alvo, 'contrato.pdf'), 'utf8')).toBe('x')
  })
})

describe('importar configurações gera ids novos (outro PC nunca mexe nas cópias deste)', () => {
  it('mesmo sem colisão local, o id importado é novo', () => {
    const r = makeRoutine({ id: 'r1', name: 'Docs' })
    const file = buildExport(DEFAULT_SETTINGS, [r], '0.1.0')
    const plan = planImport(JSON.parse(JSON.stringify(file)), [])
    expect(plan.routines[0].id).not.toBe('r1')
    expect(plan.routines[0].name).toBe('Docs')
  })

  it('cenário: rotina exportada do PC A e importada no PC B, mesmo destino de rede → nada do A é tocado', async () => {
    const a = routineWith({ id: 'id-pc-a' })
    const [b] = planImport(
      JSON.parse(JSON.stringify(buildExport(DEFAULT_SETTINGS, [a], '0.1.0'))),
      []
    ).routines
    // O PC A está no meio de uma cópia neste destino (e tem uma reserva sem marcador ainda).
    const shared = destDir()
    const running = `${backupStamp(new Date(2026, 9, 8, 17, 59))}.em-andamento`
    await makeInProgressDir(shared, running, inProgressMarker({ routineId: a.id, hostname: 'pc-a' }))
    const reserving = `${backupStamp(new Date(2026, 9, 8, 17, 58))}.em-andamento`
    await makeInProgressDir(shared, reserving, null)
    // Backups antigos do A: a retenção do B não os enxerga.
    const oldA = backupStamp(new Date(2026, 8, 1, 3))
    await makeSnapshotDir(shared, oldA, manifest({ routineId: a.id }))
    const result = await run(
      { ...b, retention: { enabled: true, days: 1, minKeep: 0 } },
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 8, 18, 1)
    )
    expect(result.status).toBe('success')
    expect(result.destinations[0].pruned).toEqual([])
    const left = await readdir(shared)
    expect(left).toEqual(
      expect.arrayContaining([running, reserving, oldA, backupStamp(new Date(2026, 9, 8, 18))])
    )
    expect(await readdir(join(shared, running))).toContain('parcial.txt')
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
    // Nunca vira caminho: sem separadores, sem "." / ".." e sem ponto/espaço final.
    for (const n of ['..', '.', ' . . ', '../..', '..\\..\\Windows', 'C:\\x', '/etc/passwd', 'a/../../b'])
      expect(sanitizeName(n)).not.toMatch(/[\\/:]|^\.{1,2}$|[. ]$/)
    expect(sanitizeName('..')).toBe('Rotina')
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

describe('cópia: nomes que colidem no destino', () => {
  it('dois arquivos com o mesmo nome no destino (maiúsculas/minúsculas, NFC/NFD) → o 2º é pulado, o 1º fica intacto', async () => {
    await writeTree(join(dir, 'src'), { 'Foto.JPG': 'primeira', 'foto.jpg': 'segunda' })
    const out = join(dir, 'out')
    await mkdir(out)
    const st = await stat(join(dir, 'src', 'Foto.JPG'))
    // Simula um destino que não diferencia maiúsculas: os dois caem no mesmo caminho.
    const items = ['Foto.JPG', 'foto.jpg'].map((n) => ({
      abs: join(dir, 'src', n),
      rel: 'Fotos/foto.jpg',
      size: 8,
      mtime: st.mtime,
      atime: st.atime,
      ctime: st.ctime,
      mtimeMs: st.mtimeMs,
      ctimeMs: st.ctimeMs
    }))
    const tracker = new ProgressTracker(
      { runId: 'r', routineId: 'x', routineName: 'x', startedAt: '', destinationCount: 1 },
      () => {}
    )
    const res = await copyTree(items, out, tracker, new AbortController().signal, { hash: false })
    expect(res.copied.length).toBe(1)
    expect(res.skipped).toEqual([
      { path: join(dir, 'src', 'foto.jpg'), reason: expect.stringMatching(/mesmo nome/) }
    ])
    expect(await readFile(join(out, 'Fotos', 'foto.jpg'), 'utf8')).toBe('primeira')
  })

  it('origem marcada como "arquivo" que na verdade é uma pasta → copia a pasta normalmente', async () => {
    const result = await run(
      routineWith({ sources: [{ id: 's1', path: join(dir, 'origem'), kind: 'file' }] }),
      new Date(2026, 9, 8, 18),
      new Date(2026, 9, 8, 18, 1)
    )
    expect(result.status).toBe('success')
    expect(result.filesCopied).toBe(2)
    // Uma origem só: o conteúdo dela direto na pasta datada.
    const out = result.destinations[0].outputPath!
    expect(await readFile(join(out, 'sub', 'b.txt'), 'utf8')).toBe('mundo')
    expect(await readFile(join(out, 'a.txt'), 'utf8')).toBe('hello')
  })
})

describe('fila de e-mail com relógio corrigido para trás', () => {
  it('item gravado com o relógio adiantado é tentado de novo (e expira em 24 h), não fica parado', async () => {
    let now = new Date('2027-06-01T10:00:00Z') // relógio errado quando o envio falhou
    let online = false
    const sent: string[] = []
    const expired: string[] = []
    const ob = await Outbox.open({
      file: join(dir, 'outbox.json'),
      now: () => now,
      send: async () => {
        if (!online) throw Object.assign(new Error('offline'), { code: 'EDNS' })
      },
      onSent: (i) => {
        sent.push(i.runId)
      },
      onExpired: (i) => {
        expired.push(i.runId)
      },
      errorMessage: () => 'offline'
    })
    await ob.add('run-1', { to: ['a@b.com'], subject: 's', html: 'h', text: 't' }, 'offline')
    await ob.add('run-2', { to: ['a@b.com'], subject: 's', html: 'h', text: 't' }, 'offline')
    ob.stop()
    now = new Date('2026-10-04T10:00:00Z') // relógio corrigido
    online = true
    await ob.processDue()
    ob.stop()
    expect(sent).toEqual(['run-1', 'run-2'])
    expect(ob.items()).toEqual([])
    // Sem rede: a janela de 24 h recomeça a partir do relógio correto (não fica para sempre).
    online = false
    await ob.add('run-3', { to: ['a@b.com'], subject: 's', html: 'h', text: 't' }, 'offline')
    ob.stop()
    now = new Date('2025-01-01T00:00:00Z') // voltou de novo
    await ob.processDue()
    ob.stop()
    expect(ob.items()[0].attempts).toBe(2)
    now = new Date('2025-01-02T00:00:01Z')
    await ob.processDue()
    ob.stop()
    expect(expired).toEqual(['run-3'])
  })
})
