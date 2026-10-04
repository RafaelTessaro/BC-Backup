// Modelos de e-mail: assunto, escape de HTML, lista com estouro, texto puro e cada status.
// Para regenerar as prévias em docs/email-preview/ (HTML + PNG):
//   PREVIEW=1 CHROMIUM_PATH=/opt/pw-browsers/chromium npx vitest run test/mail-template.test.ts

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_ISSUES,
  buildRunSubject,
  collectIssues,
  escapeHtml,
  renderRunEmail,
  renderTestEmail,
  type RunEmailContext
} from '../src/main/mail/template'
import type { DestinationResult, FinalRunStatus, RunRecord } from '../src/shared/types'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

// Datas em horário local: os testes não dependem do fuso de quem roda.
const START = new Date(2026, 9, 4, 18, 0, 5)
const END = new Date(2026, 9, 4, 18, 3, 17)
const NEXT = new Date(2026, 9, 6, 18, 0, 0)

function dest(over: Partial<DestinationResult> = {}): DestinationResult {
  return {
    destinationId: 'd1',
    path: 'E:\\',
    label: 'HD externo azul',
    outputPath: 'E:\\BC Backup\\Financeiro diário\\2026-10-04_18-00-05',
    status: 'success',
    filesCopied: 1204,
    bytesCopied: 2_254_857_830,
    skipped: [],
    pruned: ['E:\\BC Backup\\Financeiro diário\\2026-09-27_18-00-02'],
    freeBytesAfter: 129_277_385_523,
    ...over
  }
}

function run(status: FinalRunStatus, over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'r1',
    routineId: 'rt1',
    routineName: 'Financeiro diário',
    status,
    trigger: 'schedule',
    startedAt: START.toISOString(),
    finishedAt: END.toISOString(),
    durationMs: END.getTime() - START.getTime(),
    filesTotal: 1204,
    filesCopied: 1204,
    filesSkipped: 0,
    bytesTotal: 2_254_857_830,
    bytesCopied: 2_254_857_830,
    warnings: 0,
    errors: 0,
    destinationCount: 1,
    destinations: [dest()],
    log: [],
    ...over
  }
}

function ctx(r: RunRecord, over: Partial<RunEmailContext> = {}): RunEmailContext {
  return {
    run: r,
    routine: {
      name: r.routineName,
      notification: {
        enabled: true,
        recipients: ['contato@padariapaoquente.com.br'],
        bcc: [],
        onSuccess: true,
        onWarning: true,
        onFailure: true,
        attachLog: 'onFailure',
        clientName: ''
      }
    },
    settings: {
      clientName: 'Padaria Pão Quente',
      computerAlias: 'PC-RECEPCAO',
      companyName: 'TecnoSul Informática'
    },
    hostname: 'DESKTOP-7F3K2LQ',
    appVersion: '0.1.0',
    nextRunAt: NEXT.toISOString(),
    ...over
  }
}

/** Marcação gerada pelo modelo (o texto puro não pode ter nenhuma). */
const HTML_TAG = /<\/?(?:table|tr|td|th|p|div|span|strong|br|html|body)\b/i

const skipped = (n: number, reason = 'Arquivo em uso (ignorado)') =>
  Array.from({ length: n }, (_, i) => ({
    path: `C:\\Dados\\Financeiro\\2026\\Notas fiscais\\NF-${String(i + 1).padStart(4, '0')}.xml`,
    reason
  }))

/* ------------------------------------------------------------------ */
/* Assunto                                                             */
/* ------------------------------------------------------------------ */

