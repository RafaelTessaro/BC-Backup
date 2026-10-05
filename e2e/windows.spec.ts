// Teste de fumaça do app EMPACOTADO no Windows (roda no CI em windows-latest, depois do electron-builder).
// Cobre o que só existe no Windows: listagem de unidades (PowerShell), caminhos C:\…, nomes com acento,
// inicialização com o Windows (login item), ZIP e verificação completa, e o log sem erros.
// Uso: BC_E2E_EXE=dist\win-unpacked\BCBackup.exe npx playwright test e2e/windows.spec.ts
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BcApi, RoutineInput } from '../src/shared/api'
import { LEGACY_ROOT_DIR, MANIFEST_FILE, createDefaultRoutine } from '../src/shared/defaults'
import { mainPage, trayPage } from './fixtures'

type G = { bc: BcApi }
const exe = process.env.BC_E2E_EXE
const shots = join('test-results', 'windows')

test.skip(
  !exe || process.platform !== 'win32',
  'só roda no Windows com BC_E2E_EXE apontando para o app empacotado'
)

let app: ElectronApplication
let page: Page
let userData: string
const errors: string[] = []

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true })
  userData = mkdtempSync(join(tmpdir(), 'bcb-win-'))
  // BC_E2E=1: gancho __bcTrayToggle (simula o clique no ícone da bandeja).
  app = await electron.launch({
    executablePath: exe!,
    // BC_E2E_MOVE_SKEW_MIN: adianta só o relógio da regra de idade do "Mover" (o Windows não deixa
    // "envelhecer" o ChangeTime de um arquivo recém-criado).
    env: { ...process.env, BC_USER_DATA_DIR: userData, BC_E2E: '1', BC_E2E_MOVE_SKEW_MIN: '120' }
  })
  // Pela URL (index.html): o painel da bandeja (tray.html) também é uma janela do app.
  page = await mainPage(app)
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  await page.waitForFunction(
    () => typeof (globalThis as { bc?: { routines?: { list?: unknown } } }).bc?.routines?.list === 'function'
  )
})

test.afterAll(async () => {
  await app?.close()
})

test('é o app empacotado, com a janela visível', async () => {
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  // Num pré-lançamento, a versão do app precisa ser a publicada (ex.: v0.1.0-beta.2 → 0.1.0-beta.2).
  const expected = process.env.BC_E2E_EXPECT_VERSION?.replace(/^v/, '')
  if (expected) expect(await app.evaluate(({ app }) => app.getVersion())).toBe(expected)
  await expect(page.getByText('Vamos proteger seus arquivos').first()).toBeVisible()
  await page.screenshot({ path: join(shots, '01-primeira-abertura.png') })
})

test('lista as unidades do Windows (PowerShell) com espaço livre', async () => {
  const drives = await page.evaluate(() => (globalThis as unknown as G).bc.system.drives())
  const c = drives.find((d) => /^C:\\?$/i.test(d.path))
  expect(c, JSON.stringify(drives)).toBeTruthy()
  expect(c!.total).toBeGreaterThan(0)
  expect(c!.free).toBeGreaterThan(0)
})

function makeSource(): string {
  const root = mkdtempSync(join(tmpdir(), 'bcb-win-src-'))
  mkdirSync(join(root, 'Relatórios 2026', 'Ação & Cia'), { recursive: true })
  writeFileSync(join(root, 'Relatórios 2026', 'Ação & Cia', 'balanço çãõ.txt'), 'conteúdo com acento')
  writeFileSync(join(root, 'Relatórios 2026', 'planilha.xlsx'), Buffer.alloc(512 * 1024, 3))
  writeFileSync(join(root, 'Thumbs.db'), 'lixo')
  return root
}

async function runRoutine(
  input: RoutineInput & { id?: string }
): Promise<{ status: string; runId: string; id: string }> {
  // Com id: roda de novo a mesma rotina (salvar outra com o mesmo nome seria recusado).
  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), input)
  const finished = page.evaluate(
    (id) =>
      new Promise<{ status: string; runId: string }>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineId === id) {
            off()
            resolve({ status: r.status, runId: r.id })
          }
        })
      }),
    saved.id
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), saved.id)
  return { ...(await finished), id: saved.id }
}

