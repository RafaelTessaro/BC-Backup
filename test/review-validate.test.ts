// Revisão (QA #3): caminhos do Windows com prefixo de caminho longo ("\\?\C:\…", "\\?\UNC\…").
// É o mesmo caminho sem o prefixo: a comparação (destino dentro da origem, pastas proibidas do
// "Mover") não pode ser contornada por essa grafia (destino digitado, arquivo importado).
import { describe, expect, it } from 'vitest'
import { isBlockedMoveSource, isInside, normalizeForCompare } from '../src/main/validate'

const win = { platform: 'win32' as const, env: { SystemDrive: 'C:' }, homedir: 'C:\\Users\\Ana' }

describe('prefixo "\\\\?\\" no Windows', () => {
  it('normaliza para o mesmo caminho', () => {
    expect(normalizeForCompare('\\\\?\\C:\\Dados\\', 'win32')).toBe(normalizeForCompare('C:\\Dados', 'win32'))
    expect(normalizeForCompare('\\\\?\\UNC\\Servidor\\backup\\x', 'win32')).toBe(
      normalizeForCompare('\\\\servidor\\backup\\x', 'win32')
    )
  })

  it('destino dentro da origem é detectado', () => {
    expect(isInside('\\\\?\\C:\\Dados\\Backup', 'C:\\Dados', 'win32')).toBe(true)
    expect(isInside('C:\\Dados\\Backup', '\\\\?\\C:\\Dados', 'win32')).toBe(true)
    expect(isInside('\\\\?\\UNC\\srv\\share\\a', '\\\\SRV\\share', 'win32')).toBe(true)
  })

  it('pastas proibidas do "Mover" continuam proibidas', () => {
    expect(isBlockedMoveSource('\\\\?\\C:\\', win)).toBe(true)
    expect(isBlockedMoveSource('\\\\?\\C:\\Users\\Ana', win)).toBe(true)
    expect(isBlockedMoveSource('\\\\?\\C:\\Windows\\Temp', win)).toBe(true)
    expect(isBlockedMoveSource('\\\\?\\C:\\Users\\Ana\\Documents', win)).toBe(true)
    expect(isBlockedMoveSource('\\\\?\\C:\\ERP\\Backup', win)).toBe(false)
  })
})