describe('assunto', () => {
  it('segue o padrão com status, rotina, cliente, computador, data e hora', () => {
    expect(buildRunSubject(ctx(run('success')))).toBe(
      '[BC Backup] Concluído – Financeiro diário – Padaria Pão Quente (PC-RECEPCAO) – 04/10 18:00'
    )
  })

  it('usa o rótulo pt-BR de cada status', () => {
    const labels: Record<FinalRunStatus, string> = {
      success: 'Concluído',
      warning: 'Com avisos',
      failed: 'Falhou',
      cancelled: 'Cancelado'
    }
    for (const [status, label] of Object.entries(labels) as [FinalRunStatus, string][]) {
      expect(renderRunEmail(ctx(run(status))).subject.startsWith(`[BC Backup] ${label} – `)).toBe(true)
    }
  })

  it('omite o cliente sem deixar traços sobrando', () => {
    const c = ctx(run('success'))
    c.settings = { ...c.settings, clientName: '  ' }
    expect(buildRunSubject(c)).toBe('[BC Backup] Concluído – Financeiro diário (PC-RECEPCAO) – 04/10 18:00')
  })

  it('omite o computador quando não há apelido nem hostname', () => {
    const c = ctx(run('success'), { hostname: '' })
    c.settings = { ...c.settings, computerAlias: '' }
    expect(buildRunSubject(c)).toBe(
      '[BC Backup] Concluído – Financeiro diário – Padaria Pão Quente – 04/10 18:00'
    )
    c.settings = { ...c.settings, clientName: '' }
    expect(buildRunSubject(c)).toBe('[BC Backup] Concluído – Financeiro diário – 04/10 18:00')
  })

  it('usa o hostname quando não há apelido e o cliente da rotina tem prioridade', () => {
    const c = ctx(run('failed'))
    c.settings = { ...c.settings, computerAlias: '' }
    c.routine = { ...c.routine, notification: { ...c.routine.notification, clientName: 'Filial Centro' } }
    expect(buildRunSubject(c)).toBe(
      '[BC Backup] Falhou – Financeiro diário – Filial Centro (DESKTOP-7F3K2LQ) – 04/10 18:00'
    )
  })

  it('remove quebras de linha e caracteres de controle (injeção de cabeçalho)', () => {
    const c = ctx(run('success'))
    c.routine = { ...c.routine, name: 'Fotos\r\nBcc: x@y.com\tescritório' }
    const s = buildRunSubject(c)
    expect(s).not.toMatch(/[\r\n\t]/)
    expect(s).toContain('Fotos Bcc: x@y.com escritório')
  })
})

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

