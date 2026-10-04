// Posição do painel da bandeja (05-painel-da-bandeja §7). Funções puras, sem Electron — testadas em
// test/tray-position.test.ts. Coordenadas em DIP (o Electron já entrega `tray.getBounds()`, o cursor
// e os monitores em DIP).

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface DisplayArea {
  bounds: Rect
  workArea: Rect
}

export type Edge = 'top' | 'bottom' | 'left' | 'right'

/** Distância do painel até a barra de tarefas e até a borda da tela (Windows 11: 12 px). */
export const PANEL_MARGIN = 12
/** No macOS o painel encosta mais na barra de menus. */
export const PANEL_MARGIN_MAC = 6

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

const contains = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

/**
 * Borda da barra de tarefas: pela diferença entre `bounds` e `workArea`. Com ocultação automática
 * (workArea = bounds), a borda da tela mais próxima do ícone.
 */
export function taskbarEdge(bounds: Rect, wa: Rect, anchor: Rect): Edge {
  if (wa.y > bounds.y) return 'top'
  if (wa.x > bounds.x) return 'left'
  if (wa.width < bounds.width) return 'right'
  if (wa.height < bounds.height) return 'bottom'
  const c = center(anchor)
  const d: Record<Edge, number> = {
    bottom: bounds.y + bounds.height - c.y,
    right: bounds.x + bounds.width - c.x,
    top: c.y - bounds.y,
    left: c.x - bounds.x
  }
  // Empate (ex.: âncora no canto) favorece a ordem acima: barra embaixo é o padrão do Windows.
  return (Object.keys(d) as Edge[]).reduce((a, b) => (d[a] <= d[b] ? a : b))
}

/** Retângulo do painel: ancorado ao ícone, a 12 px da barra e das bordas, sempre dentro do workArea. */
export function panelBounds(o: {
  anchor: Rect
  display: DisplayArea
  size: { width: number; height: number }
  platform: string
}): Rect {
  const a = o.anchor
  const { bounds, workArea: wa } = o.display
  const mac = o.platform === 'darwin'
  const m = mac ? PANEL_MARGIN_MAC : PANEL_MARGIN
  // Inteiros (setPosition/setBounds com fração lança erro) e sempre cabendo no workArea.
  const width = Math.max(1, Math.floor(Math.min(o.size.width, wa.width - 2 * m)))
  const height = Math.max(1, Math.floor(Math.min(o.size.height, wa.height - 2 * m)))
  const minX = wa.x + m
  const maxX = wa.x + wa.width - width - m
  const minY = wa.y + m
  const maxY = wa.y + wa.height - height - m
  const edge: Edge = mac ? 'top' : taskbarEdge(bounds, wa, a)
  const centerX = clamp(a.x + a.width / 2 - width / 2, minX, maxX)
  // Barra vertical: a base do painel acompanha a base do ícone.
  const nearIconY = clamp(a.y + a.height - height, minY, maxY)
  // Math.min/max com o ícone: com ocultação automática o painel fica acima (ou ao lado) da barra,
  // nunca embaixo dela.
  const pos: Point = {
    bottom: { x: centerX, y: clamp(Math.min(maxY, a.y - height - m), minY, maxY) },
    top: { x: centerX, y: clamp(Math.max(minY, a.y + a.height + m), minY, maxY) },
    left: { x: clamp(Math.max(minX, a.x + a.width + m), minX, maxX), y: nearIconY },
    right: { x: clamp(Math.min(maxX, a.x - width - m), minX, maxX), y: nearIconY }
  }[edge]
  // Arredonda sem sair do workArea (com 125 %/150 % os limites em DIP são fracionários).
  return {
    x: clamp(Math.round(pos.x), Math.ceil(minX), Math.floor(maxX)),
    y: clamp(Math.round(pos.y), Math.ceil(minY), Math.floor(maxY)),
    width,
    height
  }
}

/**
 * O retângulo do ícone serve de âncora? Com o ícone escondido no "^" do Windows 11,
 * `tray.getBounds()` volta zerado ou fora de qualquer monitor.
 */
export function isUsableAnchor(r: Rect | null | undefined, displays: readonly DisplayArea[]): r is Rect {
  if (!r || !(r.width > 0) || !(r.height > 0)) return false
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return false
  const c = center(r)
  return displays.some((d) => contains(d.bounds, c))
}

/** Monitor que contém o ponto ou, se nenhum contém, o mais próximo dele. */
export function nearestDisplay<D extends DisplayArea>(p: Point, displays: readonly D[]): D {
  if (!displays.length) throw new Error('Nenhum monitor disponível.')
  const hit = displays.find((d) => contains(d.bounds, p))
  if (hit) return hit
  const dist = (r: Rect): number => {
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
    return dx * dx + dy * dy
  }
  return displays.reduce((a, b) => (dist(b.bounds) < dist(a.bounds) ? b : a))
}

/**
 * Tudo junto: escolhe a âncora (ícone ou, sem ele, o cursor), o monitor e o retângulo do painel.
 */
export function placePanel(o: {
  trayBounds?: Rect | null
  cursor: Point
  displays: readonly DisplayArea[]
  size: { width: number; height: number }
  platform: string
}): Rect {
  const anchor: Rect = isUsableAnchor(o.trayBounds, o.displays)
    ? o.trayBounds
    : { x: o.cursor.x, y: o.cursor.y, width: 1, height: 1 }
  const display = nearestDisplay(center(anchor), o.displays)
  return panelBounds({ anchor, display, size: o.size, platform: o.platform })
}
