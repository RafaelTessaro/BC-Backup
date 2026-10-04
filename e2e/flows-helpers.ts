// Apoio aos testes de fluxo (e2e/flows-*.spec.ts): o app Electron real, usado como o usuário usa —
// clicando e digitando. Cada teste abre o app com dados isolados e FALHA se aparecer qualquer erro de
// console ou de página (inclusive no painel da bandeja).
import { test as base, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { BcApi } from '../src/shared/api'
import { launch, mainWindow, makeDir, type Launched } from './fixtures'

export type G = { bc: BcApi }

export interface AppUnderTest extends Launched {
  page: Page
}

export const test = base.extend<{ launchEnv: Record<string, string>; bcApp: AppUnderTest }>({
  /** Variáveis de ambiente extras da abertura (ex.: BC_E2E_MOVE_SKEW_MIN). */
  launchEnv: [{}, { option: true }],
  bcApp: async ({ launchEnv }, use) => {
    const l = await launch([], undefined, launchEnv)
    const page = await mainWindow(l)
    await use({ ...l, page })
    await l.app.close().catch(() => undefined)
    expect(l.errors, 'erros no console ou na página').toEqual([])
  }
})

export { expect }

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
    writeFileSync(join(root, 'Balanços', '2026', `balanço-${String(i).padStart(2, '0')}.dat`), bytes(i, bigSize))
  for (let i = 1; i <= 30; i++)
    writeFileSync(join(root, 'Notas fiscais', `NF-${String(i).padStart(4, '0')}.xml`), `<nf n="${i}">ação</nf>`)
  writeFileSync(join(root, 'leia-me.txt'), 'Backup da contabilidade — não apagar')
  writeFileSync(join(root, 'Thumbs.db'), 'lixo') // excluído pelo filtro padrão
  return root
}

/** Conteúdo idêntico, arquivo a arquivo. */
export function expectSameFile(a: string, b: string): void {
  expect(readFileSync(b).equals(readFileSync(a)), `${b} igual a ${a}`).toBe(true)
}

export { makeDir }
