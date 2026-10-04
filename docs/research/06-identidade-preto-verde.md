# BC Backup — Identidade preto · verde · branco

> Adendo ao [02-design-system.md](02-design-system.md) · 04/10/2026 · **substitui as cores do §3 e do §10** (tipografia, raios, sombras, movimento e componentes continuam valendo).
> Pedido do dono: "adaptar o programa agora à identidade visual do ícone, que é preto e verde e branco".
> Ícone oficial: `build/brand/icone-original.png` — squircle preto com contorno branco, nuvem metade branca e metade menta, cilindro de dados, seta curva menta e o monograma "BC".

## 1. O que o ícone pede

| Cor do ícone | Valor aproximado | Papel na interface |
|---|---|---|
| Preto do fundo (com brilho verde nas bordas) | `#000` → `#001A13` | Superfícies do tema escuro, texto do tema claro, texto **sobre** menta |
| Menta (nuvem, seta) | `#00D9A0` → `#02F4C5` | O **único** acento: ação primária, seleção, foco, progresso |
| Esmeralda (sombra do cilindro) | `#009060` | Variante escura do acento no claro (texto/link, contorno de controles) |
| Branco (nuvem, contorno) | `#FFF` | Superfícies do tema claro, texto do tema escuro |

## 2. Como os produtos preto + verde resolvem

| Produto | Superfícies (escuro) | Uso do verde | Texto sobre o verde | Verde de marca × "sucesso" | Tema claro |
|---|---|---|---|---|---|
| **Spotify** | `#121212` canvas, `#181818` cards, `#1F1F1F` controles | Único acento: play, estado ativo, CTA. "A interface é acromática; a cor vem da capa" | **Preto** (`#000`) sobre `#1ED760` | Verde nunca carrega erro/aviso; semânticos em vermelho/laranja/azul | Não tem (app é só escuro) |
| **Supabase** | `#0F0F0F` / `#171717`, bordas `#242424`–`#363636` | "Marcador de identidade, não decoração": links, bordas a 30 %, logo. Proibido em fundos grandes | Escala por tema: no escuro o tom de texto é 70 % de luminosidade, no claro 26 % | Usa o próprio brand como "saudável" | Tem: o mesmo matiz, passos mais escuros para texto |
| **NVIDIA** | `#000` puro | `#76B900` em bordas, sublinhados e CTAs — "o verde é sinal, não superfície" | Preto | — | Seções brancas com o mesmo verde em detalhes |
| **Robinhood** | Preto | Verde = marca = alta | — | Fundido com "ganho" | Verde **diferente** por tema (`#00C805` claro × variante neon no escuro) |
| **Linear / Vercel** | `#08090A` e cinzas neutros | Acento só em CTA, item ativo e marca; o resto acromático | Branco (acento escuro) | Linear usa o acento de marca até para "Concluído" | Espelho exato do escuro |
| **Raycast / Warp** | `#07080A` (preto azulado) / `#121212`; elevação por degraus de fundo | Cor de marca só como "pontuação" | — | — | Raycast tem claro; Warp é tema do usuário |
| **1Password 8 (Knox) / Proton (Carbon)** | Escuros neutros | Acento só em ação primária e seleção | Branco | Semânticos separados | Ambos têm claro e alto contraste à parte |
| **GitHub Primer** | `#0D1117` | Botão primário **verde** | Branco | Primário e sucesso dividem o verde → ícone + rótulo resolvem | Mesmo verde, um passo mais escuro |

**Lições:** (1) um acento só, e sólido apenas onde há ação/seleção/progresso; (2) no escuro, menta vivo + texto **preto** por cima (Spotify, NVIDIA) — branco sobre menta reprova; (3) para não virar "néon", o verde nunca pinta áreas grandes e os fundos de status são sempre *soft*; (4) o mesmo hex não serve aos dois temas — no claro o acento precisa de um passo mais profundo e de um contorno; (5) quando a marca é verde, o "sucesso" ou se separa por matiz ou depende de ícone + rótulo (fazemos os dois); (6) acentos no escuro um pouco mais claros/menos saturados para texto, para evitar vibração (Material, tom 200).

## 3. Decisão

