# BC Backup: pesquisa de concorrentes e especificação de funcionalidades (v1)

> Data: 04/10/2026. Escopo: gerenciador de backup desktop (Windows primeiro, depois macOS/Linux), Node/Electron, sem nuvem. Público: técnico de TI que instala o programa em computadores de clientes. As fontes estão na seção 11.

## 0. Resumo executivo

- **O modelo do dono é o certo:** rotina = origens → **N destinos**, com um backup datado por execução em cada destino. Só o Iperius e o Cobian fazem "vários destinos por rotina" de forma nativa, e o PCWorld cita isso como o ponto alto do Iperius. Esse é o nosso diferencial.
- **Formato padrão:** pasta datada com cópia simples (`BC Backup/<Rotina>/2026-10-04_14-30-00/`), que qualquer pessoa abre no Explorer. **Opcional:** ZIP por execução. Nada de formato proprietário: o banco do Duplicati que corrompe e leva dias para ser recriado é a maior reclamação do produto.
- **Retenção:** "manter N dias" (pedido do dono) + **"manter sempre no mínimo M backups"** (Duplicati, AOMEI, FreeFileSync e Time Machine têm essa trava). A limpeza só roda **depois** de um backup bem-sucedido naquele destino.
- **Agendamento interno** (app na bandeja que inicia com o sistema): dias da semana + horários, a cada N horas (com janela), ao iniciar, ou manual. Uma execução atrasada roda **uma única vez** ao ligar o PC.
- **E-mail:** uma conta SMTP global (com presets brasileiros) e, em cada rotina, destinatários e eventos (sucesso, aviso, falha). Botão "Enviar e-mail de teste" e mensagens de erro traduzidas. **Outlook.com/Hotmail pessoal não funciona com senha desde 16/09/2024** (exige OAuth2, fica para a v2). Gmail funciona com "Senha de app".
- **Falha tem que ser barulhenta:** ícone da bandeja vermelho, aviso do sistema e e-mail. O Time Machine ficou conhecido por falhar em silêncio por semanas.

## 1. Panorama dos concorrentes

### 1.1 Modelo, agendamento, retenção e destinos

| Produto | Modelo de rotina | Agendamento | Retenção / rotação | Destinos |
|---|---|---|---|---|
| **Cobian Reflector** (grátis, Win, .NET) | Tarefa: origens → destinos (vários); full/incremental/diferencial/"dummy"; compressão e criptografia opcionais | Uma vez, diário, semanal, mensal, anual, timer (X min), manual; "Run missed backups"; "Run all tasks when starting up" | "Full copies to keep" (por contagem) + diferenciais; **PARK** protege uma cópia da exclusão | Local, rede, FTP/SFTP |
| **Iperius Backup** (Free a Full; popular no BR) | Job: itens + **vários destinos**, cada destino com opções próprias (ZIP, nº de cópias); full/incremental/diferencial | Dias da semana, dias do mês (inclusive o último), dias específicos, a cada N dias/h/min; **vários horários por dia**; pode rodar como serviço | **"Número de cópias"** por destino: no fim do ciclo, sobrescreve as pastas mais antigas | Free: só local/USB/NAS/rede. Pagos: FTP, nuvem, fita |
| **Duplicati** (open source, UI web) | Job: origem → 1 destino; blocos deduplicados e criptografados (formato próprio + BD local) | "Executar a cada X" + horário + dias permitidos; roda os perdidos ao abrir | Manter tudo / apagar mais antigos que X / manter N versões / **Inteligente** `1W:1D,4W:1W,12M:1M` / personalizada; **nunca apaga a última versão** | Local, rede, S3, B2, SFTP, WebDAV, nuvens |
| **FreeFileSync + RealTimeSync** | Par de pastas: comparar → sincronizar (espelho/atualizar/2 vias); "versionamento" guarda apagados e substituídos | **Sem agendador próprio** (usa Agendador de Tarefas, cron ou launchd); RealTimeSync dispara quando um arquivo muda | Versionamento: **últimos X dias + mínimo + máximo de versões** (combináveis); nomes "Time stamp [Folder]" | Local, rede, (S)FTP, Google Drive, MTP |
| **SyncBack** (Free/SE/Pro) | Perfil backup/sync/espelho; modos Easy e Expert | Usa o Agendador do Windows; "rodar se perdido" (ligado por padrão); acordar o PC; com ou sem login | Versionamento (Pro) | Local, rede, FTP, nuvens (Pro) |
| **GoodSync** (assinatura) | Job sync/backup; versões em `_gsdata_` | Ao mudar arquivo, ao conectar pasta/USB, ao iniciar, periódico, no logoff, por agenda | `_saved_` limpo após **30 dias** (padrão); `_history_` com várias versões e limpeza após N dias | Local, rede, FTP/SFTP, nuvens |
| **Veeam Agent Free** | **Só 1 job** (imagem, volume ou arquivos) | Diário em horário ou dias da semana; eventos: bloquear tela, logoff, **ao conectar o destino** | **N dias contando só dias com backup bem-sucedido** (mantém N+1); PC desligado não "gasta" dias | Local, USB, NAS/rede |
| **EaseUS Todo Backup** | Planos de backup (imagem/arquivos) | Uma vez, diário, semanal, mensal, por evento | "Image-reserve strategy": apaga imagens antigas por regra | Local, rede, nuvem |
| **AOMEI Backupper** | Tarefa imagem/arquivos/sync | Diário, semanal, mensal, evento, USB | Backup Scheme: por quantidade, por tempo, diário/semanal/mensal, por espaço; **sempre resta 1 versão válida**; **só nas edições pagas** | Local, rede, nuvem |
| **Macrium Reflect** (Free descontinuado em 01/2024) | Definição + plano com **templates** (GFS, Incremental Forever, Diferencial) | Agendas separadas para full/dif/inc | Regras por tipo: N backups **ou** N dias/semanas | Local, rede |
| **Backup4all** | Tipos Smart/Full/Dif/Inc e **Mirror** (pasta sem ZIP, abre no Explorer); "teste" e "limpeza" são operações próprias | Agendador próprio | Número de versões / limpeza "Smart" | Local, USB, rede, FTP, nuvens |
| **Time Machine** (macOS) | Uma configuração para tudo, com exclusões | A cada hora (padrão); diário ou semanal desde o Ventura | Hora a hora por 24 h, diários por 1 mês, semanais até encher o disco; com o disco cheio, apaga o mais antigo | Disco externo, NAS (SMB) |
| **Histórico de Arquivos** (Windows) | Bibliotecas do usuário (**no Win 11 não dá para adicionar pastas**) | De 10 min a diário (padrão 1 h) | Para sempre (padrão), 1 mês…2 anos, "até precisar de espaço" | Disco externo, rede |

