// Ações do app usadas por mais de uma porta de entrada: o menu nativo da bandeja, o painel da
// bandeja (IPC `tray.*`) e o menu do macOS. Uma implementação só, para os caminhos nunca divergirem.

import { app, dialog } from 'electron'
import type { AppContext } from './context'
import { hideTrayPanel } from './tray-panel'
import { getWindow, navigate, setQuitting, showWindow } from './window'

/**
 * Pausa (enabled=false) ou retoma todas as rotinas. Ao pausar, lembra quais estavam ativas
 * (`pausedByTray`) para retomar exatamente essas; sem lembrança, retoma todas.
 */
export async function setAllEnabled(c: AppContext, enabled: boolean): Promise<void> {
  const { store } = c
  const now = new Date().toISOString()
  if (!enabled) {
    const ids = store
      .routines()
      .filter((r) => r.enabled)
      .map((r) => r.id)
    for (const id of ids) {
      const r = store.getRoutine(id)
      if (r) await store.upsertRoutine({ ...r, enabled: false, updatedAt: now })
    }
    store.state.data.pausedByTray = ids
  } else {
    const remembered = (store.state.data.pausedByTray ?? []).filter((id) => store.getRoutine(id))
    const ids = remembered.length ? remembered : store.routines().map((r) => r.id)
    for (const id of ids) {
      const r = store.getRoutine(id)
      if (!r || r.enabled) continue
      store.setRoutineState(id, { lastAttemptSlot: now }) // antes do upsert: um tick no meio não recupera horários
      await store.upsertRoutine({ ...r, enabled: true, updatedAt: now })
    }
    delete store.state.data.pausedByTray
  }
  await store.state.save().catch(() => {})
  c.routinesChanged()
}

/** Pergunta (diálogo nativo, avisa se há backup rodando) e encerra o app. */
export async function confirmQuit(c: AppContext): Promise<void> {
  // O painel perde o foco e sumiria de qualquer jeito; escondê-lo antes evita o diálogo "atrás".
  hideTrayPanel()
  const busy = c.runner.liveProgress
  const opts = {
    type: 'question' as const,
    buttons: ['Sair', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Sair do BC Backup',
    message: 'Sair do BC Backup?',
    detail:
      'Os backups agendados não serão executados enquanto o BC Backup estiver fechado.' +
      (busy ? `\n\nO backup "${busy.routineName}" está em andamento e será cancelado.` : '')
  }
  // Sem pai quando a janela principal está oculta (o diálogo não pode depender dela).
  const w = getWindow()
  const res = w && w.isVisible() ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
  if (res.response !== 0) return
  setQuitting(true)
  app.quit()
}

/** Esconde o painel da bandeja e mostra a janela principal (opcionalmente numa rota). */
export function openMain(route?: string): void {
  hideTrayPanel()
  if (route) navigate(route)
  else showWindow()
}
