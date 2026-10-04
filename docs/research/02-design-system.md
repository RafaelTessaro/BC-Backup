# BC Backup — Design System v1

> Pesquisa + especificação pronta para implementação · 2026-10-04 · Electron + React + Tailwind CSS v4 · Windows-first · UI em pt-BR.
> Tokens e código em inglês. Todas as razões de contraste foram calculadas (WCAG 2.x, luminância relativa sRGB).

## 1. Direção de design — "Utilitário silencioso"

O BC Backup deve parecer uma **ferramenta calma e precisa que some quando tudo está bem**: superfícies neutras levemente frias, um único azul-cobalto de marca, tipografia Geist e status escrito como frase ("Tudo protegido"), não como tabela. Herdamos do **Linear (refresh 2025–26)** a regra *"a estrutura deve ser sentida, não vista"* — sidebar mais apagada que o conteúdo, bordas suaves, poucos ícones; do **macOS Ajustes/Time Machine**, a leitura "Último backup / Próximo backup" em linguagem humana e listas agrupadas em cards; do **Windows 11 Fluent**, a geometria (cantos progressivos 4/8 px), a escala 12/14/20/28 px e o *sentence case*; do **Vercel Geist / shadcn**, a disciplina de tokens e escalas de cinza. Uma única ação primária por tela, densidade média (desktop, não mobile), movimento sutil.

**O que torna Duplicati / Cobian / Iperius datados — e a nossa resposta**

| Padrão datado | BC Backup faz |
|---|---|
| Barras de ferramentas com 15+ ícones 16 px coloridos, menus "Arquivo/Editar" | 1 CTA primário por tela; secundárias em menu `⋯`; ícones lucide monocromáticos, stroke 1.75 |
| ListView WinForms cinza `#F0F0F0`, bordas 3D, grades com linhas verticais | Cards com respiro, bordas 1 px de baixo contraste, tabelas só com divisórias horizontais |
| Formulários de 40 campos em abas (Iperius "Opções") | Editor em 6 etapas com padrões sensatos; avançado recolhido |
| Jargão no primeiro nível (VSS, diferencial, cron, retention policy) | Frases: "Todo dia às 22:00", "Apagar cópias com mais de 30 dias" |
| Status enterrado em log de texto | Hero de status + StatusPill + próxima execução sempre visível |
| Caminhos truncados sem tooltip (queixa recorrente no fórum do Duplicati) | PathChip com truncamento **no meio** + tooltip completo + copiar |
| Modais bloqueantes para tudo | Toasts não bloqueantes; modal só para ação destrutiva |

## 2. Marca

> **Atualizado (04/10/2026):** a identidade oficial passou a ser **preto · menta · branco** (ícone em `build/brand/icone-original.png`). As cores abaixo são históricas; valem as de [06-identidade-preto-verde.md](06-identidade-preto-verde.md).

**Cor primária: Azul Cobalto `#3254F0`** (dark: `#4566FA`). Azul comunica confiança/segurança — o território certo para um profissional de TI —, mas o cobalto puxado para o violeta se diferencia do azul padrão do Windows (`#0078D4`) e do `blue-600` genérico do Tailwind. Ele **não compete com o verde semântico** ("protegido" = success), então o status nunca fica ambíguo. Texto branco sobre ele: **5.73:1** (light) / **4.63:1** (dark).

**Ícone (app, taskbar, instalador)** — squircle 32×32, `rx=8`, gradiente diagonal `#5674FF → #2843D6`, contorno interno branco 14 %; dentro, uma **seta circular anti-horária** (ciclo de backup, à la `lucide/history`) envolvendo um **check** (backup concluído). Validado renderizado em 16/24/32/256 px.

```html
<svg viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden="true">
  <defs><linearGradient id="bc-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#5674FF"/><stop offset="1" stop-color="#2843D6"/></linearGradient></defs>
  <rect width="32" height="32" rx="8" fill="url(#bc-g)"/>
  <rect x=".5" y=".5" width="31" height="31" rx="7.5" stroke="#fff" stroke-opacity=".14"/>
  <g stroke="#fff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 16a8 8 0 1 0 8-8 8.67 8.67 0 0 0-5.99 2.44L8 12.44"/>  <!-- arco -->
    <path d="M8 8v4.44h4.44"/>                                           <!-- ponta da seta -->
    <path d="M12.75 16.25l2.25 2.25 4.25-4.5"/>                          <!-- check -->
  </g>
</svg>
```

- **Wordmark:** ícone 24 px + gap 8 px + **"BC"** Geist 600, `text-fg`, tracking −0.02em + **"Backup"** Geist 400, `text-fg-muted`. 15 px na sidebar, 28 px na tela Sobre.
- **Bandeja (16 px):** mesmo squircle **sem o check** e stroke 2.75 (o check vira ruído a 16 px). Estados por badge de 6 px no canto inferior direito com anel de 1.5 px `#fff`: nenhum (ok) · `#4566FA` (em execução, alterna 2 frames a 600 ms) · `#F2B24C` (avisos) · `#E5484D` (falha).
- `.ico` com 16, 20, 24, 32, 48, 256 px.

## 3. Tokens de cor

> **Substituído por [06-identidade-preto-verde.md](06-identidade-preto-verde.md) §4–§5** (decisão, tabela completa e contrastes). Resumo dos valores atuais:

| Token | Light | Dark | Uso |
|---|---|---|---|
| `bg` | `#F8FAF9` | `#0A0D0C` | Fundo da área de conteúdo; cor do titleBarOverlay |
| `surface` | `#F1F4F3` | `#060807` | Sidebar (mais apagada que o conteúdo, à la Linear) |
| `surface-raised` | `#FFFFFF` | `#101413` | Cards, inputs, popovers, drawer, dialog, painel da bandeja |
| `surface-hover` | `#EAEFED` | `#171D1B` | Hover de linhas/itens, item ativo da sidebar |
| `border` | `#E0E6E3` | `#1E2623` | Bordas de cards, divisórias |
| `border-strong` | `#C9D2CE` | `#2D3733` | Inputs, botões secundários, hover de cards |
| `text-primary` | `#0A1310` | `#ECF2EF` | Títulos, corpo |
| `text-secondary` | `#46524D` | `#A3AEA9` | Descrições, labels, ícones de nav |
| `text-tertiary` | `#5C6863` | `#84918B` | Metadados, placeholders, timestamps |
| `accent` (menta) | `#00C795` | `#00D9A0` | Botão primário, ProgressBar, seleção — único acento |
| `accent-hover` | `#00B386` | `#2EE5B2` | Hover/pressed do primário |
| `accent-soft` | `#E3F8F0` | `#0A2B21` | Chip selecionado, ícone-tile, pill "Em execução" |
| `accent-text` | `#00765A` | `#3EE0B0` | Links e texto/ícone em cor de marca |
| `accent-foreground` | `#00140F` | `#00140F` | Texto **sobre** `accent` (preto: branco reprova) |
| `accent-edge` | `#009C73` | `#00D9A0` | Contorno ≥ 3:1 de controles em menta, campo em foco |
| `success` / `-soft` | `#24782F` / `#EAF6EA` | `#74CF78` / `#132517` | "Concluído", "Tudo protegido" (verde-folha ≠ menta) |
| `warning` / `-soft` | `#9C540A` / `#FDF3E3` | `#F2B24C` / `#2B210F` | "Com avisos", disco > 75 % |
| `danger` / `-soft` | `#C42727` / `#FDEDED` | `#FF6B6B` / `#311615` | "Falhou", disco > 90 %, botão destrutivo |
| `info` / `-soft` | `#2E5E86` / `#EDF2F6` | `#93B4D2` / `#121B23` | "Agendada", dicas (azul-aço de baixo croma) |
| `ring` (focus) | `#009C73` | `#00D9A0` | `outline: 2px solid; outline-offset: 2px` |
| `overlay` | `rgb(4 14 11 / .36)` | `rgb(0 0 0 / .64)` | Scrim de dialog/drawer |

Contrastes: todos os pares de texto ≥ 4.5:1 e os não-texto ≥ 3:1 — tabela em 06 §5.

Regras: (1) cor semântica **sempre** acompanha ícone + texto (nunca só cor). (2) Bordas de input (`border-strong`, ~1.5:1) são decorativas; o controle é identificado por label + fundo `surface-raised` + foco ≥ 3:1; Checkbox e Switch desligados usam `text-tertiary` (≥ 4.6:1) no contorno/trilho e, ligados, `accent-edge` (≥ 3:1). (3) Botão "danger" usa estilo *soft* (`danger` sobre `danger-soft`) nos dois temas — AA garantido sem token extra. (4) Menta sólido só em ação/seleção/progresso; nunca em áreas grandes.

## 4. Tipografia

**Geist Variable** (UI) + **Geist Mono Variable** (caminhos, logs, tamanhos em log) — `npm i @fontsource-variable/geist @fontsource-variable/geist-mono`. Suíça, neutra e moderna; cobre todos os diacríticos do pt-BR (ã, ç, õ, ê); tem `tnum` para números que não "pulam" durante o progresso; empacotada localmente (app offline). Fallback: `"Segoe UI Variable Text", "Segoe UI", system-ui`.

| Estilo | px / line-height | Peso | Tracking | Uso |
|---|---|---|---|---|
| `display` | 28 / 36 | 600 | −0.02em | Frase de status do hero ("Tudo protegido") |
| `title` | 22 / 28 | 600 | −0.015em | Título de página |
| `section` | 16 / 24 | 600 | −0.01em | Título de seção / etapa do editor |
| `card-title` | 14 / 20 | 600 | −0.005em | Título de card, nome da rotina |
| `body` | 14 / 20 | 400 | 0 | Texto padrão (= Windows 11 Body) |
| `small` | 13 / 18 | 400 | 0 | Descrições, linhas de tabela secundárias |
| `caption` | 12 / 16 | 500 | +0.005em | Labels, metadados, pills (mínimo absoluto: 12 px) |
| `overline` | 12 / 16 | 600 | +0.04em, UPPERCASE | Grupos de dia no Histórico ("HOJE") |
| `stat` | 24 / 32 | 600 | −0.02em, `tabular-nums` | Números dos StatTiles |
| `mono` | 12 / 18 | 400 | 0 | Caminhos, log (Geist Mono) |

Regras: só pesos 400/500/600; sem itálico; sentence case em tudo; números com `tabular-nums` em tabelas, progresso e stats; formato pt-BR (`1.204 arquivos`, `2,1 GB`, `05/10 às 22:00`) via `Intl.NumberFormat('pt-BR')`.

## 5. Espaçamento, raios, sombras, bordas, movimento

**Espaçamento** — base 4 px (escala padrão do Tailwind): `4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`.
Padding de página `32` (`px-8 py-6`); padding de card `20` (`p-5`); gap entre cards `16`; entre seções `32`; label→controle `6`; linhas de configuração `16` vertical. Alturas de controle: **sm 28 · md 32 (padrão) · lg 40**; linha de lista 56 (1 linha) / 72 (2 linhas).

**Raios** — Fluent progressivo (4 in-page / 8 overlay) subido um degrau para suavidade web moderna (Geist usa 6/12/16). Regra de aninhamento: raio interno = raio externo − padding.

| Token | Valor | Onde |
|---|---|---|
| `radius-xs` | 4 px | Checkbox, Kbd, ProgressBar/DiskUsageBar (barras), scrollbar |
| `radius-sm` | 6 px | Tooltip, botão sm, chips de dia da semana, PathChip, item de menu |
| `radius-md` | 8 px | Botões md/lg, Input, Select, Segmented, item da sidebar |
| `radius-lg` | 12 px | Cards, popover/menu, toast, StatTile |
| `radius-xl` | 16 px | Dialog, hero card, Drawer (cantos internos) |
| `radius-full` | 9999 px | StatusPill, Badge, Switch, dots |

**Sombras** (no dark a profundidade vem de borda + highlight interno; sombra é quase invisível sobre preto)

