import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { backupStamp } from '@shared/format'
import { MANIFEST_FILE } from '@shared/defaults'
import {
  applyRetention,
  cleanupLeftovers,
  listSnapshots,
  retentionCutoff,
  selectForDeletion,
  uniqueStamp
} from '../src/main/engine/retention'
import { makeSnapshotDir, manifest, tempDir } from './helpers'

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

describe('retenção no disco', () => {
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

  it('limpeza de sobras: em andamento sem manifesto é apagada; com manifesto é finalizada', async () => {
    const crashed = `${snap(3).name}.em-andamento`
    const finished = `${snap(4).name}.em-andamento`
    await makeSnapshotDir(dir, crashed, null)
    await makeSnapshotDir(dir, finished, manifest())
    await writeFile(join(dir, `${snap(5).name}.zip.em-andamento`), 'parcial')
    await makeSnapshotDir(dir, `${snap(6).name}.excluindo`, manifest())
    await mkdir(join(dir, 'algo.em-andamento')) // não segue o padrão do carimbo → intocado
    await cleanupLeftovers(dir, 'rot-1')
    const left = (await readdir(dir)).sort()
    expect(left).toEqual(['algo.em-andamento', snap(4).name].sort())
    expect(await readdir(join(dir, snap(4).name))).toContain(MANIFEST_FILE)
  })

  it('uniqueStamp avança 1 s se o carimbo já existe', async () => {
    const start = new Date(2026, 9, 8, 10, 0, 0)
    await mkdir(join(dir, backupStamp(start)))
    expect(await uniqueStamp(dir, start)).toBe(backupStamp(new Date(2026, 9, 8, 10, 0, 1)))
  })
})
