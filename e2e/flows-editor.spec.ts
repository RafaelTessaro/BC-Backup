// Detalhes do editor e da execução pela interface real: rascunho guardado ao sair para configurar o
// e-mail, caminho de rede digitado, remover itens com o foco no lugar certo, e parar um backup no meio.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  continueButton,
  expect,
  makeDir,
  queueDialog,
  saveRoutine,
  sidebar,
  stepHeading,
  test,
  toast
} from './flows-helpers'

test('rascunho guardado ao configurar o e-mail, caminho de rede e remover itens', async ({ bcApp }) => {
  const { app, page } = bcApp
  const a = join(makeDir('bcb-flow-ed-'), 'Planilhas')
  const b = join(makeDir('bcb-flow-ed-'), 'Contratos')
  for (const d of [a, b]) {
    mkdirSync(d)
    writeFileSync(join(d, 'x.txt'), d)
  }
  const dest = makeDir('bcb-flow-ed-dest-')

  await test.step('remover uma origem leva o foco para a próxima', async () => {
    await page.keyboard.press('Control+n')
    await queueDialog(app, [a, b])
    await page.getByRole('button', { name: 'Adicionar pastas' }).click()
    // Sem nome digitado: sugere o da primeira pasta.
    await expect(page.getByLabel('Nome da rotina')).toHaveValue('Planilhas')
    await page.getByRole('button', { name: 'Remover Planilhas' }).click()
    await expect(page.getByRole('button', { name: 'Remover Contratos' })).toBeFocused()
    await page.getByRole('button', { name: 'Remover Contratos' }).click()
    await expect(page.getByRole('button', { name: 'Adicionar pastas' })).toBeFocused()
    // Continuar sem origem: fica na etapa e mostra o problema.
    await continueButton(page).click()
    await expect(stepHeading(page)).toHaveText('O que você quer copiar?')
    await expect(page.getByRole('alert').first()).toBeVisible()
    await queueDialog(app, [b])
    await page.getByRole('button', { name: 'Adicionar pastas' }).click()
    await page.getByLabel('Nome da rotina').fill('Contratos do cliente')
    await continueButton(page).click()
  })

  await test.step('caminho de rede digitado: formato inválido, Esc e válido', async () => {
    await expect(stepHeading(page)).toHaveText('Para onde as cópias vão?')
    await page.getByRole('button', { name: 'Adicionar destino' }).click()
    await page.getByRole('menuitem', { name: 'Digitar caminho de rede…' }).click()
    const typed = page.getByRole('textbox', { name: 'Caminho de rede' })
    await expect(typed).toBeFocused()
    await typed.fill('servidor')
    await typed.press('Enter')
    await expect(
      page.getByText('Use o formato \\\\SERVIDOR\\pasta (ou uma unidade, como E:\\).')
    ).toBeVisible()
    await expect(typed).toHaveAttribute('aria-invalid', 'true')
    await typed.press('Escape')
    await expect(typed).toBeHidden()
    await expect(page.getByRole('button', { name: 'Adicionar destino' })).toBeFocused()
    await page.getByRole('button', { name: 'Adicionar destino' }).click()
    await page.getByRole('menuitem', { name: 'Digitar caminho de rede…' }).click()
    await typed.fill('//NAS/backup')
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
    await expect(page.getByText('\\\\NAS\\backup', { exact: true }).first()).toBeVisible()
    // Pasta local também, pelo seletor.
    await queueDialog(app, [dest])
    await page.getByRole('button', { name: 'Adicionar destino' }).click()
    await page.getByRole('menuitem', { name: 'Escolher uma pasta…' }).click()
    await expect(page.getByRole('meter')).toHaveCount(1)
    // A pasta de rede não existe aqui: remover devolve o foco para "Adicionar destino".
    await page.getByRole('button', { name: /^Remover .*NAS/ }).click()
    await expect(page.getByText('\\\\NAS\\backup', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Adicionar destino' })).toBeFocused()
    await continueButton(page).click()
    await continueButton(page).click()
    await continueButton(page).click()
  })

  await test.step('"Configurar e-mail" guarda o rascunho e "Voltar para a rotina" o devolve', async () => {
    await expect(stepHeading(page)).toHaveText('Avisar alguém?')
    await page.getByRole('switch', { name: 'Enviar e-mail ao terminar' }).click()
    const to = page.getByRole('textbox', { name: 'Destinatários' })
    await to.fill('dono@cliente.com.br')
    await to.press('Enter')
    await page.getByRole('button', { name: 'Configurar e-mail' }).click()
    await expect(page).toHaveURL(/#\/configuracoes\/email$/)
    await expect(toast(page, 'Rascunho guardado')).toContainText('Contratos do cliente')
    await expect(page.getByText('Rascunho guardado: Contratos do cliente')).toBeVisible()
    await page.getByRole('main').getByRole('button', { name: 'Voltar para a rotina' }).click()
    await expect(stepHeading(page)).toHaveText('Avisar alguém?')
    // De volta ao rascunho, o aviso com "Voltar para a rotina" some (não leva a um editor vazio depois).
    await expect(toast(page, 'Rascunho guardado')).toHaveCount(0, { timeout: 2000 })
    await expect(page.getByLabel('Nome da rotina')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Remover dono@cliente.com.br' })).toBeVisible()
    // As etapas já vistas continuam liberadas.
    const steps = page.getByRole('navigation', { name: 'Etapas da rotina' })
    await steps.getByRole('button', { name: /^Origem/ }).click()
    await expect(page.getByLabel('Nome da rotina')).toHaveValue('Contratos do cliente')
    await expect(page.getByRole('button', { name: 'Remover Contratos' })).toBeVisible()
    // Rotina nova: não dá para pular etapas ainda não vistas.
    await expect(steps.getByRole('button', { name: 'Revisão', exact: true })).toBeDisabled()
    await expect(steps.getByRole('button', { name: 'Origem', exact: true })).toHaveAttribute(
      'aria-current',
      'step'
    )
    await expect(steps.getByRole('button', { name: 'Agendamento (concluída)' })).toBeEnabled()
    await steps.getByRole('button', { name: /^Notificação/ }).click()
    await continueButton(page).click()
    await expect(stepHeading(page)).toHaveText('Tudo certo?')
    await page.getByRole('button', { name: 'Criar rotina' }).click()
    await expect(toast(page, 'Rotina criada')).toBeVisible()
    // Rascunho consumido: "Nova rotina" volta a começar do zero.
    await sidebar(page, 'Configurações').click()
    await page.getByRole('radio', { name: 'E-mail' }).click()
    await expect(page.getByRole('main').getByText(/^Rascunho guardado/)).toHaveCount(0)
    await page.keyboard.press('Control+n')
    await expect(page.getByLabel('Nome da rotina')).toHaveValue('')
  })
})

test('parar um backup no meio pelo drawer de progresso', async ({ bcApp }) => {
  const { page } = bcApp
  const src = join(makeDir('bcb-flow-stop-'), 'Vídeos')
  mkdirSync(src)
  for (let i = 0; i < 40; i++) writeFileSync(join(src, `video-${i}.mp4`), Buffer.alloc(16 * 1024 * 1024, i))
  const dest = makeDir('bcb-flow-stop-dest-')
  await saveRoutine(page, 'Vídeos da loja', src, [dest])

  await sidebar(page, 'Painel').click()
  // O botão do cabeçalho (menu "Escolha a rotina"); as próximas execuções têm o seu próprio.
  await page.getByRole('button', { name: 'Executar agora' }).first().click()
  await page.getByRole('menuitem', { name: 'Vídeos da loja' }).click()
  const drawer = page.getByRole('dialog', { name: /Vídeos da loja/ })
  await expect(
    drawer.getByRole('progressbar', { name: 'Progresso do backup de Vídeos da loja' })
  ).toBeVisible()
  await drawer.getByRole('button', { name: 'Parar' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Parar “Vídeos da loja”?' })
  // O texto diz o que o motor faz de verdade: a cópia em andamento é apagada.
  await expect(confirm).toContainText(
    'A cópia em andamento será descartada: nenhum backup incompleto fica no destino'
  )
  await confirm.getByRole('button', { name: 'Parar backup' }).click()
  await expect(toast(page, 'Backup cancelado')).toContainText(
    'Vídeos da loja · a cópia incompleta foi descartada.'
  )
  await expect(drawer.getByRole('button', { name: 'Ver detalhes' })).toBeVisible()
  await expect(drawer).toContainText('Cancelado')
  // Nada fica no destino: nem pasta "em andamento" nem backup sem manifesto.
  expect(readdirSync(dest)).toEqual([])
  await drawer.getByRole('button', { name: 'Ver detalhes' }).click()
  const detail = page.getByRole('dialog', { name: /Vídeos da loja/ })
  await expect(detail.getByRole('tab', { name: 'Resumo' })).toBeVisible()
  await expect(detail.getByText('Cancelado').first()).toBeVisible()
})
