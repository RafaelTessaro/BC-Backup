# BC Backup — Painel da bandeja (flyout "está tudo certo?")

> Spec pronta para implementação · 04/10/2026 · Electron 44.5.1 · complementa [02-design-system.md](02-design-system.md) §7(i) (substitui o menu nativo no Windows/macOS) e [03-arquitetura-tecnica.md](03-arquitetura-tecnica.md).
> Pedido do dono: clicar (inclusive com o botão direito) no ícone da bandeja abre, ali no canto inferior direito, um painel pequeno com o resumo — sem abrir o app inteiro.

## 0. Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Gatilho (Windows/macOS) | **Clique esquerdo e clique direito** abrem/fecham o painel. Duplo clique abre o app. **Shift + clique direito** abre o menu nativo antigo (saída de emergência) | Pedido do dono. OneDrive, Dropbox e Google Drive concentram tudo no painel. A diretriz Win32 diz "direito = menu de atalho", então o menu nativo continua existindo, mas atrás do Shift |
| Linux | Mantém o **menu nativo** (`setContextMenu`) e não usa o painel | AppIndicator não tem `getBounds()` e o `click` não é confiável |
| Menu nativo | É montado sempre (`updateTray`), mas `setContextMenu` só roda no Linux | Com um menu definido, o Electron mostra o menu e **não emite `right-click`** (`notify_icon.cc`) |
| Tamanho | **360 × 480 DIP fixo** | 360 é a largura dos toasts (§7h) e dos flyouts do Windows 11. Cabe em 1280×720 a 125 % (workArea ≈ 528 DIP) |
| Posição | Ancorado ao ícone, **12 px** da barra e da borda, limitado ao `workArea`. Cobre barra embaixo, em cima, à esquerda e à direita, ocultação automática e ícone escondido no "^" | Flyouts do Windows 11 flutuam com margem; `trayBottomRight` do `menubar`/`electron-positioner` |
| Superfície | **Janela opaca** em `surface-raised`, sem `transparent` e **sem acrylic na v1** | O DWM do Windows 11 já dá cantos de 8 px, sombra e borda. O contraste medido no §3 se mantém. No Windows 10 o painel fica quadrado, como os flyouts dele |
| Ciclo de vida | **Pré-criado oculto** 1,5 s após o boot e reutilizado (fechar = `hide`) | Abre instantaneamente, sem tela branca. Custa ~40–60 MB de RAM de um renderer |
| Fechamento | Perder o foco (blur), Esc, novo clique no ícone, uma ação que abre o app, troca de monitor/DPI, bloqueio ou suspensão | É o *light-dismiss* do Fluent ("acrylic/flyouts = superfícies transitórias") |
| Tema | Segue o app: o main define `nativeTheme.themeSource` e o `prefers-color-scheme` do painel acompanha | Não precisa de IPC de tema |
| Dados | Reaproveita `system.stats`, `runs.list`, `runs.active`, `routines.list`/`runNow` e `on.*`. **Novos:** `tray.openMain/hide/setAllPaused/quit` + evento `on.trayShown` | — |

## 1. Referências

| Produto | O que mostra | Forma | Interação | Ações rápidas |
|---|---|---|---|---|
| OneDrive (Win 11) | Frase de status de sync no topo, atividade recente e armazenamento | ≈360 px, raio 8, ancorado ao ícone | O clique abre. Nas versões recentes o direito também abre o painel. Blur fecha | No cabeçalho: pasta, web e ⚙ "Ajuda e configurações" (Pausar 2/8/24 h, Configurações, Sair) |
| Dropbox | Busca, atividade, notificações, sync e uso | Painel ≈380 px | O clique abre o painel | Avatar → Preferências, Pausar, Sair. **Crítica:** usuários reclamaram que "Pausar" e "Sair" ficaram escondidos num submenu |
| Google Drive desktop | Atividade de sync e notificações | Painel | O clique abre | ⚙ → Pausar sincronização, Preferências, Sair |
| Backblaze | Menu nativo com "Backup Now" e status | Menu | Clique | Backup Now e Pausar. O processo do menu é minúsculo (bzbmenu) |
| Time Machine (macOS) | "Último backup: hoje, 10:12" e o progresso em frase | NSMenu | Clique | "Fazer backup agora", "Abrir ajustes" |
| Tailscale, Docker, 1Password | Menu nativo com status no topo. O 1Password deixa escolher "Clique no ícone para: abrir o app / Quick Access" | Menu | Direito = menu | — |
| Win 11 Quick Settings / Central | Flyouts de ≈360 px que flutuam ≈12 px acima da barra, raio 8, acrylic e entrada deslizando | — | Esc ou blur fecham | — |

