# BC Backup: "Mover" (apagar da origem depois de copiar). Pesquisa e especificação v1

> Data: 04/10/2026. Pedido do dono: o sistema do cliente (ERP com Firebird/SQL) grava os próprios backups numa pasta `Backup` do disco principal. O BC Backup deve copiá-los para os discos de destino da rotina e **apagá-los da pasta original**, porque o disco principal não é lugar de backup. A verificação agora é sempre completa (sha256 na leitura e releitura do destino). As fontes estão na §9.

## 0. Decisões (resumo)

- **A opção vale para a rotina inteira** (`Routine.moveSources`). Não existe flag por origem: misturar "Mover" e "Copiar" na mesma rotina deixa a retenção apagar a última cópia do ERP (ver §2, item 8) e facilita apagar documentos do usuário por engano. A UI orienta: "crie uma rotina só para a pasta de backup do sistema".
- **Um arquivo só é apagado se** foi copiado e conferido em **todos os destinos ativos** naquela execução, com o mesmo tamanho e o mesmo sha256 em todos, e se continua idêntico na origem (tamanho, mtime e ctime) no instante da exclusão. **Se qualquer destino falhar, nada é apagado.**
- **Arquivo elegível** = sem nenhuma alteração há ≥ `minAgeMinutes` (**padrão 30**), considerando o mais recente entre mtime, ctime e birthtime, e (no Windows) sem nenhum outro programa com o arquivo aberto (abertura exclusiva). O que não é elegível **nem é copiado**: fica para a próxima execução.
- **Pastas nunca são apagadas**, nem a raiz nem as subpastas. O BC Backup só apaga arquivos que ele mesmo listou na varredura. A exclusão é **permanente** (a lixeira fica no mesmo disco e não liberaria espaço).
- **Sem arquivo novo, não há backup novo nem retenção.** O status fica em **Atenção** ("o sistema pode não ter gerado o backup"), e dá para desligar esse aviso. Assim a retenção nunca apaga a última cópia de um ERP que parou de gerar backups.
- **Auditoria:** cada arquivo apagado entra no log, no histórico (`RunRecord.move`) e no e-mail (contagem, tamanho e até 20 nomes).

## 1. Como os concorrentes fazem

| Produto | Como funciona | Proteções | Lição para nós |
|---|---|---|---|
| **Robocopy** `/MOV` `/MOVE` | Copia e apaga da origem. `/MOV` só mexe nos arquivos, `/MOVE` também nas pastas | `/MINAGE:n` em **dias**. Não verifica a cópia | `/MOV` deixa pastas vazias. `/MOVE` apaga as pastas (há relatos de que apaga até a raiz). Idade em dias é grossa demais para o nosso caso |
| **rsync** `--remove-source-files` | Apaga depois de transferir | Nenhuma: apaga sem checar se o arquivo mudou e pode gerar cópia corrompida. Desde a 3.2.6 recusa apagar arquivo compartilhado entre origem e destino | Recomenda só mover arquivos fechados ou renomeados ao terminar. Quem garante é o produtor |
| **rclone** `move` | Copia e depois apaga o original | `--min-age`, `--checksum`, `--delete-empty-src-dirs` (opcional). Avisa: "pode causar perda de dados, teste com `--dry-run`" | `--min-age` falha com arquivos extraídos ou copiados, que **mantêm o mtime antigo**. Daí o uso de ctime/birthtime |
| **SyncBack** | "Mover em vez de copiar" = copiar e depois apagar. Indisponível no *Fast Backup*. Falha se o arquivo estiver em uso ou só leitura | Opção "apagar da origem se não modificado há X dias". Verificação MD5 que apaga a cópia ruim | Idade mínima e verificação por hash são prática comum |
| **GoodSync** | "Move Mode: Delete Source after Copy" (avançado) | Pode remover a pasta de origem que esvaziar | Mantemos as pastas: o ERP pode depender delas |
| **Backup Exec** | "Delete selected files and folders after successful backup", só em backup completo | **Faz backup, verifica e só então apaga.** Se a verificação falha, o job para e avisa. **O log lista o que foi apagado.** Um job retomado não apaga | Esse é o nosso modelo: verificar → apagar → listar |
| **Arcserve** | "Delete Source files after backup to media" | Registra o aviso AW0209 no log da execução | A exclusão precisa aparecer no histórico |
| **Cobian Reflector** | Sem opção nativa documentada. O caminho são eventos pós-backup ("Executar") | — | Script externo não tem verificação. Fazer nativo e seguro é diferencial |
| **FreeFileSync / SyncToy** | Não têm "mover". O FFS sugere um comando "On success"; o SyncToy só tem Synchronize, Echo e Contribute | Lixeira opcional para o que é apagado | Lixeira tem limite de tamanho e fica no mesmo disco |
| **Iperius, Acronis, EaseUS, Bvckup 2** | Não achamos opção documentada de apagar a origem. A "sincronização" do Iperius apaga no **destino** | O Bvckup avisa quando a origem muda durante a cópia | Detectar mudança durante a cópia é o mínimo |

