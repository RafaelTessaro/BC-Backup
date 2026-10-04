import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BcApi, RoutineInput } from '../src/shared/api'
import {
  createDefaultRoutine,
  IN_PROGRESS_MARKER_FILE,
  LEGACY_ROOT_DIR,
  MANIFEST_FILE,
  ROUTINE_MARKER_FILE
} from '../src/shared/defaults'
import { backupStamp } from '../src/shared/format'
import { launch, mainWindow, makeDir, makeSourceTree } from './fixtures'

type G = { bc: BcApi }

const SNAP = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?$/

function routineInput(name: string, source: string, dests: string[]): RoutineInput {
  const r = createDefaultRoutine()
  return {
    ...r,
    name,
    sources: [{ id: 's1', path: source, kind: 'folder' }],
    destinations: dests.map((p, i) => ({ id: `d${i + 1}`, path: p, label: `Destino ${i + 1}` })),
    schedule: { ...r.schedule, kind: 'manual' },
    retention: { enabled: true, days: 7, minKeep: 3 }
  }
}

/** Backup "antigo" com o manifesto da rotina (dias atrás, às 18:00). */
function oldSnapshot(parent: string, routineId: string, daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(18, 0, 0, 0)
  const stamp = backupStamp(d)
  mkdirSync(join(parent, stamp), { recursive: true })
  writeFileSync(
    join(parent, stamp, MANIFEST_FILE),
    JSON.stringify({
      format: 'bcbackup-manifesto',
      version: 1,
      routineId,
      snapshotId: stamp,
      startedAt: d.toISOString(),
      finishedAt: d.toISOString(),
      status: 'success',
      mode: 'copy',
      files: 1,
      bytes: 1
    })
  )
  return stamp
}

async function runAndWait(page: Awaited<ReturnType<typeof mainWindow>>, routineId: string) {
  const finished = page.evaluate(
    (id) =>
      new Promise<{ status: string; id: string }>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineId === id) {
            off()
            resolve({ status: r.status, id: r.id })
          }
        })
      }),
    routineId
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), routineId)
  return finished
}