```css
/* light */
--sh-xs:     0 1px 2px rgb(16 17 20 / .05);
--sh-card:   0 1px 2px rgb(16 17 20 / .04), 0 1px 3px rgb(16 17 20 / .03);
--sh-pop:    0 0 0 1px rgb(16 17 20 / .06), 0 4px 12px -2px rgb(16 17 20 / .10), 0 2px 4px -2px rgb(16 17 20 / .06);
--sh-dialog: 0 0 0 1px rgb(16 17 20 / .06), 0 24px 48px -12px rgb(16 17 20 / .22), 0 8px 16px -8px rgb(16 17 20 / .10);
/* dark */
--sh-xs:     0 1px 2px rgb(0 0 0 / .40);
--sh-card:   inset 0 1px 0 rgb(255 255 255 / .03), 0 1px 2px rgb(0 0 0 / .40);
--sh-pop:    inset 0 1px 0 rgb(255 255 255 / .05), 0 0 0 1px rgb(255 255 255 / .06), 0 8px 24px -4px rgb(0 0 0 / .55);
--sh-dialog: inset 0 1px 0 rgb(255 255 255 / .06), 0 0 0 1px rgb(255 255 255 / .08), 0 24px 64px -12px rgb(0 0 0 / .70);
```

**Bordas** — sempre 1 px. Card = `border` + `sh-card`; hover de card clicável = `border-strong`. Tabelas: só divisórias horizontais `border`, sem linhas verticais nem zebra. Nunca borda dupla (card dentro de card → use `surface-hover` como fundo do interno, sem borda). Sidebar separada do conteúdo apenas pela diferença `surface`/`bg` + 1 px `border`.

**Movimento** — sutil, funcional, nunca decorativo.

| Token | Valor | Uso |
|---|---|---|
| `--duration-fast` | 120 ms | hover, press, cor de botão/linha |
| `--duration-base` | 180 ms | tooltip, popover, menu, toast (entrada: fade + translateY 4 px) |
| `--duration-slow` | 260 ms | drawer (translateX 24 px + fade), dialog (scale .98→1 + fade) |
| `--duration-progress` | 400 ms | largura da ProgressBar (linear) |
| `--ease-out` | `cubic-bezier(.16, 1, .3, 1)` | entradas |
| `--ease-in-out` | `cubic-bezier(.65, 0, .35, 1)` | trocas de etapa, colapsos |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | saídas (70 % da duração de entrada) |

`prefers-reduced-motion: reduce` → sem translate/scale/shimmer; só opacidade a 0.01 ms; ProgressBar sem listras animadas. O ícone de "Em execução" gira (`LoaderCircle`, 1 s linear) e vira estático no modo reduzido.

## 6. Layout e janela

- **Janela:** padrão **1200 × 780**, mínimo **960 × 640**, centralizada, lembra tamanho/posição. `show:false` + `ready-to-show`; `backgroundColor` = `bg` do tema resolvido (sem flash branco).
- **Barra de título:** frameless com controles nativos — `titleBarStyle: 'hidden'` + `titleBarOverlay` (mantém Snap Layouts e os botões do Windows 11). Altura **40 px**. Ao trocar tema: `win.setTitleBarOverlay({ color, symbolColor })`. Região arrastável `-webkit-app-region: drag`; botões/inputs nela com `no-drag`; reserve `env(titlebar-area-width)`.
- **Sem Mica na v1:** superfícies sólidas garantem o contraste medido acima e paridade com Windows 10. (Futuro: `backgroundMaterial: 'mica'` só na sidebar, Win 11 22H2+.)
- **Fechar (×)** = minimizar para a bandeja (configurável); na 1ª vez, notificação nativa "O BC Backup continua rodando na bandeja".

```ts
const dark = nativeTheme.shouldUseDarkColors; // ou preferência salva
const win = new BrowserWindow({
  width: 1200, height: 780, minWidth: 960, minHeight: 640, show: false,
  backgroundColor: dark ? '#0A0D0C' : '#F8FAF9',
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: dark ? '#0A0D0C' : '#F8FAF9', symbolColor: dark ? '#A3AEA9' : '#46524D', height: 40 },
});
win.once('ready-to-show', () => win.show());
```

**Shell**

```
┌─────────────────────┬──────────────────────────────────────────────── ─  ▢  ✕ ┐ 40 px (drag)
│ [■] BC Backup       │  Rotinas / Nova rotina          (breadcrumb, text-tertiary)│
│                     ├──────────────────────────────────────────────────────────┤
│ [ + Nova rotina  ^N]│                                                          │
│                     │       conteúdo: max-w 1080 px, centralizado, px-8 py-6   │
│ ▣ Painel            │                                                          │
│ ◷ Rotinas        5  │                                                          │
│ ↺ Histórico         │                                                          │
│ ─────────────────── │                                                          │
│ ● Agendador ativo   │                                                          │
│ ⚙ Configurações     │                                                          │
└─────────────────────┴──────────────────────────────────────────────────────────┘
  sidebar 232 px (surface)            bg
```

- **Sidebar 232 px**; abaixo de 1040 px de largura colapsa para **trilho de 64 px** (só ícones + Tooltip). Itens: altura 32, `radius-md`, px 10, ícone 16 px stroke 1.75, gap 10, `small` 13 px/500. Hover `surface-hover`; ativo `surface-hover` + `text-primary` + ícone `accent-text` + pílula `accent` 3 × 16 px na borda esquerda (NavigationView do Windows 11); inativo `text-secondary`.
- **Navegação (lucide-react):** Painel `LayoutDashboard` · Rotinas `CalendarClock` (contador = nº de rotinas, Badge neutro) · Histórico `History` (Badge `danger-soft` com nº de falhas não vistas) · Configurações `Settings` (fixo no rodapé). Botão "Nova rotina" `Plus` (secundário, largura total, Kbd `Ctrl N`). Rodapé: dot `success` + "Agendador ativo" (`caption`).
- **Cabeçalho de página:** `title` + descrição `small text-secondary` à esquerda; ação primária à direita; 24 px abaixo começa o conteúdo.

## 7. Telas

### (a) Painel