function routine(
  name: string,
  source: string,
  dests: string[],
  patch: Partial<RoutineInput> = {}
): RoutineInput {
  const base = createDefaultRoutine()
  return {
    ...base,
    name,
    sources: [{ id: 's1', path: source, kind: 'folder' }],
    destinations: dests.map((p, i) => ({ id: `d${i}`, path: p, label: `Disco ${i + 1}` })),
    schedule: { ...base.schedule, kind: 'manual' },
    verify: 'full',
    ...patch
  }
}

const SNAP = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?$/

/** Atributos do arquivo segundo o "attrib" (ex.: "A    H"): o manifesto sai oculto no Explorer. */
function isHidden(file: string): boolean {
  const out = execFileSync('attrib', [file], { encoding: 'utf8' })
  const attrs = out.slice(0, Math.max(0, out.toLowerCase().indexOf(file.slice(0, 3).toLowerCase())))
  return /H/.test(attrs)
}

test('backup em pasta datada para dois destinos, com acentos e verificação completa', async () => {
  const source = makeSource()
  // Como o dono usa: cria uma pasta "Backups" e escolhe ela como destino.
  const a = join(mkdtempSync(join(tmpdir(), 'bcb-win-a-')), 'Backups')
  const b = join(mkdtempSync(join(tmpdir(), 'bcb-win-b-')), 'Backups')
  mkdirSync(a)
  mkdirSync(b)
  const res = await runRoutine(routine('Financeiro – Ação', source, [a, b]))
  const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), res.runId)
  expect(res.status, JSON.stringify(record?.log.slice(-10))).toBe('success')
  for (const dest of [a, b]) {
    // Abrindo "Backups": direto a pasta com dia e hora (sem "BC Backup" nem o nome da rotina)…
    expect(readdirSync(dest).filter((n) => !SNAP.test(n))).toEqual([])
    const snap = readdirSync(dest).find((n) => SNAP.test(n))
    expect(snap, `pasta datada em ${dest}`).toBeTruthy()
    // …e dentro dela, os arquivos da origem.
    expect(existsSync(join(dest, snap!, 'Relatórios 2026', 'Ação & Cia', 'balanço çãõ.txt'))).toBe(true)
    expect(existsSync(join(dest, snap!, 'Thumbs.db'))).toBe(false)
    expect(existsSync(join(dest, snap!, MANIFEST_FILE))).toBe(true)
    expect(isHidden(join(dest, snap!, MANIFEST_FILE)), 'manifesto oculto').toBe(true)
    expect(isHidden(join(dest, snap!, 'Relatórios 2026', 'Ação & Cia', 'balanço çãõ.txt'))).toBe(false)
    expect(existsSync(join(dest, LEGACY_ROOT_DIR))).toBe(false)
  }
  await page.screenshot({ path: join(shots, '02-painel-depois-do-backup.png') })
})

test('backup em ZIP com verificação completa', async () => {
  const source = makeSource()
  const dest = mkdtempSync(join(tmpdir(), 'bcb-win-zip-'))
  const res = await runRoutine(routine('Contabilidade ZIP', source, [dest], { mode: 'zip' }))
  expect(res.status).toBe('success')
  // "<destino>\<carimbo>.zip" + o manifesto ao lado, direto na pasta escolhida.
  const names = readdirSync(dest)
  const zip = names.find((n) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.zip$/.test(n))
  expect(zip, JSON.stringify(names)).toBeTruthy()
  expect(names.sort()).toEqual([zip!, `${zip}.manifesto.json`].sort())
  expect(isHidden(join(dest, `${zip}.manifesto.json`)), 'manifesto do ZIP oculto').toBe(true)
  expect(isHidden(join(dest, zip!))).toBe(false)
})