### 1.2 Notificações, logs, elogios e reclamações

| Produto | E-mail | Logs / histórico | Elogios | Reclamações (UI em destaque) |
|---|---|---|---|---|
| **Cobian** | SMTP completo: nome e e-mail do remetente, assunto, corpo, SSL, autenticação, "ignorar avisos de certificado", timeout. Envia diário, por tarefa ou por backup; anexa log compactado; opção "só se houver erros" | Log diário em arquivo, exibido em tempo real; apaga logs antigos | Grátis, muitas opções, criptografia | UI datada, nomes de função pouco claros, lento, futuro incerto, VSS exige .NET 3.5 |
| **Iperius** | Conta SMTP reutilizável entre jobs; condições: sempre, só em erro, tamanho acima de X, nenhum arquivo copiado; **variáveis no assunto** (nome do PC, resultado); Cco; **botão de teste**. Gmail exige criar OAuth no Google Cloud Console | Log por execução | Vários destinos por job; Free completo; agenda granular | UI "às vezes desconcertante"; botões minúsculos; textos sem tradução; **progresso some atrás da janela**; **nome e destinos extras só depois do assistente** |
| **Duplicati** | `send-mail-level` (Success/Warning/Error/Fatal); assunto com `%PARSEDRESULT%`, `%backup-name%` | Log por job na UI web | Grátis, criptografia, nuvem | BD local corrompe; recriar leva dias; restauração lenta; ao abrir, roda todos os jobs atrasados de uma vez |
| **FreeFileSync** | Só na Donation Edition, enviado pelo servidor da FFS (sem SMTP próprio) | Log por sincronização | Rápido, grátis, multiplataforma | Conceitos confusos (Comparar × Sincronizar; 3 tipos de arquivo `.ffs_gui/.ffs_batch/.ffs_real`); sem pausa; agendamento externo |
| **SyncBack** | SMTP + Gmail OAuth / Outlook; "só em erro" ou sempre; variáveis (`%PROFILENAME%`); **configurações compartilhadas** entre perfis; botão de teste; reenvia sem anexo se o log for grande | Log HTML por perfil | Muito configurável, boa documentação | "Opções demais", intimidante para iniciantes |
| **Veeam Free** | Notifica em Sucesso, Aviso e Erro; **detecta o SMTP sozinho a partir do e-mail**; "Configure and test" | Painel na bandeja com **gráfico de barras por sessão**; clicar mostra duração, tamanho e espaço livre | Estável, simples; **ejeta a mídia após o backup** (proteção contra ransomware) | Só 1 job; códigos de erro pouco claros |
| **EaseUS** | Assunto com nome do PC + nome do plano; sucesso/falha; Google, Microsoft ou personalizado | — | Interface amigável | **Propaganda de upgrade a cada abertura**; assinatura |
| **AOMEI** | E-mail disponível na Standard | — | Fácil | **Retenção automática só nas pagas**; diferencial pago |
| **Macrium** | SMTP manual ou OAuth Gmail/O365; SSL/TLS/STARTTLS; **assunto e corpo próprios para Sucesso, Aviso e Falha**, com variáveis inseridas por `{`; anexa log HTML | Logs HTML | Confiável; templates GFS | Free descontinuado |
| **Backup4all** | Sucesso/aviso/erro para backup, teste e limpeza; templates em texto ou HTML com cerca de 30 macros (`<#BACKUP_NAME>`, `<#NBR_ERRORS>`, `<#REMAINING_DISC_SPACE>`, `<#SCHED_NEXT_EXECUTION>`…) | Histórico por job | Modo Mirror acessível pelo Explorer | — |
| **Time Machine** | Não tem | Data do último backup no menu | Zero configuração | **Falha silenciosa por semanas ou meses** |
| **Histórico de Arquivos** | Não tem | — | Nativo | Win 11 não deixa adicionar pastas (empurra para o OneDrive) |