## 2. Modos de falha e proteções

1. **O ERP ainda está gravando** (o caso catastrófico: cópia parcial e original apagado).
   - A Microsoft avisa que, ao gravar, "a data de última gravação só é totalmente atualizada quando todos os handles de escrita forem fechados". **Só a idade não basta no Windows.**
   - Cópia e extração preservam o mtime antigo, então usamos `t = max(mtime, ctime, birthtime)`. O ctime (ChangeTime no NTFS) e o birthtime mudam ao criar ou gravar.
   - **Teste de uso (Windows):** `fs.open(arq, O_RDONLY | 0x10000000)`, onde `0x10000000` é `UV_FS_O_EXLOCK`. Com essa flag o libuv abre com `share = 0`, e se **qualquer** processo tiver o arquivo aberto a chamada falha com `EBUSY` (ERROR_SHARING_VIOLATION). Fecha na hora. Antivírus abre e fecha rápido, então fazemos 3 tentativas com 2 s de intervalo antes de concluir "em uso". Em macOS e Linux não há trava obrigatória e a proteção é a idade: lá o ctime muda a cada gravação e também em `utimes`.
   - **Coerência:** bytes lidos na cópia = tamanho da varredura. Mesmo sha256 em todos os destinos (a origem foi lida N vezes e não mudou). Com **1 destino só**, relemos a origem e comparamos o sha256 antes de apagar. Antes do `unlink`, `lstat` com tamanho, mtime e ctime iguais aos da varredura.
2. **Destino A deu certo e B falhou:** não apaga nada. Os arquivos continuam na origem e voltam a ser copiados na próxima execução (em A ficam duplicados, o que é inofensivo). O status é Falha, e o e-mail diz "Nada foi apagado da origem".
3. **Verificação:** um arquivo só é aprovado se a releitura do destino bater com o sha256 da leitura da origem. No ZIP, além do CRC-32 que já conferimos, o `zipTree` passa a calcular o sha256 de cada arquivo lido.
4. **Arquivos que aparecem durante a execução:** a lista é congelada na varredura. Só é apagado o que está nela. O resto fica para a próxima execução.
5. **Pastas:** nunca usamos `rmdir`. Uma pasta vazia não ocupa espaço, e o ERP pode precisar dela (muitos não recriam `Backup\Diario`). A raiz fica sempre preservada.
6. **Lixeira ou exclusão permanente:** a exclusão é permanente. A lixeira fica no mesmo disco e não liberaria espaço. Arquivos maiores que a lixeira são apagados de vez de qualquer jeito (relatos do FFS). E o `utilityProcess` não tem `shell.trashItem`. A segurança vem das cópias conferidas em todos os destinos.
7. **Pasta vazia no horário** (o ERP não gerou o backup): Atenção, com a mensagem "Nenhum arquivo novo em C:\Backup. O sistema pode não ter gerado o backup." Ainda conferimos se os destinos respondem: destino indisponível dá Falha.
8. **Retenção:** com "Mover", o backup do ERP só existe nos destinos. Como só se cria backup quando há arquivo movido, cada backup datado contém backups reais do ERP. Se o ERP parar, nenhum backup novo é criado, a retenção não roda e as últimas cópias ficam. Por isso arquivos não elegíveis nunca entram no backup: um backup só com um `.bat` contaria como backup e, em N dias, apagaria a última cópia real. O backup da execução atual é sempre protegido (já é assim hoje).
9. **Auditoria:** uma linha de log por arquivo ("Movido: …"), `RunRecord.move.removed` (até 5.000 caminhos com bytes e sha256) e um resumo no e-mail.