```
Painel                                                        [▶ Executar agora ▾]
Visão geral das suas rotinas de backup
╭──────────────────────────────────────────────────────────────────────────────╮
│ (✓)  Tudo protegido                                          Últimos 14 dias │
│      Último backup há 2 h · Próximo hoje às 22:00 (Clientes NF-e)  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮│
╰──────────────────────────────────────────────────────────────────────────────╯
╭ Rotinas ativas ─╮╭ Execuções · 7 dias ─╮╭ Taxa de sucesso ─╮╭ Copiado · 7 dias ─╮
│ 4  de 5         ││ 28                  ││ 96 %             ││ 182 GB            │
╰─────────────────╯╰─────────────────────╯╰──────────────────╯╰───────────────────╯
╭ Próximas execuções ──────────────────╮╭ Destinos ──────────────────────────────╮
│ Hoje 22:00   Clientes NF-e        ▶ ││ ⛁ Backup (E:)     ██████████░░░░  68 %  │
│ Hoje 23:30   Fotos escritório     ▶ ││   612 GB livres de 1,8 TB               │
│ Amanhã 06:00 Banco SQL            ▶ ││ ⛁ \\srv\backup    █████████████▌  93 % ⚠│
╰──────────────────────────────────────╯╰─────────────────────────────────────────╯
╭ Últimas execuções ───────────────────────────────────────────── Ver histórico → ╮
│ (Concluído)   Clientes NF-e     hoje, 12:00    4 min   1.204 arquivos   2,1 GB │
│ (Com avisos)  Fotos escritório  hoje, 09:00   11 min     312 arquivos   8,4 GB │
│ (Falhou)      Banco SQL         ontem, 23:30     —     Destino indisponível    │
╰──────────────────────────────────────────────────────────────────────────────────╯
```

- **Hero** (`radius-xl`, `p-6`): ícone 20 px dentro de círculo 44 px `*-soft`; frase `display`; linha `small text-secondary`. Barras dos últimos 14 dias (4 × 20 px, gap 3, `radius-xs`; cor = pior status do dia; vazio = `border`) com Tooltip por dia. Variantes: **Tudo protegido** (`ShieldCheck`, success) · **Atenção necessária** (`TriangleAlert`, warning: "1 rotina terminou com avisos") · **Último backup falhou** (`ShieldAlert`, danger + botão "Ver detalhes") · **Backup em andamento** (`LoaderCircle` accent + ProgressBar inline e "42 % · ~5 min") · **Nenhuma rotina** (EmptyState).
- Grade: hero 12 col · 4 StatTiles 3 col · Próximas 5 col + Destinos 7 col · Últimas 12 col. Abaixo de 1100 px: Próximas/Destinos empilham.

### (b) Rotinas

```
Rotinas                       [⌕ Buscar rotina…] [Todas | Ativas | Pausadas] [+ Nova rotina]
╭────────────────────────────────────────────────────────────────────────────────╮
│ [⟳] Clientes NF-e                              (Agendado)    Próxima: hoje 22:00 │
│     Todo dia às 22:00 · 3 pastas → E:\, \\srv\backup · 30 dias     [▶] [⏸] [⋯] │
├────────────────────────────────────────────────────────────────────────────────┤
│ [⟳] Fotos escritório        (Em execução)  ▓▓▓▓▓▓░░░░░░ 42 %  12,4 de 29,0 GB   │
│     Seg, Qua e Sex às 23:30 · 1 pasta → E:\ · 15 dias              [■] [⋯]      │
├────────────────────────────────────────────────────────────────────────────────┤
│ [⟳] Banco SQL                                   (Pausado)               —        │
│     A cada 4 horas · 1 arquivo → \\srv\backup · 7 dias            [▶] [⏵] [⋯]  │
╰────────────────────────────────────────────────────────────────────────────────╯
```

Lista (não grade de cards: escaneia melhor e escala para 20+ rotinas). Linha 72 px; tile 32 px `accent-soft` com `FolderSync` (`text-tertiary` se pausada; nome também em `text-secondary`). Clique na linha → editor. Ações = botões ghost-ícone 28 px com Tooltip: `Play` "Executar agora", `Pause`/`Play` "Pausar"/"Retomar", `Square` "Parar" (só em execução), `Ellipsis` → Editar, Duplicar, Abrir pasta de destino, Ver histórico, —, Excluir (danger). Ordem: em execução → falhas → próxima execução.

### (c) Editor de rotina (página inteira, não modal)

```
← Rotinas  /  Nova rotina
╭───────────────────╮  Destinos
│ ✓ Origem          │  Para onde as cópias vão. Dois discos diferentes = mais segurança.
│ ● Destinos        │  ╭──────────────────────────────────────────────────────────╮
│ ○ Agendamento     │  │ ⛁ Backup (E:)   E:\Backups\BC        ███████░░░ 68 %   ✕ │
│ ○ Retenção        │  ╰──────────────────────────────────────────────────────────╯
│ ○ Notificação     │  [+ Adicionar destino]
│ ○ Revisão         │  (i) Dica: um destino em outro computador (\\servidor\pasta) protege
╰───────────────────╯      contra falha do disco local.
──────────────────────────────────────────────────────────────────────────────────────
 Cancelar                                                     [Voltar] [Continuar →]
```

- Stepper vertical 220 px, sticky; formulário max-w 640. Rodapé sticky (`surface-raised` + borda topo). **Criar** = fluxo linear (Continuar valida a etapa). **Editar** = etapas livres + "Salvar alterações" sempre visível; etapa com erro ganha dot `danger`.
- **1 Origem** — "Nome da rotina" (autofoco, sugestão a partir da 1ª pasta) · lista de PathChips (pasta/arquivo, tamanho estimado à direita) · "Adicionar pastas" / "Adicionar arquivos" (diálogo nativo) · área de soltar arquivos tracejada (`border-strong`, `radius-lg`) · `Avançado ▸` exclusões (`*.tmp`, `~$*`, `Thumbs.db` pré-preenchidas).
- **2 Destinos** — cards com DiskUsageBar + espaço livre vs. tamanho estimado; aviso warning se mesmo disco físico da origem; erro se sem espaço. Pasta-destino por execução: `Rotina_AAAA-MM-DD_HHmm` (mostrar exemplo em `mono`).
- **3 Agendamento** — Segmented `Diariamente | Dias da semana | A cada N horas | Manual`; TimePicker; WeekdayPicker; NumberStepper "a cada [4] horas, das [08:00] às [20:00]". Frase-prévia em `accent-soft`: **"Próxima execução: amanhã, 05/10 às 22:00."** Switch "Executar ao iniciar se uma execução foi perdida".
- **4 Retenção** — "Apagar cópias com mais de [30] dias" (stepper 1–3650) · Switch, ligado por padrão: "Sempre manter ao menos as 3 cópias mais recentes" · prévia: "Com base no agendamento, você terá ~30 versões ocupando ~63 GB."
- **5 Notificação** — Switch "Enviar e-mail ao terminar" · destinatários como chips (Enter/vírgula) · Segmented `Sempre | Só com avisos ou falhas` · se SMTP ausente: Callout warning "Configure o servidor de e-mail em Configurações → E-mail" com link.
- **6 Revisão** — card resumo em linhas *label → valor* com "Editar" por seção · Switch "Ativar rotina" · primário **"Criar rotina"** + secundário "Criar e executar agora".

