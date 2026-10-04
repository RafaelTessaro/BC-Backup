import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    build: { externalizeDeps: true },
    resolve: { alias: shared }
  },
  preload: {
    // Preload em sandbox: um único arquivo CJS autocontido (sem node_modules em runtime).
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }
    },
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    // Duas páginas: a janela principal e o painel da bandeja (React/Radix/lucide num chunk comum).
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          tray: resolve('src/renderer/tray.html')
        }
      }
    }
  }
})