### 1.3 O que copiar (decisões tiradas da pesquisa)

1. **Vários destinos por rotina** (Iperius), mas com **tudo configurado no assistente** (corrigindo a reclamação do PCWorld).
2. **Mínimo de versões que nunca se apaga** (Duplicati, AOMEI, FFS) e **retenção grátis e simples** (no AOMEI ela é paga).
3. **Uma conta SMTP compartilhada** (SyncBack, Iperius), **eventos Sucesso/Aviso/Falha** (Veeam, Macrium, Backup4all) e **variáveis em assunto e corpo** (Backup4all, Macrium).
4. **Execução perdida roda uma vez, sem disparar tudo ao mesmo tempo** (corrige a reclamação do Duplicati).
5. **Histórico visual por sessão** (gráfico de barras do Veeam) e **pasta aberta no Explorer** (Mirror do Backup4all, nomes com data do Cobian/FFS).
6. **Detectar destino conectado / letra trocada** (evento "ao conectar o destino" do Veeam; "ao conectar USB" do GoodSync).

## 2. Escopo: v1 × v2

### 2.1 v1, obrigatório

| # | Funcionalidade | Observação |
|---|---|---|
| 1 | **Rotinas:** criar, editar, duplicar, excluir, **pausar/retomar** | Assistente de 4 passos; o nome é o primeiro campo |
| 2 | **Origens:** várias pastas e/ou arquivos | Cada origem vira uma subpasta com rótulo editável |
| 3 | **Filtros incluir/excluir** (glob) + exclusões padrão | `*.tmp`, `~$*`, `Thumbs.db`, `desktop.ini`, `.DS_Store`, `$RECYCLE.BIN`, `System Volume Information` |
| 4 | **Vários destinos** (disco interno, USB, unidade mapeada, caminho UNC `\\servidor\pasta`) | Cada destino tem status próprio |
| 5 | **Pasta datada** (padrão) e **ZIP** (opcional) | Seção 3 |
| 6 | **Verificação da cópia:** rápida (tamanho + data) por padrão; completa (hash relendo o destino) opcional | No ZIP, testar o CRC de cada entrada |
| 7 | **Checagem de espaço livre** antes de copiar + aviso abaixo de um limite | `fs.statfs` (Node ≥ 18.15) |
| 8 | **Agendamento interno** + **iniciar com o sistema** + bandeja | Seção 5 |
| 9 | **Recuperar execução perdida** ao iniciar ou acordar | Uma vez por rotina, em fila |
| 10 | **Executar agora** e **Cancelar** | Progresso no card da rotina e na bandeja |
| 11 | **Retenção por dias + mínimo garantido** | Seção 6 |
| 12 | **E-mail SMTP** (conta global + destinatários por rotina), **Sucesso/Aviso/Falha**, **Enviar teste**, presets, fila com nova tentativa | Seção 7 |
| 13 | **Histórico** (lista + detalhe por destino + log) e "**Abrir pasta do backup**" | Guardar 180 dias |
| 14 | **Status geral** no painel e ícone da bandeja (ok / executando / erro) + notificação do sistema | Contra falhas silenciosas |
| 15 | **Tema claro/escuro/automático** | Segue o sistema por padrão |
| 16 | **Validações do assistente:** destino dentro da origem (bloquear); destino no mesmo disco físico da origem (avisar) | Evita recursão e falsa segurança |
| 17 | **Arquivos em uso** viram aviso (não falha), com lista no log | Ex.: `.pst` com o Outlook aberto, bancos Firebird |
| 18 | **Instância única**; impedir suspensão do PC durante o backup | `requestSingleInstanceLock`, `powerSaveBlocker` |

### 2.2 v1, se sobrar tempo (baratos e úteis para o técnico)

- **Achar o destino quando a letra do USB muda:** arquivo-marcador `.bcbackup-destino.json` na raiz do destino; se o caminho sumir, procurar o marcador em todas as unidades.
- **Proteger configurações com senha/PIN** (o cliente não altera nem apaga rotinas).
- **Exportar/importar configurações** (JSON sem senhas) para replicar o setup em outros clientes.
- "Nome do cliente" e "apelido do computador" nas configurações (aparecem nos e-mails).

### 2.3 v2+

Restaurar por assistente · **incremental com hardlinks** (cada pasta parece completa, mas só os arquivos alterados ocupam espaço; NTFS/ext4/APFS, não exFAT/FAT32) · **VSS** para arquivos abertos · comandos antes/depois (ex.: parar o serviço do banco) · serviço do Windows (rodar sem login) e acordar o PC · OAuth2 Gmail/Microsoft · resumo semanal por e-mail e "alerta de backup atrasado" · agenda mensal · retenção GFS e "máximo de backups" · proteger um backup específico (PARK do Cobian) · ZIP com senha (AES) · ejetar USB após o backup · credenciais de rede próprias · SFTP/FTP/S3 · console central do técnico.

## 3. Modos de backup

