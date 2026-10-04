// Unidades de disco sem módulo nativo (guia §8). Node puro.
// Windows: PowerShell Get-CimInstance (WMIC foi removido do Windows 11) + statfs por letra.
// macOS: /Volumes. Linux: "/", /media/<usuário>, /run/media/<usuário>, /media, /mnt.

import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import type { DiskSpace, DriveInfo } from '@shared/types'
import { diskSpaceOf } from './engine/fsutil'

interface WinMeta {
  label: string
  type: number
}

function winMeta(): Promise<Map<string, WinMeta>> {
  const cmd =
    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { windowsHide: true, timeout: 8_000 },
      (err, out) => {
        const map = new Map<string, WinMeta>()
        if (!err) {
          try {
            const rows = [JSON.parse(String(out))].flat() as Array<{
              DeviceID: string
              VolumeName: string | null
              DriveType: number
            }>
            for (const r of rows) {
              if (r?.DeviceID) map.set(r.DeviceID.toUpperCase(), { label: r.VolumeName ?? '', type: r.DriveType })
            }
          } catch {
            // Sem metadados: testamos todas as letras só com statfs.
          }
        }
        resolve(map)
      }
    )
  })
}

/** DriveType do Win32_LogicalDisk: 2 removível, 3 fixo, 4 rede, 5 CD/DVD. */
export async function listDrives(platform: NodeJS.Platform = process.platform): Promise<DriveInfo[]> {
  if (platform === 'win32') {
    const meta = await winMeta().catch(() => new Map<string, WinMeta>())
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('')
    const res = await Promise.allSettled(
      letters.map(async (l): Promise<DriveInfo> => {
        const root = `${l}:\\`
        const m = meta.get(`${l}:`)
        if (meta.size && !m) throw new Error('ausente')
        if (m?.type === 5) throw new Error('óptico')
        const space = await diskSpaceOf(root, 2_000)
        const info: DriveInfo = {
          path: root,
          label: m?.label ? `${m.label} (${l}:)` : `Disco local (${l}:)`,
          total: space.total,
          free: space.free
        }
        if (m?.type === 2) {
          info.removable = true
          if (!m.label) info.label = `Disco removível (${l}:)`
        }
        if (m?.type === 4) {
          info.network = true
          if (!m.label) info.label = `Unidade de rede (${l}:)`
        }
        return info
      })
    )
    return res.flatMap((r) => (r.status === 'fulfilled' && r.value.total > 0 ? [r.value] : []))
  }

  const out: DriveInfo[] = []
  const seen = new Set<string>()
  const push = async (path: string, label: string, removable: boolean) => {
    if (seen.has(path)) return
    seen.add(path)
    try {
      const space = await diskSpaceOf(path, 2_000)
      if (space.total <= 0) return
      const info: DriveInfo = { path, label, total: space.total, free: space.free }
      if (removable) info.removable = true
      out.push(info)
    } catch {
      // não montado / sem resposta
    }
  }
  await push('/', platform === 'darwin' ? 'Macintosh HD' : 'Sistema', false)
  let user: string
  try {
    user = userInfo().username
  } catch {
    user = ''
  }
  const bases =
    platform === 'darwin'
      ? ['/Volumes']
      : [...(user ? [`/media/${user}`, `/run/media/${user}`] : []), '/media', '/mnt']
  for (const base of bases) {
    let entries
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      // No macOS "Macintosh HD" em /Volumes é um link para "/": isSymbolicLink() o descarta.
      if (!e.isDirectory() || e.isSymbolicLink() || e.name === user) continue
      await push(join(base, e.name), e.name, true)
    }
  }
  return out
}

export async function diskSpace(path: string): Promise<DiskSpace | null> {
  try {
    const s = await diskSpaceOf(path, 3_000)
    return { path, total: s.total, free: s.free }
  } catch {
    return null
  }
}
