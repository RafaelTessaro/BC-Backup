// Fluxo 1 (primeira abertura → primeira rotina → backup → histórico), conferido no disco, e o painel
// da bandeja mostrando a execução. Tudo pela interface real, clicando e digitando como o usuário.
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { IN_PROGRESS_MARKER_FILE, MANIFEST_FILE } from '../src/shared/defaults'
import { trayPage } from './fixtures'
import {
  continueButton,
  expect,
  filesUnder,
  makeAccountingTree,
  makeDir,
  queueDialog,
  readClipboard,
  sha256,
  sidebar,
  stepHeading,
  test,
  toast,
  writeClipboard
} from './flows-helpers'

const STAMP = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/
const NAME = 'Contabilidade do escritório'

function makePhotos(): string {
  const root = join(makeDir('bcb-flow-src2-'), 'Fotos da loja')
  mkdirSync(join(root, 'Vitrine'), { recursive: true })
  writeFileSync(join(root, 'Vitrine', 'fachada.jpg'), Buffer.alloc(300 * 1024, 9))
  writeFileSync(join(root, 'Vitrine', 'balcão.jpg'), Buffer.alloc(200 * 1024, 4))
  writeFileSync(join(root, 'cardápio.pdf'), 'cardápio do dia')
  return root
}

