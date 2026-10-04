import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoutineInput } from '@shared/api'
import { createDefaultRoutine } from '@shared/defaults'
import {
  isInside,
  isValidEmail,
  normalizeForCompare,
  validateRoutine,
  volumeRoot
} from '../src/main/validate'
import { buildExport, planImport } from '../src/main/config-io'
import {
  asRoutineForValidation,
  asSettingsPatch,
  asSmtpInput,
  asHistoryQuery
} from '../src/main/ipc-validate'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { makeRoutine, tempDir } from './helpers'

function input(patch: Partial<RoutineInput> = {}): RoutineInput {
  return { ...createDefaultRoutine(), name: 'Docs', ...patch }
}
const msgs = (xs: Array<{ message: string }>) => xs.map((x) => x.message)

describe('comparação de caminhos', () => {
  it('Windows ignora maiúsculas e barras finais', () => {
    expect(normalizeForCompare('C:\\Dados\\', 'win32')).toBe('c:\\dados')
    expect(isInside('c:\\dados\\backup', 'C:\\DADOS', 'win32')).toBe(true)
    expect(isInside('C:\\Dados2', 'C:\\Dados', 'win32')).toBe(false)
    expect(isInside('E:\\', 'E:\\', 'win32')).toBe(true)
    expect(volumeRoot('E:\\x\\y', 'win32')).toBe('e:\\')
    expect(volumeRoot('\\\\SERVIDOR\\backup\\x', 'win32')).toBe('\\\\servidor\\backup\\')
  })
  it('Linux diferencia maiúsculas', () => {
    expect(isInside('/home/a/Docs/x', '/home/a/docs', 'linux')).toBe(false)
    expect(isInside('/home/a/docs/x', '/home/a/docs', 'linux')).toBe(true)
  })
  it('e-mails', () => {
    expect(isValidEmail('joao@cliente.com.br')).toBe(true)
    expect(isValidEmail('joao@cliente')).toBe(false)
    expect(isValidEmail('joao cliente@x.com')).toBe(false)
  })
})

describe('validateRoutine (sem disco, Windows)', () => {
  const ctx = {
    existing: [{ id: 'outra', name: 'Financeiro' }],
    smtpConfigured: false,
    platform: 'win32' as const,
    checkFs: false
  }

  it('sem origens/destinos e nome vazio → erros', async () => {
    const issues = await validateRoutine(input({ name: ' ' }), ctx)
    expect(
      issues
        .filter((i) => i.level === 'error')
        .map((i) => i.step)
        .sort()
    ).toEqual(['destinos', 'origem', 'origem'])
  })

  it('nome repetido (sem diferenciar maiúsculas) → erro; a própria rotina pode manter o nome', async () => {
    const base = input({
      sources: [{ id: 's', path: 'C:\\Dados', kind: 'folder' }],
      destinations: [{ id: 'd', path: 'E:\\' }]
    })
    expect(msgs(await validateRoutine({ ...base, name: 'financeiro' }, ctx))).toContain(
      'Já existe uma rotina chamada "financeiro". Escolha outro nome.'
    )
    expect(
      msgs(await validateRoutine({ ...base, id: 'outra', name: 'Financeiro' }, ctx)).some((m) =>
        m.startsWith('Já existe')
      )
    ).toBe(false)
  })

  it('destino dentro da origem (e vice-versa) → erro', async () => {
    const a = await validateRoutine(
      input({
        sources: [{ id: 's', path: 'C:\\Dados', kind: 'folder' }],
        destinations: [{ id: 'd', path: 'c:\\dados\\Backup' }]
      }),
      ctx
    )
    const inside = a.find((i) => i.step === 'destinos' && i.level === 'error')
    expect(inside?.message).toBe(
      'O destino c:\\dados\\Backup fica dentro da origem C:\\Dados. Escolha outra pasta.'
    )
    expect(inside?.destinationId).toBe('d')
    const b = await validateRoutine(
      input({
        sources: [{ id: 's', path: 'E:\\BC\\Docs', kind: 'folder' }],
        destinations: [{ id: 'd', path: 'E:\\' }]
      }),
      ctx
    )
    expect(b.find((i) => i.destinationId === 'd')?.message).toBe(
      'O destino E:\\ contém a origem E:\\BC\\Docs. Escolha outra pasta.'
    )
  })

  it('e-mails só são validados com o aviso ligado (campos ocultos não bloqueiam o salvamento)', async () => {
    const base = {
      sources: [{ id: 's', path: 'C:\\Dados', kind: 'folder' as const }],
      destinations: [{ id: 'd', path: 'E:\\' }]
    }
    const off = await validateRoutine(
      input({
        ...base,
        notification: { ...createDefaultRoutine().notification, enabled: false, recipients: ['x@y'] }
      }),
      ctx
    )
    expect(msgs(off)).not.toContain('E-mail inválido: x@y')
    const on = await validateRoutine(
      input({
        ...base,
        notification: { ...createDefaultRoutine().notification, enabled: true, recipients: ['x@y'] }
      }),
      ctx
    )
    expect(msgs(on)).toContain('E-mail inválido: x@y')
  })

  it('agenda, retenção e notificação', async () => {
    const issues = await validateRoutine(
      input({
        sources: [{ id: 's', path: 'C:\\Dados', kind: 'folder' }],
        destinations: [{ id: 'd', path: 'E:\\' }],
        schedule: { ...createDefaultRoutine().schedule, kind: 'weekly', weekdays: [], times: ['25:00'] },
        retention: { enabled: true, days: 0, minKeep: 0 },
        notification: { ...createDefaultRoutine().notification, enabled: true, recipients: ['x@y'] }
      }),
      ctx
    )
    const m = msgs(issues)
    expect(m).toContain('Informe pelo menos um horário (HH:MM).')
    expect(m).toContain('Escolha pelo menos um dia da semana.')
    expect(m).toContain('Mantenha os backups por pelo menos 1 dia.')
    expect(m).toContain('E-mail inválido: x@y')
    expect(issues.find((i) => i.message.startsWith('Configure o servidor de e-mail'))?.level).toBe('warning')
  })
})

