// Fluxo 7: só teclado (Tab, Enter, setas, Esc e atalhos) nos fluxos principais — criar uma rotina,
// executar, abrir os detalhes no Histórico, menus e confirmações — sem tocar no mouse.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  expect,
  focused,
  makeDir,
  queueDialog,
  routineRow,
  stepHeading,
  tabTo,
  test,
  toast,
  waitRunFinished
} from './flows-helpers'

const NAME = 'Notas do teclado'

test('só teclado: Ctrl+N, editor, executar, histórico, menus e Esc', async ({ bcApp }) => {
  const { app, page } = bcApp
  const src = join(makeDir('bcb-flow-kbd-'), 'Notas')
  const dest = makeDir('bcb-flow-kbd-dest-')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(src)
  writeFileSync(join(src, 'nota.txt'), 'teclado')

  await test.step('"Pular para o conteúdo" é a primeira parada do Tab', async () => {
    await expect(page.getByRole('heading', { name: 'Vamos proteger seus arquivos' })).toBeVisible()
    await page.keyboard.press('Tab')
    expect(await focused(page)).toBe('button: Pular para o conteúdo')
    await page.keyboard.press('Enter')
    await expect(page.locator('main#conteudo')).toBeFocused()
  })

  await test.step('Ctrl+N abre o editor com o foco no nome', async () => {
    await page.keyboard.press('Control+n')
    await expect(stepHeading(page)).toHaveText('O que você quer copiar?')
    await expect(page.getByLabel('Nome da rotina')).toBeFocused()
    await page.keyboard.type(NAME)
    await queueDialog(app, [src])
    await tabTo(page, 'Adicionar pastas')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Remover Notas' })).toBeVisible()
  })

  await test.step('Continuar pelo teclado (Tab até o botão e Ctrl+Enter)', async () => {
    await tabTo(page, 'Continuar')
    await page.keyboard.press('Enter')
    await expect(stepHeading(page)).toHaveText('Para onde as cópias vão?')
    // Troca de etapa: foco no título (o leitor de tela anuncia a etapa).
    await expect(stepHeading(page)).toBeFocused()
    // Ctrl+Enter sem destino: fica na etapa e leva o foco ao problema.
    await page.keyboard.press('Control+Enter')
    await expect(page.getByText('Escolha pelo menos um destino', { exact: false })).toBeVisible()
    await expect(stepHeading(page)).toHaveText('Para onde as cópias vão?')
    // "Adicionar destino" → menu com as setas → "Escolher uma pasta…".
    await queueDialog(app, [dest])
    await tabTo(page, 'Adicionar destino', { back: true })
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    // End = último item ("Digitar caminho de rede…"); ↑ = "Escolher uma pasta…".
    await expect(page.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('End')
    await expect.poll(() => focused(page)).toBe('menuitem: Digitar caminho de rede…')
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => focused(page)).toBe('menuitem: Escolher uma pasta…')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('meter')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Adicionar destino' })).toBeFocused()
    await page.keyboard.press('Control+Enter')
    await expect(stepHeading(page)).toHaveText('Quando executar?')
  })

  await test.step('Agendamento com as setas (grupo de opções) e o resto com Ctrl+Enter', async () => {
    await tabTo(page, /^radio: Diariamente/)
    // Setas seguidas, rápidas (a etapa troca de conteúdo a cada uma): a seleção acompanha o foco.
    for (const kind of ['Dias da semana', 'Intervalo', 'Ao ligar o PC', 'Manual']) {
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('radio', { name: kind })).toBeChecked()
      await expect(page.getByRole('radio', { name: kind })).toBeFocused()
    }
    // Volta ao início (loop) e retorna.
    for (const [key, kind] of [
      ['ArrowRight', 'Diariamente'],
      ['ArrowLeft', 'Manual']
    ]) {
      await page.keyboard.press(key)
      await expect(page.getByRole('radio', { name: kind })).toBeChecked()
      await expect(page.getByRole('radio', { name: kind })).toBeFocused()
    }
    await expect(page.getByText('Sem horário fixo.')).toBeVisible()
    await page.keyboard.press('Control+Enter')
    await expect(stepHeading(page)).toHaveText('Por quanto tempo guardar?')
    await page.keyboard.press('Control+Enter')
    await expect(stepHeading(page)).toHaveText('Avisar alguém?')
    await page.keyboard.press('Control+Enter')
    await expect(stepHeading(page)).toHaveText('Tudo certo?')
    // Na revisão, Ctrl+Enter cria a rotina.
    await page.keyboard.press('Control+Enter')
    await expect(toast(page, 'Rotina criada')).toBeVisible()
    await expect(page).toHaveURL(/#\/rotinas$/)
  })

  await test.step('Rotinas: executar pelo botão da linha e abrir o progresso', async () => {
    const row = routineRow(page, NAME)
    await expect(row).toBeVisible()
    const finished = waitRunFinished(page, NAME)
    await tabTo(page, 'Executar agora')
    await page.keyboard.press('Enter')
    const started = toast(page, 'Backup iniciado')
    await expect(started).toBeVisible()
    expect((await finished).status).toBe('success')
    await expect(toast(page, 'Backup concluído')).toBeVisible()
  })

  await test.step('menu "Mais ações" e confirmação de exclusão com o teclado (Esc cancela)', async () => {
    await tabTo(page, 'Mais ações')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByRole('menuitem', { name: 'Excluir' })).toBeFocused()
    await page.keyboard.press('Enter')
    const confirm = page.getByRole('alertdialog', { name: `Excluir a rotina “${NAME}”?` })
    await expect(confirm).toBeVisible()
    // Foco dentro do diálogo; Esc fecha e devolve o foco ao "Mais ações".
    expect(await focused(page)).toMatch(/^button: (Cancelar|Excluir rotina)$/)
    await page.keyboard.press('Escape')
    await expect(confirm).toBeHidden()
    await expect(routineRow(page, NAME).getByRole('button', { name: 'Mais ações' })).toBeFocused()
  })

  await test.step('Histórico: abrir detalhes com Enter, trocar de aba com as setas e fechar com Esc', async () => {
    await tabTo(page, /^button: Histórico/, { back: true, max: 60 })
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/historico$/)
    const open = await tabTo(page, new RegExp(`^button: Ver detalhes: ${NAME}, Concluído`), { max: 60 })
    expect(open).toBeTruthy()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: new RegExp(NAME) })
    await expect(drawer).toBeVisible()
    // Tab passa pelo "Fechar" (Tooltip abre no foco) até a aba Resumo; Esc logo depois fecha o drawer.
    expect(await tabTo(page, 'Fechar')).toBe('button: Fechar')
    await expect(page.getByRole('tooltip', { name: 'Fechar' })).toBeVisible()
    await tabTo(page, /^tab: Resumo/)
    await page.keyboard.press('ArrowRight')
    await expect(drawer.getByRole('tab', { name: /^Log/ })).toHaveAttribute('aria-selected', 'true')
    await expect(drawer.getByRole('region', { name: /^Log · / })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(page.getByRole('button', { name: new RegExp(`^Ver detalhes: ${NAME}`) })).toBeFocused()
  })

  await test.step('Ctrl+, abre as Configurações', async () => {
    await page.keyboard.press('Control+,')
    await expect(page).toHaveURL(/#\/configuracoes$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible()
  })
})
