// Ícone e menu da bandeja (design §7(i)). Ícone por estado: resources/tray.png (normal),
// tray-running.png (executando), tray-warning.png (último backup com avisos), tray-error.png
// (falha) — com @2x; no Windows prefere .ico; no macOS prefere "<nome>Template.png" (imagem modelo).
// Arquivo ausente → cai para o ícone normal → imagem vazia (nunca quebra o app).
//
// Interação (05-painel-da-bandeja §0 e §7):
// - Windows/macOS: clique esquerdo OU direito abre/fecha o painel da bandeja; duplo clique abre o
//   app; Shift + clique direito mostra o menu nativo antigo (saída de emergência). O menu nativo é
//   montado sempre, mas NÃO vai para `setContextMenu` (com ele, o Electron engole o `right-click`).
// - Linux (AppIndicator, sem getBounds e com `click` pouco confiável): só o menu nativo.
// - Se o painel caiu 2× ou não carregou, o clique volta a mostrar o menu nativo.

import {
  Menu,
  Tray,
  nativeImage,
  type MenuItemConstructorOptions,
  type NativeImage,
  type Rectangle
} from 'electron'
import { resourcePath } from './paths'
import { log } from './logger'

export type TrayState = 'idle' | 'running' | 'warning' | 'error'

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
  /** Abre/fecha o painel junto do ícone. false = painel indisponível (mostra o menu nativo). */
  togglePanel(bounds?: Rectangle): boolean
  hidePanel(): void
}

/** Windows e macOS usam o painel; o Linux fica com o menu nativo. */
export const TRAY_USES_PANEL = process.platform === 'win32' || process.platform === 'darwin'

let tray: Tray | null = null // referência no módulo: evita o GC remover o ícone
let actions: TrayActions | null = null
let lastState: TrayState | null = null
let lastMenuKey = ''
/** Menu nativo (Windows/macOS: só com Shift + clique direito ou se o painel falhar). */
let fallbackMenu: Menu | null = null
const imageCache = new Map<TrayState, NativeImage>()

function loadImage(state: TrayState): NativeImage {
  const cached = imageCache.get(state)
  if (cached) return cached
  const variants = (base: string): string[] => {
    if (process.platform === 'win32') return [`${base}.ico`, `${base}.png`]
    if (process.platform === 'darwin') return [`${base}Template.png`, `${base}.png`]
    return [`${base}.png`]
  }
  const base = state === 'idle' ? 'tray' : `tray-${state}`
  const names = [...variants(base), ...(state === 'idle' ? [] : variants('tray'))]
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
  if (!TRAY_USES_PANEL) {
    // Linux: o menu (setContextMenu em updateTray) é a interface; o clique, quando chega, abre o app.
    tray.on('click', () => actions?.open())
    tray.on('double-click', () => actions?.open())
    return
  }
  const toggle = (bounds?: Rectangle): void => {
    if (!actions?.togglePanel(bounds)) popUpMenu()
  }
  tray.on('click', (_e, bounds) => toggle(bounds))
  tray.on('right-click', (e, bounds) => (e.shiftKey ? popUpMenu() : toggle(bounds)))
  tray.on('double-click', () => {
    actions?.hidePanel()
    actions?.open()
  })
  // macOS: cada clique alterna o painel na hora (sem esperar o intervalo de duplo clique).
  if (process.platform === 'darwin') tray.setIgnoreDoubleClickEvents(true)
}

function popUpMenu(): void {
  if (!tray || !fallbackMenu) return
  actions?.hidePanel()
  tray.popUpContextMenu(fallbackMenu)
}

/** Retângulo do ícone (Windows/macOS; null sem ícone ou no Linux). Pode vir zerado no "^". */
export function trayIconBounds(): Rectangle | null {
  if (!tray || tray.isDestroyed() || !TRAY_USES_PANEL) return null
  try {
    return tray.getBounds()
  } catch {
    return null
  }
}

/** Devolve o foco do teclado à área de notificação (Esc no painel; só existe no Windows). */
export function focusTrayIcon(): void {
  if (process.platform !== 'win32' || !tray || tray.isDestroyed()) return
  try {
    tray.focus()
  } catch {
    // sem suporte: ignora
  }
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
  const menu = Menu.buildFromTemplate(template)
  if (TRAY_USES_PANEL) fallbackMenu = menu
  else tray.setContextMenu(menu)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  fallbackMenu = null
}
