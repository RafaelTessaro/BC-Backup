// Ícone e menu da bandeja (design §7(i)). Ícone por estado: resources/tray.png (normal),
// tray-running.png (executando), tray-error.png (falha) — com @2x; no Windows aceita .ico.
// Arquivo ausente → cai para tray.png → imagem vazia (nunca quebra o app).

import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { resourcePath } from './paths'
import { log } from './logger'

export type TrayState = 'idle' | 'running' | 'error'

export interface TrayModel {
  state: TrayState
  /** Texto após "BC Backup — ". */
  tooltip: string
  /** Linhas de status (itens desativados no menu). */
  statusLines: string[]
  routines: Array<{ id: string; name: string; busy: boolean }>
  /** true = há rotinas ativas (mostra "Pausar todas"); false = "Retomar rotinas". */
  anyEnabled: boolean
}

export interface TrayActions {
  open(): void
  runNow(routineId: string): void
  pauseAll(): void
  resumeAll(): void
  settings(): void
  quit(): void
}

let tray: Tray | null = null // referência no módulo: evita o GC remover o ícone
let actions: TrayActions | null = null
let lastState: TrayState | null = null
let lastMenuKey = ''
const imageCache = new Map<TrayState, NativeImage>()

function loadImage(state: TrayState): NativeImage {
  const cached = imageCache.get(state)
  if (cached) return cached
  const base = state === 'idle' ? 'tray' : `tray-${state}`
  const names: string[] = []
  if (process.platform === 'win32') names.push(`${base}.ico`)
  if (process.platform === 'darwin' && state === 'idle') names.push('trayTemplate.png')
  names.push(`${base}.png`)
  if (state !== 'idle') {
    if (process.platform === 'win32') names.push('tray.ico')
    names.push('tray.png')
  }
  let img = nativeImage.createEmpty()
  for (const n of names) {
    const p = resourcePath(n)
    if (!p) continue
    const candidate = nativeImage.createFromPath(p)
    if (candidate.isEmpty()) continue
    if (process.platform === 'darwin' && n.includes('Template')) candidate.setTemplateImage(true)
    img = candidate
    break
  }
  if (img.isEmpty()) log.warn(`Ícone da bandeja ausente (${base}); usando imagem vazia.`)
  imageCache.set(state, img)
  return img
}

export function createTray(a: TrayActions): void {
  if (tray) return
  actions = a
  try {
    tray = new Tray(loadImage('idle'))
  } catch (e) {
    log.error('Não foi possível criar o ícone da bandeja', e)
    tray = null
    return
  }
  lastState = 'idle'
  tray.setToolTip('BC Backup')
  // Windows/macOS: clique simples abre a janela. No Linux (AppIndicator) vale o menu.
  tray.on('click', () => actions?.open())
  tray.on('double-click', () => actions?.open())
}

export function updateTray(m: TrayModel): void {
  if (!tray || !actions) return
  if (m.state !== lastState) {
    tray.setImage(loadImage(m.state))
    lastState = m.state
  }
  // Tooltip do Windows tem limite de 127 caracteres.
  const tip = `BC Backup — ${m.tooltip}`
  tray.setToolTip(tip.length > 127 ? `${tip.slice(0, 124)}…` : tip)

  const key = JSON.stringify(m)
  if (key === lastMenuKey) return
  lastMenuKey = key
  const a = actions
  const runItems: MenuItemConstructorOptions[] = m.routines.length
    ? m.routines.map((r) => ({
        label: r.busy ? `${r.name} (em execução)` : r.name,
        enabled: !r.busy,
        click: () => a.runNow(r.id)
      }))
    : [{ label: 'Nenhuma rotina criada', enabled: false }]
  const template: MenuItemConstructorOptions[] = [
    { label: 'Abrir BC Backup', click: () => a.open() },
    { type: 'separator' },
    ...m.statusLines.map((label): MenuItemConstructorOptions => ({ label, enabled: false })),
    { type: 'separator' },
    { label: 'Executar agora', submenu: runItems, enabled: m.routines.length > 0 },
    m.anyEnabled
      ? { label: 'Pausar todas as rotinas', click: () => a.pauseAll(), enabled: m.routines.length > 0 }
      : { label: 'Retomar rotinas', click: () => a.resumeAll(), enabled: m.routines.length > 0 },
    { type: 'separator' },
    { label: 'Configurações…', click: () => a.settings() },
    { label: 'Sair do BC Backup', click: () => a.quit() }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
