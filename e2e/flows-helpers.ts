// Apoio aos testes de fluxo (e2e/flows-*.spec.ts): o app Electron real, usado como o usuário usa —
// clicando e digitando. Cada teste abre o app com dados isolados e FALHA se aparecer qualquer erro de
// console ou de página (inclusive no painel da bandeja).
import { test as base, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { BcApi, RoutineInput } from '../src/shared/api'
import { createDefaultRoutine } from '../src/shared/defaults'
import type { Routine } from '../src/shared/types'
import { launch, mainWindow, type Launched } from './fixtures'

export type G = { bc: BcApi }

export interface AppUnderTest extends Launched {
  page: Page
}

/** Pastas temporárias do teste em andamento (apagadas no fim dele). */
const temps: string[] = []

export const test = base.extend<{ launchEnv: Record<string, string>; bcApp: AppUnderTest }>({
  /** Variáveis de ambiente extras da abertura (ex.: BC_E2E_MOVE_SKEW_MIN). */
  launchEnv: [{}, { option: true }],
  bcApp: async ({ launchEnv }, use) => {
    const l = await launch([], undefined, launchEnv)
    temps.push(l.userData)
    try {
      const page = await mainWindow(l)
      await use({ ...l, page })
    } finally {
      await l.app.close().catch(() => undefined)
      // Pastas temporárias do teste (origens, destinos, dados do app): nada fica enchendo o disco.
      for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
    }
    expect(l.errors, 'erros no console ou na página').toEqual([])
  }
})

export { expect }

/** Pasta temporária apagada ao fim do teste. */
export function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

/* ------------------------------------------------------------------ */
/* Seletores nativos (não dá para clicar num diálogo do sistema no CI) */
/* ------------------------------------------------------------------ */

interface DialogCall {
  title?: string
  properties?: string[]
}

/**
 * Enfileira respostas para os próximos `dialog.showOpenDialog` do main (cada resposta = caminhos
 * escolhidos). Fila vazia = o usuário cancelou. As chamadas ficam registradas (título e opções).
 */
export async function queueDialog(app: ElectronApplication, ...responses: string[][]): Promise<void> {
  await app.evaluate(({ dialog }, rs) => {
    const g = globalThis as unknown as {
      __bcDialogQueue?: string[][]
      __bcDialogCalls?: DialogCall[]
      __bcDialogStubbed?: boolean
    }
    g.__bcDialogQueue = [...(g.__bcDialogQueue ?? []), ...rs]
    g.__bcDialogCalls ??= []
    if (g.__bcDialogStubbed) return
    g.__bcDialogStubbed = true
    const stub = async (a: unknown, b?: unknown) => {
      const opts = (b ?? a) as DialogCall
      g.__bcDialogCalls!.push({ title: opts?.title, properties: opts?.properties })
      const next = g.__bcDialogQueue!.shift()
      return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] }
    }
    ;(dialog as unknown as { showOpenDialog: typeof stub }).showOpenDialog = stub
  }, responses)
}

export function dialogCalls(app: ElectronApplication): Promise<DialogCall[]> {
  return app.evaluate(
    () => (globalThis as unknown as { __bcDialogCalls?: DialogCall[] }).__bcDialogCalls ?? []
  )
}

/* ------------------------------------------------------------------ */
/* Área de transferência                                               */
/* ------------------------------------------------------------------ */

export function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText())
}

export function writeClipboard(app: ElectronApplication, text: string): Promise<void> {
  return app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text)
}

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

/** Item da barra lateral ("Painel", "Rotinas", "Histórico", "Configurações"). */
export function sidebar(page: Page, name: string | RegExp): Locator {
  const exact = typeof name === 'string' ? new RegExp(`^${name}`) : name
  return page.locator('aside').getByRole('button', { name: exact }).first()
}

/** Região dos toasts (sonner). */
export function toasts(page: Page): Locator {
  return page.getByRole('region', { name: /Notificações/ })
}

/** Toast com o título dado. */
export function toast(page: Page, title: string | RegExp): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: title }).first()
}

/** Botão "Continuar" do editor (rodapé). */
export function continueButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Continuar', exact: true })
}

/** Título da etapa atual do editor. */
export function stepHeading(page: Page): Locator {
  return page.locator('#step-title')
}

/** Linha da lista de Rotinas pelo nome (o <li> com as ações dela). */
export function routineRow(page: Page, name: string): Locator {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: `Editar ${name}`, exact: true }) })
}

/**
 * Pré-condição pronta (rotina salva pelo contrato `window.bc`, como faria o editor): uma pasta de
 * origem e os destinos dados. Os fluxos em si continuam pela interface.
 */
