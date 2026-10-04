// Revisão (QA #3): importar configurações (src/main/config-io.ts).
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { buildExport, planImport } from '../src/main/config-io'
import { validateRoutine } from '../src/main/validate'
import { makeRoutine } from './helpers'

const sixty = 'Backup diário do servidor de arquivos da contabilidade - SP1'.padEnd(60, 'x')

describe('nomes das rotinas importadas cabem no limite do editor (60 caracteres)', () => {
  it('nome repetido e longo: "(importada)" não estoura o limite nem repete o nome', async () => {
    const existing = [makeRoutine({ id: 'local', name: sixty })]
    const file = JSON.parse(
      JSON.stringify(buildExport(DEFAULT_SETTINGS, [makeRoutine({ id: 'x', name: sixty })], '0.1.0'))
    )
    const [r] = planImport(file, existing).routines
    expect(r.name.length).toBeLessThanOrEqual(60)
    expect(r.name.toLocaleLowerCase('pt-BR')).not.toBe(sixty.toLocaleLowerCase('pt-BR'))
    expect(r.name).toMatch(/\(importada\)$/)
    // A rotina importada pode ser salva pelo editor sem trocar o nome.
    const issues = await validateRoutine(
      {
        ...r,
        sources: [{ id: 's', path: '/srv/a', kind: 'folder' }],
        destinations: [{ id: 'd', path: '/mnt/b' }]
      },
      { existing, smtpConfigured: false, checkFs: false, platform: 'linux' }
    )
    expect(issues.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([])
  })

  it('arquivo editado à mão com nome de 100 caracteres: chega com no máximo 60', () => {
    const file = JSON.parse(
      JSON.stringify(
        buildExport(DEFAULT_SETTINGS, [makeRoutine({ id: 'x', name: 'A'.repeat(100) })], '0.1.0')
      )
    )
    const [r] = planImport(file, []).routines
    expect(r.name.length).toBeLessThanOrEqual(60)
  })
})