## 3. Interface (textos pt-BR)

**Onde fica:** passo "Origem" do editor, num card abaixo da lista de origens.
- Interruptor: **Mover: apagar da origem depois de copiar**
- Descrição: *Para a pasta onde o sistema (ERP) grava os próprios backups. Cada arquivo só é apagado depois de copiado e conferido em todos os destinos. As pastas são mantidas.*
- Campo (visível com a opção ligada): **Só mover arquivos sem alteração há pelo menos [30] minutos** (5–1440). Ajuda: *Evita pegar um backup que o sistema ainda está gravando. Agende o BC Backup para depois do horário em que o sistema termina.*
- Caixa: **Avisar se não houver arquivo novo** (marcada). Ajuda: *A execução termina em "Atenção" quando não houver nada para mover, um sinal de que o sistema não gerou o backup.*
- Prévia (como a estimativa de tamanho): *Agora: 2 arquivos (4,2 GB) seriam movidos · 1 recente aguardando.* Com até 10 nomes.
- Confirmação ao ligar: título **Apagar arquivos da origem?** Texto: *Os arquivos de "C:\Backup" serão apagados deste computador depois de copiados e conferidos em todos os destinos. Eles passarão a existir só nos destinos, guardados conforme a retenção (últimos 7 dias, mínimo 3).* Botões **Ativar "Mover"** e **Cancelar**.
- Retenção com a opção ligada: *Com "Mover", os backups do sistema ficam só nos destinos: a retenção decide por quanto tempo.*
- Card da rotina: chip **Mover** (tooltip *Apaga da origem depois de copiar*). Gaveta de execução: etapa **Removendo da origem**, com detalhe *Apagando o que já foi copiado e conferido*. Detalhe da execução: abas **Movidos (n)** e **Ficaram na origem (n)**.

**Validação** (`validate.ts`, repetida no motor como defesa extra):
- Erro: *"Mover" só funciona com pastas. Troque o arquivo pela pasta que o contém.*
- Erro: *Não é possível usar "Mover" em uma unidade inteira ou pasta do sistema (C:\, C:\Windows, C:\Users\Ana…). Escolha a pasta onde o sistema grava os backups.* Valor exato: raiz de unidade ou compartilhamento, `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%ProgramData%`, `C:\Users`, a raiz de cada perfil e as raízes de Desktop, Documentos, Downloads, Imagens e OneDrive. Qualquer pasta dentro de `%SystemRoot%` ou que contenha a pasta de dados do BC Backup também é bloqueada. No macOS e Linux: `/`, `/Users`, `/home`, a pasta pessoal, `/System`, `/usr`, `/etc` e `/var`. Subpastas, como `C:\Program Files (x86)\ERP\Backup`, são permitidas.
- Aviso: *Só há 1 destino ativo: depois de mover, o backup existirá em um único lugar. Recomendamos 2 destinos.*
- Aviso: *A retenção está desligada: os destinos vão acumular todos os backups movidos.*
- Aviso: *O destino X fica no mesmo disco da origem: "Mover" não libera espaço nesse disco.*
- Aviso: *A rotina "Y" também usa esta pasta e pode não encontrar os arquivos depois que eles forem movidos.*
- Aviso: *Esta pasta é sincronizada com a nuvem (OneDrive/Dropbox): apagar aqui também apaga lá.*
- Dica para agendamento por intervalo: *Com execuções a cada N minutos, desmarque "Avisar se não houver arquivo novo".*

