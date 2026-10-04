import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Launched {
  app: ElectronApplication
  userData: string
  errors: string[]
}

/** Abre o app (out/) com uma pasta de dados isolada. */
export async function launch(extraArgs: string[] = [], userData?: string): Promise<Launched> {
  const dir = userData ?? mkdtempSync(join(tmpdir(), 'bcb-e2e-'))
  const app = await electron.launch({
    args: ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...extraArgs],
    // BC_E2E=1 expõe o gancho __bcTrayToggle (simula o clique no ícone da bandeja).
    env: { ...process.env, BC_USER_DATA_DIR: dir, NODE_ENV: 'production', BC_E2E: '1' }
  })
  const errors: string[] = []
  app.on('window', (page) => watchErrors(page, errors))
  return { app, userData: dir, errors }
}

export function watchErrors(page: Page, errors: string[]): void {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
}

const isTrayUrl = (url: string): boolean => /\/tray\.html(?:[?#]|$)/.test(url)
/** index.html (build) ou a raiz do servidor de dev — nunca o painel da bandeja. */
const isMainUrl = (url: string): boolean =>
  /\/index\.html(?:[?#]|$)/.test(url) || /^https?:\/\/[^/]+\/?(?:[?#].*)?$/.test(url)

async function waitForPage(
  app: ElectronApplication,
  match: (url: string) => boolean,
  what: string,
  timeout = 30_000
): Promise<Page> {
  const deadline = Date.now() + timeout
  for (;;) {
    const page = app.windows().find((p) => match(p.url()))
    if (page) return page
    if (Date.now() > deadline) throw new Error(`${what} não apareceu em ${timeout / 1000} s`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

/**
 * A janela principal. Não use `app.firstWindow()`: com o painel da bandeja pré-criado (oculto),
 * a primeira janela pode ser o tray.html.
 */
export function mainPage(app: ElectronApplication, timeout?: number): Promise<Page> {
  return waitForPage(app, isMainUrl, 'A janela principal', timeout)
}

/** O painel da bandeja (tray.html), depois de criado. */
export function trayPage(app: ElectronApplication, timeout?: number): Promise<Page> {
  return waitForPage(app, isTrayUrl, 'O painel da bandeja', timeout)
}

export async function mainWindow(l: Launched): Promise<Page> {
  const page = await mainPage(l.app)
  watchErrors(page, l.errors)
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(
    () => typeof (globalThis as { bc?: { routines?: { list?: unknown } } }).bc?.routines?.list === 'function'
  )
  return page
}

/** Cria uma árvore de arquivos de exemplo e devolve o caminho. */
export function makeSourceTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'bcb-src-'))
  mkdirSync(join(root, 'Notas fiscais', '2026'), { recursive: true })
  mkdirSync(join(root, 'Planilhas'), { recursive: true })
  for (let i = 1; i <= 12; i++) {
    writeFileSync(
      join(root, 'Notas fiscais', '2026', `NF-${String(i).padStart(4, '0')}.xml`),
      `<nf>${i}</nf>`.repeat(200)
    )
  }
  writeFileSync(join(root, 'Planilhas', 'Fluxo de caixa.xlsx'), Buffer.alloc(256 * 1024, 7))
  writeFileSync(join(root, 'Planilhas', 'Thumbs.db'), 'lixo') // deve ser excluído pelo filtro padrão
  writeFileSync(join(root, 'leia-me.txt'), 'BC Backup E2E')
  return root
}

export function makeDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}
