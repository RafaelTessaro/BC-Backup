// Fluxo 3: editar uma rotina (navegação livre pelas etapas, aviso de alterações não salvas ao sair),
// pausar/retomar, duplicar e excluir com confirmação — pela interface real.
import { trayPage } from './fixtures'
import {
  expect,
  listRoutines,
  makeDir,
  routineRow,
  saveRoutine,
  sidebar,
  stepHeading,
  test,
  toast,
  waitRunFinished,
  type G
} from './flows-helpers'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'Financeiro'

test('editar, sair sem salvar, pausar/retomar, duplicar e excluir', async ({ bcApp }) => {
  const { page } = bcApp
  const src = makeDir('bcb-flow-fin-')
  writeFileSync(join(src, 'caixa.xlsx'), 'planilha')
  const saved = await saveRoutine(page, NAME, src, [makeDir('bcb-flow-fin-dest-')])

  await sidebar(page, 'Rotinas').click()
  const row = routineRow(page, NAME)
  await expect(row).toBeVisible()
  await expect(row).toContainText('Todo dia às 18:00')

  await test.step('editor: sem alterações, sair não pergunta nada', async () => {
    await row.getByRole('button', { name: `Editar ${NAME}`, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled()
    await sidebar(page, 'Painel').click()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page).toHaveURL(/#\/painel$/)
  })

  await test.step('navegação livre pelas etapas e aviso ao sair com alterações', async () => {
    await sidebar(page, 'Rotinas').click()
    await row.click()
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible()
    const steps = page.getByRole('navigation', { name: 'Etapas da rotina' })
    // Rotina existente: todas as etapas abertas, em qualquer ordem.
    for (const s of ['Revisão', 'Retenção', 'Destinos', 'Agendamento']) {
      await expect(steps.getByRole('button', { name: new RegExp(`^${s}`) })).toBeEnabled()
    }
    await steps.getByRole('button', { name: /^Revisão/ }).click()
    await expect(stepHeading(page)).toHaveText('Tudo certo?')
    await expect(page.getByRole('button', { name: 'Salvar e executar' })).toBeVisible()
    await steps.getByRole('button', { name: /^Retenção/ }).click()
    await expect(stepHeading(page)).toHaveText('Por quanto tempo guardar?')
    await page.getByRole('button', { name: '30 dias' }).click()
    await expect(page.getByText('Alterações não salvas')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled()

    // Sair pela barra lateral: pergunta; "Continuar editando" mantém tudo.
    await sidebar(page, 'Histórico').click()
    const guard = page.getByRole('alertdialog', { name: 'Descartar alterações?' })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: 'Continuar editando' }).click()
    await expect(guard).toBeHidden()
    await expect(stepHeading(page)).toHaveText('Por quanto tempo guardar?')
    await expect(page.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true')

    // Voltar do navegador (botão do mouse) também pergunta; Esc cancela.
    await page.goBack()
    await expect(guard).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(guard).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`#/rotinas/${saved.id}$`))

    // "Cancelar" do rodapé → "Descartar": volta para Rotinas sem salvar.
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await guard.getByRole('button', { name: 'Descartar' }).click()
    await expect(page).toHaveURL(/#\/rotinas$/)
    expect((await listRoutines(page))[0].retention.days).toBe(7)
    await expect(row).toContainText('7 dias')
  })

  await test.step('editar e salvar: nome e retenção', async () => {
    await row.getByRole('button', { name: `Editar ${NAME}`, exact: true }).click()
    await page
      .getByRole('navigation', { name: 'Etapas da rotina' })
      .getByRole('button', { name: /^Retenção/ })
      .click()
    await page.getByRole('button', { name: '30 dias' }).click()
    await page
      .getByRole('navigation', { name: 'Etapas da rotina' })
      .getByRole('button', { name: /^Origem/ })
      .click()
    await page.getByLabel('Nome da rotina').fill('Financeiro 2026')
    await page.getByRole('button', { name: 'Salvar alterações' }).click()
    await expect(toast(page, 'Alterações salvas')).toBeVisible()
    await expect(page).toHaveURL(/#\/rotinas$/)
    const renamed = routineRow(page, 'Financeiro 2026')
    await expect(renamed).toContainText('30 dias')
    const [r] = await listRoutines(page)
    expect(r.name).toBe('Financeiro 2026')
    expect(r.retention.days).toBe(30)
  })

  const current = routineRow(page, 'Financeiro 2026')

  await test.step('pausar e retomar', async () => {
    await current.getByRole('button', { name: 'Pausar' }).click()
    await expect(toast(page, 'Rotina pausada')).toBeVisible()
    await expect(current).toContainText('Pausada')
    await expect(sidebar(page, 'Rotinas')).toBeVisible()
    await page.getByRole('radio', { name: /^Pausadas/ }).click()
    await expect(current).toBeVisible()
    await page.getByRole('radio', { name: /^Ativas/ }).click()
    await expect(page.getByRole('heading', { name: 'Nada encontrado' })).toBeVisible()
    await page.getByRole('radio', { name: /^Todas/ }).click()
    expect((await listRoutines(page))[0].enabled).toBe(false)
    await current.getByRole('button', { name: 'Retomar' }).click()
    await expect(toast(page, 'Rotina retomada')).toBeVisible()
    await expect(current.getByRole('button', { name: 'Pausar' })).toBeVisible()
    expect((await listRoutines(page))[0].enabled).toBe(true)
  })

  await test.step('duplicar e abrir a cópia', async () => {
    await current.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Duplicar' }).click()
    const t = toast(page, 'Rotina duplicada')
    await expect(t).toContainText('Financeiro 2026 (cópia)')
    await expect(routineRow(page, 'Financeiro 2026 (cópia)')).toBeVisible()
    await t.getByRole('button', { name: 'Editar cópia' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Financeiro 2026 (cópia)' })).toBeVisible()
    await sidebar(page, 'Rotinas').click()
    expect(await listRoutines(page)).toHaveLength(2)
  })

  await test.step('excluir com confirmação (cancelar primeiro)', async () => {
    const copy = routineRow(page, 'Financeiro 2026 (cópia)')
    await copy.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Excluir' }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Excluir a rotina “Financeiro 2026 (cópia)”?' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Cancelar' }).click()
    await expect(confirm).toBeHidden()
    await expect(copy).toBeVisible()
    await copy.getByRole('button', { name: 'Mais ações' }).click()
    await page.getByRole('menuitem', { name: 'Excluir' }).click()
    await confirm.getByRole('button', { name: 'Excluir rotina' }).click()
    await expect(toast(page, 'Rotina excluída')).toBeVisible()
    await expect(copy).toHaveCount(0)
    const left = await listRoutines(page)
    expect(left.map((r) => r.name)).toEqual(['Financeiro 2026'])
    // "Voltar" (botão do mouse) até o editor da cópia excluída: aviso amigável, sem quebrar.
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Rotina não encontrada' })).toBeVisible()
    await page.getByRole('button', { name: 'Voltar para Rotinas' }).click()
    await expect(routineRow(page, 'Financeiro 2026')).toBeVisible()
  })
})

test('bandeja "Abrir detalhes" com o editor alterado: abre por cima, sem perder o rascunho', async ({
  bcApp
}) => {
  const { app, page } = bcApp
  const src = makeDir('bcb-flow-trayed-')
  writeFileSync(join(src, 'a.txt'), 'a')
  const r = await saveRoutine(page, 'Clientes', src, [makeDir('bcb-flow-trayed-dest-')])
  const done = waitRunFinished(page, 'Clientes')
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), r.id)
  await done

  // Editando, com uma alteração não salva.
  await sidebar(page, 'Rotinas').click()
  await routineRow(page, 'Clientes').getByRole('button', { name: 'Editar Clientes', exact: true }).click()
  await page.getByLabel('Nome da rotina').fill('Clientes 2026')

  const openRunFromTray = async (): Promise<void> => {
    await app.evaluate(() =>
      (globalThis as { __bcTrayToggle?: (b?: unknown) => boolean }).__bcTrayToggle?.({
        x: 1180,
        y: 994,
        width: 24,
        height: 24
      })
    )
    const panel = await trayPage(app)
    await panel.getByRole('button', { name: /^Clientes, Concluído, .*Abrir detalhes$/ }).click()
  }

  const guard = page.getByRole('alertdialog', { name: 'Descartar alterações?' })
  const detail = page.getByRole('dialog', { name: /Clientes/ })
  await openRunFromTray()
  // Os detalhes abrem por cima do editor, sem sair dele nem perguntar (um modal só).
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('tab', { name: 'Resumo' })).toBeVisible()
  await expect(guard).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`#/rotinas/${r.id}$`))
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(page.getByLabel('Nome da rotina')).toHaveValue('Clientes 2026')
  // Sem alterações pendentes, o mesmo clique leva ao Histórico com os detalhes abertos.
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await guard.getByRole('button', { name: 'Descartar' }).click()
  await openRunFromTray()
  await expect(detail).toBeVisible()
  await expect(page).toHaveURL(/#\/historico$/)
  expect((await listRoutines(page))[0].name).toBe('Clientes')
})
