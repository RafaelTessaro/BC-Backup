import { test, expect } from '@playwright/test'
import { launch, mainWindow, makeDir } from './fixtures'

test('probe dialog stub', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  const dir = makeDir('bcb-probe-')
  const info = await l.app.evaluate(({ dialog }, p) => {
    const desc = Object.getOwnPropertyDescriptor(dialog, 'showOpenDialog')
    try {
      ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
        canceled: false,
        filePaths: [p]
      })
    } catch (e) {
      return { err: String(e), desc: JSON.stringify(desc) }
    }
    return { ok: true, desc: JSON.stringify({ ...desc, value: typeof desc?.value }) }
  }, dir)
  console.log(info)
  const r = await page.evaluate(() =>
    (globalThis as unknown as { bc: { system: { pickFolders: (o: unknown) => Promise<unknown> } } }).bc.system.pickFolders({
      multi: true
    })
  )
  console.log(r)
  const size = await page.evaluate(() => [innerWidth, innerHeight])
  console.log(size)
  expect(r).toBeTruthy()
  await l.app.close()
})