### (d) Execução em andamento (Drawer à direita, também acessível pelo hero)

```
╭ Fotos escritório · (Em execução) ─────────────────────── [Parar] [×] ╮
│ 42 %                                              ~5 min restantes     │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░                          │
│ Arquivos  1.240 / 2.950   Dados  12,4 / 29,0 GB   Velocidade  84 MB/s  │
│ Copiando  C:\Fotos\2026\Clientes\…\IMG_4821.HEIC              (mono)   │
│ ✓ Preparando ── ● Copiando ── ○ Limpando cópias antigas ── ○ E-mail    │
│ Destinos   E:\ 42 %  ·  \\srv\backup aguardando                        │
╰────────────────────────────────────────────────────────────────────────╯
```

Percentual em `stat` 32 px `tabular-nums`; ProgressBar 8 px. UI atualiza no máx. 4×/s; velocidade com média móvel de 3 s; ETA só após 5 s ("Calculando…"). Arquivo atual com truncamento no meio. "Parar" pede confirmação ("A cópia parcial deste backup será apagada; os backups anteriores continuam").

### (e) Histórico

```
Histórico   [Últimos 7 dias ▾] [Todas as rotinas ▾] [Todos | Concluído | Com avisos | Falhou]  [Exportar CSV]
HOJE
 (Concluído)   Clientes NF-e      12:00 → 12:04    4 min   1.204   2,1 GB   E:\
 (Com avisos)  Fotos escritório   09:00 → 09:11   11 min     312   8,4 GB   E:\ +1
ONTEM                                                  ╭ Drawer 480 px ──────────────────────╮
 (Falhou)      Banco SQL          23:30 → 23:30      —       —      —     │ (Falhou) Banco SQL               × │
                                                       │ ontem, 23:30 · 12 s · \\srv\backup │
                                                       │ [Resumo | Log]                     │
                                                       │ 23:30:01 INFO  Iniciando rotina…   │
                                                       │ 23:30:12 ERRO  Destino indisponível│
                                                       │ ☐ Só erros e avisos   [Copiar log] │
                                                       │ [Executar novamente] [Abrir pasta] │
                                                       ╰────────────────────────────────────╯
```

Tabela agrupada por dia (`overline`), linha 44 px, colunas numéricas à direita com `tabular-nums`. Clique → Drawer (`sh-dialog`, scrim `overlay` leve). **Resumo:** stats + lista de avisos/erros com caminho. **Log:** `mono` 12/18 em `surface` com níveis coloridos (`INFO` tertiary, `AVISO` warning, `ERRO` danger), busca, "Só erros e avisos", Copiar, Exportar .txt; virtualizado.

### (f) Configurações (Segmented no topo: `Geral | E-mail | Sobre`)

Layout macOS Ajustes: cards agrupados, cada linha = label `body` 500 + descrição `small text-secondary` à esquerda, controle à direita, divisórias `border`.

```
╭─ Geral ───────────────────────────────────────────────────────────────────╮
│ Iniciar com o Windows                                              [ ●] │
│ O BC Backup abre na bandeja ao ligar o computador.                        │
├───────────────────────────────────────────────────────────────────────────┤
│ Ao fechar a janela                         [Minimizar para a bandeja ▾]  │
├───────────────────────────────────────────────────────────────────────────┤
│ Tema                                        [Claro | Escuro | Sistema]   │
├───────────────────────────────────────────────────────────────────────────┤
│ Notificações do Windows                                            [ ●] │
├───────────────────────────────────────────────────────────────────────────┤
│ Pasta de logs   C:\ProgramData\BC Backup\logs              [Abrir pasta] │
╰───────────────────────────────────────────────────────────────────────────╯
```

- **E-mail (SMTP):** atalhos `Gmail · Microsoft 365 · Personalizado` (preenchem host/porta/segurança) · Servidor · Porta · Segurança `SSL/TLS | STARTTLS | Nenhuma` · Usuário · Senha (olho; Callout info: "No Gmail, use uma senha de app") · Nome e e-mail do remetente · Destinatário padrão. Rodapé: **"Enviar e-mail de teste"** (secundário → spinner → resultado inline success/danger com mensagem do servidor) + **"Salvar"**.
- **Sobre:** wordmark 28 px, versão `mono`, "Verificar atualizações", links Licenças/Site/Suporte, "Feito por BC · Brasil".

### (g) Empty states (ícone 24 px em tile 48 px `surface-hover` · título `section` · texto `small` · 1 CTA; alinhado à esquerda dentro de cards, centralizado em página vazia)

| Onde | Título | Texto | CTA |
|---|---|---|---|
| Painel/Rotinas sem nada | Vamos proteger seus arquivos | Crie sua primeira rotina: escolha o que copiar, para onde e quando. Leva menos de um minuto. | Criar primeira rotina |
| Histórico vazio | Nenhuma execução ainda | Assim que uma rotina rodar, o resultado aparece aqui. | Executar uma rotina agora |
| Busca/filtro sem resultado | Nada encontrado | Tente outro termo ou limpe os filtros. | Limpar filtros |
| Editor sem destino | Nenhum destino ainda | Adicione um disco externo, outra unidade ou uma pasta de rede. | Adicionar destino |
| E-mail não configurado | E-mail ainda não configurado | Configure o SMTP para avisar seus clientes ao fim de cada backup. | Configurar e-mail |

### (h) Toasts

