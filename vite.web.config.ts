// Interface rodando no navegador comum, com `window.bc` simulado (src/renderer/src/lib/mock-api.ts).
// Útil para desenvolver telas e tirar screenshots sem abrir o Electron: `npm run dev:web`.
// Janela principal em http://localhost:5199/ e painel da bandeja em http://localhost:5199/tray.html
// (use um viewport de 360×480; ?scenario=…&theme=dark como no mock).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') }
  },
  define: { 'import.meta.env.VITE_MOCK_API': JSON.stringify('1') },
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true },
  build: {
    rollupOptions: {
      input: { index: resolve('src/renderer/index.html'), tray: resolve('src/renderer/tray.html') }
    }
  }
})