| | **Pasta datada (PADRÃO)** | **ZIP (OPCIONAL)** |
|---|---|---|
| Resultado | `…/2026-10-04_14-30-00/<origem>/…` | `…/2026-10-04_14-30-00.zip` |
| Restaurar | Copiar e colar no Explorer | Abrir ou extrair o ZIP |
| Prós | Simples, robusto, sem dependências; arquivo corrompido afeta só ele | Menos arquivos (bom para USB lento); menor (texto e planilhas) |
| Contras | Ocupa 100% a cada execução (mitigado pelos hardlinks da v2) | CPU; um ZIP corrompido perde tudo; >4 GB exige ZIP64 |
| Lib Node | `fs` streams + `p-limit` (4 cópias em paralelo) | `archiver` (zip64, nível 0–9, padrão 6) + `yauzl` para verificar |

**Estrutura em disco** (nome sem `:`, que o Windows não aceita; ordenável como texto):

```
E:\BC Backup\Financeiro diário\
  .bcbackup-rotina.json                 # id da rotina (evita apagar pasta de outra rotina com o mesmo nome)
  2026-10-03_14-30-00\  bcbackup-manifesto.json  Documentos\…  Planilhas\…
  2026-10-04_14-30-00.em-andamento\     # renomeada para o nome final só no sucesso
```

`bcbackup-manifesto.json` = `{ routineId, snapshotId, startedAt, finishedAt, status, mode, files, bytes, verify, appVersion }`. **A retenção só considera pastas ou ZIPs com manifesto válido e `routineId` igual ao da rotina**, então nunca apaga arquivos do usuário. As sobras `.em-andamento` de execuções que caíram são apagadas no início da próxima execução.

**Fluxo de uma execução (por destino, em sequência):** 1) destino acessível? (procurar pelo marcador) → 2) varrer as origens com os filtros e somar bytes → 3) espaço livre ≥ bytes × 1,05? → 4) copiar para `.em-andamento`, preservando a data de modificação (`fs.utimes`) → 5) verificar → 6) gravar o manifesto e renomear → 7) **retenção** (só se 1–6 deram certo) → 8) registrar o histórico → ao fim de todos os destinos: **um e-mail consolidado**.

**Status:** `success` = tudo copiado em todos os destinos · `warning` = concluído, mas com arquivos pulados (em uso, sem permissão, caminho longo) ou espaço abaixo do limite · `failure` = origem ausente, **qualquer destino indisponível ou que falhou**, sem espaço ou erro de verificação · `canceled`.

## 4. Modelo de dados (TypeScript)

```ts
interface Routine {
  id: string; name: string;            // nome único, 1–60 caracteres (vira nome de pasta: sanitizar \/:*?"<>|)
  enabled: boolean;                    // false = "Pausada"
  sources: { id: string; path: string; kind: 'folder' | 'file'; label: string }[];
  destinations: Destination[];         // 1..N, executados em sequência
  mode: 'folder' | 'zip'; zipLevel: number;          // padrão 'folder'; zipLevel 6
  filters: { include: string[]; exclude: string[]; maxFileSizeMB: number | null; skipHidden: boolean; skipSystem: boolean };
  verify: 'quick' | 'full';            // padrão 'quick'
  schedule: Schedule; retention: Retention; notification: RoutineNotification;
  createdAt: string; updatedAt: string;
}
interface Destination {
  id: string; path: string;            // "E:\\" ou "\\\\SERVIDOR\\backup"
  label: string;                       // "HD externo azul"
  enabled: boolean;
  warnFreeBelowGB: number;             // padrão 10
}
interface Schedule {
  type: 'manual' | 'weekly' | 'interval' | 'startup';
  weekdays: number[];                  // 0=dom…6=sáb; 'weekly' com os 7 = "Todos os dias"; também filtra 'interval'
  times: string[];                     // "HH:mm", 1–6 horários (para 'weekly')
  intervalMinutes: number | null;      // 'interval': 15, 30, 60, 120, 240, 360, 720
  window: { start: string; end: string } | null;    // 'interval': ex. 08:00–18:00
  startupDelayMinutes: number;         // 'startup': padrão 5
  catchUpMissed: boolean;              // padrão true
  catchUpDelayMinutes: number;         // padrão 3
}
interface Retention { keepDays: number; minKeep: number }   // padrões 7 e 3; keepDays 0 = nunca apagar
interface RoutineNotification {
  enabled: boolean; to: string[]; bcc: string[];             // bcc: ex. e-mail do técnico
  onSuccess: boolean; onWarning: boolean; onFailure: boolean; // padrão: os três ligados
  attachLog: 'never' | 'onFailure' | 'always';               // padrão 'onFailure'
  smtpAccountId: string | null; subjectTemplate: string | null; // null = usa o padrão global
}
interface SmtpAccount {
  id: string; preset: 'gmail' | 'office365' | 'hostinger' | 'locaweb' | 'uol' | 'kinghost' | 'hostgator' | 'custom';
  host: string; port: number; security: 'ssl' | 'starttls' | 'none';
  username: string; passwordEnc: string;                     // Electron safeStorage (DPAPI/Keychain/libsecret)
  fromName: string; fromEmail: string; replyTo: string | null;
  allowInvalidCert: boolean; timeoutSec: number;             // false; 30
}
interface RoutineState { routineId: string; lastAttemptSlot: string | null; lastRunAt: string | null;
  lastSuccessAt: string | null; lastStatus: RunStatus | null; nextRunAt: string | null }
type RunStatus = 'running' | 'success' | 'warning' | 'failure' | 'canceled';
interface RunRecord {
  id: string; routineId: string; trigger: 'schedule' | 'manual' | 'catchup' | 'startup';
  startedAt: string; finishedAt: string | null; status: RunStatus;
  destinations: { destinationId: string; snapshotPath: string | null; status: RunStatus; files: number; bytes: number;
    skipped: { path: string; reason: string }[]; errors: { path?: string; code: string; message: string }[];
    freeBytesAfter: number | null; deletedSnapshots: string[] }[];
  email: 'not_configured' | 'sent' | 'queued' | 'failed';
}
interface AppSettings { clientName: string; computerAlias: string; theme: 'system' | 'light' | 'dark';
  startWithSystem: boolean; closeToTray: boolean; maxConcurrentRuns: 1; historyDays: number; adminPinHash: string | null }
```