test('arquivo aberto com bloqueio vira aviso, não falha', async () => {
  // No Windows, um arquivo aberto sem compartilhamento de leitura dá EBUSY ao ser lido.
  const source = makeSource()
  const locked = join(source, 'banco-em-uso.mdb')
  writeFileSync(locked, 'dados')
  const dest = mkdtempSync(join(tmpdir(), 'bcb-win-lock-'))
  // Abre com compartilhamento 0 (UV_FS_O_EXLOCK do libuv → CreateFileW com dwShareMode 0), como um
  // banco de dados ou um .pst aberto: qualquer outra leitura recebe EBUSY enquanto o fd estiver aberto.
  const UV_FS_O_EXLOCK = 0x10000000
  const fd = openSync(locked, constants.O_RDWR | UV_FS_O_EXLOCK)
  try {
    expect(() => readFileSync(locked)).toThrow(/EBUSY/) // o bloqueio está mesmo ativo
    const res = await runRoutine(routine('Arquivo em uso', source, [dest]))
    expect(res.status).toBe('warning')
    const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), res.runId)
    const skipped = record?.destinations[0].skipped ?? []
    expect(skipped.some((s) => s.path.endsWith('banco-em-uso.mdb'))).toBe(true)
    // O resto foi copiado direto na pasta datada; o arquivo bloqueado não aparece lá.
    const out = record?.destinations[0].outputPath ?? ''
    expect(existsSync(join(out, 'Relatórios 2026', 'planilha.xlsx'))).toBe(true)
    expect(existsSync(join(out, 'banco-em-uso.mdb'))).toBe(false)
  } finally {
    closeSync(fd)
  }
})

test('liga e desliga "Iniciar com o Windows" (login item)', async () => {
  // No Windows, a consulta precisa do mesmo caminho e argumentos usados no registro (Run).
  const registered = () =>
    app.evaluate(
      ({ app }) => app.getLoginItemSettings({ path: process.execPath, args: ['--hidden'] }).openAtLogin
    )
  await page.evaluate(() => (globalThis as unknown as G).bc.settings.update({ launchAtLogin: true }))
  await expect.poll(registered).toBe(true)
  await page.evaluate(() => (globalThis as unknown as G).bc.settings.update({ launchAtLogin: false }))
  await expect.poll(registered).toBe(false)
})

test('telas principais abrem sem erros (screenshots claro e escuro)', async () => {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => (globalThis as unknown as G).bc.settings.update({ theme: t }), theme)
    for (const [route, name] of [
      ['/painel', 'painel'],
      ['/rotinas', 'rotinas'],
      ['/historico', 'historico'],
      ['/rotinas/nova', 'nova-rotina'],
      ['/configuracoes', 'configuracoes']
    ] as const) {
      // Mesmo caminho da bandeja/notificações: o main manda o evento "navigate".
      await app.evaluate(({ BrowserWindow }, r) => {
        const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tray.html'))
        main?.webContents.send('evt:navigate', r)
      }, route)
      await page.waitForTimeout(600)
      await page.screenshot({ path: join(shots, `tela-${name}-${theme}.png`) })
    }
  }
  expect(errors).toEqual([])
})

test('painel da bandeja abre junto do ícone e fecha com Esc', async () => {
  // Clique no ícone de verdade (sem retângulo, o gancho usa tray.getBounds()). Mostrar e conferir na
  // mesma chamada: no runner do CI outra janela pode tirar o foco (e o light-dismiss esconde o painel).
  const opened = await app.evaluate(({ BrowserWindow, screen }) => {
    const hook = (globalThis as { __bcTrayToggle?: () => boolean }).__bcTrayToggle
    const ok = hook?.() ?? false
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('tray.html'))
    if (!w) return { ok, visible: false, inside: false }
    const b = w.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const inside =
      b.x >= wa.x && b.y >= wa.y && b.x + b.width <= wa.x + wa.width && b.y + b.height <= wa.y + wa.height
    return { ok, visible: w.isVisible(), inside, size: [b.width, b.height] }
  })
  expect(opened.ok).toBe(true)
  expect(opened.inside).toBe(true)
  const panel = await trayPage(app)
  panel.on('pageerror', (e) => errors.push(`painel: ${e.message}`))
  panel.on('console', (m) => m.type() === 'error' && errors.push(`painel: ${m.text()}`))
  await expect(panel.getByRole('heading', { level: 1 })).toBeVisible()
  if (opened.visible) await panel.screenshot({ path: join(shots, 'bandeja.png') })
  await panel.keyboard.press('Escape')
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((x) => x.webContents.getURL().includes('tray.html'))
          ?.isVisible()
      )
    )
    .toBe(false)
  expect(errors).toEqual([])
})