describe('HTML', () => {
  it('escapa todo conteúdo do usuário e do disco', () => {
    const evil = '<script>alert("x")</script>'
    const r = run('warning', {
      errorMessage: `Falha <b>grave</b> & "aspas"`,
      destinations: [
        dest({
          label: `<img src=x onerror=alert(1)>`,
          path: `E:\\"><svg onload=alert(1)>`,
          outputPath: undefined,
          status: 'failed',
          error: '<iframe src="javascript:alert(1)">',
          skipped: [{ path: `C:\\${evil}.txt`, reason: `<a href="http://mal.example">clique</a>` }]
        })
      ]
    })
    const c = ctx(r, { appVersion: '<v1>' })
    c.routine = { ...c.routine, name: evil }
    c.settings = { clientName: `Tom & Jerry's <Ltda>`, computerAlias: '<pc>', companyName: '<Empresa "X">' }
    const { html, text } = renderRunEmail(c)

    for (const raw of [
      '<script',
      '<img src=x',
      '<svg onload',
      '<iframe',
      '<a href="http://mal',
      '<b>grave',
      '<pc>',
      '<Ltda>',
      '<Empresa',
      '<v1>'
    ]) {
      expect(html).not.toContain(raw)
    }
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(html).toContain('Tom &amp; Jerry&#39;s &lt;Ltda&gt;')
    expect(html).toContain('&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;')
    // O texto puro não é HTML: mantém os caracteres originais.
    expect(text).toContain(evil)
  })

  it('escapeHtml cobre & < > " e \'', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('não usa imagens remotas, SVG nem scripts', () => {
    const { html } = renderRunEmail(ctx(run('success')))
    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toMatch(/<svg\b/i)
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).toContain('width="600"')
  })

  it.each([
    ['success', 'Backup concluído', '#16794A'],
    ['warning', 'Backup concluído com avisos', '#9C540A'],
    ['failed', 'O backup falhou', '#C42727'],
    ['cancelled', 'Backup cancelado', '#4F5059']
  ] as const)('status %s: faixa com título e cor certos', (status, title, color) => {
    const { html } = renderRunEmail(ctx(run(status)))
    expect(html).toContain(`>${title}</div>`)
    expect(html).toContain(`bgcolor="${color}"`)
  })

  it('cumprimenta o cliente e resume a execução em uma frase', () => {
    const { html } = renderRunEmail(ctx(run('success')))
    expect(html).toContain('Olá, Padaria Pão Quente,')
    expect(html).toContain(
      'foi concluído com sucesso: 1.204 arquivos (2,1 GB) copiados para HD externo azul em 3min 12s.'
    )
    for (const label of [
      'Rotina',
      'Computador',
      'Início',
      'Fim',
      'Duração',
      'Arquivos copiados',
      'Tamanho',
      'Avisos',
      'Erros'
    ]) {
      expect(html).toMatch(new RegExp(`>${label}</(td|div)>`))
    }
    expect(html).toContain('PC-RECEPCAO (DESKTOP-7F3K2LQ)')
    expect(html).toContain('04/10/2026 às 18:00')
    expect(html).toContain('04/10/2026 às 18:03')
    expect(html).toContain('terça-feira, 06/10/2026 às 18:00')
    expect(html).toContain('Enviado automaticamente pelo TecnoSul Informática · BC Backup v0.1.0')
  })

  it('sem cliente, o cumprimento é neutro; marca padrão não se repete no rodapé', () => {
    const c = ctx(run('success'))
    c.settings = { clientName: '', computerAlias: '', companyName: 'BC Backup' }
    const { html, text } = renderRunEmail(c)
    expect(html).toContain('>Olá,</p>')
    expect(html).toContain('Enviado automaticamente pelo BC Backup v0.1.0')
    expect(html).not.toContain('pelo BC Backup · BC Backup')
    expect(text).toContain('Enviado automaticamente pelo BC Backup v0.1.0')
  })

  it('lista no máximo 20 itens e informa quantos ficaram de fora', () => {
    const r = run('warning', {
      filesSkipped: 25,
      warnings: 25,
      destinations: [dest({ status: 'warning', skipped: skipped(25) })]
    })
    const { html, text } = renderRunEmail(ctx(r))
    expect(MAX_LISTED_ISSUES).toBe(20)
    expect(html.match(/NF-\d{4}\.xml/g)).toHaveLength(20)
    expect(html).toContain('NF-0020.xml')
    expect(html).not.toContain('NF-0021.xml')
    expect(html).toContain('+5 outros</strong>')
    expect(text).toContain('+5 outros — veja a lista completa no Histórico do BC Backup.')
    expect(text).toContain('ARQUIVOS IGNORADOS (25)')
    expect(text.match(/NF-\d{4}\.xml/g)).toHaveLength(20)
  })

  it('não repete o mesmo arquivo ignorado em dois destinos', () => {
    const r = run('warning', {
      destinations: [
        dest({ skipped: skipped(2) }),
        dest({ destinationId: 'd2', path: '\\\\SERVIDOR\\backup', skipped: skipped(3) })
      ]
    })
    expect(collectIssues(r)).toHaveLength(3)
  })

  it('erro geral entra na lista só quando não aparece em outro lugar do e-mail', () => {
    const msg = 'Destino indisponível: conecte o disco HD externo azul.'
    // Falha: o motivo já está na frase-resumo.
    expect(
      collectIssues(run('failed', { errorMessage: msg, destinations: [dest({ skipped: skipped(1) })] }))
    ).toHaveLength(1)
    // Já aparece na linha do destino.
    expect(
      collectIssues(
        run('warning', {
          errorMessage: msg,
          destinations: [dest({ error: msg }), dest({ skipped: skipped(1) })]
        })
      )
    ).toHaveLength(1)
    // Aviso com erro geral próprio: entra primeiro, como erro.
    const issues = collectIssues(
      run('warning', {
        errorMessage: 'Falha ao verificar a cópia.',
        destinations: [dest({ skipped: skipped(2) })]
      })
    )
    expect(issues).toHaveLength(3)
    expect(issues[0]).toEqual({ level: 'error', path: '', reason: 'Falha ao verificar a cópia.' })
    const { html, text } = renderRunEmail(
      ctx(
        run('warning', {
          errorMessage: 'Falha ao verificar a cópia.',
          destinations: [dest({ skipped: skipped(2) })]
        })
      )
    )
    expect(html).toContain('Arquivos ignorados e erros')
    expect(html.indexOf('Falha ao verificar a cópia.')).toBeLessThan(html.indexOf('NF-0001.xml'))
    expect(text).toContain('Erro: Falha ao verificar a cópia.')
  })

  it('agrupa os arquivos ignorados por motivo', () => {
    const r = run('warning', {
      destinations: [
        dest({
          skipped: [
            ...skipped(3),
            ...skipped(2, 'Sem permissão de leitura').map((s) => ({ ...s, path: s.path + '.bak' }))
          ]
        })
      ]
    })
    const { html, text } = renderRunEmail(ctx(r))
    expect(html).toContain('Arquivo em uso (ignorado)</strong>')
    expect(html).toContain('3 arquivos</span>')
    expect(html).toContain('Sem permissão de leitura</strong>')
    expect(text).toContain(
      '  Arquivo em uso (ignorado) (3 arquivos)\n    • C:\\Dados\\Financeiro\\2026\\Notas fiscais\\NF-0001.xml'
    )
    expect(text).toContain('  Sem permissão de leitura (2 arquivos)')
  })

  it('tabela de destinos traz caminho, status, arquivos, tamanho e removidos', () => {
    const r = run('warning', {
      destinationCount: 2,
      destinations: [
        dest(),
        dest({
          destinationId: 'd2',
          label: undefined,
          path: '\\\\NAS\\Backups',
          outputPath: undefined,
          status: 'failed',
          filesCopied: 0,
          bytesCopied: 0,
          pruned: [],
          freeBytesAfter: undefined,
          error: 'Sem espaço em \\\\NAS\\Backups (faltam 12 GB).'
        })
      ]
    })
    const { html } = renderRunEmail(ctx(r))
    expect(html).toContain('E:\\BC Backup\\Financeiro diário\\2026-10-04_18-00-05')
    expect(html).toContain('120 GB livres')
    expect(html).toContain('\\\\NAS\\Backups')
    expect(html).toContain('Sem espaço em')
    expect(html).toContain('>Antigos removidos</th>')
    expect(html.match(/>Falhou<\/span>/g)?.length).toBeGreaterThanOrEqual(1)
  })

  it('próximo backup: data, "nenhum agendamento" ou omitido', () => {
    expect(renderRunEmail(ctx(run('success'), { nextRunAt: null })).html).toContain('nenhum agendamento')
    const omitted = renderRunEmail(ctx(run('success'), { nextRunAt: undefined }))
    expect(omitted.html).not.toContain('Próximo backup')
    expect(omitted.text).not.toContain('Próximo backup')
  })

  it('falha e cancelamento avisam que nada antigo foi apagado', () => {
    const failed = renderRunEmail(
      ctx(
        run('failed', {
          errorMessage: 'Origem não encontrada: C:\\Dados.',
          destinations: [dest({ status: 'failed', pruned: [] })]
        })
      )
    )
    expect(failed.text).toContain(
      'falhou: Origem não encontrada: C:\\Dados. Nenhum backup antigo foi apagado.'
    )
    const cancelled = renderRunEmail(
      ctx(run('cancelled', { destinations: [dest({ status: 'cancelled', pruned: [] })] }))
    )
    expect(cancelled.text).toContain('foi cancelado antes de terminar. Nenhum backup antigo foi apagado.')
  })

  it('menciona o log anexado conforme a configuração da rotina', () => {
    const r = run('failed', { destinations: [dest({ status: 'failed', pruned: [], skipped: skipped(22) })] })
    expect(renderRunEmail(ctx(r)).html).toContain('log anexado')
    expect(renderRunEmail(ctx(r, { logAttached: false })).html).toContain('Histórico do BC Backup')
  })
})

