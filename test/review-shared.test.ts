// Revisão (QA #3): utilitários compartilhados (src/shared).
import { describe, expect, it } from 'vitest'
import { parseRoute } from '@shared/routes'

describe('parseRoute', () => {
  it('rota com "%" malformado não lança (cai no item sem decodificar)', () => {
    expect(() => parseRoute('/historico/%E0%A4%A')).not.toThrow()
    expect(parseRoute('/historico/%E0%A4%A')).toEqual({ name: 'history', runId: '%E0%A4%A' })
    expect(parseRoute('/rotinas/abc%20def')).toEqual({ name: 'routine-edit', id: 'abc def' })
  })
})
