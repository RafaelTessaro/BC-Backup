// Posição do painel da bandeja (src/main/tray-position.ts, spec 05-painel-da-bandeja §7 e §9).
import { describe, expect, it } from 'vitest'
import {
  isUsableAnchor,
  nearestDisplay,
  panelBounds,
  placePanel,
  taskbarEdge,
  type DisplayArea,
  type Rect
} from '../src/main/tray-position'

const SIZE = { width: 360, height: 480 }
const M = 12

/** Monitor 1920×1080 na origem com a barra de 48 px na borda pedida. */
function fullHd(edge: 'bottom' | 'top' | 'left' | 'right' | 'autohide', x = 0, y = 0): DisplayArea {
  const bounds = { x, y, width: 1920, height: 1080 }
  const wa = { ...bounds }
  if (edge === 'bottom') wa.height -= 48
  if (edge === 'top') {
    wa.y += 48
    wa.height -= 48
  }
  if (edge === 'left') {
    wa.x += 48
    wa.width -= 48
  }
  if (edge === 'right') wa.width -= 48
  return { bounds, workArea: wa }
}

const icon = (x: number, y: number): Rect => ({ x, y, width: 24, height: 24 })

/** O painel cabe inteiro no workArea, com a margem mínima, e só tem coordenadas inteiras. */
function expectInside(r: Rect, d: DisplayArea, m = M): void {
  const wa = d.workArea
  expect(r.x).toBeGreaterThanOrEqual(wa.x + m)
  expect(r.y).toBeGreaterThanOrEqual(wa.y + m)
  expect(r.x + r.width).toBeLessThanOrEqual(wa.x + wa.width - m)
  expect(r.y + r.height).toBeLessThanOrEqual(wa.y + wa.height - m)
  for (const v of [r.x, r.y, r.width, r.height]) expect(Number.isInteger(v)).toBe(true)
}

describe('taskbarEdge', () => {
  it('detecta a barra pela diferença entre bounds e workArea', () => {
    for (const edge of ['bottom', 'top', 'left', 'right'] as const) {
      const d = fullHd(edge)
      expect(taskbarEdge(d.bounds, d.workArea, icon(960, 540))).toBe(edge)
    }
  })

  it('com ocultação automática, usa a borda mais próxima do ícone', () => {
    const d = fullHd('autohide')
    expect(taskbarEdge(d.bounds, d.workArea, icon(1800, 1050))).toBe('bottom')
    expect(taskbarEdge(d.bounds, d.workArea, icon(1800, 6))).toBe('top')
    expect(taskbarEdge(d.bounds, d.workArea, icon(4, 600))).toBe('left')
    expect(taskbarEdge(d.bounds, d.workArea, icon(1890, 600))).toBe('right')
  })

  it('funciona num monitor secundário fora da origem', () => {
    const d = fullHd('bottom', -1920, 0)
    expect(taskbarEdge(d.bounds, d.workArea, icon(-200, 1044))).toBe('bottom')
    const t = fullHd('top', 1920, -1080)
    expect(taskbarEdge(t.bounds, t.workArea, icon(3700, -1070))).toBe('top')
  })
})

describe('panelBounds', () => {
  it('barra embaixo: acima da barra, 12 px do workArea, centrado no ícone', () => {
    const d = fullHd('bottom')
    const r = panelBounds({ anchor: icon(1500, 1044), display: d, size: SIZE, platform: 'win32' })
    expect(r).toEqual({ x: 1512 - 180, y: 1032 - 480 - M, width: 360, height: 480 })
    expectInside(r, d)
  })

  it('barra embaixo, ícone perto do canto: encosta a 12 px da borda direita', () => {
    const d = fullHd('bottom')
    const r = panelBounds({ anchor: icon(1880, 1044), display: d, size: SIZE, platform: 'win32' })
    expect(r.x).toBe(1920 - 360 - M)
    expect(r.y).toBe(1032 - 480 - M)
    expectInside(r, d)
  })

  it('barra em cima: abaixo da barra', () => {
    const d = fullHd('top')
    const r = panelBounds({ anchor: icon(1700, 12), display: d, size: SIZE, platform: 'win32' })
    expect(r.y).toBe(48 + M)
    expect(r.x).toBe(1712 - 180)
    expectInside(r, d)
  })

  it('barra à esquerda: ao lado da barra, base alinhada ao ícone', () => {
    const d = fullHd('left')
    const r = panelBounds({ anchor: icon(12, 1000), display: d, size: SIZE, platform: 'win32' })
    expect(r.x).toBe(48 + M)
    expect(r.y + r.height).toBe(1024)
    expectInside(r, d)
  })

  it('barra à direita: ao lado da barra, base alinhada ao ícone (limitada ao workArea)', () => {
    const d = fullHd('right')
    const r = panelBounds({ anchor: icon(1884, 900), display: d, size: SIZE, platform: 'win32' })
    expect(r.x + r.width).toBe(1872 - M)
    expect(r.y + r.height).toBe(924)
    const low = panelBounds({ anchor: icon(1884, 1050), display: d, size: SIZE, platform: 'win32' })
    expect(low.y + low.height).toBe(1080 - M) // 1074 passaria da margem do workArea
    expectInside(r, d)
    expectInside(low, d)
    expectInside(r, d)
  })

  it('ocultação automática embaixo: o painel fica acima do ícone, nunca sobre a barra', () => {
    const d = fullHd('autohide')
    const r = panelBounds({ anchor: icon(1700, 1050), display: d, size: SIZE, platform: 'win32' })
    expect(r.y + r.height).toBe(1050 - M)
    expectInside(r, d)
  })

  it('ocultação automática à direita: o painel fica à esquerda do ícone', () => {
    const d = fullHd('autohide')
    const r = panelBounds({ anchor: icon(1890, 700), display: d, size: SIZE, platform: 'win32' })
    expect(r.x + r.width).toBe(1890 - M)
    expectInside(r, d)
  })

  it('workArea menor que o painel: encolhe para caber com as margens', () => {
    const d: DisplayArea = {
      bounds: { x: 0, y: 0, width: 800, height: 400 },
      workArea: { x: 0, y: 0, width: 800, height: 360 }
    }
    const r = panelBounds({ anchor: icon(760, 370), display: d, size: SIZE, platform: 'win32' })
    expect(r.height).toBe(360 - 2 * M)
    expect(r.width).toBe(360)
    expectInside(r, d)
  })

  it('coordenadas fracionárias (125 %, 150 %) viram pixels inteiros', () => {
    const d: DisplayArea = {
      bounds: { x: 0, y: 0, width: 1536, height: 864 },
      workArea: { x: 0, y: 0, width: 1536, height: 825.6 }
    }
    const r = panelBounds({
      anchor: { x: 1301.3, y: 833.7, width: 21.3, height: 26.7 },
      display: d,
      size: SIZE,
      platform: 'win32'
    })
    expectInside(r, d)
    expect(r.width).toBe(360)
    expect(r.height).toBe(480)
  })

  it('macOS: sempre abaixo da barra de menus, com 6 px de margem', () => {
    const d: DisplayArea = {
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      workArea: { x: 0, y: 25, width: 1512, height: 957 }
    }
    const r = panelBounds({
      anchor: { x: 1200, y: 0, width: 30, height: 24 },
      display: d,
      size: SIZE,
      platform: 'darwin'
    })
    expect(r.y).toBe(31)
    expect(r.x).toBe(1215 - 180)
    expectInside(r, d, 6)
  })
})