Persistência sugerida: configuração em JSON (`electron-store`) e histórico em SQLite (`better-sqlite3`) ou NDJSON. **O histórico nunca é necessário para restaurar**: manifesto e pastas bastam.

## 5. Agendamento

**Opções na UI:** "Somente manual" · "Em dias e horários" (chips Dom–Sáb + "Todos os dias" / "Dias úteis" + até 6 horários) · "A cada N horas/minutos" (+ dias + janela opcional) · "Ao iniciar o computador" (+ atraso). Abaixo do formulário, sempre mostrar: **"Próximas execuções: hoje 18:30, amanhã 12:00, …"**.

**Motor:** um *tick* a cada 30 s (sem `setTimeout` longo, que atrasa com suspensão) + reavaliação em `powerMonitor.on('resume')`. Hora local; usar `date-fns`/`luxon` para não errar se o horário de verão voltar. Fila global com `maxConcurrentRuns = 1`. Se a rotina já estiver rodando quando chegar o horário, pular e registrar "ignorada: execução anterior em andamento".

**Recuperar execução perdida:**

```
ao iniciar o app, ao acordar e a cada tick, para cada rotina habilitada (weekly | interval):
  slot = último horário agendado <= agora
  se slot existe e slot > state.lastAttemptSlot:
     se agora - slot <= 2 min      -> executar (trigger 'schedule')
     senão se catchUpMissed        -> enfileirar UMA vez (trigger 'catchup') após catchUpDelayMinutes
     senão                         -> registrar "execução perdida" no histórico
     state.lastAttemptSlot = slot   # vários horários perdidos geram uma única recuperação
```

**Iniciar com o sistema:** `app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })` no Windows e macOS; no Linux, `~/.config/autostart/bc-backup.desktop`. Fechar a janela **minimiza para a bandeja**: na primeira vez, mostrar a dica "O BC Backup continua rodando aqui". "Sair" pede confirmação ("Os backups agendados não serão executados"). Limitação da v1: só roda com o usuário logado (o serviço fica para a v2).

## 6. Retenção

**UI:** "Manter backups dos últimos **[7]** dias" + "Manter sempre no mínimo **[3]** backups" (em "Avançado") + uma prévia: "Hoje há 8 backups; após o próximo, 1 será excluído (03/10)".

**Algoritmo** (por destino, só após um backup `success`/`warning` **naquele destino**):

```
snaps  = backups com manifesto válido, routineId igual e status concluído, ordenados do mais novo para o mais antigo
corte  = inícioDoDia(hoje) - (keepDays - 1) dias        # keepDays=7 no dia 08 -> mantém 02..08
manter = snaps com startedAt >= corte
cands  = snaps com startedAt <  corte                    # do mais novo para o mais antigo
faltam = max(0, minKeep - |manter|)
salvar os 'faltam' primeiros de cands; os demais: renomear para ".excluindo" e depois rm -r (do mais antigo ao mais novo)
registrar cada exclusão no RunRecord.deletedSnapshots
```

| Cenário (keepDays=7, minKeep=3) | Resultado |
|---|---|
| Diário, dia 08 (backups d01–d08) | Exclui d01, mantém d02–d08 (7 dias, como o dono pediu) |
| 2× ao dia | Mantém os 14 dos últimos 7 dias; exclui os 2 de d01 |
| PC desligado de d12 a d21; backup em d22 | Mantém d22 + **d10 e d11** (mínimo 3); exclui d05–d09. Sem o mínimo, sobraria só 1 |
| Backup de hoje falhou | **Nada é excluído** |
| Destino B falhou, C ok | Retenção roda só em C |

Escolhemos dias **de calendário** (fácil de explicar ao cliente) em vez dos "dias com backup" do Veeam. O `minKeep` cobre o caso do PC desligado.

## 7. Notificação por e-mail

**Conta (Configurações › E-mail):** Provedor (preset) · Servidor SMTP · Porta · Segurança (SSL/TLS · STARTTLS · Nenhuma) · Usuário · Senha · Nome do remetente (ex.: "BC Backup – Padaria Pão Quente") · E-mail do remetente · Responder para · "Ignorar erros de certificado" · botão **Enviar e-mail de teste** (usa os valores do formulário antes de salvar). Mapeamento no Nodemailer: `ssl` → `secure: true`; `starttls` → `secure: false, requireTLS: true`; `none` → `ignoreTLS: true`. Avisar que **o remetente deve ser o próprio e-mail autenticado** (muitos provedores recusam outro).

