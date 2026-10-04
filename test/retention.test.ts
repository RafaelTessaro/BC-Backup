import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupStamp } from '@shared/format'
import {
  IN_PROGRESS_MARKER_FILE,
  LEGACY_ROOT_DIR,
  MANIFEST_FILE,
  ROUTINE_MARKER_FILE
} from '@shared/defaults'
import {
  applyRetention,
  cleanupLeftovers,
  deleteSnapshot,
  listSnapshots,
  retentionCutoff,
  selectForDeletion,
  type CleanupContext
} from '../src/main/engine/retention'
import { claimOutput, legacyRoutineDirs, parseSnapshotName } from '../src/main/engine/layout'
import {
  inProgressMarker,
  makeInProgressDir,
  makeLegacyRoutineDir,
  makeSnapshotDir,
  manifest,
  tempDir
} from './helpers'

const policy = { enabled: true, days: 7, minKeep: 3 }
const snap = (day: number, hour = 3, month = 10) => {
  const date = new Date(2026, month - 1, day, hour, 0, 0)
  return { name: backupStamp(date), date }
}
const names = (xs: Array<{ name: string }>) => xs.map((x) => x.name)

describe('selectForDeletion — tabela do doc 01 §6 (dias=7, mínimo=3)', () => {
  it('corte por dia de calendário: dias=7 no dia 08 → mantém 02..08', () => {
    expect(retentionCutoff(7, new Date(2026, 9, 8, 15))).toEqual(new Date(2026, 9, 2, 0, 0, 0))
  })

  it('diário, dia 08 (d01–d08): exclui d01, mantém d02–d08', () => {
    const all = Array.from({ length: 8 }, (_, i) => snap(i + 1))
    const del = selectForDeletion(all, policy, new Date(2026, 9, 8, 12))
    expect(names(del)).toEqual([snap(1).name])
  })

  it('2× ao dia: mantém os 14 dos últimos 7 dias e exclui os 2 de d01', () => {
    const all = Array.from({ length: 8 }, (_, i) => [snap(i + 1, 9), snap(i + 1, 18)]).flat()
    const del = selectForDeletion(all, policy, new Date(2026, 9, 8, 20))
    expect(names(del)).toEqual([snap(1, 9).name, snap(1, 18).name])
    expect(all.length - del.length).toBe(14)
  })

  it('PC desligado de d12 a d21, backup em d22: mantém d22 + d10 e d11; exclui d05–d09', () => {
    const all = [...Array.from({ length: 7 }, (_, i) => snap(i + 5)), snap(22)] // d05..d11 + d22
    const del = selectForDeletion(all, policy, new Date(2026, 9, 22, 12))
    expect(names(del)).toEqual([5, 6, 7, 8, 9].map((d) => snap(d).name)) // do mais antigo ao mais novo
  })

  it('sem o mínimo, sobraria só 1', () => {
    const all = [...Array.from({ length: 7 }, (_, i) => snap(i + 5)), snap(22)]
    const del = selectForDeletion(all, { ...policy, minKeep: 0 }, new Date(2026, 9, 22, 12))
    expect(all.length - del.length).toBe(1)
  })

  it('retenção desligada ou dias inválidos → nada é excluído', () => {
    const all = [snap(1), snap(2)]
    expect(selectForDeletion(all, { ...policy, enabled: false }, new Date(2026, 9, 30))).toEqual([])
    expect(selectForDeletion(all, { ...policy, days: 0 }, new Date(2026, 9, 30))).toEqual([])
  })

  it('mínimo maior que a quantidade → nada é excluído', () => {
    const all = [snap(1), snap(2)]
    expect(selectForDeletion(all, { enabled: true, days: 1, minKeep: 5 }, new Date(2026, 9, 30))).toEqual([])
  })
})

