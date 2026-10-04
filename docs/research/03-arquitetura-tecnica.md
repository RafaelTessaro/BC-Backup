# BC Backup: arquitetura técnica pronta para implementação

> Data: 04/10/2026. Stack: Electron 44 + electron-vite + React 19 + TypeScript + Tailwind v4, Windows primeiro. Complementa [01-concorrentes-e-funcionalidades.md](01-concorrentes-e-funcionalidades.md) (modelo de dados, regras de agendamento e de retenção) e [02-design-system.md](02-design-system.md) (tokens e janela).
>
> **Tudo o que está marcado como "verificado" foi instalado e executado num protótipo**: build, typecheck com TS 6 e TS 7, 17 testes vitest em 4 fusos horários, 6 testes E2E com Playwright (2 deles no app já empacotado), um ZIP64 de 4,6 GB e as mensagens de erro do nodemailer 10. A lista completa está na §13.

## 0. Decisões

| Tema | Decisão | Motivo |
|---|---|---|
| Bundler | **electron-vite 5.0.0 + Vite 7.3.6** | O electron-vite 5.0.0 declara a peer `vite ^5 \|\| ^6 \|\| ^7`, e `npm i vite@8` dá ERESOLVE (verificado). Só o 6.0.0-beta.5 aceita Vite 8, e ainda é beta |
| Plugin React | **@vitejs/plugin-react 5.2.0** | A série 6.x exige `vite ^8` |
| TypeScript | **6.0.3** (tsconfig já compatível com o 7) | O TS 7.0 não tem API JS: `require('typescript')` só devolve `{version}`, o que quebra o typescript-eslint (peer `<6.1.0`) |
| Formato dos módulos | Projeto CJS (sem `"type":"module"`) e preload em `index.cjs` | Preload em sandbox só aceita CommonJS |
| Motor de backup | Roda num **`utilityProcess`** separado do main, usando só streams do Node | Uma varredura de 100 mil arquivos não trava a bandeja nem o IPC, e um crash do motor não derruba o app |
| Glob / ZIP / verificação | **picomatch 4.0.7 / yazl 3.3.1 / yauzl 3.4.0** | São JS puro. O yazl usa Zip64 sozinho (verificado com 4,6 GB). O archiver 8 é ESM-only e tem 9 dependências; o fflate não passa de 4 GB |
| Agendador | **Próprio** (cerca de 90 linhas), com tick de no máximo 30 s + `powerMonitor` | São só 4 tipos de agenda e não há cron na UI. `new Date(y,m,d,0,min)` já resolve o horário de verão |
| Persistência | **JSON próprio com escrita atômica** + histórico em NDJSON | Evita o electron-store 11 (ESM-only) e o better-sqlite3 (módulo nativo) |
| Senha SMTP | `safeStorage.encryptStringAsync` | A API assíncrona é a recomendada no Electron 44 |
| E-mail | **nodemailer 10.0.14** | Já traz os tipos: **não instale `@types/nodemailer`** |
| Instalador | **electron-builder 26.15.3**, NSIS assistido e por usuário, ícone lido direto de `build/icon.svg` | — |
| Testes | **vitest 5.0.3** e **@playwright/test 1.63.0** (`_electron` + `xvfb-run`) | — |

Em runtime o app usa 4 pacotes, todos JS puro: nodemailer, picomatch, yazl e yauzl. Binários nativos existem só no tooling (esbuild, rollup, lightningcss e Tailwind oxide), e chegam pré-compilados via `optionalDependencies`. Por isso dá para usar `npmRebuild: false`.

## 1. Toolchain