**Na rotina:** Destinatários (vários) · Cópia oculta · Enviar quando: ☑ Sucesso ☑ Concluído com avisos ☑ Falha · Anexar log: Nunca / Só em falha / Sempre. **Fila de saída:** se o envio falhar (sem internet), tentar de novo a cada 15 min por até 24 h. O resultado aparece no histórico.

**Presets:**

| Preset | Servidor | Porta / segurança | Observação na UI |
|---|---|---|---|
| Gmail (pessoal) | `smtp.gmail.com` | 465 SSL (alt. 587 STARTTLS) | Exige **verificação em 2 etapas + Senha de app** (16 letras); a senha de app é revogada quando a senha da conta muda; contas Workspace podem não ter a opção |
| Microsoft 365 (empresa) | `smtp.office365.com` | 587 STARTTLS | SMTP AUTH com senha vai até o fim de 12/2026; depois fica desligado por padrão (o admin pode religar); OAuth na v2 |
| Outlook.com / Hotmail | `smtp-mail.outlook.com` | 587 STARTTLS | **Não suportado na v1**: a Microsoft exige OAuth2 desde 16/09/2024 |
| Hostinger | `smtp.hostinger.com` | 465 SSL (alt. 587 STARTTLS) | Usuário = e-mail completo |
| Locaweb | `email-ssl.com.br` | 587 STARTTLS (recomendado) / 465 SSL | |
| UOL | `smtps.uol.com.br` | 587 STARTTLS / 465 SSL | Atenção ao **"s"** em `smtps` |
| KingHost | `smtpi.kinghost.net` | 587 STARTTLS | Confirmar no painel do cliente |
| HostGator Brasil | `mail.<seudominio>.com.br` | 465 SSL (alt. 587) | O servidor depende do domínio |
| Personalizado | — | — | Todos os campos livres |

**Variáveis** (`{{…}}`, formatação pt-BR: `04/10/2026 14:30`, `4,2 GB`): `{{rotina}}` `{{status}}` (SUCESSO / AVISO / FALHA) `{{cliente}}` `{{computador}}` `{{usuario}}` `{{data}}` `{{hora}}` `{{inicio}}` `{{fim}}` `{{duracao}}` `{{arquivos}}` `{{tamanho}}` `{{avisos}}` `{{erros}}` `{{destinos}}` (lista com status e espaço livre) `{{lista_erros}}` (até 20 itens) `{{backups_mantidos}}` `{{backups_excluidos}}` `{{proxima_execucao}}` `{{versao}}`.

**Assunto padrão:** `[BC Backup] {{status}} – {{rotina}} – {{cliente}} ({{computador}}) – {{data}} {{hora}}`. O prefixo fixo facilita filtros no Gmail.

**Corpo padrão** (HTML simples que funciona no celular + versão em texto):

```
O backup "{{rotina}}" do computador {{computador}} ({{cliente}}) terminou: {{status}}.
Início {{inicio}} · Fim {{fim}} · Duração {{duracao}}
Arquivos copiados: {{arquivos}} ({{tamanho}}) · Avisos: {{avisos}} · Erros: {{erros}}
Destinos:
{{destinos}}            ex.: "• E:\ (HD externo azul): OK, 120,4 GB livres"
Backups guardados: {{backups_mantidos}} · Excluídos pela retenção: {{backups_excluidos}}
Próxima execução: {{proxima_execucao}}
{{lista_erros}}
Enviado automaticamente pelo BC Backup {{versao}}.
```

**Erros SMTP traduzidos (no teste e no histórico):**

| Erro técnico | Mensagem |
|---|---|
| `EAUTH` / 535 | "Usuário ou senha recusados. No Gmail, use uma *Senha de app*, não a senha normal." |
| `wrong version number` (SSL) | "A porta e a segurança não combinam: 465 = SSL; 587 = STARTTLS." |
| `ETIMEDOUT` / `ECONNREFUSED` | "Sem conexão com o servidor. Verifique servidor, porta e firewall/antivírus." |
| `ENOTFOUND` | "Servidor não encontrado. Confira o endereço e a internet." |
| 550/553 remetente | "Remetente recusado: use como remetente o mesmo e-mail da conta." |
| certificado inválido | "Certificado do servidor inválido. Só marque 'Ignorar erros de certificado' se confiar no servidor." |

## 8. Glossário da UI (pt-BR)