## 4. Modelo de dados (tudo opcional e compatível com o que existe)

```ts
// src/shared/types.ts
export interface MoveSources {
  enabled: boolean
  /** Só move arquivos sem alteração (max de mtime/ctime/birthtime) há ≥ N min. Padrão 30; 5–1440. */
  minAgeMinutes: number
  /** Nenhum arquivo para mover → status 'warning' (true) ou 'success' (false). Padrão true. */
  warnIfEmpty: boolean
}
// Routine:     moveSources?: MoveSources            (ausente = desligado)
// RunPhase:    + 'moving'                            (LiveRunDrawer.ORDER e status.ts: "Removendo da origem…")
// RunSummary:  filesMoved?: number; bytesMoved?: number
// RunRecord:   move?: MoveReport
export interface MovedFile { path: string; bytes: number; sha256: string }
export interface MoveReport {
  removed: MovedFile[]        // apagados da origem (até MAX_MOVED_LISTED = 5000)
  removedCount: number
  removedBytes: number
  kept: SkippedFile[]         // copiados, mas mantidos na origem (motivo)
  postponed: SkippedFile[]    // não elegíveis nesta execução (recente, em uso, data no futuro)
  postponedCount: number
}
// src/shared/defaults.ts
export const DEFAULT_MOVE_SOURCES: MoveSources = { enabled: false, minAgeMinutes: 30, warnIfEmpty: true }
/** Nunca entram numa rotina "Mover" (nem copiados nem apagados). */
export const MOVE_NEVER = ['**/*.exe', '**/*.dll', '**/*.msi', '**/*.bat', '**/*.cmd', '**/*.ps1', '**/*.vbs',
  '**/*.lnk', '**/*.ini', '**/*.config', '**/*.tmp', '**/*.part', '**/*.partial', '**/*.crdownload', '**/~*']
```
- `BackupManifest`: novo campo opcional `moveSources?: true` (o backup veio de "Mover", e os arquivos podem não existir mais na origem). `isValidManifest` não muda.
- `FileItem` (motor): `ctime: Date` e `birthtime?: Date` (ignorar se for a época 0, como no Linux sem statx).
- **store.ts:** incluir `'moveSources'` em `ROUTINE_KEYS` (senão `extraPrimitives` descarta o objeto) e criar `migrateMoveSources()` com `enabled: bool(false)`, `minAgeMinutes: int(30, 5, 1440)` e `warnIfEmpty: bool(true)`. Objeto inválido ou ausente vira `undefined`. **ipc-validate.ts:** a mesma sanitização em `asRoutineInput`. `createDefaultRoutine()` não preenche o campo.

## 5. Algoritmo (em `runJob`, com `move = routine.moveSources?.enabled === true`)

1. **Pré-checagem:** toda origem precisa ser uma pasta existente e não bloqueada (mesmas regras da §3). Senão é Falha: *"Mover" recusado: …*, e nada é copiado.
2. **Varredura** (`scanning`), igual à de hoje (filtros, sem seguir links), mais `MOVE_NEVER` e arquivos vazios (0 bytes: um gbak/SQL que falhou ou um marcador não é backup e, se contasse, a retenção apagaria os backups reais de um sistema que parou de gerar backups). Cada arquivo é classificado, com `now` fixo no início:
   - `t = max(mtime, ctime, birthtime)`. Se `t > now + 5 min`, vai para **adiado** com *Data no futuro (confira o relógio)*.
   - Se `now − t < minAgeMinutes`, vai para **adiado** com *Alterado há X min, pode estar sendo gravado*.
   - Windows: teste exclusivo (3 tentativas, 2 s). `EBUSY` vai para **adiado** com *Em uso por outro programa*. `EPERM` ou `EACCES` também vão para **adiado** (*Sem permissão*). `ENOENT` é ignorado.
   - Os demais são **elegíveis** e formam `items` (o total de bytes conta só os elegíveis).
