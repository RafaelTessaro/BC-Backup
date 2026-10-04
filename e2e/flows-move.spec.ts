// Fluxo 5: rotina com "Mover" criada pela interface — confirmação, prévia do que sai da origem,
// execução e conferência no disco (saiu da origem, existe igual nos dois destinos).
// BC_E2E_MOVE_SKEW_MIN=120 adianta só o relógio da regra de idade (motor e prévia), para os arquivos
// recém-criados já contarem como "prontos".
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bytes,
  continueButton,
  expect,
  filesUnder,
  makeDir,
  queueDialog,
  routineRow,
  sha256,
  sidebar,
  stepHeading,
  test,
  toast,
  waitRunFinished
} from './flows-helpers'

test.use({ launchEnv: { BC_E2E_MOVE_SKEW_MIN: '120' } })

const NAME = 'Backup do ERP'
const MOVE_TITLE = 'Mover: apagar da origem depois de copiar'

function makeErpFolder(): string {
  const root = join(makeDir('bcb-flow-erp-'), 'ERP backups')
  mkdirSync(join(root, 'mensal'), { recursive: true })
  writeFileSync(join(root, 'ERP_2026-10-01.zip'), bytes(1, 512 * 1024))
  writeFileSync(join(root, 'ERP_2026-10-02.zip'), bytes(2, 512 * 1024))
  writeFileSync(join(root, 'mensal', 'ERP_2026-09.fbk'), bytes(3, 256 * 1024))
  writeFileSync(join(root, 'erp.ini'), '[erp]\nporta=3050') // nunca movido (MOVE_NEVER)
  return root
}

test('"Mover": confirmação, prévia, execução e arquivos fora da origem e dentro dos destinos', async ({
  bcApp
}) => {
  const { app, page } = bcApp
  const erp = makeErpFolder()
  const moved = ['ERP_2026-10-01.zip', 'ERP_2026-10-02.zip', 'mensal/ERP_2026-09.fbk']
  const hashes = Object.fromEntries(moved.map((f) => [f, sha256(join(erp, f))]))
  const destA = makeDir('bcb-flow-erp-a-')
  const destB = makeDir('bcb-flow-erp-b-')

  await test.step('nova rotina pelo botão da barra lateral, origem pelo seletor', async () => {
    await page
      .locator('aside')
      .getByRole('button', { name: /^Nova rotina/ })
      .click()
    await expect(stepHeading(page)).toHaveText('O que você quer copiar?')
    await page.getByLabel('Nome da rotina').fill(NAME)
    await queueDialog(app, [erp])
    await page.getByRole('button', { name: 'Adicionar pastas' }).click()
    await expect(page.getByRole('button', { name: 'Remover ERP backups' })).toBeVisible()
  })

  await test.step('ligar "Mover": cancelar mantém desligado; confirmar mostra a prévia', async () => {
    const sw = page.getByRole('switch', { name: MOVE_TITLE })
    await sw.click()
    const confirm = page.getByRole('alertdialog', { name: 'Apagar arquivos da origem?' })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText(`Os arquivos de “${erp}” serão apagados deste computador`)
    await confirm.getByRole('button', { name: 'Cancelar' }).click()
    await expect(confirm).toBeHidden()
    await expect(sw).not.toBeChecked()
    await expect(sw).toBeFocused()

    await sw.click()
    await confirm.getByRole('button', { name: 'Ativar “Mover”' }).click()
    await expect(sw).toBeChecked()
    const card = page.getByRole('region', { name: 'Mover' })
    await expect(card.getByText(/^Agora: 3 arquivos \(1,3 MB\) seriam movidos\.$/)).toBeVisible()
    for (const f of moved) await expect(card.getByText(f, { exact: true })).toBeVisible()
    await expect(card.getByText('erp.ini')).toHaveCount(0)
    await continueButton(page).click()
  })

  await test.step('destinos, agendamento manual, retenção e revisão', async () => {
    await expect(stepHeading(page)).toHaveText('Para onde as cópias vão?')
    for (const dest of [destA, destB]) {
      await queueDialog(app, [dest])
      await page.getByRole('button', { name: 'Adicionar destino' }).click()
      await page.getByRole('menuitem', { name: 'Escolher uma pasta…' }).click()
    }
    await expect(page.getByRole('meter')).toHaveCount(2)
    await continueButton(page).click()
    await expect(stepHeading(page)).toHaveText('Quando executar?')
    await page.getByRole('radio', { name: 'Manual' }).click()
    await expect(page.getByText('Sem horário fixo.')).toBeVisible()
    await continueButton(page).click()
    await expect(stepHeading(page)).toHaveText('Por quanto tempo guardar?')
    await expect(page.getByText(/Com “Mover”, os backups do sistema ficam só nos destinos/)).toBeVisible()
    await continueButton(page).click()
    await continueButton(page).click()
    await expect(stepHeading(page)).toHaveText('Tudo certo?')
    await expect(page.getByText('Mover: apaga da origem depois de copiar e conferir')).toBeVisible()
    await page.getByRole('button', { name: 'Criar rotina' }).click()
    await expect(toast(page, 'Rotina criada')).toBeVisible()
  })

  await test.step('executar pela lista de Rotinas', async () => {
    const row = routineRow(page, NAME)
    await expect(row.getByText('Mover', { exact: true })).toBeVisible()
    await expect(row).toContainText('Somente manual')
    const finished = waitRunFinished(page, NAME)
    await row.getByRole('button', { name: 'Executar agora' }).click()
    expect((await finished).status).toBe('success')
    await expect(toast(page, 'Backup concluído')).toContainText('3 movidos')
  })

  await test.step('no disco: saiu da origem (pastas e erp.ini ficam) e está igual nos dois destinos', async () => {
    expect(filesUnder(erp)).toEqual(['erp.ini'])
    expect(existsSync(join(erp, 'mensal'))).toBe(true)
    for (const dest of [destA, destB]) {
      const [stamp] = readdirSync(dest)
      const snap = join(dest, stamp)
      for (const f of moved) expect(sha256(join(snap, f)), `${dest}: ${f}`).toBe(hashes[f])
      expect(existsSync(join(snap, 'erp.ini'))).toBe(false)
    }
  })

  await test.step('detalhes no histórico: aba "Movidos"', async () => {
    await sidebar(page, 'Histórico').click()
    await page.getByRole('button', { name: new RegExp(`^Ver detalhes: ${NAME}, Concluído`) }).click()
    const drawer = page.getByRole('dialog', { name: new RegExp(NAME) })
    await expect(drawer.getByText('3 arquivos removidos')).toBeVisible()
    await drawer.getByRole('tab', { name: /^Movidos/ }).click()
    for (const f of moved) await expect(drawer.getByText(f, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  })
})