- **Acento = menta**, o único. Escuro `#00D9A0` (o menta do ícone); claro `#00C795` (um passo mais profundo, para ter presença sobre branco). **Sólido só em:** botão primário (1 por tela), switch ligado, checkbox marcado, etapa atual do editor, chips de dia, barras de progresso e de uso de disco, pílula de seleção da barra lateral, faixa de "solte aqui".
- **Texto sobre menta = preto da marca `#00140F`** nos dois temas (8,68:1 claro · 10,33:1 escuro). Branco reprovaria (2,19 · 1,84). Botão primário em peso 600.
- **`accent-edge` (novo):** contorno em menta com ≥ 3:1 sobre branco (`#009C73`) para switch, checkbox, campo em foco, card/chip selecionado e aba ativa. No escuro, é o próprio menta.
- **Sucesso = verde-folha, separado do menta:** matiz OKLCH ≈ 145° contra ≈ 166° do menta (≈ 21°), croma e luminância diferentes. Menta = marca/interação/"em execução"; verde-folha = "concluído/protegido". E, como antes, status **sempre** com ícone + rótulo.
- **Info = azul-aço de baixo croma** (`#2E5E86` / `#93B4D2`): "Agendada" e dicas ficam calmas e não disputam com o menta.
- **Superfícies escuras:** preto quase neutro com um fio de verde (matiz ≈ 160°, saturação ≈ 12 %, luminosidade 3–10 %). Lê como preto, não como "verde-escuro". A barra lateral é a mais escura (`#060807`), o conteúdo `#0A0D0C`, os cards `#101413` — como o fundo do ícone.
- **Superfícies claras:** branco nítido (`#FFFFFF` nos cards, `#F8FAF9` no conteúdo) com cinzas frios-esverdeados quase imperceptíveis; texto no "preto" da marca (`#0A1310`).
- **Anti-néon:** halo menta só no botão primário do escuro (borda a 25 % + brilho de 14 px a 45 %); brilhos radiais existentes (hero, Sobre, bandeja) em `*-soft`; nenhum gradiente menta em área grande; ícones coloridos só em status.

## 4. Tokens finais (`src/renderer/src/app.css`)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `bg` | `#F8FAF9` | `#0A0D0C` | Conteúdo; `backgroundColor`/`titleBarOverlay` da janela |
| `surface` | `#F1F4F3` | `#060807` | Barra lateral |
| `surface-raised` | `#FFFFFF` | `#101413` | Cards, inputs, menus, drawer, painel da bandeja |
| `surface-hover` | `#EAEFED` | `#171D1B` | Hover, item ativo, trilhos |
| `surface-sunken` | `#EEF2F0` | `#080B0A` | Log, áreas rebaixadas |
| `border` | `#E0E6E3` | `#1E2623` | Bordas de card, divisórias |
| `border-strong` | `#C9D2CE` | `#2D3733` | Inputs, botões secundários |
| `text-primary` | `#0A1310` | `#ECF2EF` | Títulos, corpo |
| `text-secondary` | `#46524D` | `#A3AEA9` | Descrições, labels; símbolos da barra de título |
| `text-tertiary` | `#5C6863` | `#84918B` | Metadados, placeholders |
| `accent` | `#00C795` | `#00D9A0` | Preenchimento menta (lista acima) |
| `accent-hover` | `#00B386` | `#2EE5B2` | Hover/pressed do primário (escurece no claro, clareia no escuro) |
| `accent-soft` | `#E3F8F0` | `#0A2B21` | Tiles, pílula "Em execução", prévias, seleção |
| `accent-text` | `#00765A` | `#3EE0B0` | Links, ícone ativo, texto em `accent-soft` |
| `accent-foreground` | `#00140F` | `#00140F` | Texto/ícone **sobre** menta |
| `accent-edge` *(novo)* | `#009C73` | `#00D9A0` | Contorno de controles em menta, campo em foco, aba ativa |
| `ring` | `#009C73` | `#00D9A0` | Anel de foco (`outline 2px`, offset 2) |
| `success` / `-soft` / `-bar` | `#24782F` / `#EAF6EA` / `#3BA14A` | `#74CF78` / `#132517` / `#4FB45A` | "Concluído", "Tudo protegido", barras de 14 dias |
| `warning` / `-soft` / `-bar` | `#9C540A` / `#FDF3E3` / `#E09B2D` | `#F2B24C` / `#2B210F` / `#F2B24C` | Avisos, disco 75–90 % |
| `danger` / `-soft` / `-bar` | `#C42727` / `#FDEDED` / `#E5484D` | `#FF6B6B` / `#311615` / `#F25F5F` | Falhas, disco > 90 % |
| `info` / `-soft` | `#2E5E86` / `#EDF2F6` | `#93B4D2` / `#121B23` | "Agendada", dicas |
| `segment-active` | `#FFFFFF` | `#232B28` | Segmento ativo do Segmented |
| `tooltip-bg` / `-fg` | `#0A1310` / `#F8FAF9` | `#ECF2EF` / `#0A0D0C` | Tooltip invertido |
| `overlay` | `rgb(4 14 11 / .36)` | `rgb(0 0 0 / .64)` | Scrim de dialog/drawer |
| `sh-accent` → `shadow-primary` | realce interno + contorno esmeralda 18 % | realce interno + contorno menta 25 % + brilho 14 px | Só o botão primário |

