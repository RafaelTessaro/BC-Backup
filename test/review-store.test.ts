// Revisão (QA #3): config.json corrompido recuperado do .bak precisa sobreviver ao próximo início.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppStore, migrateRoutine } from '../src/main/store'
import { tempDir } from './helpers'

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-review-store-'))
})
afterEach(() => cleanup())

describe('config.json corrompido', () => {
  it('a recuperação pelo .bak é gravada: o início seguinte (sem nenhuma alteração) não perde as rotinas', async () => {
    const s1 = await AppStore.open(dir)
    await s1.upsertRoutine(migrateRoutine({ id: 'r1', name: 'Rotina 1' }))
    await s1.flush()
    await AppStore.open(dir) // cria o .bak a partir do config válido
    await writeFile(join(dir, 'config.json'), '{corrompido')

    const s3 = await AppStore.open(dir)
    expect(s3.routines().map((r) => r.id)).toEqual(['r1'])
    // Sessão sem nenhuma gravação no config (só backups agendados rodando) e o app fecha.
    await s3.flush()

    const s4 = await AppStore.open(dir)
    expect(s4.routines().map((r) => r.id)).toEqual(['r1'])
    expect(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).routines[0].id).toBe('r1')
  })
})

describe('falha ao gravar o config.json (disco cheio, arquivo bloqueado)', () => {
  it('o erro chega ao usuário em pt-BR, dizendo que a alteração ainda não foi gravada', async () => {
    const store = await AppStore.open(dir)
    // config.json virou uma pasta: o rename do temporário falha (como um disco cheio/bloqueado).
    await mkdir(join(dir, 'config.json'))
    const err = await store
      .upsertRoutine(migrateRoutine({ id: 'r1', name: 'Rotina 1' }))
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/^Não foi possível gravar as configurações/)
  })
})

describe('config.json ausente com .bak (corrompido numa sessão anterior que não chegou a gravar)', () => {
  it('as rotinas voltam do .bak', async () => {
    const s1 = await AppStore.open(dir)
    await s1.upsertRoutine(migrateRoutine({ id: 'r1', name: 'Rotina 1' }))
    await s1.flush()
    await AppStore.open(dir) // cria o .bak
    await rm(join(dir, 'config.json'))
    const s2 = await AppStore.open(dir)
    expect(s2.routines().map((r) => r.id)).toEqual(['r1'])
  })

  it('instalação nova (sem config nem .bak) continua vazia', async () => {
    const s = await AppStore.open(dir)
    expect(s.routines()).toEqual([])
  })
})