3. **Nada elegível:** não cria backup e não roda retenção. Faz `stat` dos destinos ativos (15 s). Destino indisponível dá Falha. Senão:
   - houve adiados: Atenção, com *N arquivo(s) ainda em gravação/em uso; serão movidos na próxima execução*;
   - pasta vazia com `warnIfEmpty`: Atenção, com *Nenhum arquivo novo em {origens}. O sistema pode não ter gerado o backup.*;
   - pasta vazia sem `warnIfEmpty`: Sucesso, com *Nada novo para mover*.
4. **Destinos:** o fluxo atual (acessível, a mesma pasta de um destino anterior por outra grafia/link/unidade mapeada vira Falha — confere se o backup recém-gravado no outro aparece nele —, destino dentro da origem também pela identidade da pasta (volume + número), espaço, `.em-andamento`, cópia com sha256, verificação completa, manifesto com `moveSources: true`, rename, retenção protegendo o backup novo). Para cada arquivo aprovado guardamos `abs → {bytes, sha256}` no mapa do destino. Um destino concluído em Sucesso ou Atenção conta, inclusive o `keepWork` (backup completo com manifesto e nome provisório).
5. **Porta de exclusão:** a fase `moving` só roda se `!signal.aborted` **e** todos os destinos ativos estiverem concluídos (`result.destinations.length === enabledDests.length`, todos em Sucesso ou Atenção). Senão, loga *Nada foi apagado da origem porque {destino} falhou.* e pula para o passo 7.
6. **Exclusão** (`moving`), na ordem da varredura, conferindo `signal` a cada arquivo:
   a. o arquivo está no mapa de **todos** os destinos, com `bytes` e `sha256` iguais entre eles e `bytes === item.size`. Senão vai para **mantido**: *Não copiado para todos os destinos* ou *Alterado durante a cópia*;
   b. com 1 destino só, relê a origem e compara o sha256. Se diferir, vai para **mantido** (*Alterado durante a cópia*);
   c. Windows: novo teste exclusivo (3 tentativas). Se der `EBUSY`, vai para **mantido** (*Em uso*). Vem **antes** do `lstat`: entre as tentativas quem estava com o arquivo aberto pode gravar e fechar, e só depois de uma abertura exclusiva as datas no disco refletem tudo;
   d. `lstat`: tem que ser arquivo comum (não link), com `size`, `mtimeMs` e `ctimeMs` iguais aos da varredura. Senão vai para **mantido**: *Alterado depois da cópia; será copiado de novo na próxima execução*. E o caminho **real** da pasta do arquivo tem que continuar dentro da origem (uma subpasta trocada por link/junção durante a execução levaria o `unlink` para fora): senão, **mantido** (*Fora da pasta de origem*);
   e. `unlink`. Sucesso entra em `removed` e no log *Movido: {caminho} ({tamanho}), conferido em {n} destino(s).* `ENOENT` é só informação (*Já tinha sido removido por outro programa*). `EBUSY`, `EPERM` e `EACCES` vão para **mantido**, com dica de permissão. Não chama `rmdir` em nenhum momento.
   A janela entre (d) e (e) é de microssegundos e é aceitável. O handle exclusivo dura milissegundos, então o risco de atrapalhar o ERP é desprezível.
7. **Resultado:** os mesmos cálculos de hoje, mais `move` e `filesMoved`/`bytesMoved`, com o status da §6.

## 6. Status e e-mail