**Lições:** (1) uma frase de status no topo; (2) uma lista curta de atividade; (3) o painel **nunca** abre o app sozinho; (4) ações raras (Configurações, Sair) ficam num menu `⋯`, mas a ação frequente (**Pausar**) fica visível, para evitar a crítica que o Dropbox recebeu; (5) blur e Esc fecham.

## 2. Interação

- **Clique (esq./dir.)** com o painel fechado: posiciona e mostra o painel, que recebe o foco. Com o painel aberto: fecha. No Windows o Electron emite `click`/`right-click` no **mouse-down** (`WM_LBUTTONDOWN`/`WM_RBUTTONDOWN`). O blur do painel chega junto, então use a guarda `REOPEN_GUARD_MS` (§7).
- **Duplo clique:** esconde o painel e abre a janela principal (atalho de quem já conhece o app). No macOS, `tray.setIgnoreDoubleClickEvents(true)` deixa cada clique alternar o painel na hora.
- **Teclado:** `Win+B` → setas → `Enter` abre o painel com o foco em "Abrir o BC Backup". `Tab` percorre as linhas e os botões. `Esc` fecha **e chama `tray.focus()`**, devolvendo o teclado à área de notificação (diretriz da Microsoft). Se houver um menu Radix aberto, o Esc fecha só o menu.
- **Ações:** "Executar ▸ rotina" mantém o painel aberto, e o hero vira "Backup em andamento" na hora. Pausar/Retomar também mantém aberto. Abrir o app, linha da lista, "Ver histórico", "Ver detalhes", Configurações e Sair primeiro chamam `tray.hide()` e depois a janela principal ou o diálogo.

## 3. Layout (360 × 480, tudo em tokens do design system)

```
←───────────────────── 360 ──────────────────────→
┌────────────────────────────────────────────────┐ ┐
│  [■] BC Backup            (● Agendador ativo)  │ 48  cabeçalho (px-4)
│                                                │ ┤
│  (✓)  Tudo protegido                           │
│       Último backup há 2 h · 2,1 GB            │ 104 hero (px-4, borda inferior)
│       [Ver detalhes]  ← só em falha/aviso      │
├────────────────────────────────────────────────┤ ┤
│  ÚLTIMOS BACKUPS                 Ver histórico │ 32
│  ✓  Clientes NF-e        há 2 h       2,1 GB   │
│  ⚠  Fotos escritório     hoje 09:00   3 avisos │
│  ✕  Banco SQL            ontem 23:30  Falhou   │ 200 (5 × 40)
│  ✓  Contábil             ontem 22:00  812 MB   │
│  ✓  Clientes NF-e        ontem 12:00  2,0 GB   │ ┤
├────────────────────────────────────────────────┤
│  ◷  Próximo: hoje às 22:00 · Clientes NF-e     │ 40
├────────────────────────────────────────────────┤ ┤
│  [   Abrir o BC Backup   ]  [▶ ▾]  [⏸]  [⋯]    │ 56  rodapé (fundo bg)
└────────────────────────────────────────────────┘ ┘ 48+104+32+200+40+56 = 480

Hero "em andamento" (mesma altura de 104):
│  (⟳)  Backup em andamento                      │
│       Clientes NF-e · 1.240 de 2.950 arquivos  │
│       ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░   42 % · ~5 min   │
```