describe('âncora e monitor', () => {
  const primary = fullHd('bottom')
  const left = fullHd('bottom', -1920, 0)
  const displays = [primary, left]

  it('ícone escondido no "^": bounds zerados ou fora da tela não servem de âncora', () => {
    expect(isUsableAnchor({ x: 0, y: 0, width: 0, height: 0 }, displays)).toBe(false)
    expect(isUsableAnchor({ x: -32000, y: -32000, width: 24, height: 24 }, displays)).toBe(false)
    expect(isUsableAnchor(undefined, displays)).toBe(false)
    expect(isUsableAnchor({ x: Number.NaN, y: 0, width: 24, height: 24 }, displays)).toBe(false)
    expect(isUsableAnchor(icon(1700, 1044), displays)).toBe(true)
  })

  it('cai para o cursor quando o ícone não tem posição (ícone no "^")', () => {
    // Clique no ícone dentro do excesso ("^"), que flutua acima da barra: o painel fica logo acima.
    const r = placePanel({
      trayBounds: { x: 0, y: 0, width: 0, height: 0 },
      cursor: { x: 1650, y: 980 },
      displays,
      size: SIZE,
      platform: 'win32'
    })
    expect(r.x).toBe(Math.round(1650.5 - 180))
    expect(r.y + r.height).toBe(980 - M)
    expectInside(r, primary)
    // Cursor na própria barra: o painel encosta a 12 px da barra.
    const onBar = placePanel({
      trayBounds: { x: -32000, y: -32000, width: 24, height: 24 },
      cursor: { x: 1650, y: 1060 },
      displays,
      size: SIZE,
      platform: 'win32'
    })
    expect(onBar.y + onBar.height).toBe(1032 - M)
    expectInside(onBar, primary)
  })

  it('cursor perto da borda: limitado ao workArea', () => {
    const r = placePanel({
      trayBounds: null,
      cursor: { x: 1919, y: 1079 },
      displays,
      size: SIZE,
      platform: 'win32'
    })
    expect(r).toEqual({ x: 1920 - 360 - M, y: 1032 - 480 - M, width: 360, height: 480 })
  })

  it('vários monitores: abre no monitor do ícone (inclusive com x negativo)', () => {
    const r = placePanel({
      trayBounds: icon(-300, 1044),
      cursor: { x: 100, y: 100 },
      displays,
      size: SIZE,
      platform: 'win32'
    })
    expectInside(r, left)
    expect(r.x).toBe(-288 - 180)
  })

  it('vários monitores com a barra em cima no secundário', () => {
    const top = fullHd('top', 1920, 0)
    const r = placePanel({
      trayBounds: icon(3700, 12),
      cursor: { x: 0, y: 0 },
      displays: [primary, top],
      size: SIZE,
      platform: 'win32'
    })
    expectInside(r, top)
    expect(r.y).toBe(48 + M)
    expect(r.x + r.width).toBe(3840 - M)
  })

  it('ponto fora de todos os monitores: usa o mais próximo', () => {
    expect(nearestDisplay({ x: -5000, y: 500 }, displays)).toBe(left)
    expect(nearestDisplay({ x: 2500, y: 2000 }, displays)).toBe(primary)
    expect(nearestDisplay({ x: 10, y: 10 }, displays)).toBe(primary)
  })
})