Canto inferior direito, 360 px, `radius-lg`, `sh-pop`, pilha máx. 3 (mais nova embaixo); ícone semântico 16 px + título `card-title` + descrição `small` + ação opcional (link) + fechar. Sucesso/info somem em 5 s (pausa no hover); erro persiste. Com a janela oculta, usar **notificação nativa do Windows** (Electron `Notification`) em vez de toast. Exemplos: success "Backup concluído — Clientes NF-e · 1.204 arquivos · 2,1 GB" · warning "Concluído com 3 avisos — [Ver detalhes]" · danger "Falha no backup — Banco SQL: destino indisponível. [Ver log]" · info "Rotina salva" · success "E-mail de teste enviado para joao@cliente.com.br".

### (i) Menu da bandeja (nativo, `Menu.buildFromTemplate`)

Tooltip do ícone: "BC Backup — Tudo protegido · próximo às 22:00". Itens:
`Abrir BC Backup` (negrito; clique simples no ícone também abre) · ——— · *Status (desativado):* "Último backup: hoje, 12:00 ✓" · *Próximo:* "Hoje, 22:00 — Clientes NF-e" · ——— · `Executar agora ▸` (submenu com rotinas) · `Pausar todas as rotinas` / `Retomar rotinas` · ——— · `Configurações…` · `Sair do BC Backup`. Em execução, o 1º status vira "Em execução: Fotos escritório — 42 %".

## 8. Inventário de componentes

| Componente | Especificação |
|---|---|
| **Button** | Alturas sm 28 / md 32 / lg 40; px 10/12/16; `radius-sm` (sm) ou `radius-md`; `caption`→`small` 500; ícone 16 px gap 6. **primary** `accent`/`accent-foreground` (texto preto, 600), hover `accent-hover`, `shadow-primary`. **secondary** `surface-raised` + 1 px `border-strong` + `sh-xs`, hover `surface-hover`. **ghost** transparente, hover `surface-hover`, texto `text-secondary`→`text-primary`. **danger** `danger-soft` + texto `danger`, hover borda `danger`/30 %. Disabled 45 % opacidade. Loading: spinner substitui ícone, largura fixa. Só ícone: quadrado + Tooltip obrigatório. |
| **Input** | 32 px, `surface-raised`, 1 px `border-strong`, `radius-md`, px 10, `body`; placeholder `text-tertiary`; foco: borda `accent` + `ring` 2 px offset 0 (dentro do campo); erro: borda `danger` + mensagem `caption danger` com `CircleAlert`. Prefixo/sufixo ("dias", "horas") em `text-tertiary`. |
| **Select** | Igual Input + `ChevronDown` 16 px; lista em popover `radius-lg` `sh-pop`, itens 32 px `radius-sm`, selecionado com `Check` `accent-text`. (Radix Select / shadcn.) |
| **Switch** | 36 × 20, thumb 16 px branco com `sh-xs`; off: trilho `text-tertiary`/30 % com contorno `text-tertiary`; on: `accent` + contorno `accent-edge`. 120 ms `ease-out`. Rótulo à esquerda em linhas de configuração. |
| **Segmented** | Trilho `surface-hover` (`radius-md`, padding 2); segmento ativo `surface-raised` + `sh-xs` + `text-primary` (light) / `#2A2B31` (dark); inativo `text-secondary`; altura 32; indicador desliza 180 ms. |
| **Checkbox** | 16 px, `radius-xs`, contorno 1.5 px `text-tertiary`; marcado `accent` + borda `accent-edge` + `Check` `accent-foreground` (preto) 12 px stroke 3. |
| **Stepper** (editor) | Itens 36 px; círculo 20 px: pendente contorno `border-strong` + nº `text-tertiary`; atual `accent` + nº `accent-foreground`; concluído `accent-soft` + `Check` `accent-text`; linha vertical 1 px `border` ligando círculos. |
| **NumberStepper** | Input 72 px centralizado `tabular-nums` + botões `Minus`/`Plus` ghost 28 px. |
| **Card** | `surface-raised`, 1 px `border`, `radius-lg`, `sh-card`, `p-5`; cabeçalho opcional: `card-title` + ação ghost à direita, divisória opcional. |
| **StatTile** | Card `p-4`; label `caption text-secondary`; valor `stat`; delta `caption` success/danger com seta. |
| **StatusPill** | Altura 22, px 8, `radius-full`, `caption` 500, dot 6 px ou ícone 12 px + texto; fundo `*-soft`, texto `*`. Mapa: Concluído=success + `CircleCheck` · Com avisos=warning + `TriangleAlert` · Falhou=danger + `CircleX` · Em execução=accent-soft/accent-text + `LoaderCircle` girando · Agendado=info + `Clock` · Pausado=`surface-hover`/`text-secondary` + `Pause` · Cancelado=`surface-hover`/`text-tertiary` + `Ban`. |
| **ProgressBar** | 6 px (8 no drawer), trilho `surface-hover`, `radius-xs`, preenchimento `accent` (success ao concluir); indeterminado: segmento de 30 % deslizando 1.2 s (desligado em reduced motion). |
| **DiskUsageBar** | 6 px; usado `accent` < 75 % · `warning` 75–90 % · `danger` > 90 %; faixa hachurada `accent`/35 % = espaço que o próximo backup vai usar; legenda `caption`: "612 GB livres de 1,8 TB". |
| **Dialog** | Max-w 440 (confirmação) / 560; `radius-xl`, `sh-dialog`, p-6; scrim `overlay`; título `section`, texto `body text-secondary`; ações à direita (cancelar ghost, confirmar primário/danger). Esc fecha, foco preso. |
| **Drawer** | Direita, 480 px, altura total abaixo da titlebar, `surface-raised`, borda esquerda `border`, `sh-dialog`, cabeçalho sticky 56 px. |
| **Toast** | Ver 7(h). Base: Sonner ou Radix Toast. |
| **Tooltip** | `text-primary` invertido: light `#16171B` / dark `#EDEDF0` com texto `bg`; `caption`, px 8 py 4, `radius-sm`, delay 400 ms, sem seta; pode conter Kbd. |
| **EmptyState** | Ver 7(g). |
| **Kbd** | Altura 18, px 5, `mono` 11 px 500, `surface-hover`, 1 px `border`, borda inferior 2 px, `radius-xs`; "Ctrl", "N". |
| **Badge** | Contador: altura 18, min-w 18, `radius-full`, `caption` 600 `tabular-nums`; neutro `surface-hover`/`text-secondary`; alerta `danger-soft`/`danger`. |
| **TimePicker** | Input 96 px `mono`/`tabular-nums` com máscara `HH:mm` 24 h + popover com colunas de horas/minutos (passo 5 min); ícone `Clock`. Nada de AM/PM. |
| **WeekdayPicker** | 7 chips 32 × 32 `radius-sm`: **D S T Q Q S S** (Tooltip "Domingo"…); off: `surface-raised` + `border-strong` + `text-secondary`; on: `accent` + `accent-foreground` + borda `accent-edge`. Atalhos abaixo: "Dias úteis" · "Fim de semana" · "Todos". Semana começa no domingo. |
| **PathChip** | Altura 28, px 8, `radius-sm`, `surface-hover`; ícone `Folder`/`File`/`HardDrive`/`Server` (rede) 14 px `text-tertiary`; caminho `mono` truncado no meio (`C:\Clientes\…\NF-e 2026`); Tooltip com caminho completo; hover mostra `Copy` e `X`. |
| **Callout** | Faixa `*-soft`, `radius-md`, p 12, ícone 16 + `small`; para dicas e avisos dentro de formulários. |