| Conceito | Termo na UI | Evitar |
|---|---|---|
| Job / profile / task | **Rotina** (lista: "Rotinas") | Job, Tarefa, Perfil |
| Source | **Origem** ("O que copiar") | Fonte |
| Destination | **Destino** ("Onde salvar") | Target, Repositório |
| Snapshot / versão | **Backup** (ex.: "backup de 04/10 14:30"); plural "Backups guardados" | Snapshot, Ponto de restauração |
| Schedule | **Agendamento** ("Quando executar") | Scheduler, Timer |
| Run now / Cancel | **Executar agora** / **Cancelar execução** | Rodar, Abortar |
| Pause / resume | **Pausar** / **Retomar** (status: "Pausada") | Desativar |
| Retention | **Retenção** ("Por quanto tempo guardar") | Purge, Prune, Limpeza |
| Min. keep | **Manter sempre no mínimo N backups** | — |
| Missed run | **Backup atrasado** ("Executar backups atrasados ao ligar o computador") | Missed, Execução perdida |
| History / log | **Histórico** / **Detalhes da execução** (log) | Sessões, Eventos |
| Notifications | **Notificações** › **Destinatários**, **Remetente**, **Servidor de envio (SMTP)** | — |
| Test email | **Enviar e-mail de teste** | — |
| Filters | **Filtros**: **Incluir** / **Excluir** | Máscaras, Regex |
| Verify | **Verificar cópia** (Rápida / Completa) | Checksum, Hash |
| Copy modes | **Pastas (cópia simples)** / **Compactar em ZIP** | Mirror, Full, Archive |
| Status | **Sucesso** · **Concluído com avisos** · **Falha** · **Em andamento** · **Cancelado** | Warning, Error |
| Next / last run | **Próxima execução** / **Última execução** | — |
| Disk missing | **Destino indisponível** ("Conecte o disco HD externo azul") | Path not found |
| File in use | **Arquivo em uso (ignorado)** | Locked, Sharing violation |
| Tray | **Área de notificação** (perto do relógio) | Systray |
| Settings / Theme | **Configurações** / **Tema: Claro · Escuro · Automático** | Preferências |
| Restore | **Abrir backup** (v1) / **Restaurar** (v2) | Recover |

## 9. Telas (resumo)

- **Painel:** faixa de status geral ("Tudo certo · último backup há 2 h" / "1 rotina com falha"). Um card por rotina com nome, chip de status, "Última: ontem 14:30 (Sucesso)", "Próxima: hoje 14:30", destinos com barra de espaço livre, botões **Executar agora** · **Pausar** · ⋯ (Editar, Duplicar, Histórico, Excluir). Embaixo, uma barra dos últimos 14 dias colorida por status (ideia do Veeam).
- **Assistente de rotina:** 1 Nome + Origens (Filtros em "Avançado") → 2 Destinos (espaço livre, avisos) → 3 Agendamento + Retenção (com prévia) → 4 Notificações (teste) → Resumo + "Salvar e executar agora".
- **Histórico:** tabela com filtros por rotina e status; um painel lateral mostra a linha do tempo por destino, os arquivos pulados e erros com a ação sugerida, "Abrir pasta", "Copiar log" e "Salvar .txt".
- **Bandeja:** ícone com 3 estados (normal / girando / vermelho); menu com Abrir, Executar rotina ▸, Pausar todas, Sair. Notificação do sistema só em falha (e em sucesso, se a pessoa quiser).

## 10. As 10 armadilhas de UX dos concorrentes que devemos evitar

1. **Opções demais à vista** (SyncBack "intimidante", Iperius "desconcertante"). Usar assistente de 4 passos e mostrar o avançado só sob demanda; os padrões já devem servir para 90% dos casos.
2. **Falha silenciosa** (Time Machine). Falha = ícone vermelho + notificação do sistema + e-mail + faixa no painel; mostrar sempre "último backup bem-sucedido há X".
3. **Relação origem/destino espalhada e configuração incompleta no assistente** (Iperius: nome e destinos extras só depois). Tudo da rotina numa tela só, nome no primeiro passo.
4. **Vários artefatos e conceitos para um trabalho** (FFS: Comparar × Sincronizar, `.ffs_gui/.ffs_batch/.ffs_real` + RealTimeSync). Um objeto só, a "Rotina", com agendamento embutido.
5. **Janela de progresso que some atrás da principal, sem pausa ou cancelamento** (Iperius, FFS). Progresso no próprio card e na bandeja, com botão Cancelar.
6. **Execuções perdidas mal tratadas:** ou nunca rodam, ou rodam todas de uma vez ao abrir (Duplicati). Uma recuperação por rotina, em fila, com atraso, e texto claro "Executando backup atrasado de 03/10 14:30".
7. **Retenção que surpreende ou custa caro** (AOMEI só na paga; apagar antes de o novo backup terminar; ficar sem nada após dias desligado). Mínimo garantido, apagar só após sucesso e prévia do que será apagado.
8. **Erros crípticos** (Veeam "códigos de erro insuficientes"; SMTP `wrong version number`). Mensagem em pt-BR + causa provável + ação ("Conecte o disco…", "Use Senha de app…").
9. **Formato fechado ou dependência de banco para restaurar** (Duplicati: recriar o BD leva dias). Pastas e ZIP comuns + manifesto JSON; o histórico é só informativo.
10. **Agendamento terceirizado ao SO com pedido de senha do Windows** (SyncBack, FFS) e **e-mail difícil de configurar** (Gmail via Google Cloud Console no Iperius). Agendador interno, presets de SMTP, teste em 1 clique, sem anúncios nem pedidos de upgrade na máquina do cliente (EaseUS).

Bônus: a letra do USB muda (usar marcador no destino); fechar a janela não pode encerrar o app (minimizar para a bandeja); o Histórico de Arquivos do Win 11 não deixa escolher pastas (aqui qualquer pasta vale).

## 11. Fontes

