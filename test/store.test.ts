import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_EXCLUDES, DEFAULT_SETTINGS } from '@shared/defaults'
import {
  AppStore,
  JsonFile,
  migrateConfig,
  migrateRoutine,
  migrateSettings,
  migrateState
} from '../src/main/store'
import { tempDir } from './helpers'

describe('migração (campos ausentes / legados)', () => {
  it('configurações vazias recebem os padrões', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('preenche só o que falta e corrige tipos errados', () => {
    const s = migrateSettings({
      theme: 'dark',
      historyDays: '30',
      closeToTray: 'sim',
      smtp: { host: 'smtp.x.com', port: 465 }
    })
    expect(s.theme).toBe('dark')
    expect(s.historyDays).toBe(30)
    expect(s.closeToTray).toBe(DEFAULT_SETTINGS.closeToTray)
    expect(s.smtp).toMatchObject({
      host: 'smtp.x.com',
      port: 465,
      security: 'starttls',
      timeoutSec: 30,
      fromName: 'BC Backup'
    })
  })

  it('preserva campos desconhecidos primitivos (versões futuras)', () => {
    const s = migrateSettings({ novoCampo: true }) as unknown as Record<string, unknown>
    expect(s.novoCampo).toBe(true)
  })

  it('rotina mínima vira rotina completa', () => {
    const r = migrateRoutine(
      { name: 'Docs', sources: ['C:\\Dados'], destinations: [{ path: 'E:\\' }] },
      new Date('2026-10-04T10:00:00Z')
    )
    expect(r.id).toMatch(/[0-9a-f-]{36}/)
    expect(r.enabled).toBe(true)
    expect(r.mode).toBe('copy')
    expect(r.zipLevel).toBe(6)
    expect(r.verify).toBe('full') // verificação sempre completa
    expect(r.sources[0]).toMatchObject({ path: 'C:\\Dados', kind: 'folder' })
    expect(r.sources[0].id).toBeTruthy()
    expect(r.destinations[0]).toMatchObject({ path: 'E:\\', enabled: true })
    expect(r.filters.exclude).toEqual(DEFAULT_EXCLUDES)
    expect(r.schedule).toMatchObject({ kind: 'daily', times: ['18:00'], catchUpMissed: true })
    expect(r.retention).toEqual({ enabled: true, days: 7, minKeep: 3 })
    expect(r.notification).toMatchObject({ enabled: false, recipients: [], attachLog: 'onFailure' })
    expect(r.createdAt).toBe('2026-10-04T10:00:00.000Z')
  })

  it('converte o formato legado do doc 01 (type, keepDays, to, mode folder)', () => {
    const r = migrateRoutine({
      id: 'x',
      name: 'Legado',
      mode: 'folder',
      schedule: {
        type: 'interval',
        intervalMinutes: 120,
        window: { start: '08:00', end: '18:00' },
        weekdays: [1, 2, 9]
      },
      retention: { keepDays: 0, minKeep: 2 },
      notification: { enabled: true, to: ['a@b.com'] }
    })
    expect(r.mode).toBe('copy')
    expect(r.schedule).toMatchObject({
      kind: 'interval',
      intervalMinutes: 120,
      weekdays: [1, 2],
      window: { start: '08:00', end: '18:00' }
    })
    expect(r.retention.enabled).toBe(false)
    expect(r.notification.recipients).toEqual(['a@b.com'])
  })

  it('config: ids repetidos são trocados, senha vira hasPassword', () => {
    const c = migrateConfig({
      routines: [{ id: 'a', name: '1' }, { id: 'a', name: '2' }, 'lixo'],
      secrets: { smtpPassword: 'a1:xx' }
    })
    expect(c.routines.length).toBe(2)
    expect(new Set(c.routines.map((r) => r.id)).size).toBe(2)
    expect(c.settings.smtp.hasPassword).toBe(true)
    expect(c.schemaVersion).toBe(1)
  })

  it('estado: valores inválidos descartados', () => {
    const s = migrateState({
      routines: { a: { lastAttemptSlot: 5 }, b: 'x' },
      window: { width: 50, height: 900, x: 10, y: 20 }
    })
    expect(s.routines).toEqual({ a: { lastAttemptSlot: null, lastRunAt: null } })
    expect(s.window).toEqual({ width: 400, height: 900, maximized: false, x: 10, y: 20 })
  })
})

describe('JsonFile / AppStore no disco', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-store-'))
  })
  afterEach(() => cleanup())

  it('gravações em rajada são serializadas e atômicas', async () => {
    const f = join(dir, 'x.json')
    const jf = await JsonFile.load(f, (raw) => (raw as { n: number; list: number[] }) ?? { n: 0, list: [] })
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        jf.data.n++
        jf.data.list.push(i)
        return jf.save()
      })
    )
    await jf.flush()
    const disk = JSON.parse(await readFile(f, 'utf8'))
    expect(disk.n).toBe(50)
    expect(disk.list.length).toBe(50)
    expect((await readdir(dir)).filter((x) => x.endsWith('.tmp'))).toEqual([])
  })

  it('arquivo corrompido é preservado e o .bak da sessão anterior é usado', async () => {
    const s1 = await AppStore.open(dir)
    await s1.upsertRoutine(migrateRoutine({ id: 'r1', name: 'Rotina 1' }))
    await s1.flush()
    // Próxima sessão cria o .bak a partir do config válido.
    const s2 = await AppStore.open(dir)
    expect(s2.routines().map((r) => r.id)).toEqual(['r1'])
    await writeFile(join(dir, 'config.json'), '{corrompido')
    const s3 = await AppStore.open(dir)
    expect(s3.routines().map((r) => r.id)).toEqual(['r1'])
    expect((await readdir(dir)).some((n) => n.startsWith('config.json.corrupt-'))).toBe(true)
  })

  it('config antigo sem campos novos carrega com padrões; settings/estado persistem', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ settings: { theme: 'light' }, routines: [{ id: 'r', name: 'Antiga' }] })
    )
    const s = await AppStore.open(dir)
    expect(s.settings.theme).toBe('light')
    expect(s.settings.historyDays).toBe(180)
    expect(s.getRoutine('r')?.schedule.kind).toBe('daily')
    await s.updateSettings({ clientName: 'Padaria' })
    s.setRoutineState('r', { lastAttemptSlot: '2026-10-04T10:00:00.000Z' })
    await s.setSmtpPassword('a1:segredo')
    await s.flush()
    const again = await AppStore.open(dir)
    expect(again.settings.clientName).toBe('Padaria')
    expect(again.settings.smtp.hasPassword).toBe(true)
    expect(again.routineState('r').lastAttemptSlot).toBe('2026-10-04T10:00:00.000Z')
    expect(await again.removeRoutine('r')).toBe(true)
    expect(again.routineState('r').lastAttemptSlot).toBeNull()
  })
})
