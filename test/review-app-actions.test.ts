// Revisão (QA #3): "Pausar todas" / "Retomar" da bandeja (src/main/app-actions.ts) com o AppStore real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStore } from '../src/main/store'
import { makeRoutine, tempDir } from './helpers'

vi.mock('electron', () => ({ app: {}, dialog: {} }))
vi.mock('../src/main/tray-panel', () => ({ hideTrayPanel: () => {} }))
vi.mock('../src/main/window', () => ({
  getWindow: () => null,
  navigate: () => {},
  setQuitting: () => {},
  showWindow: () => {}
}))

const { setAllEnabled } = await import('../src/main/app-actions')

let dir: string
let cleanup: () => Promise<void>
beforeEach(async () => {
  ;({ dir, cleanup } = await tempDir('bcb-review-actions-'))
})
afterEach(() => cleanup())

async function setup() {
  const store = await AppStore.open(dir)
  await store.upsertRoutine(makeRoutine({ id: 'a', name: 'A', enabled: true }))
  await store.upsertRoutine(makeRoutine({ id: 'b', name: 'B', enabled: false })) // pausada pelo usuário
  const ctx = { store, routinesChanged: vi.fn(), runner: { dropQueued: vi.fn(async () => false) } }
  return { store, ctx: ctx as never }
}

const enabledIds = (store: AppStore) =>
  store
    .routines()
    .filter((r) => r.enabled)
    .map((r) => r.id)

describe('pausar/retomar todas pela bandeja', () => {
  it('"Pausar" duas vezes (clique duplo, painel + menu) não esquece quais estavam ativas', async () => {
    const { store, ctx } = await setup()
    await setAllEnabled(ctx, false)
    await setAllEnabled(ctx, false)
    await setAllEnabled(ctx, true)
    // B tinha sido pausada à parte pelo usuário: "Retomar" não pode ligá-la.
    expect(enabledIds(store)).toEqual(['a'])
  })

  it('"Pausar" de novo depois de retomar uma à parte guarda as duas listas', async () => {
    const { store, ctx } = await setup()
    await store.upsertRoutine(makeRoutine({ id: 'c', name: 'C', enabled: true }))
    await setAllEnabled(ctx, false) // pausa A e C
    // O usuário liga só a A pelo app (routines.setEnabled tira a A da lista)…
    await store.upsertRoutine({ ...store.getRoutine('a')!, enabled: true })
    store.state.data.pausedByTray = ['c']
    // …e pausa todas de novo pela bandeja.
    await setAllEnabled(ctx, false)
    await setAllEnabled(ctx, true)
    expect(enabledIds(store).sort()).toEqual(['a', 'c'])
  })
})