| Situação | Status | Apaga da origem | Cria backup | Retenção |
|---|---|---|---|---|
| Tudo que era elegível foi movido, nada adiado ou pulado | Sucesso | sim | sim | sim |
| Movido, mas houve adiado, mantido ou pulado | Atenção | só os aprovados | sim | sim |
| Nada elegível: pasta vazia (`warnIfEmpty`) ou só arquivos recentes/em uso | Atenção | — | não | não |
| Pasta vazia e `warnIfEmpty = false` | Sucesso | — | não | não |
| Algum destino falhou ou está indisponível | Falha | **nada** | só nos que deram certo | só nos que deram certo |
| Cancelado antes da fase `moving` | Cancelado | nada | — | — |
| Cancelado durante `moving` | Cancelado | os já apagados (todos conferidos) | sim | sim |
| Origem ausente ou recusada para "Mover" | Falha | nada | não | não |

**E-mail** (`template.ts`): bloco **Movidos para os destinos (apagados de C:\Backup): 3 arquivos · 4,2 GB** com até 20 nomes, e **Ficaram na origem: N** com motivos (até 20). Nos casos sem arquivo novo, a frase *Nenhum arquivo novo…* vira o destaque do e-mail e o assunto fica `[ATENÇÃO] {rotina}: nenhum backup novo do sistema`. Na Falha: *Nada foi apagado da origem*. Novas variáveis: `{{movidos}}`, `{{tamanho_movido}}`, `{{lista_movidos}}`, `{{mantidos_origem}}`. A lista completa vai no log anexado.

## 7. Casos de borda

| Caso | Comportamento |
|---|---|
| O ERP grava devagar e com pausas, mas mantém o arquivo aberto | Windows: o teste exclusivo segura. macOS/Linux: só a idade protege, então aumente `minAgeMinutes` |
| O ERP copia ou compacta para a pasta (mtime antigo) | ctime/birthtime "agora": o arquivo fica adiado até completar `minAge` |
| O ERP grava em `*.tmp`/`*.part` e renomeia no fim | Ignorado pelo `MOVE_NEVER` até ser renomeado. O rename atualiza o ctime, então ainda espera `minAge` |
| O ERP reabre o arquivo para acrescentar dados (append em sessões) | O re-stat (tamanho, mtime, ctime) antes do `unlink` mantém o arquivo |
| Arquivo novo durante a execução | Fora da lista congelada: fica para a próxima |
| O ERP apaga os próprios backups antigos durante a execução | Na cópia, `ENOENT` vira pulado. No `unlink`, é só informação |
| Destino pulou um arquivo (maiúsculas `EEXIST`, caminho longo) | O arquivo fica na origem (não está em todos os destinos) |
| USB em FAT32 e arquivo > 4 GB | O destino falha e nada é apagado |
| Disco de destino desconectado por dias | Falha diária e barulhenta. A origem acumula como antes, sem perda |
| Sem permissão para apagar (ERP roda como serviço/SYSTEM) | Mantido, com dica: *ajuste a permissão da pasta para o usuário do BC Backup* |
| Arquivo somente leitura | É apagado (o libuv ignora o atributo no `unlink`) |
| Pasta de rede (`\\servidor\…`) | O teste exclusivo vale pelo SMB. Se a rede cair, o `unlink` falha e o arquivo fica mantido |
| Subpastas criadas pelo ERP | Preservadas (vazias). A raiz nunca é tocada |
| Link ou junção dentro da origem | Não é seguido nem apagado (`walk` já ignora) |
| `.exe`, `.bat` ou `.ini` na pasta de backup | Ignorados (`MOVE_NEVER`). Para restringir mais, use o filtro **Incluir** (`*.fbk; *.gbk; *.bak; *.zip; *.7z; *.rar`) |
| Queda de energia no meio da exclusão | Os já apagados estavam conferidos. Os outros são copiados de novo (duplicata inofensiva) |
| Relógio do PC errado | Arquivo "do futuro" fica adiado com aviso. A retenção já é segura (doc 01 §6) |
| Duas rotinas na mesma pasta | Aviso no editor. A fila roda uma de cada vez, então não há corrida |
| Pasta do OneDrive/Dropbox | Aviso: a exclusão é sincronizada na nuvem |
| Destino no mesmo volume da origem | Aviso: mover não libera espaço |
| Modo ZIP | A mesma regra, com sha256 calculado durante a compactação |
| Backup que não pôde receber o nome final (`keepWork`) | Conta como concluído (tem manifesto) e é finalizado na próxima execução. A limpeza de sobras só apaga um `.em-andamento` quando o manifesto **não existe**; manifesto ilegível no momento (antivírus) deixa a pasta como está |
| Configuração importada com "Mover" ligado | Chega **desligado**: só o editor liga, com a confirmação que mostra as pastas deste computador |
| Arquivo vazio (0 bytes) | Fica na origem e não conta como backup novo (aviso no log) |

