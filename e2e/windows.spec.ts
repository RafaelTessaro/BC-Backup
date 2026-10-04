// Teste de fumaça do app EMPACOTADO no Windows (roda no CI em windows-latest, depois do electron-builder).
// Cobre o que só existe no Windows: listagem de unidades (PowerShell), caminhos C:\…, nomes com acento,
// inicialização com o Windows (login item), ZIP e verificação completa, e o log sem erros.
// Uso: BC_E2E_EXE=dist\win-unpacked\BCBackup.exe npx playwright test e2e/windows.spec.ts
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BcApi, RoutineInput } from '../src/shared/api'
import { BACKUP_ROOT_DIR, MANIFEST_FILE, createDefaultRoutine } from '../src/shared/defaults'
import { mainPage, trayPage } from './fixtures'

type G = { bc: BcApi }
const exe = process.env.BC_E2E_EXE
const shots = join('test-results', 'windows')

test.skip(
  !exe || process.platform !== 'win32',
  'só roda no Windows com BC_E2E_EXE apontando para o app empacotado'
)

let app: ElectronApplication
let page: Page
let userData: string
const errors: string[] = []

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true })
  userData = mkdtempSync(join(tmpdir(), 'bcb-win-'))
  // BC_E2E=1: gancho __bcTrayToggle (simula o clique no ícone da bandeja).
  app = await electron.launch({
    executablePath: exe!,
    env: { ...process.env, BC_USER_DATA_DIR: userData, BC_E2E: '1' }
  })
  // Pela URL (index.html): o painel da bandeja (tray.html) também é uma janela do app.
  page = await mainPage(app)
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.waitForFunction(
    () => typeof (globalThis as { bc?: { routines?: { list?: unknown } } }).bc?.routines?.list === 'function'
  )
})

test.afterAll(async () => {
  await app?.close()
})

test('é o app empacotado, com a janela visível', async () => {
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  // Num pré-lançamento, a versão do app precisa ser a publicada (ex.: v0.1.0-beta.2 → 0.1.0-beta.2).
  const expected = process.env.BC_E2E_EXPECT_VERSION?.replace(/^v/, '')
  if (expected) expect(await app.evaluate(({ app }) => app.getVersion())).toBe(expected)
  await expect(page.getByText('Vamos proteger seus arquivos').first()).toBeVisible()
  await page.screenshot({ path: join(shots, '01-primeira-abertura.png') })
})

test('lista as unidades do Windows (PowerShell) com espaço livre', async () => {
  const drives = await page.evaluate(() => (globalThis as unknown as G).bc.system.drives())
  const c = drives.find((d) => /^C:\\?$/i.test(d.path))
  expect(c, JSON.stringify(drives)).toBeTruthy()
  expect(c!.total).toBeGreaterThan(0)
  expect(c!.free).toBeGreaterThan(0)
})

function makeSource(): string {
  const root = mkdtempSync(join(tmpdir(), 'bcb-win-src-'))
  mkdirSync(join(root, 'Relatórios 2026', 'Ação & Cia'), { recursive: true })
  writeFileSync(join(root, 'Relatórios 2026', 'Ação & Cia', 'balanço çãõ.txt'), 'conteúdo com acento')
  writeFileSync(join(root, 'Relatórios 2026', 'planilha.xlsx'), Buffer.alloc(512 * 1024, 3))
  writeFileSync(join(root, 'Thumbs.db'), 'lixo')
  return root
}

async function runRoutine(input: RoutineInput): Promise<{ status: string; runId: string }> {
  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), input)
  const finished = page.evaluate(
    (id) =>
      new Promise<{ status: string; runId: string }>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineId === id) {
            off()
            resolve({ status: r.status, runId: r.id })
          }
        })
      }),
    saved.id
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), saved.id)
  return finished
}

function routine(
  name: string,
  source: string,
  dests: string[],
  patch: Partial<RoutineInput> = {}
): RoutineInput {
  const base = createDefaultRoutine()
  return {
    ...base,
    name,
    sources: [{ id: 's1', path: source, kind: 'folder' }],
    destinations: dests.map((p, i) => ({ id: `d${i}`, path: p, label: `Disco ${i + 1}` })),
    schedule: { ...base.schedule, kind: 'manual' },
    verify: 'full',
    ...patch
  }
}

test('backup em pasta datada para dois destinos, com acentos e verificação completa', async () => {
  const source = makeSource()
  const a = mkdtempSync(join(tmpdir(), 'bcb-win-a-'))
  const b = mkdtempSync(join(tmpdir(), 'bcb-win-b-'))
  const res = await runRoutine(routine('Financeiro – Ação', source, [a, b]))
  const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), res.runId)
  expect(res.status, JSON.stringify(record?.log.slice(-10))).toBe('success')
  for (const dest of [a, b]) {
    const dir = join(dest, BACKUP_ROOT_DIR, 'Financeiro – Ação')
    const snap = readdirSync(dir).find((n) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n))
    expect(snap, `pasta datada em ${dir}`).toBeTruthy()
    const files = readdirSync(join(dir, snap!), { recursive: true }).map(String)
    expect(files.some((f) => f.endsWith('balanço çãõ.txt'))).toBe(true)
    expect(files.some((f) => f.endsWith('Thumbs.db'))).toBe(false)
    expect(existsSync(join(dir, snap!, MANIFEST_FILE))).toBe(true)
  }
  await page.screenshot({ path: join(shots, '02-painel-depois-do-backup.png') })
})