- **Cobian Reflector:** [Tarefas](https://cobiansoft.com/crHelp/tasks.html) · [Opções/e-mail](https://cobiansoft.com/crHelp/options.html) · [Backups e nomes](https://www.cobiansoft.com/crHelp/backups.html) · [TechRadar review](https://www.techradar.com/reviews/cobian-backup)
- **Iperius:** [E-mail](https://www.iperiusbackup.it/33528/how-to-receive-a-notification-email-at-the-end-of-the-backup) · [Agendamento](https://www.iperiusbackup.it/33518/scheduling-automatic-backups-with-iperius-backup) · [PCWorld review](https://www.pcworld.com/article/3391364/iperius-backup-software-review.html) · [ghacks (nº de cópias)](https://www.ghacks.net/2021/03/18/iperius-backup-is-a-user-friendly-program-for-backing-up-your-files-and-folders/) · [The CTO Club](https://thectoclub.com/tools/iperius-backup-review/)
- **Duplicati:** [Retenção](https://docs.duplicati.com/configuration-and-management/retention-settings.md) · [Retenção inteligente](https://forum.duplicati.com/t/new-retention-policy-deletes-old-backups-in-a-smart-way/2195) · [E-mail](https://forum.duplicati.com/t/how-to-configure-automatic-email-notifications-via-gmail-for-every-backup-job/869) · [Jobs atrasados ao abrir](https://forum.duplicati.com/t/jobs-run-immediately-upon-launching-program-instead-of-on-schedule/20016) · [Recriação do BD](https://forum.duplicati.com/t/repair-fails-database-recreate-takes-a-ridiculously-long-time/1799)
- **FreeFileSync:** [Versionamento](https://freefilesync.org/manual.php?topic=versioning) · [Limite de versões](https://freefilesync.org/forum/viewtopic.php?p=18269) · [Agendar batch](https://freefilesync.org/manual.php?topic=schedule-batch-jobs) · [E-mail (Donation)](https://freefilesync.org/forum/viewtopic.php?p=23283) · [Confusão de novo usuário](https://freefilesync.org/forum/viewtopic.php?p=39672)
- **SyncBack:** [E-mail](https://www.2brightsparks.com/syncback/help/emailsettings.htm) · [Agendamento](https://www.2brightsparks.com/syncback/help/creatingaschedule.htm) · [Capterra](https://www.capterra.com/p/171153/SyncBackPro/reviews/)
- **GoodSync:** [Recycled/History](https://help.goodsync.com/hc/en-us/articles/34117066758541-Recycled-History) · [Auto/Timetable](https://help.goodsync.com/hc/en-us/articles/44177307674509-Timetable-formerly-Job-Automation-AUTO) · [GetApp](https://www.getapp.com/it-management-software/a/goodsync/reviews/)
- **Veeam Agent:** [Retenção](https://helpcenter.veeam.com/docs/agentforwindows/userguide/retention_days.html) · [E-mail](https://helpcenter.veeam.com/docs/agentforwindows/userguide/settings_enable_email_notifications.html) · [Eventos](https://helpcenter.veeam.com/docs/agentforwindows/userguide/scheduled_backup_events.html) · [Edições](https://helpcenter.veeam.com/docs/agentforwindows/userguide/license_editions.html) · [Painel](https://helpcenter.veeam.com/archive/agentforwindows/50/userguide/monitoring_restore_points_general.html)
- **EaseUS / AOMEI / Macrium / Backup4all:** [EaseUS Capterra](https://www.capterra.com/p/171039/EaseUS-Todo-Backup/reviews/?page=3) · [AOMEI Backup Scheme](https://www.ubackup.com/help/backup-scheme.html) · [Macrium e-mail](https://kbx.macrium.com/macrium-reflect-ltsc/email-server) · [Macrium Free encerrado](https://www.ghacks.net/?p=182006) · [B4A macros](https://backup4all.com/how-to-customize-email-notifications-kb.html) · [B4A tipos](https://www.backup4all.com/backup-types-help.html)
- **Apple / Windows:** [Time Machine](https://en.wikipedia.org/wiki/Time_Machine_(macOS)) · [Falha silenciosa](https://eclecticlight.co/2026/01/15/how-time-machine-backups-can-fail-silently/) · [Histórico de Arquivos (opções)](https://ninjaone.com/blog/file-history-retention-best-practices) · [Win 11 sem "adicionar pasta"](https://itprotoday.com/windows-11/what-you-need-to-know-about-file-history-in-windows-11)
- **E-mail/SMTP:** [Senha de app Google](https://support.google.com/accounts/answer/185833?hl=pt-BR) · [Outlook.com exige OAuth](https://support.microsoft.com/en-US/support/known-issues/modern-authentication-methods-now-needed-to-continue-syncing-outlook-email-in-non-microsoft-email-ap) · [Exchange SMTP AUTH adiado](https://office365itpros.com/2026/01/29/smtp-auth-basic-retirement/) · [Locaweb portas](https://www.locaweb.com.br/ajuda/wiki/portas-smtp/) · [UOL](https://univik.com/email-settings/uol.html) · [Hostinger](https://www.hostinger.com/support/?p=6731) · [Provedores BR (Alterdata)](https://ajuda.alterdata.com.br/shopbase/smtp-e-porta-de-provedores-de-e-mail-185212695.html) · [HostGator portas](https://hostgator.com.br/blog/como-escolher-porta-smtp/)