Ícones: **lucide-react**, 16 px em controles / 20 px em cabeçalhos, `strokeWidth={1.75}`, cor herdada. Sem ícones coloridos fora do status.

## 9. Microcopy (pt-BR)

Tom: direto, tranquilo, "você"; verbos no infinitivo nos botões; nunca culpar o usuário; datas relativas ("hoje", "ontem", "há 2 h") com absoluta no Tooltip.

| Contexto | Texto |
|---|---|
| Status | **Concluído** · **Com avisos** · **Falhou** · **Em execução** · **Agendado** · **Pausado** · **Cancelado** · **Na fila** |
| Hero | "Tudo protegido" · "Atenção necessária" · "O último backup falhou" · "Backup em andamento" |
| Hero (linha) | "Último backup há 2 h · Próximo hoje às 22:00" |
| Botões | "Nova rotina" · "Executar agora" · "Pausar" · "Retomar" · "Parar" · "Editar" · "Duplicar" · "Excluir" · "Salvar alterações" · "Criar rotina" · "Continuar" · "Voltar" · "Cancelar" |
| Editor | "O que você quer copiar?" · "Para onde as cópias vão?" · "Quando executar?" · "Por quanto tempo guardar?" · "Avisar alguém?" · "Tudo certo?" |
| Agendamento | "Todo dia às 22:00" · "Seg, Qua e Sex às 23:30" · "A cada 4 horas, das 08:00 às 20:00" · "Somente manual" |
| Retenção | "Apagar cópias com mais de 30 dias" · "Sempre manter as 3 cópias mais recentes" |
| Execução | "Preparando…" · "Copiando 1.240 de 2.950 arquivos" · "~5 min restantes" · "Limpando cópias antigas…" · "Enviando e-mail…" |
| Confirmação | "Excluir a rotina “Banco SQL”?" / "As cópias já feitas continuam no destino. Esta ação não pode ser desfeita." / [Excluir rotina] |
| Erros | "Destino indisponível: verifique se o disco está conectado." · "Sem espaço em E:\ (faltam 12 GB)." · "Não foi possível ler 3 arquivos em uso." |
| E-mail | "Enviar e-mail de teste" · "E-mail de teste enviado para joao@cliente.com.br" · "Não foi possível conectar ao servidor SMTP (porta 587)." |
| Configurações | "Iniciar com o Windows" · "Minimizar para a bandeja ao fechar" · "Tema: Claro · Escuro · Sistema" |
| Assunto do e-mail | "[BC Backup] Concluído — Clientes NF-e (05/10, 22:04)" |

## 10. Tokens em CSS (Tailwind v4)

> Valores atualizados para a identidade preto · menta · branco ([06](06-identidade-preto-verde.md)). A fonte da verdade é `src/renderer/src/app.css`.

