// Interface rodando no navegador comum, com `window.bc` simulado (src/renderer/src/lib/mock-api.ts).
// Útil para desenvolver telas e tirar screenshots sem abrir o Electron: `npm run dev:web`.
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
  server: { port: 5199, strictPort: true }
})