describe('retenção no disco (pasta do destino compartilhada)', () => {
  let dir: string
  let cleanup: () => Promise<void>
  const now = new Date(2026, 9, 8, 12)
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-ret-'))
  })
  afterEach(() => cleanup())

  it('só apaga backups com manifesto válido desta rotina; renomeia e registra os caminhos', async () => {
    for (let d = 1; d <= 8; d++) await makeSnapshotDir(dir, snap(d).name)
    // Mais velhos, mas SEM manifesto ou de OUTRA rotina: nunca podem ser apagados.
    await makeSnapshotDir(dir, backupStamp(new Date(2026, 8, 1, 3)), null)
    await makeSnapshotDir(dir, backupStamp(new Date(2026, 8, 2, 3)), manifest({ routineId: 'outra' }))
    // Pasta do usuário com nome qualquer.
    await mkdir(join(dir, 'Minhas fotos'))
    // Manifesto inválido (status em andamento)
    await makeSnapshotDir(dir, backupStamp(new Date(2026, 8, 3, 3)), {
      ...manifest(),
      status: 'running' as never
    })

    const logs: string[] = []
    const pruned = await applyRetention(dir, 'rot-1', policy, now, (_l, m) => logs.push(m))
    expect(pruned).toEqual([join(dir, snap(1).name)])
    const left = (await readdir(dir)).sort()
    expect(left).toContain(backupStamp(new Date(2026, 8, 1, 3)))
    expect(left).toContain(backupStamp(new Date(2026, 8, 2, 3)))
    expect(left).toContain(backupStamp(new Date(2026, 8, 3, 3)))
    expect(left).toContain('Minhas fotos')
    expect(left).not.toContain(snap(1).name)
    expect(left.some((n) => n.endsWith('.excluindo'))).toBe(false)
    expect(logs.join(' ')).toMatch(/Retenção/)
  })

  it('duas rotinas na mesma pasta: cada uma só vê (e só apaga) os próprios backups', async () => {
    // Rotina A (rot-1) e rotina B (rot-2) gravam na mesma pasta, inclusive no mesmo segundo ("_2").
    for (let d = 1; d <= 8; d++) {
      await makeSnapshotDir(dir, snap(d).name, manifest({ routineId: 'rot-1' }))
      await makeSnapshotDir(dir, `${snap(d).name}_2`, manifest({ routineId: 'rot-2' }))
    }
    await writeFile(join(dir, 'planilha do usuário.xlsx'), 'não mexa')
    const prunedA = await applyRetention(dir, 'rot-1', { enabled: true, days: 3, minKeep: 1 }, now)
    expect(prunedA.sort()).toEqual([1, 2, 3, 4, 5].map((d) => join(dir, snap(d).name)).sort())
    // Os backups de B continuam todos lá.
    expect((await listSnapshots(dir, 'rot-2')).length).toBe(8)
    // B com retenção maior não apaga nada de A.
    const prunedB = await applyRetention(dir, 'rot-2', { enabled: true, days: 6, minKeep: 1 }, now)
    expect(prunedB.sort()).toEqual([1, 2].map((d) => join(dir, `${snap(d).name}_2`)).sort())
    expect((await listSnapshots(dir, 'rot-1')).map((s) => s.name)).toEqual([8, 7, 6].map((d) => snap(d).name))
    expect(await readFile(join(dir, 'planilha do usuário.xlsx'), 'utf8')).toBe('não mexa')
  })

  it('nomes com sufixo "_N" contam como backup e desempatam no mesmo segundo', async () => {
    await makeSnapshotDir(dir, snap(1).name)
    await makeSnapshotDir(dir, `${snap(1).name}_2`)
    await makeSnapshotDir(dir, `${snap(1).name}_10`)
    await makeSnapshotDir(dir, `${snap(1).name}_x`) // não é nome de backup
    expect((await listSnapshots(dir, 'rot-1')).map((s) => s.name)).toEqual([
      `${snap(1).name}_10`,
      `${snap(1).name}_2`,
      snap(1).name
    ])
    expect(parseSnapshotName(`${snap(1).name}_2`)).toEqual({ date: snap(1).date, seq: 2 })
    expect(parseSnapshotName('2026-02-31_10-00-00')).toBeNull()
    expect(parseSnapshotName(`${snap(1).name}_0`)).toBeNull()
  })

  it('ZIPs: usa o manifesto ao lado e apaga zip + manifesto', async () => {
    for (const d of [1, 8]) {
      const name = `${snap(d).name}.zip`
      await writeFile(join(dir, name), 'zip')
      await writeFile(join(dir, `${name}.manifesto.json`), JSON.stringify(manifest({ mode: 'zip' })))
    }
    await writeFile(join(dir, `${snap(2).name}.zip`), 'zip sem manifesto')
    const pruned = await applyRetention(dir, 'rot-1', { enabled: true, days: 3, minKeep: 1 }, now)
    expect(pruned).toEqual([join(dir, `${snap(1).name}.zip`)])
    const left = await readdir(dir)
    expect(left).not.toContain(`${snap(1).name}.zip.manifesto.json`)
    expect(left).toContain(`${snap(2).name}.zip`)
    expect((await listSnapshots(dir, 'rot-1')).map((s) => s.name)).toEqual([`${snap(8).name}.zip`])
  })

  it('links nunca contam como backup, mesmo com nome e manifesto certos', async () => {
    const alvo = await makeSnapshotDir(join(dir, 'fora'), 'qualquer')
    await symlink(alvo, join(dir, snap(1).name), 'dir')
    expect(await listSnapshots(dir, 'rot-1')).toEqual([])
    expect(await applyRetention(dir, 'rot-1', { enabled: true, days: 1, minKeep: 0 }, now)).toEqual([])
    expect(await readFile(join(alvo, MANIFEST_FILE), 'utf8')).toBeTruthy()
  })

  it('protege o backup desta execução por caminho e por id (2 destinos que são a mesma pasta)', async () => {
    await makeSnapshotDir(dir, snap(1).name, manifest({ snapshotId: 'run-atual' }))
    await makeSnapshotDir(dir, `${snap(1).name}_2`, manifest({ snapshotId: 'run-atual' }))
    await makeSnapshotDir(dir, snap(2).name, manifest({ snapshotId: 'run-velho' }))
    const pruned = await applyRetention(
      dir,
      'rot-1',
      { enabled: true, days: 1, minKeep: 0 },
      now,
      undefined,
      {
        protect: [join(dir, `${snap(1).name}_2`)],
        protectSnapshotId: 'run-atual'
      }
    )
    expect(pruned).toEqual([join(dir, snap(2).name)])
  })

  it('exclusão de pasta: o manifesto é a última coisa a sair', async () => {
    const p = await makeSnapshotDir(dir, snap(1).name)
    await writeFile(join(p, 'b.txt'), 'b')
    const [s] = await listSnapshots(dir, 'rot-1')
    await deleteSnapshot(s)
    expect(await readdir(dir)).toEqual([])
  })
})

