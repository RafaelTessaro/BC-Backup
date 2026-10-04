// Entrada do painel da bandeja (tray.html). Mesmo app.css (tokens) e os mesmos componentes da
// janela principal; dados próprios e enxutos (useTray.ts).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../app.css'
import { trackInputModality } from '../lib/modality'
import { TrayPanel } from './TrayPanel'

async function boot(): Promise<void> {
  // dev:web (ou sem preload): `window.bc` simulado.
  if (import.meta.env.VITE_MOCK_API === '1' || !(window as { bc?: unknown }).bc) {
    const { installMockApi } = await import('../lib/mock-api')
    installMockApi()
  }
  const root = document.documentElement
  // O main define nativeTheme.themeSource (Claro/Escuro/Sistema): prefers-color-scheme já reflete a
  // preferência do app. As configurações carregadas depois confirmam (TrayPanel → useTrayTheme).
  root.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  // win11 = cantos, borda e sombra do DWM; nos demais o painel desenha a própria borda (app.css).
  const os = new URLSearchParams(location.search).get('os')
  if (os) root.dataset.os = os
  // Pré-criado oculto: o conteúdo só aparece (com a entrada animada) quando o painel é mostrado.
  if (document.visibilityState === 'hidden') root.dataset.trayHidden = ''
  trackInputModality()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TrayPanel />
    </StrictMode>
  )
}

void boot()