test('"Mover": move o que está pronto e deixa na origem o arquivo que o sistema ainda está gravando', async () => {
  const source = mkdtempSync(join(tmpdir(), 'bcb-win-erp-'))
  const pronto = join(source, 'erp-2026-10-04.fbk')
  const gravando = join(source, 'erp-em-gravacao.fbk')
  writeFileSync(pronto, Buffer.alloc(2 * 1024 * 1024, 7))
  writeFileSync(gravando, Buffer.alloc(512 * 1024, 9))
  const a = mkdtempSync(join(tmpdir(), 'bcb-win-mova-'))
  const b = mkdtempSync(join(tmpdir(), 'bcb-win-movb-'))
  const input = routine('Backup do ERP', source, [a, b], {
    moveSources: { enabled: true, minAgeMinutes: 30, warnIfEmpty: true }
  })

  // Um "ERP" ainda gravando: handle aberto COM compartilhamento de leitura (o caso difícil: copiar
  // funcionaria, mas o teste de uso exclusivo do BC Backup precisa perceber e adiar).
  const fd = openSync(gravando, 'r+')
  let first: { status: string; runId: string; id: string }
  try {
    first = await runRoutine(input)
  } finally {
    closeSync(fd)
  }
  const rec1 = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), first.runId)
  expect(first.status, JSON.stringify(rec1?.log.slice(-12))).toBe('warning')
  // O pronto saiu da origem e está nos dois destinos; o que estava em uso ficou e não foi copiado.
  expect(existsSync(pronto)).toBe(false)
  expect(existsSync(gravando)).toBe(true)
  for (const dest of [a, b]) {
    // Uma origem: os arquivos movidos ficam direto na pasta datada do destino.
    const snap = readdirSync(dest).find((n) => SNAP.test(n))
    expect(snap, `pasta datada em ${dest}`).toBeTruthy()
    expect(existsSync(join(dest, snap!, 'erp-2026-10-04.fbk')), `em ${dest}`).toBe(true)
    const files = readdirSync(dest, { recursive: true }).map(String)
    expect(
      files.some((f) => f.endsWith('erp-2026-10-04.fbk')),
      `em ${dest}`
    ).toBe(true)
    expect(
      files.some((f) => f.endsWith('erp-em-gravacao.fbk')),
      `em ${dest}`
    ).toBe(false)
  }
  const move1 = (
    rec1 as unknown as {
      move?: { removed: { path: string }[]; postponed: { path: string; reason: string }[] }
    }
  ).move
  expect(move1?.removed.map((r) => r.path).some((p) => p.endsWith('erp-2026-10-04.fbk'))).toBe(true)
  expect(move1?.postponed.find((p) => p.path.endsWith('erp-em-gravacao.fbk'))?.reason ?? '').toMatch(/uso/i)

  // O "ERP" terminou (handle fechado): a próxima execução leva o restante.
  const second = await runRoutine({ ...input, id: first.id })
  expect(second.status).toBe('success')
  expect(existsSync(gravando)).toBe(false)
  expect(existsSync(source)).toBe(true) // a pasta de origem nunca é apagada
  await page.screenshot({ path: join(shots, '03-mover.png') })
})

test('log do app sem erros', async () => {
  const logFile = join(userData, 'logs', 'bc-backup.log')
  expect(existsSync(logFile)).toBe(true)
  const errorLines = readFileSync(logFile, 'utf8')
    .split(/\r?\n/)
    .filter((l) => / ERROR /.test(l))
  expect(errorLines).toEqual([])
})