```css
/* src/renderer/styles/globals.css */
@import "tailwindcss";
@import "@fontsource-variable/geist";
@import "@fontsource-variable/geist-mono";

@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

:root {
  color-scheme: light;
  --bg: #F8FAF9;            --surface: #F1F4F3;        --surface-raised: #FFFFFF;  --surface-hover: #EAEFED;
  --border: #E0E6E3;        --border-strong: #C9D2CE;
  --text-primary: #0A1310;  --text-secondary: #46524D; --text-tertiary: #5C6863;
  --accent: #00C795;        --accent-hover: #00B386;   --accent-soft: #E3F8F0;     --accent-text: #00765A;
  --accent-foreground: #00140F; --accent-edge: #009C73;
  --success: #24782F; --success-soft: #EAF6EA;  --warning: #9C540A; --warning-soft: #FDF3E3;
  --danger:  #C42727; --danger-soft:  #FDEDED;  --info:    #2E5E86; --info-soft:    #EDF2F6;
  --ring: #009C73;    --overlay: rgb(4 14 11 / .36);
  /* sombras: mesma forma de antes, tinta rgb(4 20 14); --sh-accent só no botão primário (ver app.css) */
}

[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0A0D0C;            --surface: #060807;        --surface-raised: #101413;  --surface-hover: #171D1B;
  --border: #1E2623;        --border-strong: #2D3733;
  --text-primary: #ECF2EF;  --text-secondary: #A3AEA9; --text-tertiary: #84918B;
  --accent: #00D9A0;        --accent-hover: #2EE5B2;   --accent-soft: #0A2B21;     --accent-text: #3EE0B0;
  --accent-foreground: #00140F; --accent-edge: #00D9A0;
  --success: #74CF78; --success-soft: #132517;  --warning: #F2B24C; --warning-soft: #2B210F;
  --danger:  #FF6B6B; --danger-soft:  #311615;  --info:    #93B4D2; --info-soft:    #121B23;
  --ring: #00D9A0;    --overlay: rgb(0 0 0 / .64);
}

/* Mapeia variáveis de runtime → utilitários (bg-surface-raised, text-fg-muted, border-border-strong, shadow-card…) */
@theme inline {
  --color-bg: var(--bg);                 --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised); --color-surface-hover: var(--surface-hover);
  --color-border: var(--border);         --color-border-strong: var(--border-strong);
  --color-fg: var(--text-primary);       --color-fg-muted: var(--text-secondary); --color-fg-subtle: var(--text-tertiary);
  --color-accent: var(--accent);         --color-accent-hover: var(--accent-hover);
  --color-accent-soft: var(--accent-soft); --color-accent-text: var(--accent-text);
  --color-accent-foreground: var(--accent-foreground);
  --color-success: var(--success); --color-success-soft: var(--success-soft);
  --color-warning: var(--warning); --color-warning-soft: var(--warning-soft);
  --color-danger: var(--danger);   --color-danger-soft: var(--danger-soft);
  --color-info: var(--info);       --color-info-soft: var(--info-soft);
  --color-ring: var(--ring);       --color-overlay: var(--overlay);
  --shadow-xs: var(--sh-xs); --shadow-card: var(--sh-card); --shadow-pop: var(--sh-pop); --shadow-dialog: var(--sh-dialog);
}

/* Valores estáticos */
@theme {
  --font-sans: "Geist Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", "Cascadia Mono", Consolas, monospace;
  --radius-xs: 4px; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
  --text-display: 28px; --text-display--line-height: 36px; --text-display--letter-spacing: -0.02em;
  --text-title: 22px;   --text-title--line-height: 28px;   --text-title--letter-spacing: -0.015em;
  --text-section: 16px; --text-section--line-height: 24px; --text-section--letter-spacing: -0.01em;
  --text-body: 14px;    --text-body--line-height: 20px;
  --text-small: 13px;   --text-small--line-height: 18px;
  --text-caption: 12px; --text-caption--line-height: 16px;
  --text-stat: 24px;    --text-stat--line-height: 32px;    --text-stat--letter-spacing: -0.02em;
  --ease-out: cubic-bezier(.16, 1, .3, 1); --ease-in-out: cubic-bezier(.65, 0, .35, 1); --ease-in: cubic-bezier(.4, 0, 1, 1);
}

@layer base {
  html, body { background: var(--bg); color: var(--text-primary); font-family: var(--font-sans); font-size: 14px; }
  body { -webkit-font-smoothing: antialiased; user-select: none; }          /* app, não página */
  input, textarea, [data-selectable] { user-select: text; }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  ::selection { background: var(--accent-soft); }
  .titlebar { height: 40px; -webkit-app-region: drag; }
  .titlebar :is(button, input, a) { -webkit-app-region: no-drag; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
      transition-duration: .01ms !important; scroll-behavior: auto !important; }
  }
}
```

Uso: `<div className="bg-surface-raised border border-border rounded-lg shadow-card p-5">`, `<p className="text-small text-fg-muted">`, `<button className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-accent-foreground">`.
**Tema:** o main process resolve `Claro | Escuro | Sistema` (`nativeTheme.themeSource` + `nativeTheme.on('updated')`), envia ao preload, e um script inline no `<head>` define `document.documentElement.dataset.theme` **antes do primeiro paint**; na mesma troca, chamar `win.setTitleBarOverlay()` e `win.setBackgroundColor()` com `bg`/`text-secondary` do tema.

## Referências

- Linear — [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh) · [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) (LCH, sidebar apagada, "structure felt not seen")
- Vercel Geist — [Colors](https://vercel.com/geist/colors) (escala 100–1000 por função) · [Materials](https://vercel.com/geist/materials) (raios 6/12/16) · Fonte: [fontsource.org/fonts/geist](https://fontsource.org/fonts/geist/about), [geist-mono](https://fontsource.org/fonts/geist-mono/about), [vercel/geist-font](https://github.com/vercel/geist-font)
- Radix Colors — [Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) (passos 1–12: fundos, componentes, bordas, sólidos, texto)
- shadcn/ui — [Theming](https://ui.shadcn.com/docs/theming) (CSS vars + `@theme inline`) · Tailwind v4 — [Dark mode / `@custom-variant`](https://tailwindcss.com/docs/dark-mode)
- Microsoft — [Geometry / rounded corners no Windows 11](https://learn.microsoft.com/en-us/windows/apps/design/style/rounded-corner) (4/8 px) · [Typography / type ramp](https://learn.microsoft.com/en-us/windows/apps/design/style/typography) (12/14/20/28, sentence case, mín. 12 px)
- Electron — [Custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar) · [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) (`setTitleBarOverlay`, `backgroundMaterial`, `ready-to-show`)
- Raycast — [Manual: Settings/Appearance](https://manual.raycast.com/settings) · análise do sistema visual (sombras em camadas, Inter/GeistMono): [open-design.ai](https://open-design.ai/plugins/design-system-raycast/)
- Apple — [Time Machine: status no menu e frequência](https://appleinsider.com/inside/macos/tips/how-to-keep-your-macs-data-safe-using-time-machine) · Backblaze — [Computer Backup 8.5 redesign](https://www.backblaze.com/blog/announcing-backblaze-computer-backup-v8-5/) ("less cluttered, easier to understand")
- Anti-referências — Duplicati: [Utterly confused by the new interface](https://forum.duplicati.com/t/utterly-confused-by-the-new-interface/21763), [Difficult to use](https://forum.duplicati.com/t/difficult-to-use-impossible-to-maintain/21522), [2.2.0.0 nova UI](https://forum.duplicati.com/t/release-2-2-0-0-stable-2025-10-23/21453/) · Iperius: [PCWorld review](https://www.pcworld.com/article/3391364/iperius-backup-software-review.html), [SaaSworthy reviews](https://www.saasworthy.com/product/iperius-backup/reviews)
- Empty states — [Carbon pattern](https://carbondesignsystem.com/patterns/empty-states-pattern/) · [Eleken: empty state UX](https://eleken.co/blog-posts/empty-state-ux)
- Também considerados (padrões consolidados, sem página específica): Things 3 (respiro, hierarquia tipográfica), Notion Calendar/Cron (agendamento em linguagem natural, Kbd), Superhuman (atalhos e feedback instantâneo), Arc (sidebar como âncora), Mobbin/Dribbble "cloud storage dashboard" (barras de uso de disco, stat tiles).
