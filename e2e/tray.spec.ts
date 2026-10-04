// Painel da bandeja (docs/research/05-painel-da-bandeja.md) no app Electron real.
// O clique no ícone é simulado pelo gancho __bcTrayToggle (só existe com BC_E2E=1): no Linux o ícone
// usa o menu nativo, mas o painel em si é o mesmo do Windows/macOS.
import { test, expect, type ElectronApplication } from '@playwright/test'
import type { BcApi } from '../src/shared/api'
import { createDefaultRoutine } from '../src/shared/defaults'
import { launch, mainWindow, makeDir, makeSourceTree, trayPage } from './fixtures'

type G = { bc: BcApi }
type Rect = { x: number; y: number; width: number; height: number }

/** Simula o clique no ícone (com o retângulo dele, como o evento `click` do Tray). */
const clickTrayIcon = (app: ElectronApplication, bounds?: Rect) =>
  app.evaluate((_e, b) => {
    const hook = (globalThis as { __bcTrayToggle?: (b?: Rect) => boolean }).__bcTrayToggle
    if (!hook) throw new Error('Gancho __bcTrayToggle ausente (BC_E2E=1?)')
    return hook(b)
  }, bounds)

const windowState = (app: ElectronApplication, which: 'main' | 'tray') =>
  app.evaluate(({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows().find(
      (x) => x.webContents.getURL().includes('tray.html') === (w === 'tray')
    )
    return win ? { visible: win.isVisible(), bounds: win.getBounds(), title: win.getTitle() } : null
  }, which)

test('painel da bandeja: resumo ao vivo, abrir o app, pausar e fechar com Esc', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  const { app } = l

  // Como quem só usa a bandeja: janela principal escondida.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('tray.html'))
      ?.hide()
  )

  // Clique no ícone (canto inferior direito da tela 1280×1024 do xvfb).
  const icon = { x: 1180, y: 994, width: 24, height: 24 }
  expect(await clickTrayIcon(app, icon)).toBe(true)
  const panel = await trayPage(app)
  await panel.waitForFunction(() => typeof (globalThis as Partial<G>).bc?.tray?.hide === 'function')
  await expect.poll(async () => (await windowState(app, 'tray'))?.visible).toBe(true)

  // Janela 360×480 junto do ícone, inteira na tela, com o título lido pelo Narrador.
  const st = (await windowState(app, 'tray'))!
  expect(st.title).toBe('BC Backup — resumo')
  expect(st.bounds.width).toBe(360)
  expect(st.bounds.height).toBe(480)
  expect(st.bounds.y + st.bounds.height).toBeLessThanOrEqual(icon.y)
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  expect(st.bounds.x).toBeGreaterThanOrEqual(area.x + 12)
  expect(st.bounds.x + st.bounds.width).toBeLessThanOrEqual(area.x + area.width - 12)

  // Sem rotinas: convite para criar a primeira; Executar e Pausar desativados.
  await expect(panel.getByRole('heading', { name: 'Nenhuma rotina ainda' })).toBeVisible()
  await expect(panel.getByText('Sem rotinas')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Executar agora' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Pausar todas as rotinas' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Abrir o BC Backup' })).toBeFocused()
  if (process.env.SHOTS) await panel.screenshot({ path: 'docs/screenshots/bandeja-electron-vazio.png' })

  // Um backup rodando pela janela principal: o painel (aberto) acompanha ao vivo.
  const source = makeSourceTree()
  const dest = makeDir('bcb-tray-dest-')
  const base = createDefaultRoutine()
  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), {
    ...base,
    name: 'Documentos do escritório',
    sources: [{ id: 's1', path: source, kind: 'folder' as const }],
    destinations: [{ id: 'd1', path: dest, label: 'HD externo' }]
  })
  const done = page.evaluate(
    (id) =>
      new Promise<string>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineId === id) {
            off()
            resolve(r.status)
          }
        })
      }),
    saved.id
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), saved.id)
  expect(await done).toBe('success')
  await expect(panel.getByRole('heading', { name: 'Tudo protegido' })).toBeVisible()
  await expect(panel.getByText('Agendador ativo')).toBeVisible()
  await expect(
    panel.getByRole('button', { name: /^Documentos do escritório, Concluído, .*Abrir detalhes$/ })
  ).toBeVisible()
  if (process.env.SHOTS) await panel.screenshot({ path: 'docs/screenshots/bandeja-electron.png' })

  // "Abrir o BC Backup": o painel some e a janela principal aparece.
  await panel.getByRole('button', { name: 'Abrir o BC Backup' }).click()
  await expect.poll(async () => (await windowState(app, 'main'))?.visible).toBe(true)
  await expect.poll(async () => (await windowState(app, 'tray'))?.visible).toBe(false)

  // De novo pelo ícone: Esc com um menu aberto fecha só o menu; o segundo Esc fecha o painel.
  expect(await clickTrayIcon(app, icon)).toBe(true)
  await expect.poll(async () => (await windowState(app, 'tray'))?.visible).toBe(true)
  // Escondido, o conteúdo fica transparente; ao reaparecer ele volta (com a entrada animada).
  await expect(panel.locator('html')).not.toHaveAttribute('data-tray-hidden')
  await expect(panel.getByRole('button', { name: 'Abrir o BC Backup' })).toBeFocused()
  await panel.getByRole('button', { name: 'Mais opções' }).click()
  await expect(panel.getByRole('menuitem', { name: 'Sair do BC Backup' })).toBeVisible()
  await panel.keyboard.press('Escape')
  await expect(panel.getByRole('menu')).toHaveCount(0)
  expect((await windowState(app, 'tray'))?.visible).toBe(true)
  await panel.keyboard.press('Escape')
  await expect.poll(async () => (await windowState(app, 'tray'))?.visible).toBe(false)

  // Pausar pelo painel: o hero muda e as rotinas ficam pausadas de verdade; "Retomar" desfaz.
  expect(await clickTrayIcon(app, icon)).toBe(true)
  await expect.poll(async () => (await windowState(app, 'tray'))?.visible).toBe(true)
  await panel.getByRole('button', { name: 'Pausar todas as rotinas' }).click()
  await expect(panel.getByRole('heading', { name: 'Rotinas pausadas' })).toBeVisible()
  await expect(panel.getByText('Agendamentos pausados')).toBeVisible()
  const enabled = () =>
    page.evaluate(async () => (await (globalThis as unknown as G).bc.routines.list()).map((r) => r.enabled))
  expect(await enabled()).toEqual([false])
  await panel.getByRole('button', { name: 'Retomar rotinas' }).first().click()
  await expect(panel.getByRole('heading', { name: 'Tudo protegido' })).toBeVisible()
  expect(await enabled()).toEqual([true])

  // Segundo clique no ícone com o painel aberto: fecha.
  expect(await clickTrayIcon(app, icon)).toBe(true)
  await expect.poll(async () => (await windowState(app, 'tray'))?.visible).toBe(false)

  expect(l.errors).toEqual([])
  await app.close()
})