Sombras (`sh-xs/card/pop/dialog`) mantêm a forma do §5, com tinta `rgb(4 20 14)` no claro.

## 5. Contraste verificado (WCAG 2.x, script lendo o `app.css`)

| Par (mín.) | Claro | Escuro |
|---|---|---|
| text-primary / raised · bg · surface · hover (4,5) | 18,86 · 17,99 · 17,04 · 16,23 | 16,36 · 17,21 · 17,71 · 15,08 |
| text-secondary / raised · bg · surface · hover (4,5) | 8,16 · 7,78 · 7,37 · 7,02 | 8,12 · 8,54 · 8,78 · 7,48 |
| text-tertiary / raised · bg · surface · hover (4,5) | 5,81 · 5,54 · 5,25 · 5,00 | 5,66 · 5,95 · 6,13 · 5,22 |
| **accent-foreground / accent · accent-hover** (4,5) | **8,68 · 7,04** | **10,33 · 11,71** |
| accent-text / raised · bg · surface · hover · accent-soft (4,5) | 5,62 · 5,36 · 5,07 · 4,83 · 5,07 | 11,04 · 11,61 · 11,95 · 10,17 · 9,05 |
| success / success-soft · raised (4,5) | 4,96 · 5,52 | 8,38 · 9,67 |
| warning / warning-soft · raised (4,5) | 5,18 · 5,70 | 8,48 · 9,94 |
| danger / danger-soft · raised (4,5) | 5,05 · 5,73 | 6,02 · 6,69 |
| info / info-soft · raised (4,5) | 6,09 · 6,86 | 8,04 · 8,57 |
| tooltip-fg / tooltip-bg (4,5) | 17,99 | 17,21 |
| text-primary / segment-active (4,5) | 18,86 | 12,79 |
| ring · accent-edge / bg · raised (3, não-texto) | 3,34 · 3,50 | 10,63 · 10,10 |
| success-bar · danger-bar / raised (3, não-texto) | 3,29 · 3,91 | 7,08 · 5,81 |

Informativo: branco sobre menta 2,19 (claro) / 1,84 (escuro) — por isso o texto é preto. O preenchimento menta sobre o branco (2,09) não identifica nada sozinho: o botão é identificado pelo rótulo (8,68:1) e os controles pelo `accent-edge` (≥ 3:1). Sucesso × menta em OKLCH: matiz 145–146° × 166–168°.

## 6. Onde mudou

- `app.css`: todos os tokens acima + `--accent-edge`, `--sh-accent` (utilitário `shadow-primary`).
- Botão primário (texto preto 600, `shadow-primary`); Checkbox (check `accent-foreground`, borda `accent-edge`); Switch (contorno `accent-edge`); Input/ChipInput/Select em foco; WeekdayPicker; abas do drawer; cards e chips selecionados do editor; faixa de arrastar.
- Barra lateral: **pílula menta de 3 × 16 px** no item ativo (como o NavigationView do Windows 11).
- EmptyState de primeiro uso ("Vamos proteger seus arquivos") com tile menta.
- `src/main/window.ts` (`THEME_COLORS`) e `src/main/tray-panel.ts` (`PANEL_BG`) com os novos `bg`/`surface-raised`/`text-secondary`.

## 7. Fontes

- Spotify: [análise do sistema](https://cdn.jsdelivr.net/npm/oh-my-opencode@4.18.2/dist/skills/frontend/references/design/spotify.md) · Supabase: [análise](https://cdn.jsdelivr.net/npm/oh-my-opencode@4.18.2/dist/skills/frontend/references/design/supabase.md), tokens reais [light.css](https://github.com/supabase/supabase/blob/master/packages/ui/build/css/themes/light.css) / [dark.css](https://github.com/supabase/supabase/blob/master/packages/ui/build/css/themes/dark.css)
- NVIDIA: [análise do sistema](https://open-design.ai/plugins/design-system-nvidia/) · Robinhood: [a filosofia do verde](https://youmind.com/landing/x-viral-articles/robinhood-green-branding-design-philosophy)
- Linear: [custom themes](https://linear.app/docs/custom-themes), [análise](https://opendesigner.io/design-systems/linear-app) · Raycast: [análise](https://open-design.ai/plugins/design-system-raycast/) · Warp: [custom themes](https://docs.warp.dev/terminal/appearance/custom-themes)
- 1Password 8: [Knox e modo escuro](https://1password.com/blog/1password-8-for-windows-dark-mode-edition) · Proton: [temas Carbon/Ebony](https://proton.me/support/dark-mode) · GitHub: [Primer](https://primer.style/foundations/color)
- Material: [Dark theme — tons 200, sem saturação, cores "on"](https://developer.android.com/design/ui/wear/guides/m2-5/styles/color) · WCAG 2.2: [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) e [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast)