### 1.1 Fatos que mudam a configuração (verificados em 04/10/2026)
- **Electron 44.5.1** traz Node 24.21 e Chromium 152 ([releases.electronjs.org](https://releases.electronjs.org)). Por isso use `@types/node@24`.
- **Desde o Electron 42 o pacote npm não baixa mais o binário no `postinstall`**: o download acontece na primeira execução (verificado: `npm view electron@41 scripts` tem `postinstall`, o 42 não; ver [PR #51982](https://releases.electronjs.org/pr/51982)). O electron-vite 5 lê `node_modules/electron/path.txt` direto, então num clone novo `electron-vite dev` falha com **`Error: Electron uninstall`** (reproduzido). Correção: o script `"postinstall": "install-electron"`.
- O electron-vite 5 só conhece alvos de build até o Electron 39; para o 44 usa `node22.20`/`chrome142`, o que só transpila um pouco a mais. O 6 beta com Vite 8 (rolldown) exigiria `vite@8`, `@vitejs/plugin-react@6` e `rolldownOptions` no lugar de `rollupOptions`, e tem issues abertas: [#906](https://github.com/alex8088/electron-vite/issues/906) (esm-shim corrompe bundle ESM) e [#925](https://github.com/alex8088/electron-vite/issues/925). **Migre quando sair o 6.0.0 estável.**

### 1.2 `package.json`
```json
{
  "name": "bc-backup", "productName": "BC Backup", "version": "0.1.0", "description": "Gerenciador de backups",
  "author": "BC", "main": "./out/main/index.js", "engines": { "node": ">=22.12" },
  "scripts": {
    "postinstall": "install-electron",
    "dev": "electron-vite dev", "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json --composite false && tsc --noEmit -p tsconfig.web.json --composite false",
    "test": "vitest run", "e2e": "electron-vite build && playwright test",
    "dist:win": "electron-vite build && electron-builder --win --x64 --publish never",
    "dist:mac": "electron-vite build && electron-builder --mac --publish never",
    "dist:linux": "electron-vite build && electron-builder --linux --publish never"
  },
  "dependencies": { "nodemailer": "10.0.14", "picomatch": "4.0.7", "yauzl": "3.4.0", "yazl": "3.3.1" },
  "devDependencies": {
    "@playwright/test": "1.63.0", "@tailwindcss/vite": "4.3.3", "@types/node": "24.19.1", "@types/picomatch": "4.0.3",
    "@types/react": "19.3.0", "@types/react-dom": "19.3.0", "@types/yauzl": "3.4.0", "@types/yazl": "3.3.1",
    "@vitejs/plugin-react": "5.2.0", "electron": "44.5.1", "electron-builder": "26.15.3", "electron-vite": "5.0.0",
    "react": "19.3.0", "react-dom": "19.3.0", "tailwindcss": "4.3.3", "typescript": "6.0.3", "vite": "7.3.6", "vitest": "5.0.3"
  }
}
```
React vai em `devDependencies` porque é empacotado no bundle do renderer. Assim o `app.asar` leva apenas as 4 dependências de runtime (verificado com `asar list`).

### 1.3 Layout
```
src/main/      index.ts shell.ts ipc.ts scheduler.ts engine-host.ts autostart.ts mail.ts store.ts drives.ts
src/main/engine/  schedule.ts retention.ts walk.ts copy.ts zip.ts verify-zip.ts job.ts worker.ts  ← Node puro, testável
src/preload/   index.ts                       ← só contextBridge
src/renderer/  index.html  src/{main.tsx, app.css, ...}
src/shared/    ipc-contract.ts types.ts       ← só tipos e constantes, importados pelos três processos
resources/     tray.png tray@2x.png tray.ico  ← lidos em runtime via "?asset"
build/         icon.svg installer.nsh         ← electron-builder
test/ e2e/
```

### 1.4 `electron.vite.config.ts` (verificado)
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
const shared = { '@shared': resolve('src/shared') }
export default defineConfig({
  main: { build: { externalizeDeps: true }, resolve: { alias: shared } },
  preload: {
    // Sandboxed preload: a single self-contained CJS file (no node_modules at runtime)
    build: { externalizeDeps: false, rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
    resolve: { alias: shared }
  },
  renderer: { resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } }, plugins: [react(), tailwindcss()] }
})
```
No v5, `externalizeDepsPlugin()` e `bytecodePlugin()` ficaram obsoletos e foram substituídos por `build.externalizeDeps` e `build.bytecode` ([CHANGELOG](https://github.com/alex8088/electron-vite/blob/master/CHANGELOG.md)). Para o `utilityProcess`, use `import p from './engine/worker?modulePath'` ([guia](https://electron-vite.org/guide/dev)) e adicione `/// <reference types="electron-vite/node" />` em `src/main/env.d.ts`.

### 1.5 tsconfig e TypeScript 7
Use um `tsconfig.json` raiz com `{"files":[],"references":[{"path":"./tsconfig.node.json"},{"path":"./tsconfig.web.json"}]}`, que é o que o editor enxerga. O `tsconfig.node.json`:
```jsonc
{ "compilerOptions": { "composite": true, "target": "ES2024", "lib": ["ES2024"], "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true, "isolatedModules": true, "verbatimModuleSyntax": true,
    "types": ["node"], "paths": { "@shared/*": ["./src/shared/*"] } },
  "include": ["electron.vite.config.ts", "vitest.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*", "test/**/*"] }
```
O `tsconfig.web.json` muda só nestes campos: `"lib": ["ES2024","DOM","DOM.Iterable"]`, `"jsx": "react-jsx"`, `"types": ["vite/client"]`, o alias `@renderer/*` e o `include` de `src/renderer/src` + `src/shared`. **Se faltar `vite/client`, o TS 6 acusa TS2882 em `import './app.css'`** (verificado).

Sobre o **TS 7**: o Vite e o electron-vite não usam o compilador TS (transpilam com esbuild/oxc). O `tsc` 7.0.2 passa nos dois projetos acima (verificado). O problema é que o 7.0 "não traz API" ([anúncio](https://devblogs.microsoft.com/typescript/?p=5246)), e isso quebra o typescript-eslint e qualquer ferramenta que importe `typescript`. Os tsconfigs acima já evitam `baseUrl`, `moduleResolution: node` e o padrão `types: []`, então a migração vai ser só trocar a versão. Se quiser o `tsc` nativo desde já, o caminho oficial (testado) é instalar as duas versões lado a lado: `"typescript": "npm:@typescript/typescript6@6.0.2"` (para eslint e editor, binário `tsc6`) e `"@typescript/native": "npm:typescript@7.0.2"` (binário `tsc`).

## 2. Tailwind v4 e tema por `data-theme` (verificado)
```css
/* src/renderer/src/app.css: tokens completos em 02-design-system.md §10 */
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
```
```ts
// main: makes Chromium's prefers-color-scheme AND native menus/dialogs follow the app setting
ipcHandle('settings:theme', (t: 'system' | 'light' | 'dark') => { nativeTheme.themeSource = t })
// renderer (main.tsx, before createRoot): always derive from the media query, which now mirrors the setting
const mq = matchMedia('(prefers-color-scheme: dark)')
const apply = () => { document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light' }
apply(); mq.addEventListener('change', apply)
```
Para não piscar branco na abertura: `BrowserWindow({ show: false, backgroundColor })` + `ready-to-show`, e `data-theme="dark"` no `<html>` como valor inicial. A diretiva `@custom-variant` é a forma documentada do v4 ([docs](https://tailwindcss.com/docs/dark-mode)). Não precisa de `tailwind.config.js` nem de PostCSS.

## 3. IPC seguro e tipado
A base é `contextIsolation: true`, `sandbox: true` e `nodeIntegration: false`. O preload só tem acesso aos módulos de renderer do `electron` e a `events`/`timers`/`url`. O renderer nunca recebe o `ipcRenderer` cru, só canais de uma lista branca, e o main valida quem enviou cada mensagem ([checklist de segurança, itens 3, 4 e 17](https://www.electronjs.org/docs/latest/tutorial/security)).
```ts
// src/shared/ipc-contract.ts
export interface InvokeMap {            // renderer → main (request/response)
  'routines:list': () => Routine[];  'routines:save': (r: Routine) => Routine
  'runs:start': (routineId: string) => string;  'runs:cancel': (runId: string) => void
  'mail:test': () => { ok: true } | { ok: false; message: string }
  'fs:pickFolder': () => string | null;  'fs:drives': () => DriveInfo[]
}
export interface EventMap { 'run:progress': RunProgress; 'run:finished': RunRecord; 'state:changed': AppSnapshot } // main → renderer
export const INVOKE_CHANNELS = ['routines:list', 'routines:save', 'runs:start', 'runs:cancel', 'mail:test', 'fs:pickFolder', 'fs:drives'] as const satisfies readonly (keyof InvokeMap)[]
export const EVENT_CHANNELS = ['run:progress', 'run:finished', 'state:changed'] as const satisfies readonly (keyof EventMap)[]
export type Ret<K extends keyof InvokeMap> = Awaited<ReturnType<InvokeMap[K]>>
export interface BcApi {
  invoke<K extends keyof InvokeMap>(ch: K, ...args: Parameters<InvokeMap[K]>): Promise<Ret<K>>
  on<K extends keyof EventMap>(ch: K, cb: (payload: EventMap[K]) => void): () => void   // returns unsubscribe
  pathForFile(file: File): string                                                        // drag & drop
}
```
```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { INVOKE_CHANNELS, EVENT_CHANNELS, type BcApi } from '@shared/ipc-contract'
const okInvoke = new Set<string>(INVOKE_CHANNELS), okEvent = new Set<string>(EVENT_CHANNELS)
const api: BcApi = {
  invoke: (ch, ...args) => (okInvoke.has(ch) ? ipcRenderer.invoke(ch, ...args) : Promise.reject(new Error(`blocked: ${ch}`))),
  on(ch, cb) {
    if (!okEvent.has(ch)) throw new Error(`blocked: ${ch}`)
    const listener = (_e: IpcRendererEvent, payload: any) => cb(payload)
    ipcRenderer.on(ch, listener)
    return () => { ipcRenderer.removeListener(ch, listener) }
  },
  pathForFile: (f) => webUtils.getPathForFile(f) // File.path was removed in Electron 32
}
contextBridge.exposeInMainWorld('bc', api)
```
```ts
// src/main/ipc.ts
const trusted = (f: WebFrameMain | null) => !!f && (process.env.ELECTRON_RENDERER_URL
  ? new URL(f.url).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin : f.url.startsWith('file://'))
export function handle<K extends keyof InvokeMap>(ch: K, fn: (...a: Parameters<InvokeMap[K]>) => Ret<K> | Promise<Ret<K>>) {
  ipcMain.handle(ch, (e, ...args) => { if (!trusted(e.senderFrame)) throw new Error('untrusted sender'); return fn(...(args as Parameters<InvokeMap[K]>)) })
}
export const emit = <K extends keyof EventMap>(w: BrowserWindow | null, ch: K, p: EventMap[K]) => { if (w && !w.isDestroyed()) w.webContents.send(ch, p) }
// renderer hook (React 19.2+ has useEffectEvent): subscription is removed on unmount
export function useIpcEvent<K extends keyof EventMap>(ch: K, cb: (p: EventMap[K]) => void) {
  const onEvent = useEffectEvent(cb); useEffect(() => window.bc.on(ch, (p) => onEvent(p)), [ch])
}
```
Mais regras:
- Valide os argumentos no main com *type guards* (caminhos absolutos, ids existentes). `setWindowOpenHandler(() => ({action:'deny'}))` e `shell.openExternal` para links `https`; `will-navigate` → `preventDefault`; `setPermissionRequestHandler(→ false)`.
- No `index.html`, a CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:` funciona no `dev` (com React Refresh) e no build (verificado).
- O motor emite progresso a cada 250 ms no máximo. Ao montar, o renderer pede um *snapshot* (`state:changed`), porque a janela pode nem existir enquanto o app está só na bandeja.

## 4. Iniciar com o sistema
```ts
// src/main/autostart.ts
export const HIDDEN = '--hidden'
const exe = () => process.env.PORTABLE_EXECUTABLE_FILE ?? process.env.APPIMAGE ?? process.execPath // portable runs from %TEMP%
const desktopFile = () => join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart', 'bc-backup.desktop')
export async function setAutoStart(on: boolean) {
  if (!app.isPackaged) return                                   // never register node_modules/electron
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: on, path: exe(), args: [HIDDEN] })
  else if (process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin: on }) // SMAppService; openAsHidden no longer exists
  else if (on) {
    await mkdir(dirname(desktopFile()), { recursive: true })
    await writeFile(desktopFile(), `[Desktop Entry]\nType=Application\nName=BC Backup\nExec="${exe().replace(/(["`$\\])/g, '\\$1')}" ${HIDDEN}\nIcon=bc-backup\nX-GNOME-Autostart-enabled=true\nX-GNOME-Autostart-Delay=10\nTerminal=false\n`)
  } else await rm(desktopFile(), { force: true })
}
export function autoStartStatus() {          // show "desativado pelo usuário no Gerenciador de Tarefas" when blocked
  if (process.platform === 'win32') { const s = app.getLoginItemSettings({ path: exe(), args: [HIDDEN] }) // same path/args as set!
    return { on: s.openAtLogin, blocked: s.openAtLogin && !s.executableWillLaunchAtLogin } }
  if (process.platform === 'darwin') { const s = app.getLoginItemSettings(); return { on: s.openAtLogin, blocked: s.status === 'requires-approval' } }
  return { on: existsSync(desktopFile()), blocked: false }
}
export const startedHidden = () => process.argv.includes(HIDDEN) || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
```
Cuidados (tipos conferidos no `electron.d.ts` 44.5.1; docs de [app](https://www.electronjs.org/docs/latest/api/app)):
1. No Windows o valor fica em `HKCU\…\Run`, com o nome igual ao **AppUserModelId**. Com NSIS `perMachine: false` o caminho é estável (`%LOCALAPPDATA%\Programs\bc-backup`) e sobrevive a atualizações; apague a chave na desinstalação (§11). No macOS, `openAsHidden` foi removido: use `wasOpenedAtLogin`.
2. **Portable:** `process.execPath` aponta para uma pasta temporária que muda a cada execução. Use `PORTABLE_EXECUTABLE_FILE` (definido pelo template do electron-builder) ou desative o auto-start no portable.
3. Se o usuário desligar o app em "Aplicativos de inicialização", `openAtLogin` continua `true` e `executableWillLaunchAtLogin` passa a `false`: a UI deve avisar. No Linux vale a [especificação de autostart do freedesktop](https://specifications.freedesktop.org/autostart-spec/latest/); no AppImage, o `Exec` aponta para `$APPIMAGE`.

## 5. Bandeja, instância única e notificações (verificado em E2E)
```ts
// src/main/shell.ts
const APP_ID = 'com.bcbackup.app'          // MUST equal electron-builder appId (NSIS stamps it on the shortcut AUMID)
let win: BrowserWindow | null = null, tray: Tray | null = null, quitting = false // module-level tray ref: avoids GC
export function bootstrap(onReady: () => void) {
  if (process.env.BC_USER_DATA) app.setPath('userData', process.env.BC_USER_DATA) // E2E isolation (lock is per userData)
  if (!app.requestSingleInstanceLock()) return app.quit()
  app.on('second-instance', (_e, argv) => { if (!argv.includes(HIDDEN)) showWindow() })
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => {})    // keep running in the tray
  app.whenReady().then(() => {
    createTray()
    if (!startedHidden()) showWindow(); else if (process.platform === 'darwin') app.dock?.hide()
    app.on('activate', showWindow); onReady()
  })
}
export function showWindow() {
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return }
  win = new BrowserWindow({ width: 1200, height: 780, minWidth: 960, minHeight: 640, show: false, backgroundColor: '#0B0B0F',
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } })
  win.once('ready-to-show', () => win?.show())
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide() } })   // close = minimize to tray
  win.on('query-session-end', () => { quitting = true })                        // never block Windows logoff/shutdown
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL); else win.loadFile(join(__dirname, '../renderer/index.html'))
}
function createTray() {
  const img = nativeImage.createFromPath(process.platform === 'win32' ? trayIco : trayPng) // import trayIco from '../../resources/tray.ico?asset'
  if (process.platform === 'darwin') img.setTemplateImage(true)
  tray = new Tray(img); tray.setToolTip('BC Backup')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir BC Backup', click: showWindow }, { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit() } }]))
  tray.on('click', showWindow)              // Win/macOS; on Linux (AppIndicator) rely on the context menu
}
export function notify(title: string, body: string) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body }); n.on('click', showWindow); n.show()
}
export function keepAwake() {               // around every run: blocks system sleep, not the display
  const id = powerSaveBlocker.start('prevent-app-suspension'); return () => powerSaveBlocker.stop(id)
}
```
- **Notificação no Windows** só aparece se houver atalho no Menu Iniciar com o mesmo AUMID; o NSIS cria esse atalho com `${APP_ID}`. Em `dev`, use `process.execPath` ([notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)).
- **Bandeja:** `.ico` (16/20/24/32 px) no Windows, imagem *template* `trayTemplate.png` + `@2x` no macOS; no Linux o `click` varia conforme o ambiente ([tray](https://www.electronjs.org/docs/latest/api/tray)). Troque o ícone com `tray.setImage(...)` (ok/rodando/erro): "falha tem que ser barulhenta" (doc 01).

## 6. Agendador (sem biblioteca, verificado com fake timers)
Não vale usar croner. Ele resolveria só a conta do próximo horário: o fallback de 30 s e a recuperação de execução perdida (*catch-up*) teriam que ser escritos de qualquer forma, e a UI não expõe cron. Também dispensa o date-fns/luxon sugerido no doc 01. O modelo `Schedule` abaixo é o mesmo do doc 01 §4. Datas criadas com `new Date(y, m, d, 0, minutos)` tratam o horário de verão assim: se o horário cai no buraco da primavera, avança para o primeiro horário válido; se cai na hora repetida do outono, usa a primeira ocorrência (testado em New York, Berlim, São Paulo e UTC).
```ts
// src/main/engine/schedule.ts
export interface Schedule { type: 'manual' | 'weekly' | 'interval' | 'startup'; weekdays: number[]; times: string[]
  intervalMinutes: number | null; window: { start: string; end: string } | null; startupDelayMinutes: number
  catchUpMissed: boolean; catchUpDelayMinutes: number }
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
function slotsOfDay(s: Schedule): number[] {
  if (s.type === 'weekly') return [...new Set(s.times.map(toMin))].sort((a, b) => a - b)
  if (s.type !== 'interval' || !s.intervalMinutes) return []
  const out: number[] = [], end = s.window ? toMin(s.window.end) : 1439
  for (let m = s.window ? toMin(s.window.start) : 0; m <= end; m += Math.max(5, s.intervalMinutes)) out.push(m)
  return out
}
export function nextRunAfter(s: Schedule, after: Date): Date | null {
  const mins = slotsOfDay(s), days = s.weekdays.length ? new Set(s.weekdays) : null
  for (let i = 0; mins.length && i <= 7; i++) {
    const y = after.getFullYear(), mo = after.getMonth(), d = after.getDate() + i
    if (days && !days.has(new Date(y, mo, d).getDay())) continue
    for (const m of mins) { const c = new Date(y, mo, d, 0, m); if (c > after) return c }
  }
  return null
}
export function lastDueSlot(s: Schedule, anchor: Date, now: Date): Date | null { // most recent slot in (anchor, now]
  let slot = nextRunAfter(s, anchor); if (!slot || slot > now) return null
  for (let n = nextRunAfter(s, slot); n && n <= now; n = nextRunAfter(s, n)) slot = n
  return slot
}
export const upcoming = (s: Schedule, from: Date, n = 3) => { // "Próximas execuções: hoje 18:30, amanhã 12:00…"
  const out: Date[] = []; for (let d = nextRunAfter(s, from); d && out.length < n; d = nextRunAfter(s, d)) out.push(d); return out }