- **Janela:** `surface-raised` (#FFFFFF / #18191D), que também é o `backgroundColor` da BrowserWindow (sem flash). No Windows 11 o raio de 8 px, a sombra e a borda de 1 px vêm do DWM. No Windows 10 e no macOS, desenhe `box-shadow: inset 0 0 0 1px var(--border)` (`data-os="win10"|"mac"`). Divisórias: 1 px `border`. Rodapé: fundo `bg` + borda superior.
- **Cabeçalho:** `Wordmark size={15}` à esquerda. À direita, um StatusPill com o **estado do agendador** (não repete o hero): `● Agendador ativo` (success, dot 6 px) · `Pausado` (neutral, `Pause`) · `Sem rotinas` (muted). Mesma linguagem do rodapé da sidebar (§6).
- **Hero:** círculo de 40 px `*-soft` com ícone de 20 px (stroke 1.75) + título `title` 22/28 600 + linha `small` `text-fg-muted` (2 linhas no máximo, a 2ª pode ser um link/ação `Button sm`). Em andamento: `ProgressBar` 6 px + `small` `tnum` "42 % · ~5 min" (+ "· 1 na fila", `caption`). O hero inteiro é `aria-live="polite"`. Um clique na barra de progresso abre o app no Painel.
- **Lista:** cabeçalho com `overline` `text-fg-subtle` e "Ver histórico" (`Button link`, `caption`). Cada linha é um `<button>` de 40 px, `mx-2 px-2`, `radius-sm`, hover `surface-hover`. Ícone de status 16 px (`RUN_STATUS`). Nome em `small` 500, truncado. Hora em `caption` `text-fg-subtle` `tnum` (`formatAgo` para hoje, "ontem 23:30" e assim por diante). Na coluna da direita (72 px, à direita, `caption`), o **texto acompanha a cor** (regra 1 do §3): sucesso = tamanho (`formatSize(bytesCopied)`), aviso = "3 avisos" `warning`, falha = "Falhou" `danger` (Tooltip com `errorMessage`), cancelado = "Cancelado" `text-fg-subtle`. Um clique abre `ROUTES.run(id)` no app.
- **Próximo:** `CalendarClock` 14 px + `small` `text-fg-muted`, nome truncado.
- **Rodapé:** `Button primary md` "Abrir o BC Backup" (`flex-1`) · `secondary` 44×32 `Play`+`ChevronDown` (Tooltip "Executar agora", `MenuContent side="top"`, uma rotina por item, rotina em execução fica desativada com "Em execução", `max-h` com rolagem) · `secondary` 32×32 `Pause`/`Play` (Tooltip "Pausar todas as rotinas" / "Retomar rotinas") · `ghost` 32×32 `Ellipsis` → `Settings` Configurações · `History` Histórico · — · `Power` Sair do BC Backup.
- **Movimento:** no `trayShown`, o conteúdo faz opacidade 0→1 + `translateY(4px)`→0 em `--duration-base` com `--ease-out` (lembra a entrada dos flyouts do Win 11). Nada com `prefers-reduced-motion`. A janela em si não é animada (o `animate` de `setBounds` só funciona no macOS).

## 4. Estados e microcopy (prioridade de cima para baixo, igual ao hero do Painel e ao ícone da bandeja)

| Estado | Ícone / tom | Título | Linha / ação |
|---|---|---|---|
| Executando | `LoaderCircle` girando / accent | Backup em andamento | "Clientes NF-e · copiando 1.240 de 2.950 arquivos" / "Preparando…" + barra "42 % · ~5 min" |
| Só na fila | `Clock` / accent | Backup na fila | "Clientes NF-e · aguardando outra execução terminar" |
| Falha | `ShieldAlert` / danger | O último backup falhou · "2 backups falharam" | "Banco SQL · ontem às 23:30 — Destino indisponível" + [Ver detalhes] |
| Avisos | `TriangleAlert` / warning | Atenção necessária | "1 rotina terminou com avisos (Fotos escritório)" + [Ver detalhes] |
| Sem rotinas | `FolderPlus` / neutral | Nenhuma rotina ainda | "Crie sua primeira rotina: leva menos de um minuto." + [Criar primeira rotina] → `ROUTES.newRoutine`. A lista vira o texto "Os backups aparecem aqui assim que uma rotina rodar." e o rodapé desativa ▶ e ⏸ |
| Tudo pausado | `Pause` / neutral | Rotinas pausadas | "Os backups agendados não vão rodar até você retomar." + [Retomar rotinas] |
| OK | `ShieldCheck` / success | Tudo protegido | "Último backup há 2 h · 2,1 GB" ou "Nenhum backup concluído ainda" |

Linha "Próximo": "Próximo: hoje às 22:00 · Clientes NF-e" · "Nenhum backup agendado" · com tudo pausado, "Agendamentos pausados". Lista vazia (há rotinas, nenhuma execução): "Nenhum backup ainda." + `Button link` "Executar agora". Título da janela, lido pelo Narrador: **"BC Backup — resumo"**.

**Recomendado:** extrair a regra de "saúde" para `src/shared/health.ts`, uma função pura `summarizeHealth(routines, progress)` → `{ kind, routine?, count }`, e usá-la em `context.ts` (ícone/tooltip da bandeja), no `StatusHero` do Painel e no painel. Assim os três nunca discordam.

## 5. Dados e IPC

**Reaproveitado (nada muda):** `system.stats()` (próxima execução, totais) · `runs.list({ limit: 8 })` (vem do mais novo para o mais antigo; filtre os finais e fique com 5, porque `running` pode estar no topo) · `runs.active()` · `routines.list()` (`enabled`, `lastRun` → falha/aviso/pausado, itens do "Executar") · `routines.runNow(id)` · `on.progress` (limitado a 250 ms, como em `lib/store.ts`) · `on.runFinished`/`on.routinesChanged` → recarregar · `on.settingsChanged`.

**Novo em `src/shared/api.ts`:**

```ts
export interface BcApi {
  // …
  tray: {
    /** Esconde o painel e mostra a janela principal; `route` = uma das ROUTES (ex.: ROUTES.run(id)). */
    openMain(route?: string): Promise<void>
    /** Esconde o painel. `restoreFocus` devolve o teclado à área de notificação (Esc, Windows). */
    hide(opts?: { restoreFocus?: boolean }): Promise<void>
    /** true = pausa as rotinas ativas (lembra quais em `pausedByTray`); false = retoma. */
    setAllPaused(paused: boolean): Promise<void>
    /** Pede confirmação (diálogo nativo, avisa se há backup rodando) e encerra o app. */
    quit(): Promise<void>
  }
  on: {
    // …
    /** O painel da bandeja acabou de aparecer: atualizar o relógio e consultar de novo. */
    trayShown(cb: () => void): () => void
  }
}
// IPC_CHANNELS
trayOpenMain: 'tray:open-main', trayHide: 'tray:hide', traySetAllPaused: 'tray:set-all-paused', trayQuit: 'tray:quit',
// IPC_EVENTS
trayShown: 'evt:tray-shown',
```

**No main:** (1) mover `setAllEnabled` e `confirmQuit` de `index.ts` para `src/main/app-actions.ts`, que passa a ser usado pelos handlers e pelo menu nativo. (2) Em `ipc.ts`, adicionar 4 entradas no `HandlerMap` (o tipo `Missing` já obriga isso). `openMain` valida a rota (string de até 200 caracteres, começando com `/`; `parseRoute` cai no Painel). `setAllPaused` usa `asBool`. (3) Preload: `tray.*` com `invoke` e `on.trayShown` com `subscribe`. (4) `mock-api.ts`: stubs de `tray` e `trayShown`, para que `npm run dev:web` sirva `http://localhost:5199/tray.html` (dá para tirar screenshot nos dois temas num viewport de 360×480). (5) **`sendToRenderer` hoje só fala com a janela principal.** Crie `broadcast()` em `src/main/broadcast.ts`, que envia `progress`/`runFinished`/`routinesChanged`/`settingsChanged` também para o painel (o `progress` só quando ele está visível, porque o `trayShown` ressincroniza), e troque as chamadas em `context.ts`/`ipc.ts`. O `navigate` continua indo só para a janela principal.

## 6. Renderer: segunda entrada `tray.html`

```ts
// electron.vite.config.ts → renderer
build: { rollupOptions: { input: {
  index: resolve('src/renderer/index.html'),
  tray: resolve('src/renderer/tray.html')
} } }
```

```
src/renderer/tray.html               mesma CSP e favicon do index.html; <body data-surface="tray">; script /src/tray/main.tsx
src/renderer/src/tray/main.tsx       import '../app.css'; mock se não houver window.bc; applyInitialTheme(); trackInputModality(); render <TrayPanel/>
src/renderer/src/tray/TrayPanel.tsx  cabeçalho, hero, lista, próximo, rodapé (componentes de components/ui)
src/renderer/src/tray/TrayHero.tsx   estados do §4 (summarizeHealth)
src/renderer/src/tray/useTray.ts     zustand enxuto: { ready, stats, runs, routines, progress }; load() + assinaturas on.*
```

- Compartilha `components/ui` (Button, StatusPill, ProgressBar, Menu, Tooltip, Logo/Wordmark, RelativeTime), `lib/status`, `lib/format`, `lib/progress`, `lib/clock` e `app.css` (os tokens). O Rollup separa React/Radix/lucide num chunk comum.
- **Não importe `lib/store.ts`:** o `loadAll()` busca 2000 execuções e as unidades de disco (PowerShell no Windows), pesado demais para o painel.
- **Tema:** `applyInitialTheme()` + `matchMedia('(prefers-color-scheme: dark)')` → `data-theme`. O `nativeTheme.themeSource` definido pelo main já reflete Claro/Escuro/Sistema em todos os renderers. **Não** chame `bc.app.setResolvedTheme`, que mexe na titlebar da janela principal.
- `tray.html`: `html, body { background: var(--surface-raised); overflow: hidden; height: 100% }`. Esc no `document` → `bc.tray.hide({ restoreFocus: true })`, exceto se existir `[role="menu"]` aberto.
- `on.trayShown` → `useClock.setState({ now: Date.now() })` + `load()` + animação de entrada + foco no botão primário. Janelas ocultas têm timers e rAF estrangulados, então o "há 2 min" estaria velho.

## 7. Main: janela, posição e alternância

**`src/main/tray-position.ts`** é puro (sem electron) e tem teste em `test/tray-position.test.ts`:

```ts
export interface Rect { x: number; y: number; width: number; height: number }
type Edge = 'top' | 'bottom' | 'left' | 'right'
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Borda da barra de tarefas: pela diferença bounds × workArea; com ocultação automática, a borda mais próxima do ícone. */
export function taskbarEdge(bounds: Rect, wa: Rect, anchor: Rect): Edge {
  if (wa.y > bounds.y) return 'top'
  if (wa.x > bounds.x) return 'left'
  if (wa.width < bounds.width) return 'right'
  if (wa.height < bounds.height) return 'bottom'
  const cx = anchor.x + anchor.width / 2, cy = anchor.y + anchor.height / 2
  const d: Record<Edge, number> = { top: cy - bounds.y, bottom: bounds.y + bounds.height - cy,
    left: cx - bounds.x, right: bounds.x + bounds.width - cx }
  return (Object.keys(d) as Edge[]).reduce((a, b) => (d[a] <= d[b] ? a : b))
}

export function panelBounds(o: { anchor: Rect; display: { bounds: Rect; workArea: Rect };
  size: { width: number; height: number }; platform: NodeJS.Platform }): Rect {
  const { anchor: a, display: { bounds, workArea: wa } } = o
  const m = o.platform === 'darwin' ? 6 : 12
  const width = Math.min(o.size.width, wa.width - 2 * m), height = Math.min(o.size.height, wa.height - 2 * m)
  const minX = wa.x + m, maxX = wa.x + wa.width - width - m
  const minY = wa.y + m, maxY = wa.y + wa.height - height - m
  const edge: Edge = o.platform === 'darwin' ? 'top' : taskbarEdge(bounds, wa, a)
  const centerX = clamp(a.x + a.width / 2 - width / 2, minX, maxX)
  const nearIconY = clamp(a.y + a.height - height, minY, maxY) // barra vertical: alinha a base ao ícone
  // Math.min/max com o ícone: com ocultação automática o painel fica acima ou ao lado da barra, nunca embaixo dela.
  const pos = {
    bottom: { x: centerX, y: clamp(Math.min(maxY, a.y - height - m), minY, maxY) },
    top: { x: centerX, y: clamp(Math.max(minY, a.y + a.height + m), minY, maxY) },
    left: { x: clamp(Math.max(minX, a.x + a.width + m), minX, maxX), y: nearIconY },
    right: { x: clamp(Math.min(maxX, a.x - width - m), minX, maxX), y: nearIconY }
  }[edge]
  return { x: Math.round(pos.x), y: Math.round(pos.y), width: Math.round(width), height: Math.round(height) }
}
```

**`src/main/tray-panel.ts`:**

```ts
export const PANEL_SIZE = { width: 360, height: 480 }
const PANEL_BG = { light: '#FFFFFF', dark: '#18191D' } // surface-raised
const REOPEN_GUARD_MS = 300 // o clique no ícone que acabou de causar o blur não reabre o painel
const BLUR_GRACE_MS = 150 // blur logo após o show, com o Explorer ainda processando o clique: refocar
let panel: BrowserWindow | null = null, shownAt = 0, hiddenAt = 0

export function createTrayPanel(): BrowserWindow {
  if (panel && !panel.isDestroyed()) return panel
  const w = new BrowserWindow({ ...PANEL_SIZE, show: false, frame: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    hiddenInMissionControl: true, roundedCorners: true, /* thickFrame: padrão true = sombra do DWM */
    title: 'BC Backup — resumo', backgroundColor: PANEL_BG[currentResolvedTheme()],
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: true, nodeIntegration: false,
      spellcheck: false, navigateOnDragDrop: false, devTools: !app.isPackaged } })
  w.setAlwaysOnTop(true, 'pop-up-menu')
  if (process.platform === 'darwin')
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.on('blur', () => {
    if (Date.now() - shownAt < BLUR_GRACE_MS) return void setTimeout(() => w.isVisible() && w.focus(), 0)
    hideTrayPanel()
  })
  w.on('close', (e) => { if (!isQuitting()) { e.preventDefault(); hideTrayPanel() } }) // Alt+F4
  w.on('closed', () => { if (panel === w) panel = null })
  const wc = w.webContents
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e, url) => { if (!isAppUrl(url)) e.preventDefault() })
  wc.on('render-process-gone', (_e, d) => { log.error('Painel da bandeja caiu', d.reason); w.destroy() })
  const dev = devRendererUrl()
  void (dev ? w.loadURL(`${dev}/tray.html`) : w.loadFile(rendererTrayPath()))
  return (panel = w)
}

export function toggleTrayPanel(trayBounds?: Rectangle): void {
  const w = createTrayPanel()
  if (w.isVisible()) return hideTrayPanel()
  if (Date.now() - hiddenAt < REOPEN_GUARD_MS) return // este clique foi o que fechou (blur)
  const cursor = screen.getCursorScreenPoint()
  const onScreen = (r?: Rectangle) => !!r && r.width > 0 && screen.getAllDisplays().some(({ bounds: b }) =>
    r.x + r.width / 2 >= b.x && r.x + r.width / 2 < b.x + b.width && r.y + r.height / 2 >= b.y && r.y + r.height / 2 < b.y + b.height)
  const anchor = onScreen(trayBounds) ? trayBounds! : { ...cursor, width: 1, height: 1 } // ícone no "^": bounds 0/fora da tela
  const display = screen.getDisplayNearestPoint({ x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 })
  const b = panelBounds({ anchor, display, size: PANEL_SIZE, platform: process.platform })
  const show = () => {
    w.setBounds(b) // setBounds com tamanho (não setPosition): inteiros e sem reescala ao trocar de monitor
    w.show(); w.focus()
    const now = w.getBounds(); if (now.width !== b.width || now.height !== b.height) w.setBounds(b) // DPI misto
    shownAt = Date.now()
    w.webContents.send(IPC_EVENTS.trayShown)
  }
  if (w.webContents.isLoading()) w.once('ready-to-show', show); else show()
}

export function hideTrayPanel(opts: { restoreFocus?: boolean } = {}): void {
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return
  panel.hide(); hiddenAt = Date.now()
  if (opts.restoreFocus) focusTrayIcon() // tray.ts: process.platform === 'win32' && tray.focus()
}
// + applyPanelTheme(t): panel?.setBackgroundColor(PANEL_BG[t]) (chamado no nativeTheme 'updated' e no settingsChanged)
// + trayPanelContents(): WebContents | null; isTrayPanelVisible()
```

**`tray.ts`:** `TrayActions` ganha `togglePanel(bounds?)` e `hidePanel()`.

```ts
const usePanel = process.platform === 'win32' || process.platform === 'darwin'
tray.on('click', (_e, bounds) => (usePanel ? a.togglePanel(bounds) : a.open()))
tray.on('right-click', (e, bounds) => (e.shiftKey ? tray?.popUpContextMenu(fallbackMenu) : a.togglePanel(bounds)))
tray.on('double-click', () => { a.hidePanel(); a.open() })
if (process.platform === 'darwin') tray.setIgnoreDoubleClickEvents(true)
// updateTray(): Linux → tray.setContextMenu(menu); win32/darwin → fallbackMenu = menu (NÃO setContextMenu)
// Fallback: se o painel caiu 2× (render-process-gone) ou falhou ao carregar, clique → popUpContextMenu(fallbackMenu)
```

**Outros pontos:** `paths.ts` ganha `rendererTrayPath()` = `join(__dirname, '../renderer/tray.html')`, e `isAppUrl` passa a aceitar o index **ou** o tray. Sem isso, todo IPC do painel cai em "Remetente não autorizado". **`index.ts`:** `setTimeout(createTrayPanel, 1500)` depois de `showWindow()`. Além disso: `screen.on('display-metrics-changed' | 'display-removed' | 'display-added', () => hideTrayPanel())` e `powerMonitor.on('lock-screen' | 'suspend', () => hideTrayPanel())`. O `openMain` chama `hideTrayPanel()` **antes** de `showWindow()`/`navigate()`.

## 8. Armadilhas do Electron 44 (Windows primeiro)

1. **`click`/`right-click` no mouse-down** (`notify_icon_host.cc`). Com o painel aberto, clicar no ícone gera blur (esconde) e logo depois click (reabriria). Por isso a guarda `hiddenAt` de 300 ms. A biblioteca `menubar` usa um blur atrasado em 100 ms pelo mesmo motivo.
2. **`setContextMenu` sequestra o direito** (Windows) e o esquerdo (macOS): com menu definido, `right-click` nunca é emitido. Use `popUpContextMenu(menu)` sob demanda.
3. **`tray.getBounds()` pode vir zerado ou fora da tela** com o ícone no excesso ("^") do Windows 11 (o Qt documentou isso). A âncora cai para `screen.getCursorScreenPoint()` e tudo é limitado ao `workArea`. As coordenadas já vêm em DIP (`ScreenToDIPRect`).
4. **`transparent: true` piora tudo no Windows:** perde a sombra e os cantos do DWM e, em algumas GPUs, o fundo fica preto ([electron#40515](https://github.com/electron/electron/issues/40515), aberto). Use a janela opaca e mantenha `thickFrame` no padrão (`false` remove a sombra e as animações).
5. **Acrylic (`backgroundMaterial: 'acrylic'`)** só existe no Windows 11 22H2 ou mais novo. Em janelas sem moldura só funciona a partir do Electron 27 (#39708). Bugs de fundo preto e de troca dinâmica foram corrigidos no #47814. Ele vira cor sólida com "Efeitos de transparência" desligado, com a economia de bateria ligada e com a janela inativa. Exige `backgroundColor: '#00000000'` e `html, body` transparentes, e quebra o contraste medido (o `text-tertiary` sobre papel de parede claro). **v1: sólido.** Fica como opção futura atrás de uma flag, depois de QA visual.
6. **Foco:** o `blur` só dispara se a janela recebeu foco. Chame `show()` + `focus()`. O clique no ícone dá ao processo o direito de ir para o primeiro plano (é o mesmo mecanismo que o `PopUpContextMenu` usa). `showInactive()` quebraria o light-dismiss.
7. **`alwaysOnTop` com o nível `'pop-up-menu'`:** fica acima de outras janelas topmost e da barra. No macOS, junto com `setVisibleOnAllWorkspaces(..., { skipTransformProcessType: true })`, aparece no Space e na tela cheia atuais sem mexer no Dock.
8. **Janela oculta = timers e rAF estrangulados.** Por isso o evento `trayShown` atualiza o relógio e consulta de novo. Não mande `progress` 4×/s para o painel oculto.
9. **Posições inteiras e `setBounds` com tamanho:** `setPosition` com fração lança erro (menubar#233). Entre monitores de DPI diferente, confira o tamanho depois do `show()` e reaplique.
10. **IPC:** `trustedSender` usa `isAppUrl`, que só conhece o `index.html`. Sem ajuste, o painel não consegue nem ler `stats()`.
11. **E2E:** `e2e/fixtures.ts` e `windows.spec.ts` usam `app.firstWindow()`. Com o painel pré-criado, isso pode devolver o `tray.html`. Escolha a janela pela URL (`app.windows().find(p => !p.url().endsWith('tray.html'))`) e crie o painel **depois** da janela principal.
12. **Diálogo de "Sair"** (`confirmQuit`): o painel perde o foco e se esconde antes do diálogo. Abra o diálogo sem pai quando a janela principal está oculta (o código atual já faz isso).
13. **Linux:** sem `getBounds`. O `click` do AppIndicator depende do ambiente e muitas vezes nem chega. Fica só com o menu nativo.
14. **DevTools do painel:** com F12 em dev, use `openDevTools({ mode: 'detach' })`, porque 360 px não comportam o painel acoplado.

## 9. Acessibilidade e QA

- Título da janela "BC Backup — resumo". O hero é `<h1>` dentro de `aria-live="polite"`. O `ProgressBar` já tem `label`/`valueText`. As linhas são `<button aria-label="Clientes NF-e, Concluído, há 2 horas, 2,1 GB. Abrir detalhes">`. Os botões só com ícone têm Tooltip e `aria-label`. O foco inicial vai no primário. O anel de foco segue o §3 (`ring` ≥ 3:1). Em `forced-colors: active` (Contraste do Windows), as bordas usam `CanvasText`.
- **Testes unitários** (`panelBounds`): barra embaixo, em cima, à esquerda e à direita; ocultação automática; âncora vinda do cursor; workArea menor que o painel; macOS.
- **QA manual:** Windows 11 a 100/125/150/175 %; dois monitores com DPI misto; ícone fixado e no "^"; Windows 10 com a barra à esquerda e em cima; claro/escuro/Sistema trocando com o painel aberto; teclado (`Win+B` → `Enter` → `Tab` → `Esc`); `prefers-reduced-motion`; backup rodando (hero e barra a 4×/s); Shift+clique direito mostrando o menu nativo.

## Referências

- Microsoft — [Notification area](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area) (clique esquerdo = popup perto do ícone; direito = menu de atalho) · [Geometry](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry) (flyouts com raio de 8 px) · [Materials](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials) (acrylic só em superfícies transitórias)
- Electron — [Tray](https://www.electronjs.org/docs/latest/api/tray) · [BaseWindowOptions](https://www.electronjs.org/docs/latest/api/structures/base-window-options) (`roundedCorners`, `thickFrame`, `backgroundMaterial`) · fontes da v44.5.1: `shell/browser/ui/win/notify_icon_host.cc` e `notify_icon.cc` (eventos no mouse-down; menu definido suprime `right-click`) · [#40515](https://github.com/electron/electron/issues/40515) (fundo preto em janela transparente) · [#39708](https://ayakael.net/mirrors/electron/commit/d1827941790f23b241ef3f234a9782750ac97e8d) e [#47814](https://ayakael.net/mirrors/electron/commit/b20e91d86f4ac454bbba162b079a5a1bb9cd5617) (acrylic/mica em janelas sem moldura)
- [menubar](https://github.com/max-mapper/menubar) (`src/Menubar.ts`: blur atrasado e alternância; `getWindowPosition.ts`: detecção da borda da barra) · [electron-positioner](https://npmjs.com/package/electron-positioner) (`trayBottomRight`)
- Produtos — [Dropbox: ícone da bandeja](https://help.dropbox.com/installs-integrations/desktop/system-tray-menu-bar) · [Dropbox 2.0: crítica a Pausar/Sair escondidos](https://techcrunch.com/?p=775953) · [OneDrive: pausar/sair pelo ícone](https://support.microsoft.com/en-au/onedrive/how-to-pause-and-resume-onedrive-sync) · [Google Drive: pausar pela bandeja](https://geekrewind.com/how-to-pause-syncing-google-drive-on-windows-11/) · [1Password: "Click the icon to…"](https://support.1password.com/quick-access/?windows) · [Backblaze bzbmenu](https://ski-epic.com/2020_backblaze_client_architecture/bzbui_and_bzbmenu.html) · Qt [qwindowssystemtrayicon.cpp](https://code.qt.io/cgit/qt/qtbase.git/log/src/plugins/platforms/windows/qwindowssystemtrayicon.cpp?showmsg=1) (ícone oculto no "^": no Win 11 a geometria cai fora da tela)
