// Caminhos de runtime (recursos, renderer, preload) em dev e no app empacotado.
// No empacotado, `resources/**` vai em asarUnpack: <resourcesPath>/app.asar.unpacked/resources.

import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

function resourceDirs(): string[] {
  const dirs: string[] = []
  if (app.isPackaged) {
    dirs.push(join(process.resourcesPath, 'app.asar.unpacked', 'resources'))
    dirs.push(join(process.resourcesPath, 'resources'))
  }
  dirs.push(join(app.getAppPath(), 'resources'))
  dirs.push(join(__dirname, '../../resources'))
  return dirs
}

/** Primeiro caminho existente para um arquivo de `resources/`, ou null. */
export function resourcePath(name: string): string | null {
  for (const dir of resourceDirs()) {
    const p = join(dir, name)
    if (existsSync(p)) return p
  }
  return null
}

export function preloadPath(): string {
  return join(__dirname, '../preload/index.cjs')
}

export function rendererIndexPath(): string {
  return join(__dirname, '../renderer/index.html')
}

/** Painel da bandeja (segunda entrada do renderer). */
export function rendererTrayPath(): string {
  return join(__dirname, '../renderer/tray.html')
}

/** URL de dev (electron-vite) ou null no build. */
export function devRendererUrl(): string | null {
  const url = process.env.ELECTRON_RENDERER_URL
  return url && !app.isPackaged ? url : null
}

/**
 * A URL pertence à nossa interface? (valida remetente IPC e navegação). Aceita a janela principal
 * (index.html) e o painel da bandeja (tray.html); em dev, qualquer página do servidor do Vite.
 */
export function isAppUrl(url: string): boolean {
  if (!url) return false
  const dev = devRendererUrl()
  try {
    if (dev) return new URL(url).origin === new URL(dev).origin
    const u = new URL(url)
    if (u.protocol !== 'file:') return false
    u.hash = ''
    u.search = ''
    const a = normalize(fileURLToPath(u))
    const same = (b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
    return same(normalize(rendererIndexPath())) || same(normalize(rendererTrayPath()))
  } catch {
    return false
  }
}