test('backup completo para dois destinos: pasta datada direto no destino, manifesto e retenção segura', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  const source = makeSourceTree()
  const destA = makeDir('bcb-destA-')
  const destB = makeDir('bcb-destB-')

  const input = routineInput('Financeiro diário', source, [destA, destB])
  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), input)
  expect(saved.id).toBeTruthy()

  // Destino A (estrutura nova): 4 backups da rotina (10, 9, 8 e 2 dias atrás), uma pasta com nome de
  // backup mas sem manifesto e um arquivo do usuário — a pasta do destino é dele.
  const oldA = [10, 9, 8, 2].map((d) => oldSnapshot(destA, saved.id, d))
  const foreign = join(destA, '2020-01-01_00-00-00')
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'arquivo-do-usuario.txt'), 'não apague')
  writeFileSync(join(destA, 'planilha do usuário.xlsx'), 'não apague')
  // Destino B (estrutura ANTIGA, "BC Backup/<rotina>"): os backups de lá também saem no prazo.
  const legacyB = join(destB, LEGACY_ROOT_DIR, 'Financeiro diário')
  mkdirSync(legacyB, { recursive: true })
  writeFileSync(join(legacyB, ROUTINE_MARKER_FILE), JSON.stringify({ routineId: saved.id }))
  const oldB = [10, 9, 8, 2].map((d) => oldSnapshot(legacyB, saved.id, d))

  const result = await runAndWait(page, saved.id)
  expect(result.status).toBe('success')

  const today = backupStamp(new Date()).slice(0, 10)
  for (const dest of [destA, destB]) {
    const newest = readdirSync(dest)
      .filter((n) => SNAP.test(n) && n.startsWith(today))
      .sort()
      .pop()
    expect(newest, `backup de hoje direto em ${dest}`).toBeTruthy()
    const snap = join(dest, newest!)
    const manifest = JSON.parse(readFileSync(join(snap, MANIFEST_FILE), 'utf8'))
    expect(manifest).toMatchObject({ routineId: saved.id, layout: 'direct' })
    // Uma origem: o conteúdo dela direto na pasta datada (sem pasta da rotina nem da origem).
    expect(existsSync(join(snap, 'Notas fiscais', '2026', 'NF-0012.xml'))).toBe(true)
    expect(existsSync(join(snap, 'Planilhas', 'Fluxo de caixa.xlsx'))).toBe(true)
    expect(existsSync(join(snap, 'leia-me.txt'))).toBe(true)
    expect(existsSync(join(snap, 'Planilhas', 'Thumbs.db'))).toBe(false)
    expect(existsSync(join(snap, IN_PROGRESS_MARKER_FILE))).toBe(false)
    // Nada de "em andamento" nem marcador de rotina na pasta do usuário.
    expect(readdirSync(dest).some((n) => n.endsWith('.em-andamento'))).toBe(false)
    expect(existsSync(join(dest, ROUTINE_MARKER_FILE))).toBe(false)
  }
  // O destino A não ganhou a pasta "BC Backup"; o B continua com a pasta legada.
  expect(existsSync(join(destA, LEGACY_ROOT_DIR))).toBe(false)
  expect(existsSync(legacyB)).toBe(true)

  // Retenção (7 dias, mínimo 3): dentro da janela ficam hoje + 2 dias atrás; o mínimo de 3 salva o mais
  // novo dos antigos (8 dias); 10 e 9 dias atrás saem. Pasta sem manifesto e arquivo do usuário: intactos.
  const remainingA = readdirSync(destA)
  expect(remainingA).not.toContain(oldA[0])
  expect(remainingA).not.toContain(oldA[1])
  expect(remainingA).toContain(oldA[2])
  expect(remainingA).toContain(oldA[3])
  expect(existsSync(join(foreign, 'arquivo-do-usuario.txt'))).toBe(true)
  expect(readFileSync(join(destA, 'planilha do usuário.xlsx'), 'utf8')).toBe('não apague')
  const remainingB = readdirSync(legacyB)
  expect(remainingB).not.toContain(oldB[0])
  expect(remainingB).not.toContain(oldB[1])
  expect(remainingB).toContain(oldB[2])
  expect(remainingB).toContain(oldB[3])

  // Histórico registra a execução com os dois destinos.
  const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), result.id)
  expect(record?.destinations).toHaveLength(2)
  expect(record?.destinations.every((d) => d.status === 'success')).toBe(true)
  expect(record?.destinations.map((d) => d.pruned.length)).toEqual([2, 2])
  expect(record?.destinations[0].outputPath?.startsWith(join(destA, today))).toBe(true)

  expect(l.errors).toEqual([])
  await l.app.close()
})

test('duas rotinas na mesma pasta de destino: nomes distintos e uma não apaga os backups da outra', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  const shared = makeDir('bcb-shared-')
  const strict = { enabled: true, days: 1, minKeep: 0 }
  const a = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), {
    ...routineInput('Rotina A', makeSourceTree(), [shared]),
    retention: strict
  })
  const b = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), {
    ...routineInput('Rotina B', makeSourceTree(), [shared]),
    retention: strict
  })
  // Um backup antigo de A: a retenção de B (1 dia, mínimo 0) não pode enxergá-lo.
  const oldOfA = oldSnapshot(shared, a.id, 5)
  expect((await runAndWait(page, a.id)).status).toBe('success')
  expect((await runAndWait(page, b.id)).status).toBe('success')
  const snaps = readdirSync(shared).filter((n) => SNAP.test(n))
  const byRoutine = (id: string) =>
    snaps.filter((n) => JSON.parse(readFileSync(join(shared, n, MANIFEST_FILE), 'utf8')).routineId === id)
  // A rodou com retenção de 1 dia: o antigo DELE saiu; B não mexeu em nada de A.
  expect(byRoutine(a.id)).toHaveLength(1)
  expect(byRoutine(a.id)).not.toContain(oldOfA)
  expect(byRoutine(b.id)).toHaveLength(1)
  expect(new Set(snaps).size).toBe(2)
  expect(l.errors).toEqual([])
  await l.app.close()
})

