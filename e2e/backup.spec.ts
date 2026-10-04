import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BcApi, RoutineInput } from '../src/shared/api'
import {
  createDefaultRoutine,
  BACKUP_ROOT_DIR,
  MANIFEST_FILE,
  ROUTINE_MARKER_FILE
} from '../src/shared/defaults'
import { backupStamp } from '../src/shared/format'
import { launch, mainWindow, makeDir, makeSourceTree } from './fixtures'

type G = { bc: BcApi }

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

test('backup completo para dois destinos, com manifesto e retenção segura', async () => {
  const l = await launch()
  const page = await mainWindow(l)
  const source = makeSourceTree()
  const destA = makeDir('bcb-destA-')
  const destB = makeDir('bcb-destB-')

  // Backups "antigos" no destino A: 3 com manifesto da rotina (10, 9 e 8 dias atrás) + 1 pasta alheia sem manifesto.
  const input = routineInput('Financeiro diário', source, [destA, destB])
  const saved = await page.evaluate((i) => (globalThis as unknown as G).bc.routines.save(i), input)
  expect(saved.id).toBeTruthy()

  const routineDirA = join(destA, BACKUP_ROOT_DIR, 'Financeiro diário')
  mkdirSync(routineDirA, { recursive: true })
  const oldStamps: string[] = []
  for (const daysAgo of [10, 9, 8, 2]) {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    d.setHours(18, 0, 0, 0)
    const stamp = backupStamp(d)
    oldStamps.push(stamp)
    mkdirSync(join(routineDirA, stamp), { recursive: true })
    writeFileSync(
      join(routineDirA, stamp, MANIFEST_FILE),
      JSON.stringify({
        format: 'bcbackup-manifesto',
        version: 1,
        routineId: saved.id,
        snapshotId: stamp,
        startedAt: d.toISOString(),
        finishedAt: d.toISOString(),
        status: 'success',
        mode: 'copy',
        files: 1,
        bytes: 1
      })
    )
  }
  const foreign = join(routineDirA, '2020-01-01_00-00-00')
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'arquivo-do-usuario.txt'), 'não apague')

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
    saved.id
  )
  await page.evaluate((id) => (globalThis as unknown as G).bc.routines.runNow(id), saved.id)
  const result = await finished
  expect(result.status).toBe('success')

  for (const dest of [destA, destB]) {
    const dir = join(dest, BACKUP_ROOT_DIR, 'Financeiro diário')
    expect(existsSync(join(dir, ROUTINE_MARKER_FILE))).toBe(true)
    const snaps = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(n))
    const today = backupStamp(new Date()).slice(0, 10)
    const newest = snaps
      .filter((n) => n.startsWith(today))
      .sort()
      .pop()
    expect(newest, `backup de hoje em ${dest}`).toBeTruthy()
    const snap = join(dir, newest!)
    const manifest = JSON.parse(readFileSync(join(snap, MANIFEST_FILE), 'utf8'))
    expect(manifest.routineId).toBe(saved.id)
    // Conteúdo copiado (rótulo da origem = nome da pasta) e filtro padrão aplicado.
    const files = readdirSync(snap, { recursive: true }).map(String)
    expect(files.some((f) => f.endsWith('NF-0012.xml'))).toBe(true)
    expect(files.some((f) => f.endsWith('Fluxo de caixa.xlsx'))).toBe(true)
    expect(files.some((f) => f.endsWith('Thumbs.db'))).toBe(false)
    expect(readdirSync(dir).some((n) => n.endsWith('.em-andamento'))).toBe(false)
  }

  // Retenção (7 dias, mínimo 3) no destino A: dentro da janela ficam hoje + 2 dias atrás; o mínimo de 3
  // salva o mais novo dos antigos (8 dias); 10 e 9 dias atrás saem. A pasta sem manifesto NUNCA é tocada.
  const remaining = readdirSync(routineDirA)
  expect(remaining).not.toContain(oldStamps[0])
  expect(remaining).not.toContain(oldStamps[1])
  expect(remaining).toContain(oldStamps[2])
  expect(remaining).toContain(oldStamps[3])
  expect(existsSync(join(foreign, 'arquivo-do-usuario.txt'))).toBe(true)

  // Histórico registra a execução com os dois destinos.
  const record = await page.evaluate((id) => (globalThis as unknown as G).bc.runs.get(id), result.id)
  expect(record?.destinations).toHaveLength(2)
  expect(record?.destinations.every((d) => d.status === 'success')).toBe(true)
  expect(record?.destinations[0].pruned.length).toBe(2)

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