describe('backups LEGADOS ("<destino>/BC Backup/<rotina>")', () => {
  let dir: string
  let cleanup: () => Promise<void>
  const now = new Date(2026, 9, 8, 12)
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-legacy-'))
  })
  afterEach(() => cleanup())

  it('acha só as pastas legadas com o marcador desta rotina (sem seguir links)', async () => {
    const mine = await makeLegacyRoutineDir(dir, 'Financeiro diário', 'rot-1')
    await makeLegacyRoutineDir(dir, 'Outra rotina', 'rot-2')
    await mkdir(join(dir, LEGACY_ROOT_DIR, 'Sem marcador'))
    const elsewhere = await makeLegacyRoutineDir(join(dir, 'fora'), 'Financeiro diário', 'rot-1')
    await symlink(elsewhere, join(dir, LEGACY_ROOT_DIR, 'Atalho'), 'dir')
    expect(await legacyRoutineDirs(dir, 'rot-1')).toEqual([mine])
    // Destino escolhido = a própria pasta "BC Backup": as subpastas dela também contam.
    expect(await legacyRoutineDirs(join(dir, LEGACY_ROOT_DIR), 'rot-1')).toEqual([mine])
    expect(await legacyRoutineDirs(join(dir, 'nao-existe'), 'rot-1')).toEqual([])
  })

  it('backups antigos da estrutura antiga saem no prazo junto com os novos; as pastas legadas ficam', async () => {
    const legacy = await makeLegacyRoutineDir(dir)
    for (const d of [1, 2, 3]) await makeSnapshotDir(legacy, snap(d).name)
    await makeSnapshotDir(legacy, snap(4).name, manifest({ routineId: 'outra' }))
    for (const d of [7, 8]) await makeSnapshotDir(dir, snap(d).name)
    const pruned = await applyRetention(
      dir,
      'rot-1',
      { enabled: true, days: 3, minKeep: 3 },
      now,
      undefined,
      {
        extraDirs: await legacyRoutineDirs(dir, 'rot-1')
      }
    )
    // Mantém d07, d08 (janela) + d03 (mínimo 3); apaga d01 e d02 da pasta legada.
    expect(pruned).toEqual([join(legacy, snap(1).name), join(legacy, snap(2).name)])
    expect((await readdir(legacy)).sort()).toEqual([ROUTINE_MARKER_FILE, snap(3).name, snap(4).name].sort())
    // Mesmo quando todos os backups legados saem, a pasta legada não é apagada.
    await applyRetention(dir, 'rot-1', { enabled: true, days: 1, minKeep: 0 }, now, undefined, {
      extraDirs: [legacy]
    })
    expect((await stat(legacy)).isDirectory()).toBe(true)
    expect(await readdir(legacy)).toContain(snap(4).name)
  })
})