## 8. Checklist de testes (vitest + `EngineHooks`; manual no Windows)

- [ ] Rotinas antigas sem `moveSources` carregam iguais. `migrateMoveSources` limita os valores a 5–1440 e descarta lixo. O IPC sanitiza.
- [ ] Arquivo recente (mtime < minAge) não é copiado nem apagado: Atenção e nenhum backup criado.
- [ ] Arquivo com mtime antigo e ctime/birthtime recentes (simula cópia) fica adiado.
- [ ] `EBUSY` simulado no teste exclusivo (novo hook `beforeProbe`) deixa o arquivo adiado. `EBUSY` no `unlink` deixa mantido e dá Atenção.
- [ ] 2 destinos com B indisponível: Falha, origem intacta e retenção só em A.
- [ ] Verificação de B falha (hook corrompe o destino): Falha e origem intacta.
- [ ] Arquivo muda entre a cópia e a exclusão (hook altera depois de `copyTree`): mantido, e copiado de novo na execução seguinte.
- [ ] Arquivo cresce durante a cópia (bytes ≠ size): mantido.
- [ ] Hashes diferentes entre destinos: mantido. Com 1 destino, a releitura do sha256 da origem pega a diferença.
- [ ] Pasta vazia: Atenção (warnIfEmpty) ou Sucesso (false). Sem backup, sem retenção e com destino checado.
- [ ] ERP "para" por 10 dias com retenção 7/3: nenhuma exclusão de backups antigos (só há retenção quando há movidos).
- [ ] Pastas e subpastas continuam existindo depois de mover tudo. A raiz nunca é removida.
- [ ] Link/junção dentro da origem continua intacto, e o alvo também.
- [ ] `MOVE_NEVER` e os filtros: `.exe`, `.tmp` e excluídos nem copiados nem apagados.
- [ ] Cancelar antes de `moving`: nada apagado. Cancelar no meio: `removed` bate exatamente com o que sumiu.
- [ ] Modo ZIP: sha256 por arquivo e a mesma regra de exclusão.
- [ ] `keepWork` (rename bloqueado) permite apagar a origem.
- [ ] `validate.ts`: bloqueia `C:\`, `C:\Windows\x`, `C:\Users\Ana`, `%ProgramFiles%` e origem do tipo arquivo. Permite `C:\Program Files (x86)\ERP\Backup`. Avisos de 1 destino, retenção desligada, mesmo disco e outra rotina.
- [ ] E-mail: bloco de movidos, assunto "nenhum backup novo" e *Nada foi apagado* na Falha. Prévias atualizadas.
- [ ] **Manual Windows:** um PowerShell grava 2 GB devagar com `FileShare.Read` e depois com `FileShare.ReadWrite`. Nos dois casos o arquivo fica adiado. Um `Copy-Item` de arquivo antigo para a pasta fica adiado até `minAge`. A pasta numa unidade de rede também é testada.

## 9. Fontes

- **Robocopy:** [Microsoft Learn: /MOV, /MOVE, /MINAGE](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/robocopy) · [/MOV deixa pastas vazias, /MOVE apaga pastas](https://learn.microsoft.com/en-us/archive/blogs/jjameson/using-robocopy-to-move-files-and-folders) · [Erro 32 (em uso) impede a exclusão](https://learn.microsoft.com/en-us/answers/questions/938903/robocopy-folder-not-moved)
- **rsync:** [lista rsync: apaga sem checar se o arquivo mudou](https://lists.samba.org/archive/rsync/2009-June/023354.html) · [Jane Street: mover via rsync](https://blog.janestreet.com/moving-files-via-rsync/) · [Guia: só arquivos fechados](https://www.simplified.guide/rsync/file-move-remove-source)
- **rclone:** [rclone move](https://rclone.org/commands/rclone_move/) · [movendo arquivos ainda em gravação](https://forum.rclone.org/t/rclone-moving-files-that-are-still-being-written/18718) · [--min-age falha com mtime antigo](https://forum.rclone.org/t/min-age-not-working-for-extracted-files-on-a-upload-script-any-solution/17683)
- **SyncBack:** [Decisões: mover e apagar se não modificado há X dias](https://www.2brightsparks.com/syncback/help/decisionsfiles.htm) · [Integridade: verificação MD5](https://www.2brightsparks.com/resources/articles/data-integrity.html) · [Fórum: mover não apagou (em uso/Fast Backup)](https://forum.2brightsparks.com/bb/viewtopic.php?p=54995)
- **GoodSync:** [Job Options: Move Mode](https://help.goodsync.com/hc/en-us/articles/115003939392-Job-Options) · [General](https://help.goodsync.com/hc/en-us/articles/115003228932-General)
- **Backup Exec / Arcserve:** [Apagar após backup bem-sucedido (verifica antes e lista no log)](https://docs.backupexec.com/us/en/backupexec-userdocs/product-guides/all-platforms/backup-exec-administrators-guide/22-1/backups/configuring-backup-exec-to-automatically-delete-fi.html) · [Arcserve AW0209](https://documentation.arcserve.com/Arcserve-Backup/Available/R17/ENU/Bookshelf_Files/HTML/caabhelp/300209_error.htm)
- **Cobian / FFS / SyncToy / Bvckup:** [Cobian: eventos pré/pós-backup](https://cobiansoft.com/crHelp/tasks.html) · [Fórum Cobian (Delete source)](https://forum.cobiansoft.com/viewtopic.php?p=7588) · [FFS: sem mover, usar "On success"](https://freefilesync.org/forum/viewtopic.php?p=37153) · [FFS: lixeira e arquivos grandes](https://freefilesync.org/forum/viewtopic.php?p=24420) · [SyncToy](https://en.wikipedia.org/wiki/SyncToy) · [Bvckup: aviso de origem alterada na cópia](https://www.neowin.net/software/bvckup-2-release-807/) · [Iperius: sincronização apaga no destino](https://www.iperiusbackup.net/en/synchronization-delete-old-files-backup/)
- **Windows / Node:** [File Times: last write só atualiza ao fechar os handles](https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times) · [libuv `src/win/fs.c` (`UV_FS_O_EXLOCK` → share 0, unlink ignora só leitura)](https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c) · [libuv `error.c` (sharing violation → EBUSY)](https://github.com/libuv/libuv/blob/v1.x/src/win/error.c) · [Old New Thing: modos de compartilhamento](https://devblogs.microsoft.com/oldnewthing/?p=3373) · [Cópia mantém "modificado" e muda "criado"](https://petri.com/copy-files-preserve-timestamp)
- **Hot folders (estabilidade):** [GMG ColorServer: checagem de estabilidade](https://gmgcolor.com/support/help/colorserver/GMG_Text/ColorServer/Files/Input.htm) · [docuteam feeder: hotfolder](https://docs.docuteam.ch/feeder/hotfolder)
