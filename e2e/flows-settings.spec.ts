// Fluxo 4: Configurações pela interface real — tema na hora, preferências gerais que sobrevivem a
// reabrir o app e a aba E-mail (provedor, regra da senha ao trocar de servidor, erro amigável no teste).
import type { ElectronApplication, Page } from '@playwright/test'
import { launch, mainWindow } from './fixtures'
import { expect, sidebar, test, toast, type G } from './flows-helpers'

const bgColor = (app: ElectronApplication): Promise<string | undefined> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('tray.html'))
      ?.getBackgroundColor()
  )

const systemPrefersDark = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      (globalThis as unknown as { matchMedia(q: string): { matches: boolean } }).matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches
  )

test('tema muda na hora e as preferências gerais continuam depois de reabrir', async ({ bcApp }) => {
  const { app, page, userData } = bcApp
  const html = page.locator('html')

  await sidebar(page, 'Configurações').click()
  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible()
  const theme = page.getByRole('radiogroup', { name: 'Tema' })

  await test.step('tema: Escuro, Claro e Sistema', async () => {
    await theme.getByRole('radio', { name: 'Escuro' }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => bgColor(app)).toMatch(/^#0A0D0C$/i)
    await theme.getByRole('radio', { name: 'Claro' }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await expect.poll(() => bgColor(app)).toMatch(/^#F8FAF9$/i)
    await theme.getByRole('radio', { name: 'Sistema' }).click()
    await expect(theme.getByRole('radio', { name: 'Sistema' })).toBeChecked()
    await expect(html).toHaveAttribute('data-theme', (await systemPrefersDark(page)) ? 'dark' : 'light')
    await theme.getByRole('radio', { name: 'Escuro' }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
  })

  await test.step('Geral: chaves, seleção, textos e número', async () => {
    const launchSwitch = page.getByRole('switch', { name: 'Iniciar com o sistema' })
    await expect(launchSwitch).toBeChecked()
    await launchSwitch.click()
    await expect(launchSwitch).not.toBeChecked()
    const notif = page.getByRole('switch', { name: 'Notificações do sistema' })
    await notif.click()
    await expect(notif).not.toBeChecked()
    await page.getByRole('combobox', { name: 'Ao fechar a janela' }).click()
    await page.getByRole('option', { name: 'Encerrar o BC Backup' }).click()
    await expect(page.getByText('Fechando o aplicativo, os backups agendados não rodam.')).toBeVisible()
    const client = page.getByRole('textbox', { name: 'Nome do cliente' })
    await client.fill('  Padaria Pão Quente  ')
    await client.press('Enter')
    await expect(toast(page, 'Configuração salva')).toBeVisible()
    await expect(client).toHaveValue('Padaria Pão Quente')
    // Esc desfaz o que foi digitado sem salvar.
    const alias = page.getByRole('textbox', { name: 'Apelido do computador' })
    await alias.fill('Recepção')
    await alias.press('Escape')
    await expect(alias).toHaveValue('')
    await page.getByRole('button', { name: 'Aumentar dias de histórico' }).click()
    await expect(page.getByRole('textbox', { name: 'Dias de histórico' })).toHaveValue('210')
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as G).bc.settings.get()))
      .toMatchObject({
        theme: 'dark',
        launchAtLogin: false,
        desktopNotifications: false,
        closeToTray: false,
        clientName: 'Padaria Pão Quente',
        computerAlias: '',
        historyDays: 210
      })
  })

  await test.step('reabrir o app com os mesmos dados: tudo como estava', async () => {
    await app.close()
    const again = await launch([], userData)
    try {
      const p2 = await mainWindow(again)
      // Tema escuro desde o primeiro quadro (sem piscar claro).
      await expect(p2.locator('html')).toHaveAttribute('data-theme', 'dark')
      await sidebar(p2, 'Configurações').click()
      await expect(p2.getByRole('switch', { name: 'Iniciar com o sistema' })).not.toBeChecked()
      await expect(p2.getByRole('switch', { name: 'Notificações do sistema' })).not.toBeChecked()
      await expect(p2.getByRole('combobox', { name: 'Ao fechar a janela' })).toHaveText(
        /Encerrar o BC Backup/
      )
      await expect(p2.getByRole('textbox', { name: 'Nome do cliente' })).toHaveValue('Padaria Pão Quente')
      await expect(p2.getByRole('textbox', { name: 'Dias de histórico' })).toHaveValue('210')
      await expect(
        p2.getByRole('radiogroup', { name: 'Tema' }).getByRole('radio', { name: 'Escuro' })
      ).toBeChecked()
    } finally {
      await again.app.close().catch(() => undefined)
    }
    expect(again.errors, 'erros no console depois de reabrir').toEqual([])
  })
})

test('E-mail: provedor preenche o servidor, senha pedida de novo ao trocar de servidor e erro amigável', async ({
  bcApp
}) => {
  const { page } = bcApp
  await sidebar(page, 'Configurações').click()
  await page
    .getByRole('radiogroup', { name: 'Seções das configurações' })
    .getByRole('radio', { name: 'E-mail' })
    .click()
  await expect(page).toHaveURL(/#\/configuracoes\/email$/)
  const host = page.getByRole('textbox', { name: 'Servidor' })
  const port = page.getByRole('textbox', { name: 'Porta' })
  const security = page.getByRole('radiogroup', { name: 'Segurança' })
  const password = page.getByLabel('Senha', { exact: true })
  const testButton = page.getByRole('button', { name: 'Enviar e-mail de teste' })

  await test.step('provedor Gmail preenche servidor, porta e segurança', async () => {
    await expect(page.getByText('E-mail ainda não configurado')).toBeVisible()
    await page
      .getByRole('radiogroup', { name: 'Provedor de e-mail' })
      .getByRole('radio', { name: 'Gmail' })
      .click()
    await expect(host).toHaveValue('smtp.gmail.com')
    await expect(port).toHaveValue('465')
    await expect(security.getByRole('radio', { name: 'SSL/TLS' })).toBeChecked()
    await expect(page.getByText(/senha de app/).first()).toBeVisible()
    await page
      .getByRole('radiogroup', { name: 'Provedor de e-mail' })
      .getByRole('radio', { name: 'Microsoft 365' })
      .click()
    await expect(host).toHaveValue('smtp.office365.com')
    await expect(port).toHaveValue('587')
    await expect(security.getByRole('radio', { name: 'STARTTLS' })).toBeChecked()
    await page
      .getByRole('radiogroup', { name: 'Provedor de e-mail' })
      .getByRole('radio', { name: 'Gmail' })
      .click()
  })

  await test.step('salvar a conta (a senha nunca volta para a interface)', async () => {
    await page.getByRole('textbox', { name: 'Usuário' }).fill('escritorio@gmail.com')
    await password.fill('senha-de-app-1234')
    await page.getByRole('textbox', { name: 'E-mail do remetente' }).fill('escritorio@gmail.com')
    await expect(page.getByText('Você tem alterações não salvas.')).toBeVisible()
    await page.getByRole('button', { name: 'Salvar', exact: true }).click()
    await expect(toast(page, 'E-mail configurado')).toBeVisible()
    await expect(password).toHaveValue('')
    await expect(password).toHaveAttribute('placeholder', '(senha salva)')
    await expect(page.getByText('Deixe em branco para manter a senha salva.')).toBeVisible()
    const smtp = await page.evaluate(async () => (await (globalThis as unknown as G).bc.settings.get()).smtp)
    expect(smtp).toMatchObject({ host: 'smtp.gmail.com', port: 465, hasPassword: true })
    expect(JSON.stringify(smtp)).not.toContain('senha-de-app')
  })

  await test.step('trocar o servidor exige digitar a senha de novo', async () => {
    await page
      .getByRole('radiogroup', { name: 'Provedor de e-mail' })
      .getByRole('radio', { name: 'Personalizado' })
      .click()
    await host.fill('127.0.0.1')
    await expect(page.getByText('Digite a senha novamente para o novo servidor.')).toBeVisible()
    await expect(testButton).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Salvar', exact: true })).toBeDisabled()
    // Voltar ao servidor salvo: a senha salva vale de novo.
    await host.fill('smtp.gmail.com')
    await expect(page.getByText('Digite a senha novamente para o novo servidor.')).toHaveCount(0)
    await host.fill('127.0.0.1')
    await port.fill('1')
    await security.getByRole('radio', { name: 'Nenhuma' }).click()
    await password.fill('outra-senha')
    await expect(page.getByText('Digite a senha novamente para o novo servidor.')).toHaveCount(0)
    await expect(testButton).toBeEnabled()
  })

  await test.step('teste com servidor fora do ar: mensagem amigável', async () => {
    await expect(page.getByRole('textbox', { name: 'Enviar para' })).toHaveValue('escritorio@gmail.com')
    await testButton.click()
    const result = page.getByText('Não foi possível enviar')
    await expect(result).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText('Conexão recusada (porta 1): porta fechada ou servidor incorreto.')
    ).toBeVisible()
    // "Descartar" volta ao que está salvo.
    await page.getByRole('button', { name: 'Descartar' }).click()
    await expect(host).toHaveValue('smtp.gmail.com')
    await expect(port).toHaveValue('465')
    await expect(password).toHaveValue('')
  })
})