test('primeira rotina pela interface: cria, executa, confere no disco, histórico e bandeja', async ({
  bcApp
}) => {
  const { app, page } = bcApp
  const contab = makeAccountingTree()
  const photos = makePhotos()
  const destA = makeDir('bcb-flow-destA-')
  const destB = makeDir('bcb-flow-destB-')

  await test.step('estado vazio → "Criar primeira rotina"', async () => {
    await expect(page.getByRole('heading', { name: 'Vamos proteger seus arquivos' })).toBeVisible()
    await page.getByRole('button', { name: 'Criar primeira rotina' }).click()
    await expect(stepHeading(page)).toHaveText('O que você quer copiar?')
    await expect(page.getByLabel('Nome da rotina')).toBeFocused()
  })

  await test.step('Origem: nome, duas pastas pelo seletor (cancelar não muda nada)', async () => {
    await page.getByLabel('Nome da rotina').fill(NAME)
    await queueDialog(app, [contab])
    await page.getByRole('button', { name: 'Adicionar pastas' }).click()
    await expect(page.getByRole('button', { name: 'Remover Contabilidade' })).toBeVisible()
    // Seletor cancelado: nada muda.
    await queueDialog(app)
    await page.getByRole('button', { name: 'Adicionar pastas' }).click()
    // Mesma pasta de novo: não duplica.
    await queueDialog(app, [contab, photos])
    await page.getByRole('button', { name: 'Adicionar pastas' }).click()
    await expect(page.getByRole('button', { name: /^Remover / })).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Remover Fotos da loja' })).toBeVisible()
    // O nome digitado não é trocado pelo da pasta.
    await expect(page.getByLabel('Nome da rotina')).toHaveValue(NAME)
    // Tamanho estimado: 55 arquivos da contabilidade (sem o Thumbs.db) + 3 fotos.
    await expect(page.getByText(/≈\s*\S+ \S+ em 58 arquivos/)).toBeVisible()
    await continueButton(page).click()
  })

  await test.step('Destinos: duas pastas, barras de disco, apelido e exemplo da estrutura', async () => {
    await expect(stepHeading(page)).toHaveText('Para onde as cópias vão?')
    await expect(page.getByRole('heading', { name: 'Nenhum destino ainda' })).toBeVisible()
    for (const dest of [destA, destB]) {
      await queueDialog(app, [dest])
      await page.getByRole('button', { name: 'Adicionar destino' }).click()
      await page.getByRole('menuitem', { name: 'Escolher uma pasta…' }).click()
      await expect(
        page.getByRole('switch', { name: `Usar ${dest.split('/').pop()} nas execuções` })
      ).toBeChecked()
    }
    // Barra de uso de cada disco (meter) com a legenda de espaço livre.
    await expect(page.getByRole('meter')).toHaveCount(2)
    await expect(page.getByText(/livres de/).first()).toBeVisible()
    // O foco volta para "Adicionar destino" depois de adicionar.
    await expect(page.getByRole('button', { name: 'Adicionar destino' })).toBeFocused()
    await page.getByRole('textbox', { name: 'Apelido' }).first().fill('HD externo')
    await expect(page.getByRole('switch', { name: 'Usar HD externo nas execuções' })).toBeVisible()
    await expect(page.getByText('Com várias origens, cada uma fica numa subpasta dentro dela.')).toBeVisible()
    await expect(
      page.getByText(new RegExp(`${destA}/\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}$`))
    ).toBeVisible()
    await continueButton(page).click()
  })

  await test.step('Agendamento: dias da semana, horários e intervalo', async () => {
    await expect(stepHeading(page)).toHaveText('Quando executar?')
    await page.getByRole('radio', { name: 'Dias da semana' }).click()
    const days = page.getByRole('toolbar', { name: 'Dias da semana' })
    await expect(days.getByRole('button', { name: 'Segunda' })).toHaveAttribute('aria-pressed', 'true')
    await days.getByRole('button', { name: 'Sábado' }).click()
    await expect(days.getByRole('button', { name: 'Sábado' })).toHaveAttribute('aria-pressed', 'true')
    // Horário digitado "730" vira 07:30.
    const first = page.getByRole('textbox', { name: 'Horário 1' })
    await first.fill('730')
    await first.press('Enter')
    await expect(first).toHaveValue('07:30')
    await page.getByRole('button', { name: 'Adicionar horário' }).click()
    await expect(page.getByRole('textbox', { name: 'Horário 2' })).toHaveValue('13:30')
    await expect(page.getByText(/Próxima execução:/)).toBeVisible()
    // Intervalo: a cada 2 horas, depois volta para dias da semana (horários preservados).
    await page.getByRole('radio', { name: 'Intervalo' }).click()
    await page.getByRole('combobox', { name: 'Intervalo' }).click()
    await page.getByRole('option', { name: '2 horas', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Intervalo' })).toHaveText(/2 horas/)
    await page.getByRole('radio', { name: 'Dias da semana' }).click()
    await expect(page.getByRole('textbox', { name: 'Horário 1' })).toHaveValue('07:30')
    await expect(page.getByRole('textbox', { name: 'Horário 2' })).toHaveValue('13:30')
    await continueButton(page).click()
  })

  await test.step('Retenção: dias e mínimo', async () => {
    await expect(stepHeading(page)).toHaveText('Por quanto tempo guardar?')
    await page.getByRole('button', { name: '15 dias' }).click()
    await expect(page.getByRole('button', { name: '15 dias' })).toHaveAttribute('aria-pressed', 'true')
    const days = page.getByRole('textbox', { name: 'Dias para guardar os backups' })
    await days.fill('20')
    await days.press('Tab')
    await expect(days).toHaveValue('20')
    await expect(page.getByRole('button', { name: '15 dias' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Aumentar mínimo de backups guardados' }).click()
    await page.getByRole('button', { name: 'Aumentar mínimo de backups guardados' }).click()
    await expect(page.getByRole('textbox', { name: 'Mínimo de backups guardados' })).toHaveValue('5')
    await expect(page.getByText(/^Até \d+ backups em cada destino/)).toBeVisible()
    await continueButton(page).click()
  })

  await test.step('Notificação: e-mails válidos, inválido e lista colada', async () => {
    await expect(stepHeading(page)).toHaveText('Avisar alguém?')
    await page.getByRole('switch', { name: 'Enviar e-mail ao terminar' }).click()
    const to = page.getByRole('textbox', { name: 'Destinatários' })
    await to.fill('cliente@empresa.com.br')
    await to.press('Enter')
    await expect(page.getByRole('button', { name: 'Remover cliente@empresa.com.br' })).toBeVisible()
    // Inválido: fica marcado com a mensagem junto do campo e bloqueia o "Continuar".
    await to.fill('contato@')
    await to.press('Enter')
    await expect(page.getByText('E-mail inválido: contato@. Corrija ou remova.')).toBeVisible()
    await continueButton(page).click()
    await expect(stepHeading(page)).toHaveText('Avisar alguém?')
    await page.getByRole('button', { name: 'Remover contato@' }).click()
    await expect(page.getByText(/E-mail inválido/)).toHaveCount(0)
    // Lista colada do Outlook: nomes, maiúsculas, ";" e "," — só os endereços entram, sem repetir.
    await writeClipboard(
      app,
      'Carla Souza <Carla@Contabil.com.br>; ti@empresa.com.br, cliente@empresa.com.br'
    )
    await to.focus()
    await page.keyboard.press('Control+V')
    await expect(page.getByRole('button', { name: /^Remover / })).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Remover carla@contabil.com.br' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remover ti@empresa.com.br' })).toBeVisible()
    // SMTP ainda não configurado: aviso, sem bloquear.
    await expect(page.getByText('E-mail ainda não configurado')).toBeVisible()
    await continueButton(page).click()
  })

  await test.step('Revisão: resumo de tudo', async () => {
    await expect(stepHeading(page)).toHaveText('Tudo certo?')
    await expect(page.getByText(NAME, { exact: true }).last()).toBeVisible()
    await expect(page.getByText('2 pastas', { exact: false })).toBeVisible()
    await expect(page.getByText('HD externo', { exact: true })).toBeVisible()
    await expect(page.getByText('Seg, Ter, Qua, Qui, Sex e Sáb às 07:30 e 13:30')).toBeVisible()
    await expect(page.getByText('Guardar por 20 dias')).toBeVisible()
    await expect(
      page.getByText('E-mail para cliente@empresa.com.br, carla@contabil.com.br, ti@empresa.com.br')
    ).toBeVisible()
  })

  let runId = ''
  await test.step('"Criar e executar agora": progresso ao vivo e aviso de sucesso', async () => {
    const finished = page.evaluate(
      (name) =>
        new Promise<{ id: string; status: string }>((resolve) => {
          const off = (
            globalThis as unknown as {
              bc: {
                on: {
                  runFinished(
                    cb: (r: { id: string; status: string; routineName: string }) => void
                  ): () => void
                }
              }
            }
          ).bc.on.runFinished((r) => {
            if (r.routineName === name) {
              off()
              resolve(r)
            }
          })
        }),
      NAME
    )
    await page.getByRole('button', { name: 'Criar e executar agora' }).click()
    await expect(toast(page, 'Rotina criada')).toBeVisible()
    const drawer = page.getByRole('dialog', { name: new RegExp(NAME) })
    await expect(drawer).toBeVisible()
    await expect(page).toHaveURL(/#\/rotinas$/)
    // Progresso ao vivo (percentual ou fase) enquanto copia.
    await expect(drawer.getByRole('progressbar', { name: `Progresso do backup de ${NAME}` })).toBeVisible()
    const r = await finished
    expect(r.status).toBe('success')
    runId = r.id
    await expect(drawer.getByText('Backup concluído')).toBeVisible()
    await expect(toast(page, 'Backup concluído')).toContainText(`${NAME} · 58 arquivos`)
    await drawer.getByRole('button', { name: 'Fechar' }).last().click()
    await expect(drawer).toBeHidden()
  })

  await test.step('no disco: pasta datada direto no destino, uma subpasta por origem, sha256 igual', async () => {
    for (const dest of [destA, destB]) {
      const entries = readdirSync(dest)
      expect(entries, `só a pasta datada em ${dest}`).toHaveLength(1)
      expect(entries[0]).toMatch(STAMP)
      const snap = join(dest, entries[0])
      expect(readdirSync(snap).sort()).toEqual(['Contabilidade', 'Fotos da loja', MANIFEST_FILE].sort())
      expect(existsSync(join(snap, IN_PROGRESS_MARKER_FILE))).toBe(false)
      for (const [src, sub] of [
        [contab, 'Contabilidade'],
        [photos, 'Fotos da loja']
      ]) {
        const expected = filesUnder(src).filter((f) => f !== 'Thumbs.db')
        expect(filesUnder(join(snap, sub))).toEqual(expected)
        for (const f of expected) expect(sha256(join(snap, sub, f)), f).toBe(sha256(join(src, f)))
      }
    }
  })

  await test.step('Histórico: a execução, detalhes com Resumo e Log, "Copiar log"', async () => {
    await sidebar(page, 'Histórico').click()
    const row = page.getByRole('button', { name: new RegExp(`^Ver detalhes: ${NAME}, Concluído`) })
    await expect(row).toBeVisible()
    await row.click()
    const drawer = page.getByRole('dialog', { name: new RegExp(NAME) })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: 'Resumo' })).toHaveAttribute('aria-selected', 'true')
    await expect(drawer.getByText('HD externo', { exact: true })).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Executar novamente' })).toBeVisible()
    await drawer.getByRole('tab', { name: /^Log/ }).click()
    const log = drawer.getByRole('region', { name: /^Log · \d+ linhas$/ })
    await expect(log).toBeVisible()
    await drawer.getByRole('button', { name: 'Copiar log' }).click()
    await expect(toast(page, 'Log copiado')).toBeVisible()
    const copied = await readClipboard(app)
    expect(copied.split('\n').length).toBeGreaterThan(3)
    expect(copied).toMatch(/^\d{2}:\d{2}:\d{2} {2}INFO /)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    expect(runId).toBeTruthy()
  })

  await test.step('bandeja: o painel mostra a última execução e abre o app', async () => {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes('tray.html'))
        ?.hide()
    )
    const opened = await app.evaluate(() =>
      (globalThis as { __bcTrayToggle?: (b?: unknown) => boolean }).__bcTrayToggle?.({
        x: 1180,
        y: 994,
        width: 24,
        height: 24
      })
    )
    expect(opened).toBe(true)
    const panel = await trayPage(app)
    await expect(panel.getByRole('heading', { name: 'Tudo protegido' })).toBeVisible()
    await expect(
      panel.getByRole('button', { name: new RegExp(`^${NAME}, Concluído, .*Abrir detalhes$`) })
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Abrir o BC Backup' }).click()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((w) => !w.webContents.getURL().includes('tray.html'))
            ?.isVisible()
        )
      )
      .toBe(true)
  })
})