describe('validateRoutine (com disco)', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-val-'))
    await mkdir(join(dir, 'origem'))
    await mkdir(join(dir, 'destino'))
  })
  afterEach(() => cleanup())

  it('mesmo disco → aviso; destino inacessível → aviso', async () => {
    const issues = await validateRoutine(
      input({
        sources: [{ id: 's', path: join(dir, 'origem'), kind: 'folder' }],
        destinations: [
          { id: 'd', path: join(dir, 'destino') },
          { id: 'x', path: join(dir, 'desconectado'), label: 'HD azul' }
        ]
      }),
      { existing: [], smtpConfigured: true, platform: 'linux' }
    )
    const same = issues.find((i) => i.message.includes('no mesmo disco da origem'))
    expect(same?.level).toBe('warning')
    expect(same?.destinationId).toBe('d')
    const unavailable = issues.find((i) => i.message.startsWith('Destino indisponível agora: HD azul'))
    expect(unavailable?.level).toBe('warning')
    expect(issues.some((i) => i.level === 'error')).toBe(false)
  })
})

describe('argumentos IPC', () => {
  it('rotina para validação mantém horários digitados', () => {
    const v = asRoutineForValidation({ name: 'x', schedule: { kind: 'daily', times: ['99:99'] } })
    expect(v.schedule.times).toEqual(['99:99'])
    expect(v.id).toBeUndefined()
  })
  it('patch de configurações: tipos checados, smtp recusado, campos novos primitivos aceitos', () => {
    expect(asSettingsPatch({ theme: 'dark', historyDays: 3, extra: 1 })).toEqual({
      theme: 'dark',
      historyDays: 7,
      extra: 1
    })
    expect(() => asSettingsPatch({ smtp: {} })).toThrow()
    expect(() => asSettingsPatch({ closeToTray: 'sim' })).toThrow()
    expect(() => asSettingsPatch({ theme: 'roxo' })).toThrow()
  })
  it('SMTP: senha opcional preservada; hasPassword nunca vem do renderer', () => {
    const s = asSmtpInput({ ...DEFAULT_SETTINGS.smtp, host: 'smtp.x', hasPassword: true, password: 'p' })
    expect(s.password).toBe('p')
    expect(s).not.toHaveProperty('hasPassword')
    expect(asSmtpInput({ host: 'a' }).password).toBeUndefined()
  })
  it('consulta do histórico', () => {
    expect(asHistoryQuery(undefined)).toEqual({})
    expect(asHistoryQuery({ status: 'failed', limit: 10.7 })).toEqual({ status: 'failed', limit: 10 })
    expect(() => asHistoryQuery({ status: 'xx' })).toThrow()
  })
})

describe('exportar/importar configurações', () => {
  it('exporta sem senha e importa com ids novos e nomes únicos', () => {
    const r = makeRoutine({ id: 'r1', name: 'Docs' })
    const settings = {
      ...DEFAULT_SETTINGS,
      computerAlias: 'Recepção',
      smtp: { ...DEFAULT_SETTINGS.smtp, host: 'smtp.x', hasPassword: true }
    }
    const file = buildExport(settings, [r], '0.1.0')
    expect(JSON.stringify(file)).not.toMatch(/"password"|smtpPassword|secrets/)
    expect(file.settings.smtp.hasPassword).toBe(false)
    expect(file.settings).not.toHaveProperty('computerAlias')
    const plan = planImport(JSON.parse(JSON.stringify(file)), [r])
    expect(plan.routines.length).toBe(1)
    expect(plan.routines[0].id).not.toBe('r1')
    expect(plan.routines[0].name).toBe('Docs (importada)')
    expect(plan.settings?.smtp?.host).toBe('smtp.x')
    expect(plan.settings).not.toHaveProperty('computerAlias')
    // Sem colisão: também gera id novo (outro PC no mesmo destino não pode dividir a pasta da rotina).
    expect(planImport(file, []).routines[0].id).not.toBe('r1')
  })
  it('arquivo estranho → erro em pt-BR', () => {
    expect(() => planImport({ foo: 1 }, [])).toThrow(/não é uma exportação/)
    expect(() => planImport({ format: 'bc-backup-config', version: 99 }, [])).toThrow(/versão mais nova/)
  })
})
