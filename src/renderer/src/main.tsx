import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { applyInitialTheme } from './lib/theme'
import { App } from './App'

async function boot(): Promise<void> {
  // dev:web (ou sem preload): `window.bc` simulado, carregado sob demanda (fica fora do bundle principal).
  if (import.meta.env.VITE_MOCK_API === '1' || !(window as { bc?: unknown }).bc) {
    const { installMockApi } = await import('./lib/mock-api')
    installMockApi()
  }
  applyInitialTheme()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void boot()