describe('limpeza de sobras numa pasta compartilhada', () => {
  let dir: string
  let cleanup: () => Promise<void>
  const H = 3600_000
  const ctx = (patch: Partial<CleanupContext> = {}): CleanupContext => ({
    routineId: 'rot-1',
    runId: 'run-atual',
    hostname: 'pc-teste',
    now: new Date(),
    ...patch
  })
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-clean-'))
  })
  afterEach(() => cleanup())

  it('sobra desta rotina neste computador (execução que caiu) é apagada', async () => {
    const name = `${snap(3).name}.em-andamento`
    await makeInProgressDir(dir, name, inProgressMarker())
    const zipWork = `${snap(3).name}_2.em-andamento`
    await makeInProgressDir(dir, zipWork, inProgressMarker({ hostname: 'PC-TESTE' }))
    await writeFile(join(dir, zipWork, `${snap(3).name}_2.zip`), 'zip parcial')
    const logs: string[] = []
    await cleanupLeftovers(dir, ctx(), (_l, m) => logs.push(m))
    expect(await readdir(dir)).toEqual([])
    expect(logs.filter((m) => /Removida a sobra/.test(m))).toHaveLength(2)
  })

  it('cópia em andamento de OUTRA rotina nunca é tocada', async () => {
    const name = `${snap(3).name}.em-andamento`
    await makeInProgressDir(dir, name, inProgressMarker({ routineId: 'rot-2' }), 48 * H)
    await cleanupLeftovers(dir, ctx())
    expect(await readdir(join(dir, name))).toContain('parcial.txt')
  })

  it('cópia em andamento de OUTRO computador (mesma rotina) só sai depois de 12 h parada', async () => {
    const fresh = `${snap(3).name}.em-andamento`
    const old = `${snap(2).name}.em-andamento`
    await makeInProgressDir(dir, fresh, inProgressMarker({ hostname: 'outro-pc' }), 1 * H)
    await makeInProgressDir(
      dir,
      old,
      inProgressMarker({ hostname: 'outro-pc', startedAt: new Date(Date.now() - 13 * H).toISOString() }),
      13 * H
    )
    const logs: string[] = []
    await cleanupLeftovers(dir, ctx(), (_l, m) => logs.push(m))
    expect(await readdir(dir)).toEqual([fresh])
    expect(await readdir(join(dir, fresh))).toContain('parcial.txt')
    expect(logs.some((m) => /de outro computador \(outro-pc\) deixada como está/.test(m))).toBe(true)
  })

  it('a execução atual nunca apaga a própria cópia', async () => {
    const name = `${snap(3).name}.em-andamento`
    await makeInProgressDir(dir, name, inProgressMarker({ runId: 'run-atual' }), 48 * H)
    await cleanupLeftovers(dir, ctx())
    expect(await readdir(dir)).toEqual([name])
  })

  it('sem marcador nunca é apagada (só registra); reserva VAZIA e parada há 12 h sai com rmdir', async () => {
    const unknown = `${snap(3).name}.em-andamento`
    await makeInProgressDir(dir, unknown, null, 48 * H)
    const emptyOld = `${snap(4).name}.em-andamento`
    const emptyFresh = `${snap(5).name}.em-andamento`
    await mkdir(join(dir, emptyOld))
    await mkdir(join(dir, emptyFresh))
    await utimes(join(dir, emptyOld), new Date(Date.now() - 13 * H), new Date(Date.now() - 13 * H))
    const logs: string[] = []
    await cleanupLeftovers(dir, ctx(), (_l, m) => logs.push(m))
    expect((await readdir(dir)).sort()).toEqual([unknown, emptyFresh].sort())
    expect(logs.some((m) => m.includes(`sem identificação deixada como está: ${unknown}`))).toBe(true)
  })

  it('marcador ilegível agora (antivírus/rede) → não mexe', async () => {
    const name = `${snap(3).name}.em-andamento`
    const p = await makeInProgressDir(dir, name, null, 48 * H)
    await writeFile(join(p, IN_PROGRESS_MARKER_FILE), '{ corrompido')
    await cleanupLeftovers(dir, ctx())
    expect(await readdir(dir)).toEqual([name])
  })

  it('backup completo desta rotina sem o nome final é finalizado (e o marcador sai)', async () => {
    const p = await makeInProgressDir(dir, `${snap(4).name}.em-andamento`, inProgressMarker())
    await writeFile(join(p, MANIFEST_FILE), JSON.stringify(manifest({ hostname: 'pc-teste' })))
    // De outro computador e recente: fica como está.
    const other = await makeInProgressDir(dir, `${snap(5).name}.em-andamento`, null)
    await writeFile(join(other, MANIFEST_FILE), JSON.stringify(manifest({ hostname: 'outro-pc' })))
    await cleanupLeftovers(dir, ctx())
    const left = (await readdir(dir)).sort()
    expect(left).toEqual([snap(4).name, `${snap(5).name}.em-andamento`].sort())
    expect((await readdir(join(dir, snap(4).name))).sort()).toEqual([MANIFEST_FILE, 'parcial.txt'].sort())
  })

  it('exclusões interrompidas: só as desta rotina terminam; manifesto órfão desta rotina sai', async () => {
    await makeSnapshotDir(dir, `${snap(6).name}.excluindo`, manifest())
    await makeSnapshotDir(dir, `${snap(7).name}.excluindo`, manifest({ routineId: 'rot-2' }))
    await mkdir(join(dir, `${snap(8).name}.excluindo`)) // vazia: sobra inofensiva
    // ZIP sendo excluído (o manifesto ao lado ainda identifica) e manifestos órfãos.
    await writeFile(join(dir, `${snap(1).name}.zip.excluindo`), 'zip')
    await writeFile(join(dir, `${snap(1).name}.zip.manifesto.json`), JSON.stringify(manifest()))
    await writeFile(join(dir, `${snap(2).name}.zip.manifesto.json`), JSON.stringify(manifest()))
    await writeFile(
      join(dir, `${snap(3).name}.zip.manifesto.json`),
      JSON.stringify(manifest({ routineId: 'rot-2' }))
    )
    await mkdir(join(dir, 'algo.em-andamento')) // não segue o padrão do carimbo → intocado
    await cleanupLeftovers(dir, ctx())
    expect((await readdir(dir)).sort()).toEqual(
      ['algo.em-andamento', `${snap(7).name}.excluindo`, `${snap(3).name}.zip.manifesto.json`].sort()
    )
  })

  it('pasta legada desta rotina: sobra sem marcador (versão anterior) só sai depois de 12 h parada', async () => {
    const legacy = await makeLegacyRoutineDir(dir)
    const old = `${snap(3).name}.em-andamento`
    const fresh = `${snap(4).name}.em-andamento`
    await makeInProgressDir(legacy, old, null, 13 * H)
    await makeInProgressDir(legacy, fresh, null)
    const oldZip = join(legacy, `${snap(5).name}.zip.em-andamento`)
    await writeFile(oldZip, 'parcial')
    await utimes(oldZip, new Date(Date.now() - 13 * H), new Date(Date.now() - 13 * H))
    await cleanupLeftovers(legacy, ctx({ legacy: true }))
    expect((await readdir(legacy)).sort()).toEqual([ROUTINE_MARKER_FILE, fresh].sort())
  })
})