test('destino indisponível falha a execução e registra o motivo', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  const source = makeSourceTree()
  const ok = makeDir('bcb-ok-')
  const missing = join(makeDir('bcb-missing-'), 'nao-existe', 'disco-E')
  const input = routineInput('Rotina com destino ausente', source, [ok, missing])
  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), input)

  const finished = page.evaluate(
    (id) =>
      new Promise<string>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineId === id) {
            off()
            resolve(r.id)
          }
        })
      }),
    saved.id
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), saved.id)
  const runId = await finished
  const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), runId)
  expect(record?.status).toBe('failed')
  const bad = record?.destinations.find((d) => d.path === missing)
  expect(bad?.status).toBe('failed')
  expect(bad?.error ?? '').toMatch(/indispon/i)
  const good = record?.destinations.find((d) => d.path === ok)
  expect(good?.status).toBe('success')
  await l.app.close()
})

test('"Mover": arquivos recém-gravados ficam na origem (Atenção, sem backup novo, nada apagado)', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  const source = makeDir('bcb-erp-backup-')
  writeFileSync(join(source, 'ERP_hoje.fbk'), 'backup que o ERP acabou de gravar')
  mkdirSync(join(source, 'Diario'))
  writeFileSync(join(source, 'Diario', 'NFE_hoje.zip'), 'zip recente')
  const destA = makeDir('bcb-move-a-')
  const destB = makeDir('bcb-move-b-')
  const input: RoutineInput = {
    ...routineInput('Backup do ERP', source, [destA, destB]),
    moveSources: { enabled: true, minAgeMinutes: 30, warnIfEmpty: true }
  }
  // Validação e prévia passam pela ponte IPC real.
  const issues = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.validate(i), {
    ...input,
    sources: [{ id: 's1', path: '/', kind: 'folder' as const }]
  })
  expect(issues.some((i) => i.level === 'error' && i.topic === 'move')).toBe(true)
  const preview = await page.evaluate(
    (i) => (globalThis as unknown as G).bc.system.previewMove([i.sources[0].path], i.filters, i.moveSources!),
    input
  )
  expect(preview).toMatchObject({ files: 0, waiting: 2 })

  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), input)
  expect(saved.moveSources).toEqual({ enabled: true, minAgeMinutes: 30, warnIfEmpty: true })
  const finished = page.evaluate(
    (id) =>
      new Promise<string>((resolve) => {
        const off = (globalThis as unknown as G).bc.on.runFinished((r) => {
          if (r.routineId === id) {
            off()
            resolve(r.id)
          }
        })
      }),
    saved.id
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), saved.id)
  const runId = await finished
  const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), runId)
  expect(record?.status).toBe('warning')
  expect(record?.move?.nothingNew).toBe(true)
  expect(record?.move?.postponedCount).toBe(2)
  expect(record?.filesMoved).toBe(0)
  expect(record?.notice).toMatch(/2 arquivos ainda em gravação\/em uso/)
  // Nada apagado, nada copiado: os destinos continuam vazios.
  expect(existsSync(join(source, 'ERP_hoje.fbk'))).toBe(true)
  expect(existsSync(join(source, 'Diario', 'NFE_hoje.zip'))).toBe(true)
  expect(readdirSync(destA)).toEqual([])
  expect(readdirSync(destB)).toEqual([])
  expect(l.errors).toEqual([])
  await l.app.close()
})

test('inicia oculto na bandeja e fechar a janela só esconde', async () => {
  const l = await launch(['--hidden'])
  await new Promise((r) => setTimeout(r, 2000))
  const visible = await l.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.isVisible())
  )
  expect(visible).toBe(false)
  await l.app.evaluate(({ app }) => {
    app.emit('activate')
  })
  await expect
    .poll(() =>
      l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible()))
    )
    .toBe(true)
  await l.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().includes('tray.html'))
      ?.close()
  )
  await expect
    .poll(() =>
      l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isVisible()))
    )
    .toBe(false)
  await l.app.close()
})
