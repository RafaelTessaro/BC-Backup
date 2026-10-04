// Listagem de unidades no Windows (PowerShell simulado): rótulos acentuados, BOM, tipos de unidade.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFile = vi.fn()
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFile(...args) }))
vi.mock('../src/main/engine/fsutil', () => ({
  diskSpaceOf: async (root: string) => {
    if (['C:\\', 'E:\\', 'Z:\\'].includes(root)) return { total: 500e9, free: 100e9 }
    throw new Error('sem unidade')
  }
}))

const { listDrives } = await import('../src/main/drives')

function powershellReturns(stdout: string) {
  execFile.mockImplementation((...a: unknown[]) => {
    const cb = a[3]
    if (typeof cb === 'function') cb(null, stdout)
  })
}

beforeEach(() => execFile.mockReset())

describe('listDrives (Windows)', () => {
  it('mantém acentos do rótulo, ignora BOM e marca removível/rede', async () => {
    powershellReturns(
      '\uFEFF' +
        JSON.stringify([
          { DeviceID: 'C:', VolumeName: 'Windows', DriveType: 3 },
          { DeviceID: 'E:', VolumeName: 'Mídia Cópias', DriveType: 2 },
          { DeviceID: 'Z:', VolumeName: null, DriveType: 4 },
          { DeviceID: 'D:', VolumeName: 'DVD', DriveType: 5 }
        ])
    )
    const drives = await listDrives('win32')
    expect(drives.map((d) => d.label)).toEqual(['Windows (C:)', 'Mídia Cópias (E:)', 'Unidade de rede (Z:)'])
    expect(drives.find((d) => d.path === 'E:\\')?.removable).toBe(true)
    expect(drives.find((d) => d.path === 'Z:\\')?.network).toBe(true)
  })

  it('pede saída UTF-8 ao PowerShell (página OEM embaralha acentos)', async () => {
    powershellReturns('[]')
    await listDrives('win32')
    const args = execFile.mock.calls[0][1] as string[]
    expect(args.join(' ')).toContain('[Console]::OutputEncoding')
  })
})