describe('reserva do nome do backup (mkdir atômico, "_2", "_3"…)', () => {
  let dir: string
  let cleanup: () => Promise<void>
  const stamp = backupStamp(new Date(2026, 9, 8, 10, 0, 0))
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-claim-'))
  })
  afterEach(() => cleanup())

  it('nome livre: "<carimbo>.em-andamento" com o marcador gravado primeiro', async () => {
    const c = await claimOutput(dir, stamp, 'copy', inProgressMarker({ runId: 'r1' }))
    expect(c).toEqual({
      name: stamp,
      finalPath: join(dir, stamp),
      workDir: join(dir, `${stamp}.em-andamento`)
    })
    expect(await readdir(c.workDir)).toEqual([IN_PROGRESS_MARKER_FILE])
    const m = JSON.parse(await readFile(join(c.workDir, IN_PROGRESS_MARKER_FILE), 'utf8'))
    expect(m).toMatchObject({ format: 'bcbackup-em-andamento', routineId: 'rot-1', runId: 'r1' })
    const z = await claimOutput(dir, backupStamp(new Date(2026, 9, 8, 11)), 'zip', inProgressMarker())
    expect(z.finalPath).toBe(join(dir, `${z.name}.zip`))
    expect(z.workDir).toBe(join(dir, `${z.name}.em-andamento`))
    expect(z.workZip).toBe(join(z.workDir, `${z.name}.zip`))
  })

  it('nunca reaproveita um nome ocupado (pasta, ZIP, em andamento, de qualquer rotina ou arquivo)', async () => {
    await mkdir(join(dir, stamp)) // backup de outra rotina neste segundo
    await writeFile(join(dir, `${stamp}_2.zip`), 'zip de outro PC')
    await mkdir(join(dir, `${stamp}_3.em-andamento`)) // outro PC copiando agora
    await writeFile(join(dir, `${stamp}_4`), 'arquivo do usuário com esse nome')
    const c = await claimOutput(dir, stamp, 'copy', inProgressMarker())
    expect(c.name).toBe(`${stamp}_5`)
    expect(await readFile(join(dir, `${stamp}_4`), 'utf8')).toBe('arquivo do usuário com esse nome')
  })

  it('execuções simultâneas na mesma pasta recebem nomes diferentes', async () => {
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, k) =>
        claimOutput(dir, stamp, k % 2 ? 'zip' : 'copy', inProgressMarker({ runId: `r${k}` }))
      )
    )
    const names = claims.map((c) => c.name)
    expect(new Set(names).size).toBe(8)
    for (const c of claims) {
      const m = JSON.parse(await readFile(join(c.workDir, IN_PROGRESS_MARKER_FILE), 'utf8'))
      expect(claims.find((x) => x.workDir === c.workDir)).toBe(c)
      expect(m.runId).toMatch(/^r\d$/)
    }
  })

  it('destino sem permissão/indisponível → erro do destino (nada criado)', async () => {
    await expect(
      claimOutput(join(dir, 'nao-existe', 'x'), stamp, 'copy', inProgressMarker())
    ).rejects.toThrow(/Destino indisponível/)
  })
})
