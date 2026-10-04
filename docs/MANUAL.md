# Manual do BC Backup

Guia para o **técnico** que instala o BC Backup e para o **cliente** que usa o computador. Os nomes de botões e
telas aparecem em **negrito**, como no programa.

**Sumário**

1. [O que o BC Backup faz](#1-o-que-o-bc-backup-faz)
2. [Instalar](#2-instalar)
3. [Criar a primeira rotina, passo a passo](#3-criar-a-primeira-rotina-passo-a-passo)
4. [Vários destinos](#4-vários-destinos)
5. [Agendamento](#5-agendamento)
6. [Retenção: por quanto tempo os backups ficam guardados](#6-retenção-por-quanto-tempo-os-backups-ficam-guardados)
7. [Aviso por e-mail](#7-aviso-por-e-mail)
8. [Restaurar arquivos](#8-restaurar-arquivos)
9. [Como as pastas ficam no destino](#9-como-as-pastas-ficam-no-destino)
10. [Perguntas frequentes](#10-perguntas-frequentes)
11. [Solução de problemas](#11-solução-de-problemas)

---

## 1. O que o BC Backup faz

O BC Backup copia as pastas e arquivos importantes do computador para um ou mais lugares seguros — um HD externo,
um pendrive, outra unidade ou uma pasta de rede — nos dias e horários que você escolher.

- Cada backup vira uma **pasta com a data e a hora** (ou um arquivo **ZIP**). Para recuperar um arquivo, basta abrir
  a pasta no Explorer e copiar: não precisa do BC Backup para isso.
- Os backups antigos são **apagados sozinhos** depois do prazo escolhido, sempre sobrando um mínimo de cópias.
- Ao terminar, o BC Backup pode **mandar um e-mail** com o resultado para o cliente e para o técnico.
- Se algo der errado, você fica sabendo: o ícone perto do relógio fica **vermelho**, aparece um aviso do Windows e
  sai o e-mail de falha.

Um conjunto "o que copiar → para onde → quando" se chama **rotina**. Um computador pode ter várias rotinas (por
exemplo, "Financeiro diário" às 18:00 e "Fotos" uma vez por semana).

## 2. Instalar

1. Baixe o arquivo `BC-Backup-Setup-<versão>-x64.exe` (enviado pelo técnico ou na página de Releases).
2. Dê dois cliques. Como o instalador ainda não tem assinatura digital, o Windows pode mostrar a tela azul
   **"O Windows protegeu o computador"**: clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Escolha a pasta de instalação (a sugerida serve) e clique em **Instalar**. A instalação é só para o usuário
   atual e **não pede senha de administrador**.
4. No fim, deixe marcado **Executar BC Backup** e clique em **Concluir**. São criados atalhos na Área de Trabalho e
   no Menu Iniciar.

Depois de instalado:

- O BC Backup **inicia junto com o Windows** e fica na **área de notificação** (os ícones perto do relógio). Dá para
  mudar em **Configurações › Geral › Iniciar com o Windows**.
- **Fechar a janela não fecha o programa**: ele continua na área de notificação para fazer os backups no horário.
  Para fechar de verdade, clique com o botão direito no ícone e escolha **Sair do BC Backup** (os backups agendados
  deixam de acontecer até ele ser aberto de novo).
- No Windows 11, se o ícone não aparecer perto do relógio, clique na setinha **^** ou fixe-o em
  **Configurações do Windows › Personalização › Barra de tarefas › Outros ícones da bandeja do sistema**.

**Primeiros ajustes (técnico):** em **Configurações**, preencha o **nome do cliente**, o **apelido do
computador** (ex.: "PC-RECEPCAO") e o **nome da sua empresa** — eles aparecem nos e-mails. Depois configure o
e-mail ([seção 7](#7-aviso-por-e-mail)).

Para desinstalar: **Configurações do Windows › Aplicativos › BC Backup › Desinstalar**. Os backups já feitos e as
configurações **não são apagados** (útil para reinstalar sem perder nada).

## 3. Criar a primeira rotina, passo a passo

Clique em **Nova rotina**. O editor tem 6 etapas; use **Continuar** e **Voltar** para navegar.

**1. Origem — "O que você quer copiar?"**

- Dê um **nome** para a rotina (ex.: "Financeiro diário"). Ele vira o nome da pasta no destino.
- Clique em **Adicionar pastas** ou **Adicionar arquivos** (ou arraste do Explorer). Pode misturar várias pastas e
  arquivos; cada um vira uma subpasta dentro do backup.
- Em **Avançado** ficam os filtros. Já vêm excluídos arquivos que não precisam de backup (`Thumbs.db`,
  `desktop.ini`, temporários `*.tmp`, arquivos `~$` do Office aberto, lixeira). Exemplo de inclusão: só `*.xml`.

**2. Destinos — "Para onde as cópias vão?"**

- Clique em **Adicionar destino** e escolha o HD externo, o pendrive, outra unidade ou uma pasta de rede
  (`\\SERVIDOR\backup`). O programa mostra o espaço livre e quanto o backup deve ocupar.
- Se o destino estiver no **mesmo disco** da origem, aparece um aviso: se esse disco quebrar, perde-se o original
  **e** o backup. Prefira outro disco.
- Pode adicionar mais de um destino — veja a [seção 4](#4-vários-destinos).

**3. Agendamento — "Quando executar?"**

Escolha, por exemplo, **Dias da semana** → seg a sex → **18:00**. A frase embaixo confirma: "Próxima execução:
amanhã, 05/10 às 18:00". Detalhes na [seção 5](#5-agendamento).

**4. Retenção — "Por quanto tempo guardar?"**

O padrão é **guardar os últimos 7 dias** e **manter sempre pelo menos 3 backups**. Explicação completa na
[seção 6](#6-retenção-por-quanto-tempo-os-backups-ficam-guardados).

**5. Notificação — "Avisar alguém?"**

Ligue **Enviar e-mail ao terminar**, digite os **destinatários** (Enter entre um e outro) e, se quiser receber uma
cópia escondida como técnico, use **Cópia oculta**. Escolha quando enviar: sucesso, com avisos, falha. Se o e-mail
ainda não foi configurado, o próprio editor mostra o atalho para **Configurações › E-mail**.

**6. Revisão — "Tudo certo?"**

Confira o resumo e clique em **Criar rotina** — ou **Criar e executar agora** para já fazer o primeiro backup e ver
se está tudo certo. **Recomendação ao técnico:** sempre rode o primeiro backup na hora, com o cliente junto, e
mostre onde a pasta datada ficou.

O andamento aparece no painel (porcentagem, arquivos, tempo restante). Dá para **Parar** a qualquer momento; o
backup parcial não é considerado um backup válido.

## 4. Vários destinos

Uma rotina pode copiar para **vários destinos** de uma vez — por exemplo, um HD externo **e** uma pasta no
servidor. É a forma mais simples de seguir a regra de ouro do backup: ter cópias em lugares diferentes.

- Os destinos são feitos **um depois do outro**, cada um com seu resultado (Concluído, Com avisos, Falhou).
- Se um destino falhar (HD desconectado, por exemplo), os outros **continuam normalmente**. A execução fica como
  **Falhou** para chamar a atenção, e o e-mail mostra qual destino teve problema.
- A **retenção** é feita em cada destino separadamente, e só naquele que recebeu o backup novo com sucesso.
- Você recebe **um único e-mail** por execução, com uma linha por destino.
- Para desligar um destino temporariamente sem apagá-lo, edite a rotina e desmarque-o.

## 5. Agendamento

| Opção | Exemplo | Quando usar |
| --- | --- | --- |
| **Diariamente / Dias da semana** | Seg a sex às 12:00 e 18:00 (até 6 horários) | O mais comum: no almoço e no fim do expediente |
| **A cada N horas** | A cada 4 horas, das 08:00 às 20:00 | Arquivos que mudam o dia todo |
| **Ao iniciar o computador** | 5 minutos depois de ligar | PCs que não têm horário fixo |
| **Manual** | Só quando clicar em **Executar agora** | Backups eventuais |

- O computador precisa estar **ligado** e com o usuário **conectado** (logado) no horário. O BC Backup roda na área
  de notificação; ele não liga o computador sozinho.
- Durante o backup o BC Backup impede o computador de **entrar em suspensão**.
- **Backup atrasado:** se o computador estava desligado no horário, com a opção **Executar backups atrasados ao
  ligar o computador** ligada (padrão), o backup é feito **uma única vez** pouco depois de ligar — mesmo que vários
  horários tenham sido perdidos.
- Um backup nunca roda por cima de outro: se uma rotina ainda está em andamento, a próxima espera na fila.
- **Pausar** uma rotina (botão ⏸ na lista) suspende os horários dela sem apagar nada. **Retomar** volta ao normal.

## 6. Retenção: por quanto tempo os backups ficam guardados

A retenção apaga os backups antigos para o destino não encher. Ela tem duas regras que trabalham juntas:

- **Guardar os backups dos últimos N dias** (contando o dia de hoje como 1º dia).
- **Manter sempre no mínimo M backups**, aconteça o que acontecer.

**Exemplo com o padrão (7 dias, mínimo 3), um backup por dia:**

| Dia | Backups no destino | O que acontece |
| --- | --- | --- |
| 1º ao 7º | 1, 2, 3 … 7 | Nada é apagado: todos estão dentro dos 7 dias |
| **8º** | 2 … 8 | **No 8º dia o mais antigo (o do dia 1) é apagado** |
| 9º | 3 … 9 | Sai o do dia 2, e assim por diante: sempre os últimos 7 dias |

**Mas sempre ficam pelo menos 3.** Se o computador ficou desligado nas férias, do dia 12 ao dia 21, e o próximo
backup acontece no dia 22: pela regra dos 7 dias sobraria só o backup do dia 22. Como o mínimo é 3, o BC Backup
mantém o do dia 22 **e os dois mais recentes antes dele** (dias 10 e 11), e apaga só os mais velhos.

Outras garantias:

- A limpeza só acontece **depois de um backup que deu certo** naquele destino. **Se o backup de hoje falhou, nada é
  apagado.**
- Com dois backups por dia, "7 dias" guarda os 14 backups desses dias.
- O BC Backup só apaga pastas e ZIPs **criados por ele para aquela rotina** (identificados pelo manifesto). Seus
  outros arquivos no mesmo HD nunca são tocados.
- Se você **renomear ou mover** uma pasta de backup, ela deixa de ser reconhecida e **nunca será apagada** pela
  retenção. É um jeito de "guardar para sempre" uma cópia específica.

**Quanto espaço preciso?** Cada backup em pasta ocupa o tamanho total dos arquivos copiados. Com 7 dias e um backup
por dia, conte cerca de **7 × o tamanho da origem** (um pouco menos em ZIP para documentos e planilhas). O editor
mostra uma estimativa na etapa de retenção.

## 7. Aviso por e-mail

O e-mail é configurado **uma vez** em **Configurações › E-mail** (a conta que **envia**) e, em cada rotina, você
escolhe **quem recebe** e **quando**.

### Configurar a conta que envia

1. Escolha o **provedor** (Gmail, Microsoft 365, Hostinger…). Servidor, porta e segurança são preenchidos sozinhos.
2. Preencha **usuário** (normalmente o e-mail completo) e **senha**.
3. Em **E-mail do remetente**, use **o mesmo e-mail da conta** — a maioria dos provedores recusa outro remetente.
   O **nome do remetente** pode ser, por exemplo, "BC Backup – Padaria Pão Quente".
4. Clique em **Enviar e-mail de teste**. Se chegar a mensagem "Tudo certo com o envio de e-mails", clique em
   **Salvar**. Se não chegar, olhe também a caixa de spam.

A senha fica guardada de forma cifrada pelo Windows e nunca é mostrada de novo.

### Gmail (senha de app)

O Gmail **não aceita a senha normal** da conta em programas como o BC Backup. É preciso criar uma **senha de app**:

1. Entre em <https://myaccount.google.com> com a conta que vai enviar os avisos.
2. Abra **Segurança** e ative a **Verificação em duas etapas** (se ainda não estiver ativa).
3. Abra <https://myaccount.google.com/apppasswords> (ou pesquise "Senhas de app" na barra de busca da conta).
4. Dê um nome, por exemplo **BC Backup**, e clique em **Criar**.
5. Copie a senha de **16 letras** que aparece (os espaços não importam).
6. No BC Backup: provedor **Gmail** (`smtp.gmail.com`, porta **465**, **SSL/TLS**), usuário = endereço Gmail
   completo, senha = a senha de app.

Se a senha da conta Google for trocada, as senhas de app são revogadas: crie outra. Contas Google Workspace podem
ter a opção bloqueada pelo administrador.

### Microsoft 365 (e-mail corporativo)

- Provedor **Microsoft 365**: `smtp.office365.com`, porta **587**, **STARTTLS**; usuário = e-mail completo.
- A caixa de correio precisa ter o **SMTP autenticado** habilitado (Centro de administração do Microsoft 365 ›
  Usuários › selecione o usuário › **Email** › **Gerenciar aplicativos de email** › marque **SMTP autenticado**).
- A Microsoft está desligando esse tipo de autenticação por padrão a partir do fim de 2026; o administrador ainda
  pode reativá-la. Se o teste mostrar "A Microsoft recusou a autenticação básica", é isso.
- **Outlook.com / Hotmail / Live pessoais não funcionam** com senha desde setembro de 2024. Use um Gmail ou o
  e-mail da hospedagem do domínio.

### E-mail da hospedagem do site

| Provedor | Servidor SMTP | Porta / segurança | Observação |
| --- | --- | --- | --- |
| Hostinger | `smtp.hostinger.com` | 465 SSL/TLS (ou 587 STARTTLS) | Usuário = e-mail completo |
| Locaweb | `email-ssl.com.br` | 587 STARTTLS (ou 465 SSL/TLS) | |
| UOL Host | `smtps.uol.com.br` | 587 STARTTLS (ou 465 SSL/TLS) | Atenção ao **"s"** em `smtps` |
| KingHost | `smtpi.kinghost.net` | 587 STARTTLS | Confirme no painel da KingHost |
| HostGator Brasil | `mail.seudominio.com.br` | 465 SSL/TLS (ou 587) | Troque pelo seu domínio |
| Outro | o informado pelo provedor | normalmente 465 SSL/TLS ou 587 STARTTLS | Opção **Personalizado** |

Regra prática: **porta 465 = SSL/TLS**, **porta 587 = STARTTLS**. Trocar um pelo outro dá erro.

### Na rotina

- **Destinatários**: o cliente (ex.: `contato@padaria.com.br`). **Cópia oculta**: o técnico.
- **Enviar quando**: sucesso, concluído com avisos, falha (marque pelo menos a falha!).
- **Anexar log**: nunca, só em falha (padrão) ou sempre.

O e-mail mostra o status em destaque (verde, laranja ou vermelho), um resumo (arquivos, tamanho, duração, início
e fim), uma linha por destino com os backups antigos removidos, a lista de arquivos que ficaram de fora (até 20) e o
próximo backup agendado. O assunto segue o modelo
`[BC Backup] Concluído – Financeiro diário – Padaria Pão Quente (PC-RECEPCAO) – 04/10 18:00`, fácil de filtrar.
Se a internet estiver fora no momento, o envio é tentado de novo mais tarde.

## 8. Restaurar arquivos

O BC Backup não usa formato próprio: restaurar é **copiar e colar**.

**Backup em pasta (padrão)**

1. No BC Backup, abra **Histórico**, clique na execução desejada e em **Abrir pasta** — ou, no Explorer, vá até o
   destino: `E:\BC Backup\<nome da rotina>\`.
2. Entre na pasta com a **data e hora** desejada (ex.: `2026-10-03_18-00-02` = 03/10/2026 às 18:00).
3. Dentro dela há uma subpasta para cada origem (ex.: `Documentos`, `Planilhas`). Encontre o arquivo e **copie**.
4. Cole em uma pasta de trabalho (ex.: Área de Trabalho) e confira. Só então substitua o original, se for o caso.

**Backup em ZIP**

1. Vá até `E:\BC Backup\<nome da rotina>\` e abra o arquivo com a data desejada (ex.: `2026-10-03_18-00-02.zip`) —
   o Windows abre ZIP com dois cliques.
2. Arraste os arquivos para fora, ou clique com o botão direito no ZIP › **Extrair tudo…**

Dicas: nunca trabalhe direto dentro da pasta de backup (a retenção pode apagá-la no prazo); e, para restaurar um
sistema inteiro (ex.: banco de dados de um programa), feche o programa antes de colar os arquivos.

## 9. Como as pastas ficam no destino

```
E:\
└─ BC Backup\
   └─ Financeiro diário\                     ← uma pasta por rotina
      ├─ .bcbackup-rotina.json               ← identifica a rotina (não apague)
      ├─ 2026-10-03_18-00-02\                ← um backup (pasta datada: AAAA-MM-DD_HH-MM-SS)
      │  ├─ bcbackup-manifesto.json          ← resumo do backup (data, arquivos, tamanho, status)
      │  ├─ Documentos\…                     ← uma subpasta por origem
      │  └─ Planilhas\…
      ├─ 2026-10-04_18-00-05\
      ├─ 2026-10-05_18-00-01.zip             ← (modo ZIP) um arquivo por backup…
      ├─ 2026-10-05_18-00-01.zip.manifesto.json   …com o manifesto ao lado
      └─ 2026-10-06_18-00-03.em-andamento\   ← backup sendo feito agora (ou interrompido)
```

- **`bcbackup-manifesto.json`** diz que aquela pasta é um backup completo e válido. É por ele que a retenção sabe o
  que pode apagar.
- **`.em-andamento`**: o backup ainda não terminou. Só quando tudo foi copiado e verificado a pasta recebe o nome
  final. Se o computador desligou no meio, a sobra é limpa no próximo backup — **não use** essas pastas para
  restaurar.
- **`.excluindo`**: backup antigo que a retenção está apagando.
- Os horários são os do computador no início do backup; os nomes são em ordem cronológica no Explorer.

## 10. Perguntas frequentes

**Um arquivo estava em uso e não foi copiado. E agora?**
Programas abertos podem travar arquivos (ex.: Outlook com o `.pst`, sistemas com banco Firebird/Access). O BC Backup
pula o arquivo, termina o resto e marca o backup como **Com avisos**, listando o arquivo no e-mail. Solução: agende o
backup para quando o programa estiver fechado (ex.: no almoço ou depois do expediente) ou peça para fechá-lo antes.

**A letra do pendrive/HD externo mudou (era E:, virou F:).**
O Windows dá a letra livre na hora em que o disco é conectado. O backup acusa **Destino indisponível** e você recebe
o e-mail de falha. Para não acontecer de novo, fixe uma letra alta para o disco: tecla Windows + X › **Gerenciamento
de Disco** › clique com o botão direito no disco › **Alterar letra de unidade e caminho** › escolha, por exemplo,
**B:** ou **Z:**. Depois edite o destino da rotina, se precisar.

**O computador estava desligado no horário do backup.**
Com **Executar backups atrasados ao ligar o computador** ativado (padrão), o backup é feito uma vez pouco depois de
ligar e entrar no Windows. Se ficou vários dias desligado, ainda assim é um backup só. Na retenção, o mínimo de
backups garante que as cópias antigas não sumam enquanto o PC esteve parado.

**Posso usar o computador durante o backup?**
Pode. Arquivos alterados durante a cópia podem sair na versão anterior ou ser pulados; por isso é melhor agendar em
horários de pouco uso.

**O HD externo precisa ficar sempre conectado?**
Só no horário do backup. Desconectar entre um backup e outro é até mais seguro (contra vírus de sequestro de dados).
Se esquecer desconectado, o e-mail de falha avisa.

**Posso fazer backup para uma pasta de rede?**
Sim, use o caminho `\\SERVIDOR\pasta` ou uma unidade mapeada. A pasta precisa estar acessível para o usuário do
Windows **sem pedir senha** no momento do backup (salve a credencial marcando **Lembrar minhas credenciais** ao
acessá-la pela primeira vez).

**O backup apaga arquivos que eu apaguei no computador?**
Não. Cada backup é uma cópia completa do momento; o que você apagou continua nos backups anteriores até eles saírem
pela retenção.

**Como faço para não receber e-mail quando dá tudo certo?**
Edite a rotina › **Notificação** e desmarque **Sucesso**, deixando **Com avisos** e **Falha**.

## 11. Solução de problemas

| O que aparece | Causa provável | O que fazer |
| --- | --- | --- |
| **Destino indisponível** | HD/pendrive desconectado, letra mudou, servidor desligado ou sem rede | Conecte o disco; fixe a letra (seção 10); teste abrir o caminho no Explorer |
| **Sem espaço em E:\\** | O destino encheu | Diminua os dias de retenção, apague backups antigos manualmente ou use um disco maior |
| **Com avisos** — arquivos ignorados | Arquivos em uso, sem permissão ou caminho longo demais | Veja a lista no e-mail ou no **Histórico**; feche o programa que usa o arquivo |
| **Origem não encontrada** | A pasta de origem foi movida ou renomeada | Edite a rotina e escolha a pasta de novo |
| E-mail: **Usuário ou senha recusados** | Senha errada; no Gmail, falta a senha de app | Crie uma senha de app (seção 7) |
| E-mail: **Segurança e porta não combinam** | 465 com STARTTLS ou 587 com SSL | 465 = SSL/TLS, 587 = STARTTLS |
| E-mail: **Tempo esgotado** / **Conexão recusada** | Firewall ou antivírus bloqueando, servidor/porta errados | Confira servidor e porta; libere o BC Backup no antivírus |
| E-mail: **Remetente recusado** | E-mail do remetente diferente da conta | Use como remetente o mesmo e-mail do usuário |
| E-mail: **A Microsoft recusou a autenticação básica** | SMTP autenticado desligado no Microsoft 365 | Peça ao administrador para habilitar ou use outro provedor |
| O backup **não rodou** no horário | Programa fechado com **Sair**, PC desligado/suspenso, rotina **Pausada**, usuário não conectado | Abra o BC Backup; verifique se a rotina está ativa; com a recuperação ligada, ele roda ao ligar |
| Avisos do Windows não aparecem | Notificações desligadas ou modo Não incomodar | **Configurações do Windows › Sistema › Notificações** › ative para **BC Backup** |
| Ícone não aparece perto do relógio | O Windows 11 esconde ícones novos | Clique na setinha **^** ou fixe o ícone (seção 2) |

**Onde estão os logs?** Cada execução tem o log completo em **Histórico** › clique na execução › **Log** (com o
botão **Copiar log**). O log geral do programa fica em `%APPDATA%\BC Backup\logs\bc-backup.log` — envie-o ao
técnico quando pedir ajuda. As configurações e o histórico ficam em `%APPDATA%\BC Backup` (cole esse endereço na
barra do Explorer).
