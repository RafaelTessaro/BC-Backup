import { test, expect } from '@playwright/test'
import type { BcApi } from '../src/shared/api'
import { createDefaultRoutine } from '../src/shared/defaults'
import { launch, mainWindow, makeDir, makeSourceTree } from './fixtures'

type G = { bc: BcApi }

test('interface real: estado vazio, criar rotina pela API e ver no painel/histórico', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  await page.setViewportSize({ width: 1200, height: 780 }).catch(() => {})

  // Estado inicial sem rotinas: convite para criar a primeira.
  await expect(page.getByText('Vamos proteger seus arquivos').first()).toBeVisible()
  if (process.env.SHOTS) await page.screenshot({ path: 'docs/screenshots/electron-vazio.png' })

  const source = makeSourceTree()
  const dest = makeDir('bcb-ui-dest-')
  const base = createDefaultRoutine()
  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), {
    ...base,
    name: 'Documentos do escritório',
    sources: [{ id: 's1', path: source, kind: 'folder' as const }],
    destinations: [{ id: 'd1', path: dest, label: 'HD externo' }]
  })
  const done = page.evaluate(
    (id) =>
      new Promise<void>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineId === id) {
            off()
            resolve()
          }
        })
      }),
    saved.id
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), saved.id)
  await done

  await expect(page.getByText('Tudo protegido').first()).toBeVisible()
  await expect(page.getByText('Documentos do escritório').first()).toBeVisible()
  if (process.env.SHOTS) await page.screenshot({ path: 'docs/screenshots/electron-painel.png' })

  // Navega pela barra lateral.
  await page
    .getByRole('link', { name: /Rotinas/ })
    .or(page.getByRole('button', { name: /^Rotinas/ }))
    .first()
    .click()
  await expect(page.getByText('Documentos do escritório').first()).toBeVisible()
  await page
    .getByRole('link', { name: /Histórico/ })
    .or(page.getByRole('button', { name: /^Histórico/ }))
    .first()
    .click()
  await expect(page.getByText('Concluído').first()).toBeVisible()
  if (process.env.SHOTS) await page.screenshot({ path: 'docs/screenshots/electron-historico.png' })

  expect(l.errors).toEqual([])
  await l.app.close()
})

test('seletores: bolinha do Switch centrada com 4 px de folga, ligado e desligado', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  await page.evaluate("location.hash = '#/configuracoes'")
  const switches = page.getByRole('switch')
  await expect(switches.first()).toBeVisible()

  type Measure = { checked: string | null; w: number; h: number; gaps: number[] }[]
  /** Trilho e folgas da bolinha (o círculo é o ::before da célula que anda). */
  const measure = () => page.evaluate(SWITCH_GEOMETRY_JS) as Promise<Measure>
  const settle = async () => {
    await page.mouse.move(1, 1) // sem hover (a bolinha cresce no hover)
    await page.waitForTimeout(400) // fim das transições
  }
  const check = (all: Measure) => {
    expect(all.length).toBeGreaterThan(0)
    for (const s of all) {
      expect([s.w, s.h], JSON.stringify(s)).toEqual([40, 20])
      for (const g of s.gaps) expect(g, JSON.stringify(s)).toBeCloseTo(4, 1)
    }
  }

  await settle()
  const before = await measure()
  check(before)
  // Troca o estado de todos (ligado ↔ desligado) e mede de novo.
  const n = await switches.count()
  for (let i = 0; i < n; i++) await switches.nth(i).click()
  await settle()
  const after = await measure()
  check(after)
  expect(after.map((s) => s.checked)).not.toEqual(before.map((s) => s.checked))
  if (process.env.SHOTS) await page.screenshot({ path: 'docs/screenshots/electron-seletores.png' })

  expect(l.errors).toEqual([])
  await l.app.close()
})

/** Roda na página: [{ checked, w, h, gaps: [esquerda, direita, cima, baixo] }] de cada [role=switch]. */
const SWITCH_GEOMETRY_JS = `[...document.querySelectorAll('[role=switch]')].map((el) => {
  const r = el.getBoundingClientRect()
  const cell = el.querySelector('span')
  const c = cell.getBoundingClientRect()
  const dot = getComputedStyle(cell, '::before')
  const w = parseFloat(dot.width)
  const h = parseFloat(dot.height)
  const cx = c.left + c.width / 2 - r.left
  const cy = c.top + c.height / 2 - r.top
  return {
    checked: el.getAttribute('aria-checked'),
    w: r.width,
    h: r.height,
    gaps: [cx - w / 2, r.width - (cx + w / 2), cy - h / 2, r.height - (cy + h / 2)]
  }
})`