/* ------------------------------------------------------------------ */
/* Texto puro                                                          */
/* ------------------------------------------------------------------ */

describe('texto puro', () => {
  it('traz as mesmas informações, sem HTML', () => {
    const r = run('warning', {
      filesSkipped: 3,
      warnings: 3,
      destinations: [dest({ status: 'warning', skipped: skipped(3) })]
    })
    const { text } = renderRunEmail(ctx(r))
    expect(text).not.toMatch(HTML_TAG)
    expect(text).not.toContain('&amp;')
    expect(text.startsWith('BACKUP CONCLUÍDO COM AVISOS\n')).toBe(true)
    expect(text).toContain('Olá, Padaria Pão Quente,')
    for (const label of [
      'Rotina:',
      'Computador:',
      'Início:',
      'Fim:',
      'Duração:',
      'Arquivos copiados:',
      'Tamanho:',
      'Avisos:',
      'Erros:'
    ]) {
      expect(text).toContain(label)
    }
    expect(text).toContain('• HD externo azul — Com avisos')
    expect(text).toContain('1.204 arquivos · 2,1 GB · 1 backup antigo removido · 120 GB livres')
    expect(text).toContain(
      'ARQUIVOS IGNORADOS (3)\n  Arquivo em uso (ignorado) (3 arquivos)\n    • C:\\Dados\\Financeiro\\2026\\Notas fiscais\\NF-0001.xml'
    )
    expect(text).toContain('Próximo backup: terça-feira, 06/10/2026 às 18:00')
    expect(text).toContain('Enviado automaticamente pelo TecnoSul Informática · BC Backup v0.1.0')
  })
})

/* ------------------------------------------------------------------ */
/* E-mail de teste                                                     */
/* ------------------------------------------------------------------ */