test('backup em ZIP com verificação completa', async () => {
  const source = makeSource()
  const dest = mkdtempSync(join(tmpdir(), 'bcb-win-zip-'))
  const res = await runRoutine(routine('Contabilidade ZIP', source, [dest], { mode: 'zip' }))
  expect(res.status).toBe('success')
  const dir = join(dest, BACKUP_ROOT_DIR, 'Contabilidade ZIP')
  expect(readdirSync(dir).some((n) => n.endsWith('.zip'))).toBe(true)
})

test('arquivo aberto com bloqueio vira aviso, não falha', async () => {
  // No Windows, um arquivo aberto sem compartilhamento de leitura dá EBUSY ao ser lido.
  const source = makeSource()
  const locked = join(source, 'banco-em-uso.mdb')
  writeFileSync(locked, 'dados')
  const dest = mkdtempSync(join(tmpdir(), 'bcb-win-lock-'))
  // Abre com compartilhamento 0 (UV_FS_O_EXLOCK do libuv → CreateFileW com dwShareMode 0), como um
  // banco de dados ou um .pst aberto: qualquer outra leitura recebe EBUSY enquanto o fd estiver aberto.
  const UV_FS_O_EXLOCK = 0x10000000
  const fd = openSync(locked, constants.O_RDWR | UV_FS_O_EXLOCK)
  try {
    expect(() => readFileSync(locked)).toThrow(/EBUSY/) // o bloqueio está mesmo ativo
    const res = await runRoutine(routine('Arquivo em uso', source, [dest]))
    expect(res.status).toBe('warning')
    const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), res.runId)
    const skipped = record?.destinations[0].skipped ?? []
    expect(skipped.some((s) => s.path.endsWith('banco-em-uso.mdb'))).toBe(true)
  } finally {
    closeSync(fd)
  }
})

test('liga e desliga "Iniciar com o Windows" (login item)', async () => {
  // No Windows, a consulta precisa do mesmo caminho e argumentos usados no registro (Run).
  const registered = () =>
    app.evaluate(
      ({ app }) => app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin
    )
  await page.evaluate(() => (globalThis as unknown as G).bc.settings.update({ launchAtLogin: true }))
  await expect.poll(registered).toBe(true)
  await page.evaluate(() => (globalThis as unknown as G).bc.settings.update({ launchAtLogin: false }))
  await expect.poll(registered).toBe(false)
})

test('telas principais abrem sem erros (screenshots claro e escuro)', async () => {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => (globalThis as unknown as G).bc.settings.update({ theme: t }), theme)
    for (const [route, name] of [
      ['/painel', 'painel'],
      ['/rotinas', 'rotinas'],
      ['/historico', 'historico'],
      ['/rotinas/nova', 'nova-rotina'],
      ['/configuracoes', 'configuracoes']
    ] as const) {
      // Mesmo caminho da bandeja/notificações: o main manda o evento "navigate".
      await app.evaluate(({ BrowserWindow }, r) => {
        const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tray.html'))
        main?.webContents.send('evt:navigate', r)
      }, route)
      await page.waitForTimeout(600)
      await page.screenshot({ path: join(shots, `tela-${name}-${theme}.png`) })
    }
  }
  expect(errors).toEqual([])
})

test('painel da bandeja abre junto do ícone e fecha com Esc', async () => {
  // Clique no ícone de verdade (sem retângulo, o gancho usa tray.getBounds()). Mostrar e conferir na
  // mesma chamada: no runner do CI outra janela pode tirar o foco (e o light-dismiss esconde o painel).
  const opened = await app.evaluate(({ BrowserWindow, screen }) => {
    const hook = (globalThis as { __bcTrayToggle?: () => boolean }).__bcTrayToggle
    const ok = hook?.() ?? false
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('tray.html'))
    if (!w) return { ok, visible: false, inside: false }
    const b = w.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const inside =
      b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height
    return { ok, visible: w.isVisible(), inside, size: [b.width, b.height] }
  })
  expect(opened.ok).toBe(true)
  expect(opened.inside).toBe(true)
  const panel = await trayPage(app)
  panel.on('pageerror', (e) => errors.push(`painel: ${e.message}`))
  panel.on('console', (m) => m.type() === 'error' && errors.push(`painel: ${m.text()}`))
  await expect(panel.getByRole('heading', { level: 1 })).toBeVisible()
  if (opened.visible) await panel.screenshot({ path: join(shots, 'bandeja.png') })
  await panel.keyboard.press('Escape')
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((x) => x.webContents.getURL().includes('tray.html'))
          ?.isVisible()
      )
    )
    .toBe(false)
  expect(errors).toEqual([])
})

test('log do app sem erros', async () => {
  const logFile = join(userData, 'logs', 'bc-backup.log')
  expect(existsSync(logFile)).toBe(true)
  const errorLines = readFileSync(logFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => / ERROR /.test(l))
  expect(errorLines).toEqual([])
})
