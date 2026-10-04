# BC Backup — guia para o Claude

Gerenciador de backups de marca própria (BC Backup). App desktop Electron + React + TypeScript + Tailwind v4,
Windows primeiro (também macOS/Linux). Interface e textos em **português do Brasil**.

## Preferências do dono do projeto

- Interface **minimalista, moderna e bonita** — "dá gosto de ver". Modo claro e escuro sempre.
- **Identidade visual oficial: preto, verde (menta) e branco**, a partir do ícone em `build/brand/icone-original.png`
  (tokens em `docs/research/06-identidade-preto-verde.md`). Nada de azul como cor de marca.
- **Integridade acima de tudo:** verificação completa (sha256 relendo o destino) sempre; nada é apagado da origem
  sem cópia conferida em todos os destinos.
- **Estrutura no destino:** `<pasta escolhida>/<AAAA-MM-DD_HH-mm-ss>/arquivos` (ou `.zip`). O nome da rotina
  NÃO vira pasta. Várias origens → uma subpasta por origem dentro da pasta datada.
- Para qualquer trabalho de interface nova (telas, componentes, redesign), **dispare agentes em paralelo
  para pesquisar referências de interface** antes de implementar (ex.: Linear, Raycast, Vercel, Fluent/Windows 11,
  macOS) e siga o design system em `docs/research/02-design-system.md`.
- Para funcionalidades novas, pesquise como programas parecidos resolvem (Cobian, Iperius, Duplicati, FreeFileSync,
  SyncBack, Veeam…) — veja `docs/research/01-concorrentes-e-funcionalidades.md`.
- Trabalhe com vários agentes em paralelo quando as partes forem independentes.

## Estrutura

- `src/shared/` — tipos de domínio, contrato IPC (`api.ts`), cálculo de agendamento, formatação. Sem dependências de Node/DOM.
- `src/main/` — processo principal: janela, bandeja, inicialização com o sistema, agendador, motor de backup,
  retenção, e-mail (SMTP), persistência JSON.
- `src/preload/` — expõe `window.bc` (ver `BcApi` em `src/shared/api.ts`).
- `src/renderer/` — interface React.
- `docs/research/` — pesquisas que embasam produto, design e arquitetura.

## Regras

- O renderer só fala com o main via `window.bc` (contextIsolation + sandbox). Nada de `nodeIntegration`.
- Mudou um tipo em `src/shared/types.ts`? Campos novos opcionais ou migração em `src/main/store.ts`.
- Senha SMTP nunca volta para o renderer (`hasPassword` apenas); guardada com `safeStorage`.
- Rode `npm run typecheck`, `npm run lint` e `npm test` antes de commitar.
