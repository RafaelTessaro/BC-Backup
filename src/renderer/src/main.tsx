import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app.css'
import { installMockApiIfNeeded } from './lib/mock-api'
import { applyInitialTheme } from './lib/theme'
import { App } from './App'

installMockApiIfNeeded()
applyInitialTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