```
```ts
// src/main/scheduler.ts: wire with powerMonitor.on('resume' | 'unlock-screen', scheduler.tick)
type Trigger = 'schedule' | 'manual' | 'catchup' | 'startup'
interface SchedDeps { routines(): Routine[]; getSlot(id: string): string | null; setSlot(id: string, iso: string): void   // slot = RoutineState.lastAttemptSlot (persist!)
  run(id: string, t: Trigger): Promise<void>; missed(id: string, slot: Date): void }
const TICK_MAX = 30_000, ON_TIME = 120_000
export class Scheduler {
  private timer?: NodeJS.Timeout; private queue: { id: string; trigger: Trigger }[] = []; private active: string | null = null
  constructor(private d: SchedDeps, private now = () => new Date()) {}
  start() { for (const r of this.d.routines()) if (r.enabled && r.schedule.type === 'startup')
    setTimeout(() => this.enqueue(r.id, 'startup'), r.schedule.startupDelayMinutes * 60_000); this.tick() }
  stop() { clearTimeout(this.timer) }
  tick = () => {
    clearTimeout(this.timer)
    const now = this.now(); let soonest = now.getTime() + TICK_MAX
    for (const r of this.d.routines()) {
      if (!r.enabled) continue
      const anchor = new Date(this.d.getSlot(r.id) ?? r.createdAt)        // RoutineState.lastAttemptSlot
      const slot = lastDueSlot(r.schedule, anchor, now)
      if (slot) {
        this.d.setSlot(r.id, slot.toISOString())     // consume FIRST: N missed slots → 1 run; a crash never loops
        if (now.getTime() - slot.getTime() <= ON_TIME) this.enqueue(r.id, 'schedule')
        else if (r.schedule.catchUpMissed) setTimeout(() => this.enqueue(r.id, 'catchup'), r.schedule.catchUpDelayMinutes * 60_000)
        else this.d.missed(r.id, slot)
      }
      const next = nextRunAfter(r.schedule, slot ?? anchor); if (next) soonest = Math.min(soonest, next.getTime())
    }
    this.timer = setTimeout(this.tick, Math.max(1_000, soonest - now.getTime())) // ≤30 s: survives sleep/clock changes
  }
  enqueue(id: string, trigger: Trigger): boolean {   // manual runs too; maxConcurrentRuns = 1
    if (this.active === id || this.queue.some((q) => q.id === id)) return false // log "ignorada: execução anterior em andamento"
    this.queue.push({ id, trigger }); void this.drain(); return true
  }
  private async drain() {
    if (this.active) return
    for (let j = this.queue.shift(); j; j = this.queue.shift()) {
      this.active = j.id
      try { await this.d.run(j.id, j.trigger) } catch { /* run() records failures */ } finally { this.active = null }
    }
  }
}
```
Uma rotina nova usa `createdAt` como âncora, então não dispara na hora. Ao editar a agenda, grave `lastAttemptSlot = agora`. Eventos do `powerMonitor` ([docs](https://www.electronjs.org/docs/latest/api/power-monitor)): `suspend`/`resume` em todas as plataformas, `lock-screen`/`unlock-screen` em Windows e macOS.

## 7. Motor de cópia (Node puro, roda no `utilityProcess`)
**Layout:** `<dest>/BC Backup/<rotina>/` contém `.bcbackup-rotina.json` (o routineId) e uma pasta por execução, `2026-10-04_14-30-00/`, com `.incomplete` → conteúdo → `bcbackup-manifesto.json`.

No modo ZIP o arquivo é `2026-10-04_14-30-00.zip.partial`, renomeado para `.zip` no fim. Aqui o guia **troca o `rename` da pasta inteira `.em-andamento`, proposto no doc 01, por um marcador**. O motivo: no Windows, o antivírus segura *handles* dos arquivos recém-gravados, e renomear um diretório grande falha com EPERM de forma intermitente. Renomear um arquivo único (`.partial`) é seguro desde que haja retry.
```ts
// src/main/engine/walk.ts: iterative opendir walk; never follows symlinks/junctions; errors become issues
export function makeFilter(include: string[], exclude: string[]) {
  const o = { dot: true, nocase: process.platform !== 'linux' }   // NTFS/APFS are case-insensitive
  const inc = picomatch(include.length ? include : ['**'], o), exc = exclude.length ? picomatch(exclude, o) : () => false
  return { dirExcluded: (rel: string) => exc(rel), fileIncluded: (rel: string) => inc(rel) && !exc(rel) }
}
export async function* walk(root: string, f: Filter, issues: Issue[], signal?: AbortSignal): AsyncGenerator<FileItem> {
  const st = await stat(root)
  if (st.isFile()) { yield { abs: root, rel: basename(root), size: st.size, mtime: st.mtime, atime: st.atime }; return }
  const stack = [root]
  while (stack.length) {
    signal?.throwIfAborted()
    const dir = stack.pop()!
    let h; try { h = await opendir(dir, { bufferSize: 128 }) } catch (e: any) { issues.push({ path: dir, code: e.code, message: e.message }); continue }
    for await (const ent of h) {
      const abs = join(dir, ent.name), rel = relative(root, abs).split(sep).join('/')  // globs always see "/"
      if (ent.isSymbolicLink()) { issues.push({ path: abs, code: 'SYMLINK', message: 'link ignorado' }); continue }
      if (ent.isDirectory()) { if (!f.dirExcluded(rel)) stack.push(abs); continue }  // prune: "**/node_modules/**" matches the dir
      if (!ent.isFile() || !f.fileIncluded(rel)) continue
      try { const s = await stat(abs); yield { abs, rel, size: s.size, mtime: s.mtime, atime: s.atime } }
      catch (e: any) { issues.push({ path: abs, code: e.code, message: e.message }) }
    }
  }
}
```
```ts
// src/main/engine/copy.ts
export const SKIPPABLE = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'EINVAL', 'ENAMETOOLONG']) // in use / gone / denied → warning
export const FATAL_DEST = new Set(['ENOSPC', 'EDQUOT', 'EROFS', 'EIO', 'ENOTCONN', 'ENODEV'])    // abort THIS destination
export const freeBytes = async (p: string) => { const s = await statfs(p); return Number(s.bavail) * Number(s.bsize) }
export async function copyOne(it: FileItem, root: string, onBytes: (n: number) => void, signal: AbortSignal) {
  const dst = join(root, ...it.rel.split('/'))
  await mkdir(dirname(dst), { recursive: true })
  const count = new Transform({ transform(c: Buffer, _e, cb) { onBytes(c.length); cb(null, c) } })
  await pipeline(createReadStream(it.abs, { highWaterMark: 1 << 20 }), count, createWriteStream(dst, { flags: 'wx' }), { signal })
  await utimes(dst, it.atime, it.mtime)                                   // preserve mtime
}
export async function copyTree(items: FileItem[], dir: string, meter: Meter, signal: AbortSignal): Promise<Skip[]> {
  const total = items.reduce((a, f) => a + f.size, 0)
  await mkdir(dir, { recursive: true })
  if ((await freeBytes(dir)) < total * 1.05 + 64 * 2 ** 20) throw Object.assign(new Error('Espaço insuficiente no destino'), { code: 'ENOSPC' })
  await writeFile(join(dir, '.incomplete'), new Date().toISOString())
  const skipped: Skip[] = []
  for (const it of items) {
    signal.throwIfAborted(); meter.file(it.rel); let done = 0
    try { await copyOne(it, dir, (n) => { done += n; meter.add(n) }, signal) }
    catch (e: any) {
      if (signal.aborted || FATAL_DEST.has(e.code) || !SKIPPABLE.has(e.code)) throw e // .incomplete stays; next run deletes it
      meter.add(it.size - done); skipped.push({ rel: it.rel, code: e.code, message: e.message })
      await rm(join(dir, ...it.rel.split('/')), { force: true })
    }
  }
  await writeJsonAtomic(join(dir, 'bcbackup-manifesto.json'), { /* routineId, snapshotId, startedAt, finishedAt, status, mode, files, bytes, verify, appVersion, skipped */ })
  await rm(join(dir, '.incomplete'))
  return skipped
}
```
O `Meter` acumula bytes e calcula bytes/s numa janela de 1 s, emitindo no máximo a cada 250 ms. Os testes cobrem: cancelar deixa `.incomplete`; o `mtime` é preservado; `**/node_modules/**` poda a árvore inteira; o `ENOENT` de um arquivo que sumiu vira aviso, não erro. Pastas que sobraram com `.incomplete` (execução que caiu) são apagadas no início da próxima execução da rotina (doc 01). A cópia é **sequencial**. O doc 01 sugere `p-limit` com 4 em paralelo: só adote isso (com um pool de 10 linhas, já que o p-limit 7 é ESM-only) se uma medição em rede ou SSD mostrar ganho com muitos arquivos pequenos. Em HD ou pendrive USB, paralelizar piora.
```ts
// src/main/engine/zip.ts: one open file at a time; a locked file is detected at open() and skipped without corrupting the archive
export async function zipTree(items: FileItem[], final: string, onBytes: (n: number) => void, signal: AbortSignal, compress = true) {
  const partial = final + '.partial', zip = new yazl.ZipFile(), skipped: Skip[] = []
  const out = pipeline(zip.outputStream, createWriteStream(partial, { flags: 'wx' }), { signal }); out.catch(() => {})
  try {
    for (const it of items) {
      signal.throwIfAborted()
      let fh; try { fh = await open(it.abs, 'r') } catch (e: any) { if (!SKIPPABLE.has(e.code)) throw e; skipped.push({ rel: it.rel, code: e.code, message: e.message }); continue }
      const body = pipeCb(fh.createReadStream({ highWaterMark: 1 << 20 }), new Transform({ transform(c: Buffer, _e, cb) { onBytes(c.length); cb(null, c) } }), () => {})
      zip.addReadStream(body, it.rel, { mtime: it.mtime, compress, size: it.size })  // Zip64 kicks in automatically
      await finished(body)
    }
    zip.end(); await out; await renameRetry(partial, final); return skipped
  } catch (e) { (zip.outputStream as Readable).destroy(); await out.catch(() => {}); await rm(partial, { force: true }); throw e }
}
```
**Verificação rápida:** compare tamanhos com `stat` ou, no ZIP, abra o diretório central com o `yauzl`. **Completa:** releia tudo. **O yauzl não confere CRC-32** (está no README dele): calcule com `zlib.crc32(chunk, crc)` (Node 24) e compare com `entry.crc32`. O teste corrompe 3 bytes e detecta.
```ts
// src/main/engine-host.ts: main side. worker.ts: parentPort.on('message') → runJob(spec, emit, ac.signal); 'cancel' → ac.abort()
import enginePath from './engine/worker?modulePath'
export function startJob(spec: JobSpec, onProgress: (p: Progress) => void) {
  const child = utilityProcess.fork(enginePath, [], { serviceName: 'BC Backup Engine', stdio: 'pipe' })
  const result = new Promise<JobResult>((resolve, reject) => {
    child.once('spawn', () => child.postMessage({ type: 'start', spec }))
    child.on('message', (m: FromWorker) => {
      if (m.type === 'progress') return onProgress(m.p)
      child.kill(); m.type === 'done' ? resolve(m.result) : reject(Object.assign(new Error(m.message), { code: m.cancelled ? 'ECANCELED' : m.code }))
    })
    child.once('exit', (code) => reject(new Error(`engine exited (${code})`)))
  })
  return { result, cancel: () => { child.postMessage({ type: 'cancel' }); setTimeout(() => child.kill(), 10_000).unref() } }
}
```
O `runJob` faz a varredura **uma vez** e grava cada origem em `<stamp>/<nome-da-origem>/…`. Depois processa os destinos **em sequência e de forma independente**: se um disco encher, os outros seguem. A retenção roda só depois do sucesso naquele destino, e o resultado é um único `JobResult`, que vira um único e-mail. Nomes de rotina passam por limpeza: tira `<>:"/\|?*`, ponto ou espaço final, e prefixa `_` em `CON`, `PRN`, `AUX`, `NUL`, `COMn` e `LPTn`. O fluxo inteiro (zip, 2 destinos, progresso, `keepAwake`) foi testado em E2E dentro do Electron, e o `utilityProcess` também carrega de dentro do `app.asar`.

Retenção, com as regras do doc 01 §6 (`keepDays=7` no dia 8 mantém do dia 2 ao 8, e `minKeep` protege as cópias completas mais novas):
```ts
export function selectForDeletion(entries: BackupEntry[], r: Retention, now: Date): BackupEntry[] {
  if (r.keepDays <= 0) return []
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (r.keepDays - 1))
  const sorted = [...entries].sort((a, b) => b.date.getTime() - a.date.getTime())
  const kept = sorted.filter((e) => e.complete && e.date >= cutoff).length
  const rescue = new Set(sorted.filter((e) => e.complete && e.date < cutoff).slice(0, Math.max(0, r.minKeep - kept)))
  return sorted.filter((e) => e.date < cutoff && !rescue.has(e)).reverse()   // oldest first
}
```
Para montar `entries`, a data vem do **nome** (`parseStamp`), nunca do mtime. Uma cópia conta como `complete` quando tem manifesto com o mesmo `routineId` e não tem `.incomplete`, ou quando é `.zip` sem `.partial`. Ignore tudo que não casar com `^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d(\.zip)?(\.partial)?$`, porque o app nunca apaga o que não criou. Para apagar: renomeie para `.excluindo` e depois `rm(p, { recursive: true, force: true, maxRetries: 3 })`. Sobras `.excluindo` de uma exclusão interrompida são removidas na próxima execução.

Casos especiais:
- **Caminhos longos:** desde o [nodejs/node#52135](https://github.com/nodejs/node/pull/52135), o `fs` converte caminhos absolutos para `\\?\` em C++. Então **não adicione o prefixo `\\?\` à mão**: ele quebra `join`/`relative`. Mesmo assim, o Explorer pode falhar acima de 260 caracteres. Registre um aviso quando o caminho de destino passar de 240.
- **Arquivos em uso:** o Windows devolve `EBUSY` para *sharing violation* e `EPERM`/`EACCES` para acesso negado. Esses arquivos são pulados com aviso, e o status final fica "Concluído com avisos". Ler arquivos bloqueados de verdade (PST, bancos) exige VSS, que é nativo e precisa de admin: fica para a v2.

## 8. Unidades de disco sem módulo nativo (verificado no Linux)
```ts
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), ms))])
const space = async (p: string) => { const s = await withTimeout(statfs(p), 2_000) // dead mapped drives can hang
  return { total: Number(s.blocks) * Number(s.bsize), free: Number(s.bavail) * Number(s.bsize) } }
function winMeta(): Promise<Map<string, { label: string; type: number }>> {   // labels + type; WMIC is gone from Win 11 24H2+
  const cmd = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType | ConvertTo-Json -Compress'
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 8_000 }, (err, out) => {
    const m = new Map(); if (!err) try { for (const r of [JSON.parse(out)].flat()) m.set(r.DeviceID.toUpperCase(), { label: r.VolumeName ?? '', type: r.DriveType }) } catch {}
    res(m) }))
}
const KIND: Record<number, DriveKind> = { 2: 'removable', 3: 'fixed', 4: 'network', 5: 'optical' }
export async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform === 'win32') {
    const meta = await winMeta()
    const r = await Promise.allSettled('CDEFGHIJKLMNOPQRSTUVWXYZAB'.split('').map(async (l) => {
      const m = meta.get(`${l}:`); if ((meta.size && !m) || m?.type === 5) throw 0          // absent or CD/DVD
      return { path: `${l}:\\`, label: m?.label || `${l}:`, kind: KIND[m?.type ?? 0] ?? 'unknown', ...(await space(`${l}:\\`)) }
    }))
    return r.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []))
  }
  const u = userInfo().username, bases = process.platform === 'darwin' ? ['/Volumes'] : [`/media/${u}`, `/run/media/${u}`, '/mnt']
  const out: DriveInfo[] = [{ path: '/', label: 'Sistema', kind: 'fixed', ...(await space('/')) }]
  for (const b of bases) for (const e of await readdir(b, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue                // skips macOS "Macintosh HD" → "/"
    try { out.push({ path: join(b, e.name), label: e.name, kind: 'removable', ...(await space(join(b, e.name))) }) } catch {}
  }
  return out
}
```
Se o PowerShell falhar (política, timeout), o mapa volta vazio e todas as letras A–Z são testadas só com `statfs`. Unidade vazia não abre a janela "Não há disco na unidade", porque o libuv chama `SetErrorMode(SEM_FAILCRITICALERRORS…)` ao iniciar ([core.c](https://github.com/libuv/libuv/blob/v1.x/src/win/core.c)). O WMIC foi **removido** das versões atuais do Windows 11 ([KB5067470](https://support.microsoft.com/help/5067470)): não dependa dele. Destinos de rede (`\\SERVIDOR\share`) não aparecem na lista: o usuário escolhe pelo `dialog.showOpenDialog`. O `statfs` do libuv no Windows faz `CreateFileW` + `NtQueryVolumeInformationFile` no caminho dado ([fs.c](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c)), então funciona com UNC e com qualquer subpasta, e devolve o espaço livre já descontando cota.

## 9. Persistência e segredos
Arquivos em `userData`: `config.json` (rotinas, configurações, contas SMTP) · `state.json` (`RoutineState`, gravado a cada slot e a cada execução) · `history/2026-10.ndjson` (um `RunRecord` por linha, só append) · `logs/<runId>.log`.

O doc 01 sugeria electron-store e better-sqlite3. Ficam de fora: o **electron-store 11** é ESM-only (exigiria ESM no main ou `require(esm)`) e não ganha nada sobre 40 linhas próprias; o **better-sqlite3** é nativo, o que vai contra a regra do projeto.
```ts
export async function renameRetry(from: string, to: string) { // Windows: AV/indexer briefly holds the target → EPERM/EBUSY
  for (let i = 0; ; i++) try { return await rename(from, to) } catch (e: any) {
    if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || i >= 8) throw e
    await new Promise((r) => setTimeout(r, 25 * 2 ** i)) }
}
export async function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`, fh = await open(tmp, 'w')
  try { await fh.writeFile(JSON.stringify(data, null, 2)); await fh.sync() } finally { await fh.close() } // fsync before rename
  try { await renameRetry(tmp, file) } catch (e) { await rm(tmp, { force: true }); throw e }
}
export class JsonStore<T extends object> {    // serializes writes; a corrupt file is renamed *.corrupt-<ts> and defaults load
  private chain = Promise.resolve(); constructor(private file: string, public data: T) {}
  update(mut: (d: T) => void) { mut(this.data); const snap = structuredClone(this.data)
    return (this.chain = this.chain.then(() => writeJsonAtomic(this.file, snap))) }
}
```
Guarde um campo `schemaVersion` e uma função `migrate(raw)` ao carregar. A senha SMTP é cifrada assim ([safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)):
```ts
export const sealSecret = async (plain: string) => (await safeStorage.encryptStringAsync(plain)).toString('base64') // after app 'ready'
export async function openSecret(enc: string, reseal: (b64: string) => void) {
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'))
  if (shouldReEncrypt) reseal(await sealSecret(result))        // key rotated
  return result
}
```
Por plataforma, a chave vem do DPAPI (Windows), do Keychain (macOS) ou do libsecret/kwallet (Linux). Quando `getSelectedStorageBackend() === 'basic_text'` (Linux sem chaveiro), mostre um aviso: nesse caso a senha fica só ofuscada. Chame `isAsyncEncryptionAvailable()` antes de cifrar.

## 10. E-mail com nodemailer 10
Mudanças em relação ao 6/7 ([CHANGELOG](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md)): **7.0** SES v2 · **8.0** `NoAuth` virou `ENOAUTH` · **9.0** buscas HTTPS de conteúdo remoto (anexos `href`, OAuth2) passaram a validar TLS · **10.0** reescrito em TypeScript, build duplo ESM/CJS, tipos próprios, Node ≥ 20. A API `createTransport`/`verify`/`sendMail` continua igual. Os códigos de erro abaixo foram **obtidos contra servidores SMTP falsos locais**:

| Situação | `code` | Detalhe |
|---|---|---|
| Senha errada (535) | `EAUTH` | `responseCode: 535` |
| `secure:true` numa porta STARTTLS (587) | `ESOCKET` | mensagem `…wrong version number` |
| Porta fechada | `ESOCKET` | mensagem `connect ECONNREFUSED` |
| Servidor mudo | `ETIMEDOUT` | `Greeting never received` |
| Host inexistente | `EDNS` | — |

Atenção: **os timeouts padrão são de 2 min (conexão), 30 s (saudação) e 10 min (socket)**. Sem ajustá-los, o botão "Testar" parece travado.
```ts
export const transport = (s: SmtpAccount, pass: string) => nodemailer.createTransport({
  host: s.host, port: s.port, secure: s.security === 'ssl', requireTLS: s.security === 'starttls', // 465 = TLS direto; 587 = STARTTLS
  auth: s.username ? { user: s.username, pass } : undefined,
  connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: s.timeoutSec * 1000,
  tls: { minVersion: 'TLSv1.2', rejectUnauthorized: !s.allowInvalidCert } })
export function smtpErrorPtBR(e: any): string {
  if (/5\.7\.30|basic authentication is (not supported|disabled)/i.test(e.response ?? ''))
    return 'A Microsoft recusou a autenticação básica (SMTP AUTH). Peça ao administrador do Microsoft 365 para habilitá-la ou use outro provedor.'
  switch (e.code) {
    case 'EAUTH': return 'Usuário ou senha recusados. No Gmail ou Outlook com verificação em duas etapas, use uma "senha de app".'
    case 'ENOAUTH': return 'O servidor exige autenticação: preencha usuário e senha.'
    case 'EDNS': return 'Servidor SMTP não encontrado. Confira o endereço.'
    case 'ETIMEDOUT': return 'Tempo esgotado. Confira host e porta, ou se um firewall ou antivírus bloqueia o SMTP.'
    case 'ESOCKET': case 'ECONNECTION':
      if (/wrong version number|tls_validate_record_header/i.test(e.message)) return 'Segurança e porta não combinam: 465 usa SSL/TLS, 587 usa STARTTLS.'
      return /ECONNREFUSED/.test(e.message) ? 'Conexão recusada: porta fechada ou servidor incorreto.' : 'Não foi possível conectar ao servidor SMTP (rede ou porta bloqueada).'
    case 'ETLS': return 'Falha ao negociar TLS/STARTTLS.';  case 'EENVELOPE': return 'Remetente ou destinatário recusado pelo servidor.'
    default: return `Erro ao enviar e-mail: ${e.message}`
  }
}
// "Testar": const t = transport(acc, pass); try { await t.verify(); …ok } catch (e) { …smtpErrorPtBR(e) } finally { t.close() }
```
**E-mail HTML:** tabela com estilos *inline* (Outlook e Gmail ignoram `<style>`), todo texto do usuário escapado (`&<>"'`) e versão `text` junto. Assunto `[BC Backup] ✔ Sucesso: Financeiro diário (PC-RECEPCAO)`; corpo com status colorido, resumo por destino (arquivos, bytes, espaço livre, cópias excluídas) e os 20 primeiros arquivos pulados; log anexado conforme `attachLog`.

**Provedores:**
- **Gmail:** só com [senha de app](https://support.google.com/accounts/answer/185833), que exige verificação em duas etapas. **Outlook.com pessoal:** não aceita senha desde 16/09/2024 (doc 01).
- **Microsoft 365:** o SMTP AUTH básico passa a vir **desativado por padrão no fim de 12/2026**; o administrador pode reativar, e a remoção definitiva será anunciada em 2027 ([MC786329](https://www.itelio.com/en/microsoft-message-center/MC786329)). A recusa chega como `550 5.7.30`, que o código acima já traduz.

## 11. Empacotamento (electron-builder 26) e CI
```yaml
# electron-builder.yml  (validated: linux dir build + packaged E2E)
appId: com.bcbackup.app
productName: BC Backup
directories: { buildResources: build, output: dist }
files: [out/**, resources/**, package.json]
asarUnpack: [resources/**]
npmRebuild: false                      # no native modules
publish: null
# Fuses (@electron/fuses at pack time). enableNodeCliInspectArguments stays true: Playwright needs it.
# grantFileProtocolExtraPrivileges: leave default (true); false breaks the file:// ES-module renderer (tested)
electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableCookieEncryption: true,
  enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true, enableNodeCliInspectArguments: true }
win: { target: [{ target: nsis, arch: [x64] }], executableName: BCBackup }
nsis:                                  # createStartMenuShortcut is required for toasts (AUMID)
  { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true,
    createStartMenuShortcut: true, shortcutName: BC Backup, runAfterFinish: true, deleteAppDataOnUninstall: false,
    artifactName: 'BC-Backup-Setup-${version}-${arch}.${ext}', include: build/installer.nsh }
mac: { target: [{ target: dmg, arch: [universal] }], category: public.app-category.utilities }
linux: { target: [AppImage, deb], category: Utility, executableName: bc-backup, artifactName: 'BC-Backup-${version}-${arch}.${ext}' }
```
```nsis
; build/installer.nsh: remove the login item on real uninstall (not on update)
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.bcbackup.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.bcbackup.app"
  ${endIf}
!macroend
```
**Ícones:** um único `build/icon.svg`. O electron-builder 26 rasteriza em 1024 px e gera `.ico`/`.icns`, e no Linux usa o SVG direto ([docs](https://www.electron.build/docs/features/icons-and-images)). Com PNG, o mínimo é 256 px (Windows) e 512 px (macOS), senão `ERR_ICON_TOO_SMALL`. Os ícones de bandeja (`resources/tray.ico` 16/20/24/32 px, `trayTemplate.png` + `@2x`) **são feitos à parte**, porque o `nativeImage` não lê SVG: gere uma vez e versione.

**Assinatura:** sem certificado o SmartScreen avisa; com orçamento, `win.azureSignOptions` (Trusted Signing). No Ubuntu 24.04 o AppArmor bloqueia o sandbox de AppImages Electron ([discussão](https://discourse.ubuntu.com/t/problem-runing-appimage-files-without-no-sandbox/78361)), por isso também há `deb`.
```yaml
# .github/workflows/build.yml
name: build
on: { push: { tags: ['v*'] }, pull_request: {}, workflow_dispatch: {} }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - { uses: actions/setup-node@v7, with: { node-version: 24, cache: npm } }
      - run: npm ci                          # postinstall downloads Electron (cached in ~/.cache/electron)
      - run: npm run typecheck && npm test
      - run: npx playwright install-deps chromium   # Electron's system libs (nss, gbm, asound…)
      - run: npm run build && xvfb-run -a npx playwright test
  windows:
    needs: test
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7
      - { uses: actions/setup-node@v7, with: { node-version: 24, cache: npm } }
      - uses: actions/cache@v6               # Electron zip + electron-builder toolsets (NSIS, icons)
        with:
          path: |
            ~\AppData\Local\electron\Cache
            ~\AppData\Local\electron-builder\Cache
          key: eb-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npm ci
      - { run: npm run dist:win, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }   # unsigned for now
      - { uses: actions/upload-artifact@v7, with: { name: BC-Backup-Setup, path: dist/*.exe, if-no-files-found: error } }
```
Versões das actions conferidas com `git ls-remote` em 04/10/2026: checkout v7, setup-node v7, cache v6, upload-artifact v7. A partir do v6, o setup-node faz cache automático só para npm e o runner precisa ser ≥ 2.327.1. **Gerar o NSIS no Linux exige wine** (testado: `spawn wine ENOENT` mesmo com `signAndEditExecutable: false`), por isso o instalador sai do `windows-latest`. Se o `package-lock.json` gerado em Linux fizer o `npm ci` no Windows reclamar de binários opcionais (`@rollup/rollup-win32-x64-msvc`, `@tailwindcss/oxide-win32-x64-msvc`), regere o lock com `npm install`. Não use `--omit=optional`.

## 12. Testes
```ts
// vitest.config.ts: engine only (Node). Run once with TZ=America/New_York in CI to catch DST bugs.
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 20_000 } })
```
Testes já escritos no protótipo (`test/`): **schedule** (vários horários, dias, janela, catch-up que junta horários perdidos) · **scheduler** (`vi.useFakeTimers()`: 3 dias desligado → 1 catch-up após o atraso → próximo horário no tempo certo; nada se sobrepõe) · **retention** (corte por dia, `minKeep`, incompleta não conta, `keepDays 0`) · **copy** (filtros e poda, mtime, manifesto, cancelar deixa `.incomplete`) · **zip/verify** (arquivo sumido é pulado, CRC pega corrupção) · **job** (2 destinos, pasta e ZIP, retenção) · **store** (50 gravações concorrentes, JSON corrompido preservado). O teste de ZIP64 com 4,6 GB (`truncate -s 4400M` + `unzip -t`, 45 s) fica fora do CI.
```ts
// playwright.config.ts: export default defineConfig({ testDir: 'e2e', timeout: 30_000, retries: process.env.CI ? 1 : 0 })
// e2e/fixtures.ts: Playwright _electron (experimental)
export const launch = (extra: string[] = []) => electron.launch({
  args: ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), ...extra],   // Chromium refuses to run as root otherwise
  env: { ...process.env, BC_USER_DATA: mkdtempSync(join(tmpdir(), 'bcb-e2e-')) } }) // single-instance lock is per userData
// usage: const app = await launch(['--hidden']); app.evaluate(({ BrowserWindow }) => …); (await app.firstWindow()).screenshot(…)
```
Comportamento no container Linux (verificado):
- **O Electron precisa de display**: sem `DISPLAY` aborta com `Missing X server`, e `--ozone-platform=headless` também falhou. Use **`xvfb-run -a`**. Como root, passe `--no-sandbox`. Mensagens de `dbus`/`libnotify` no log são inofensivas.
- **Sem `BC_USER_DATA` isolado, testes em paralelo brigam pelo lock de instância única**: um fecha e o outro recebe `second-instance`.
- O Chromium de `/opt/pw-browsers` não é usado: o Playwright roda `node_modules/electron`, que o `postinstall` baixa via `@electron/get` (funcionou atrás do proxy do sandbox; cache em `~/.cache/electron` ou `electron_config_cache`). Com mirror: `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`; com proxy: `ELECTRON_GET_USE_PROXY=1` + `GLOBAL_AGENT_HTTPS_PROXY`.
- O fuse `EnableNodeCliInspectArguments=false` impede o Playwright de controlar o app ([docs](https://playwright.dev/docs/api/class-electron)). Rode o E2E sem fuses (`electron .`) ou num empacotado com esse fuse ligado.

## 13. O que foi verificado (protótipo em `/tmp`, 04/10/2026)
1. **`npm view`:** electron-vite@5.0.0 tem a peer `vite ^5||^6||^7` (o 6.0.0-beta.5 aceita `^8`); plugin-react@6.1.1 exige `vite ^8` e o 5.2.0 aceita até o 8; typescript-eslint@8.71.0 exige `typescript <6.1.0`; electron@42+ não tem `postinstall`. E `npm i electron-vite@5.0.0 vite@8.3.2` → **ERESOLVE**.
2. **Build** com electron-vite 5 + Vite 7.3.6 + React 19.3 + Tailwind 4.3.3: main e preload em CJS, preload em sandbox funcionando, `dark:` via `data-theme` (screenshot), CSP ok em `dev`.
3. **Typecheck** passou com TS 6.0.3 e com `tsc` 7.0.2. No 7.0.2, `require('typescript')` devolve só `{ version, versionMajorMinor }`.
4. **17 testes vitest** passaram em UTC, São Paulo, New York e Berlim. ZIP64 de 4,6 GB ok no `unzip -t` e no `zipinfo` (4.613.734.400 bytes descompactados).
5. **E2E com Playwright + `xvfb-run`:** boot e IPC; início com `--hidden` sem janela, janela sob demanda, fechar-para-bandeja; `utilityProcess` + `?modulePath` com o job completo (ZIP, 2 destinos); no build empacotado, boot e bandeja escondida com os fuses do §11. Testado isoladamente, `grantFileProtocolExtraPrivileges:false` quebra o renderer.
6. **nodemailer 10.0.14:** códigos de erro medidos (§10). **electron-builder `--linux dir`:** o `app.asar` levou só as dependências de runtime.

## Fontes
- Registro npm (`npm view`, 04/10/2026): electron, electron-vite, vite, @vitejs/plugin-react, typescript, @typescript/typescript6, typescript-eslint, nodemailer, archiver, yazl, yauzl, fflate, electron-store, vitest, @playwright/test.
- electron-vite: [CHANGELOG](https://github.com/alex8088/electron-vite/blob/master/CHANGELOG.md), [guia de dev](https://electron-vite.org/guide/dev), issues [#894](https://github.com/alex8088/electron-vite/issues/894), [#906](https://github.com/alex8088/electron-vite/issues/906), [#917](https://github.com/alex8088/electron-vite/issues/917), [#925](https://github.com/alex8088/electron-vite/issues/925).
- Vite 8: [anúncio](https://vite.dev/blog/announcing-vite8). TypeScript 7: [anúncio](https://devblogs.microsoft.com/typescript/?p=5246). Tailwind: [dark mode](https://tailwindcss.com/docs/dark-mode).
- Electron: [segurança](https://www.electronjs.org/docs/latest/tutorial/security), [isolamento de contexto](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [app](https://www.electronjs.org/docs/latest/api/app), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [tray](https://www.electronjs.org/docs/latest/api/tray), [notificações](https://www.electronjs.org/docs/latest/tutorial/notifications), [powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor), [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [instalação e mirrors](https://www.electronjs.org/docs/latest/tutorial/installation), [fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [releases](https://releases.electronjs.org), [PR #51982](https://releases.electronjs.org/pr/51982).
- Node: [fs ToNamespacedPath em C++ (#52135)](https://github.com/nodejs/node/pull/52135). ZIP: [yazl](https://github.com/thejoshwolfe/yazl), [yauzl, "No CRC-32 Checking"](https://github.com/thejoshwolfe/yauzl), [fflate](https://github.com/101arrowz/fflate), [archiver](https://github.com/archiverjs/node-archiver).
- Windows: [remoção do WMIC (KB5067470)](https://support.microsoft.com/help/5067470). Linux: [autostart freedesktop](https://specifications.freedesktop.org/autostart-spec/latest/), [AppImage e AppArmor no Ubuntu 24.04](https://discourse.ubuntu.com/t/problem-runing-appimage-files-without-no-sandbox/78361).
- E-mail: [CHANGELOG do nodemailer](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md), [SMTP do nodemailer](https://nodemailer.com/smtp/), [senhas de app do Google](https://support.google.com/accounts/answer/185833), [Exchange Online SMTP AUTH (MC786329)](https://www.itelio.com/en/microsoft-message-center/MC786329).
- Empacotamento e CI: [ícones no electron-builder](https://www.electron.build/docs/features/icons-and-images), [NSIS no electron-builder](https://www.electron.build/nsis) (opções conferidas no `app-builder-lib/scheme.json` 26.15.3), [releases do setup-node](https://github.com/actions/setup-node/releases), [releases do upload-artifact](https://github.com/actions/upload-artifact/releases), [Playwright Electron](https://playwright.dev/docs/api/class-electron).
