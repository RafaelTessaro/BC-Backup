// Eventos main → interface para TODAS as janelas: a principal e o painel da bandeja.
// O `progress` (até 4×/s) só vai para o painel quando ele está visível: escondido, ele não precisa
// dele, e o `trayShown` já o ressincroniza ao aparecer. O `navigate` continua só na janela
// principal (sendToRenderer em window.ts).

import { IPC_EVENTS } from '@shared/api'
import { isTrayPanelVisible, trayPanelContents } from './tray-panel'
import { sendToRenderer } from './window'

export type BroadcastEvent =
  | typeof IPC_EVENTS.progress
  | typeof IPC_EVENTS.runFinished
  | typeof IPC_EVENTS.routinesChanged
  | typeof IPC_EVENTS.settingsChanged

export function broadcast(channel: BroadcastEvent, payload?: unknown): void {
  sendToRenderer(channel, payload)
  const panel = trayPanelContents()
  if (!panel) return
  if (channel === IPC_EVENTS.progress && !isTrayPanelVisible()) return
  panel.send(channel, payload)
}