describe('e-mail de teste', () => {
  it('confirma que o SMTP funciona e escapa os campos', () => {
    const { subject, html, text } = renderTestEmail({
      companyName: 'TecnoSul <Informática>',
      hostname: 'DESKTOP-7F3K2LQ',
      appVersion: '0.1.0',
      clientName: 'Padaria Pão Quente',
      computerAlias: 'PC-RECEPCAO',
      smtpServer: 'smtp.gmail.com:465 (SSL/TLS)',
      sentAt: START
    })
    expect(subject).toBe('[BC Backup] E-mail de teste – PC-RECEPCAO')
    expect(html).toContain('Tudo certo com o envio de <span style="white-space:nowrap;">e-mails</span>')
    expect(html).toContain('TecnoSul &lt;Informática&gt;')
    expect(html).not.toContain('<Informática>')
    expect(html).toContain('04/10/2026 às 18:00')
    expect(text).toContain('Olá, Padaria Pão Quente!')
    expect(text).toContain('smtp.gmail.com:465 (SSL/TLS)')
    expect(text).not.toMatch(HTML_TAG)
  })

  it('funciona só com os campos obrigatórios', () => {
    const { subject, html } = renderTestEmail({
      companyName: 'BC Backup',
      hostname: 'PC1',
      appVersion: '1.2.3'
    })
    expect(subject).toBe('[BC Backup] E-mail de teste – PC1')
    expect(html).toContain('Enviado automaticamente pelo BC Backup v1.2.3')
  })
})

/* ------------------------------------------------------------------ */
/* Prévias (opcional)                                                  */
/* ------------------------------------------------------------------ */

describe.runIf(process.env.PREVIEW)('prévias', () => {
  it('grava docs/email-preview/*.html e *.png', { timeout: 60_000 }, async () => {
    const out = resolve(__dirname, '../docs/email-preview')
    mkdirSync(out, { recursive: true })

    const sucesso = ctx(
      run('success', {
        destinationCount: 2,
        destinations: [
          dest(),
          dest({
            destinationId: 'd2',
            label: 'Servidor do escritório',
            path: '\\\\SERVIDOR\\backup',
            outputPath: '\\\\SERVIDOR\\backup\\BC Backup\\Financeiro diário\\2026-10-04_18-00-05',
            pruned: [],
            freeBytesAfter: 912_680_550_400
          })
        ]
      })
    )
    const avisos = ctx(
      run('warning', {
        filesTotal: 1231,
        filesCopied: 1204,
        filesSkipped: 27,
        warnings: 27,
        destinations: [
          dest({
            status: 'warning',
            skipped: [
              { path: 'C:\\Dados\\Financeiro\\Sistema\\banco.mdb', reason: 'Arquivo em uso (ignorado)' },
              { path: 'C:\\Dados\\Financeiro\\Sistema\\banco.ldb', reason: 'Arquivo em uso (ignorado)' },
              {
                path: 'C:\\Dados\\Financeiro\\Planilhas\\~$Fluxo de caixa 2026.xlsx',
                reason: 'Sem permissão de leitura'
              },
              ...skipped(24)
            ]
          })
        ]
      })
    )
    const falha = ctx(
      run('failed', {
        filesCopied: 0,
        bytesCopied: 0,
        errors: 1,
        trigger: 'catch-up',
        errorMessage: 'Destino indisponível: verifique se o disco “HD externo azul” está conectado.',
        destinations: [
          dest({
            status: 'failed',
            outputPath: undefined,
            filesCopied: 0,
            bytesCopied: 0,
            pruned: [],
            freeBytesAfter: undefined,
            error: 'Destino indisponível: verifique se o disco “HD externo azul” está conectado.'
          })
        ]
      })
    )
    const files: Record<string, string> = {
      sucesso: renderRunEmail(sucesso).html,
      avisos: renderRunEmail(avisos).html,
      falha: renderRunEmail(falha).html,
      teste: renderTestEmail({
        companyName: 'TecnoSul Informática',
        hostname: 'DESKTOP-7F3K2LQ',
        appVersion: '0.1.0',
        clientName: 'Padaria Pão Quente',
        computerAlias: 'PC-RECEPCAO',
        smtpServer: 'smtp.gmail.com:465 (SSL/TLS)',
        sentAt: START
      }).html
    }
    for (const [name, html] of Object.entries(files)) writeFileSync(join(out, `${name}.html`), html)

    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch(
      process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
    )
    try {
      for (const [name, html] of Object.entries(files)) {
        for (const [suffix, width] of [
          ['', 720],
          ['-celular', 390]
        ] as const) {
          const page = await browser.newPage({
            viewport: { width, height: 800 },
            deviceScaleFactor: suffix ? 2 : 1
          })
          await page.setContent(html)
          await page.screenshot({ path: join(out, `${name}${suffix}.png`), fullPage: true })
          await page.close()
        }
      }
    } finally {
      await browser.close()
    }
  })
})