export function saveRoutine(
  page: Page,
  name: string,
  source: string,
  dests: string[],
  patch: Partial<RoutineInput> = {}
): Promise<Routine> {
  const base = createDefaultRoutine()
  const input: RoutineInput = {
    ...base,
    name,
    sources: [{ id: 'src-1', path: source, kind: 'folder' }],
    destinations: dests.map((path, i) => ({ id: `dst-${i + 1}`, path, label: '', enabled: true })),
    ...patch
  }
  return page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), input)
}

/** Rotinas salvas no main (fonte da verdade, não a tela). */
export function listRoutines(page: Page): Promise<Routine[]> {
  return page.evaluate(() => (globalThis as unknown as G).bc.routines.list())
}

/** Espera a execução da rotina terminar (evento do main) e devolve o resumo. */
export function waitRunFinished(
  page: Page,
  routineName: string
): Promise<{ id: string; status: string; routineId: string }> {
  return page.evaluate(
    (name) =>
      new Promise<{ id: string; status: string; routineId: string }>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineName === name) {
            off()
            resolve({ id: r.id, status: r.status, routineId: r.routineId })
          }
        })
      }),
    routineName
  )
}

/* ------------------------------------------------------------------ */
/* Teclado                                                             */
/* ------------------------------------------------------------------ */

/** Nome acessível aproximado do elemento focado (aria-label, rótulo ou texto) + papel. */
const FOCUSED_JS = `(() => {
  const el = document.activeElement
  if (!el || el === document.body) return '(body)'
  const labelled = el.getAttribute('aria-labelledby')
  const byId = labelled
    ? labelled.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    : ''
  const forLabel = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent : ''
  const name = el.getAttribute('aria-label') || byId || forLabel || el.textContent || ''
  const role = el.getAttribute('role') || el.tagName.toLowerCase()
  return role + ': ' + name.replace(/\\s+/g, ' ').trim()
})()`

export function focused(page: Page): Promise<string> {
  return page.evaluate(FOCUSED_JS) as Promise<string>
}

/**
 * Tab (ou Shift+Tab) até o foco chegar no controle com esse nome — como quem só usa o teclado.
 * Falha se não chegar em `max` teclas (controle inalcançável pelo teclado).
 */
export async function tabTo(
  page: Page,
  name: string | RegExp,
  opts: { back?: boolean; max?: number } = {}
): Promise<string> {
  const seen: string[] = []
  const match = (f: string): boolean =>
    typeof name === 'string' ? f.slice(f.indexOf(': ') + 2) === name : name.test(f)
  for (let i = 0; i < (opts.max ?? 40); i++) {
    await page.keyboard.press(opts.back ? 'Shift+Tab' : 'Tab')
    const f = await focused(page)
    seen.push(f)
    if (match(f)) return f
  }
  throw new Error(`"${String(name)}" não recebeu o foco pelo teclado. Caminho: ${seen.join(' → ')}`)
}

/* ------------------------------------------------------------------ */
/* Disco                                                               */
/* ------------------------------------------------------------------ */

/** Lista recursiva de arquivos (caminhos relativos com "/"). */
export function filesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(relative(dir, p).split('\\').join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

/** Bytes pseudoaleatórios determinísticos (conteúdo diferente por arquivo, sem compressão trivial). */
export function bytes(seed: number, size: number): Buffer {
  const b = Buffer.alloc(size)
  let x = (seed * 2654435761) >>> 0 || 1
  for (let i = 0; i < size; i += 4) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    b.writeUInt32LE(x >>> 0, Math.min(i, size - 4))
  }
  return b
}

/**
 * Pasta "Contabilidade" com subpastas, acentos e um volume que leva alguns segundos para copiar e
 * conferir em dois destinos (dá tempo de ver o progresso ao vivo).
 */
export function makeAccountingTree(bigFiles = 24, bigSize = 6 * 1024 * 1024): string {
  const root = join(makeDir('bcb-flow-src-'), 'Contabilidade')
  mkdirSync(join(root, 'Balanços', '2026'), { recursive: true })
  mkdirSync(join(root, 'Notas fiscais'), { recursive: true })
  for (let i = 1; i <= bigFiles; i++)
    writeFileSync(
      join(root, 'Balanços', '2026', `balanço-${String(i).padStart(2, '0')}.dat`),
      bytes(i, bigSize)
    )
  for (let i = 1; i <= 30; i++)
    writeFileSync(
      join(root, 'Notas fiscais', `NF-${String(i).padStart(4, '0')}.xml`),
      `<nf n="${i}">ação</nf>`
    )
  writeFileSync(join(root, 'leia-me.txt'), 'Backup da contabilidade — não apagar')
  writeFileSync(join(root, 'Thumbs.db'), 'lixo') // excluído pelo filtro padrão
  return root
}

/** sha256 (hex) do arquivo. */
export function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Conteúdo idêntico, arquivo a arquivo. */
export function expectSameFile(a: string, b: string): void {
  expect(readFileSync(b).equals(readFileSync(a)), `${b} igual a ${a}`).toBe(true)
}
