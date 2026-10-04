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
  const saved = await page.evaluate(
    (i) => (globalThis as unknown as G).bc.routines.save(i),
    {
      ...base,
      name: 'Documentos do escritório',
      sources: [{ id: 's1', path: source, kind: 'folder' as const }],
      destinations: [{ id: 'd1', path: dest, label: 'HD externo' }]
    }
  )
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
  await page.getByRole('link', { name: /Rotinas/ }).or(page.getByRole('button', { name: /^Rotinas/ })).first().click()
  await expect(page.getByText('Documentos do escritório').first()).toBeVisible()
  await page.getByRole('link', { name: /Histórico/ }).or(page.getByRole('button', { name: /^Histórico/ })).first().click()
  await expect(page.getByText('Concluído').first()).toBeVisible()
  if (process.env.SHOTS) await page.screenshot({ path: 'docs/screenshots/electron-historico.png' })

  expect(l.errors).toEqual([])
  await l.app.close()
})
