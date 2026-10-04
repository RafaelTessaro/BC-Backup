// Histórico e Painel pela interface real: falha não vista na barra lateral, filtros, exportar CSV,
// detalhes de uma falha (log filtrado, salvar .txt), "Executar agora" pelo Painel e limpar o histórico.
// O "Salvar como" nativo dos downloads é trocado (no main) por um caminho temporário.
import type { ElectronApplication } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, makeDir, saveRoutine, sidebar, test, toast, waitRunFinished, type G } from './flows-helpers'

/** Os próximos downloads vão para `dir` (sem o "Salvar como" nativo); devolve os nomes sugeridos. */
async function captureDownloads(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ session }, d) => {
    session.defaultSession.on('will-download', (_e, item) => {
      item.setSavePath(`${d}/${item.getFilename()}`)
    })
  }, dir)
}

async function waitFile(path: string): Promise<string> {
  await expect.poll(() => existsSync(path) && readFileSync(path).length > 0, { timeout: 15_000 }).toBe(true)
  return readFileSync(path, 'utf8')
}

test('Histórico: falha não vista, filtros, CSV, log da falha, Painel e limpar', async ({ bcApp }) => {
  const { app, page } = bcApp
  const downloads = makeDir('bcb-flow-dl-')
  await captureDownloads(app, downloads)

  const src = makeDir('bcb-flow-hist-src-')
  writeFileSync(join(src, 'relatório.txt'), 'ok')
  const ok = await saveRoutine(page, 'Relatórios', src, [makeDir('bcb-flow-hist-dest-')])
  const missingDest = join(makeDir('bcb-flow-hist-gone-'), 'disco-desconectado')
  const bad = await saveRoutine(page, 'Servidor antigo', src, [missingDest])

  await test.step('duas execuções: uma concluída e uma falha (destino desconectado)', async () => {
    for (const r of [ok, bad]) {
      const done = waitRunFinished(page, r.name)
      await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), r.id)
      await done
    }
    await expect(toast(page, 'Falha no backup')).toContainText('Servidor antigo')
    // Barra lateral: a falha ainda não vista aparece no Histórico.
    await expect(sidebar(page, /^Histórico, 1 falha não vista$/)).toBeVisible()
  })

  await test.step('Painel: hero de atenção e últimas execuções', async () => {
    await sidebar(page, 'Painel').click()
    const recent = page.getByRole('table', { name: 'Últimas execuções' })
    await expect(recent.getByRole('row')).toHaveCount(2)
    await expect(recent.getByRole('button', { name: 'Ver detalhes: Servidor antigo' })).toBeVisible()
  })

  await test.step('Histórico: visitar zera o aviso; filtros por status e rotina', async () => {
    await sidebar(page, 'Histórico').click()
    await expect(sidebar(page, 'Histórico')).toHaveAccessibleName('Histórico')
    const table = page.getByRole('table', { name: 'Execuções' })
    const rows = table.getByRole('button', { name: /^Ver detalhes:/ })
    await expect(rows).toHaveCount(2)
    await page.getByRole('radio', { name: /^Falhou/ }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAccessibleName(/^Ver detalhes: Servidor antigo, Falhou,/)
    await page.getByRole('radio', { name: /^Concluído/ }).click()
    await page.getByRole('combobox', { name: 'Rotina' }).click()
    await page.getByRole('option', { name: 'Servidor antigo' }).click()
    await expect(page.getByRole('heading', { name: 'Nada encontrado' })).toBeVisible()
    await page.getByRole('button', { name: 'Limpar filtros' }).click()
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole('combobox', { name: 'Rotina' })).toHaveText(/Todas as rotinas/)
  })

  await test.step('Exportar CSV (Excel em pt-BR: BOM e ";")', async () => {
    await page.getByRole('button', { name: 'Exportar CSV' }).click()
    await expect(toast(page, 'Histórico exportado')).toContainText('2 execuções')
    const today = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `bc-backup-historico-${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}.csv`
    const csv = await waitFile(join(downloads, name))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Início;Fim;Rotina;Status;Origem;Duração (s);Arquivos;Bytes;Avisos;Erros;Mensagem')
    expect(lines).toHaveLength(3)
    expect(lines.some((l) => l.includes(';Servidor antigo;Falhou;'))).toBe(true)
    expect(lines.some((l) => l.includes(';Relatórios;Concluído;'))).toBe(true)
  })

  await test.step('detalhes da falha: o que aconteceu, log filtrado e salvo em .txt', async () => {
    await page.getByRole('button', { name: /^Ver detalhes: Servidor antigo, Falhou/ }).click()
    const drawer = page.getByRole('dialog', { name: /Servidor antigo/ })
    await expect(drawer.getByText('O que aconteceu')).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Executar novamente' })).toBeVisible()
    await drawer.getByRole('tab', { name: /^Log/ }).click()
    const log = drawer.getByRole('region', { name: /^Log · \d+ linhas?$/ })
    const all = Number(/(\d+)/.exec((await log.getAttribute('aria-label')) ?? '')?.[1])
    await drawer.getByText('Só erros e avisos').click()
    await expect(drawer.getByRole('checkbox', { name: 'Só erros e avisos' })).toBeChecked()
    await expect(log).not.toHaveAccessibleName(`Log · ${all} linhas`)
    await expect(log.getByText('ERRO').first()).toBeVisible()
    await expect(log.getByText('INFO', { exact: true })).toHaveCount(0)
    await drawer.getByRole('textbox', { name: 'Buscar no log' }).fill('texto que não existe')
    await expect(drawer.getByText('Nenhuma linha corresponde ao filtro.')).toBeVisible()
    await drawer.getByRole('textbox', { name: 'Buscar no log' }).fill('')
    await drawer.getByRole('button', { name: 'Salvar como .txt' }).click()
    await expect
      .poll(() => readdirSync(downloads))
      .toContainEqual(expect.stringMatching(/^bc-backup-log-Servidor antigo-.*\.txt$/))
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  })

  await test.step('limpar o histórico com confirmação', async () => {
    await page.getByRole('main').getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Limpar histórico' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Limpar todo o histórico?' })
    await confirm.getByRole('button', { name: 'Limpar histórico' }).click()
    await expect(toast(page, 'Histórico limpo')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nenhuma execução ainda' })).toBeVisible()
    await page.getByRole('button', { name: 'Executar uma rotina agora' }).click()
    await expect(page).toHaveURL(/#\/rotinas$/)
  })
})
