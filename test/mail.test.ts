import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { join } from 'node:path'
import type { AppSettings, RunRecord } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { isSmtpConfigured, sendMail, smtpErrorMessage, transportOptions } from '../src/main/mail/smtp'
import { decideRunEmail, runLogText } from '../src/main/mail/compose'
import { Outbox } from '../src/main/mail/outbox'
import { makeRoutine, tempDir } from './helpers'

describe('erros SMTP → mensagens pt-BR', () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ code: 'EAUTH', responseCode: 535 }, /Usuário ou senha recusados.*senha de app/],
    [
      { code: 'ESOCKET', message: 'C0:error:0A00010B:SSL routines:ssl3_get_record:wrong version number' },
      /465 com SSL\/TLS ou 587 com STARTTLS/
    ],
    [{ code: 'ECONNECTION', message: 'wrong version number' }, /465 com SSL\/TLS ou 587 com STARTTLS/],
    [{ code: 'ESOCKET', message: 'connect ECONNREFUSED 127.0.0.1:2525' }, /Conexão recusada/],
    [{ code: 'ETIMEDOUT', message: 'Greeting never received' }, /Tempo esgotado/],
    [{ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.x' }, /não encontrado/],
    [{ code: 'EENVELOPE', message: 'No recipients defined' }, /Remetente ou destinatário recusado/],
    [{ code: 'ENOAUTH' }, /exige autenticação/],
    [{ code: 'ETLS', message: 'Error upgrading connection with STARTTLS' }, /TLS/],
    [
      {
        code: 'EAUTH',
        response: '535 5.7.139 Authentication unsuccessful, basic authentication is disabled'
      },
      /Microsoft recusou a autenticação básica/
    ],
    [
      { code: 'ESOCKET', message: 'self-signed certificate in certificate chain' },
      /Certificado do servidor inválido/
    ],
    [new Error('algo estranho'), /Erro ao enviar e-mail: algo estranho/]
  ]
  for (const [err, re] of cases) {
    it(`${(err as { code?: string }).code ?? 'genérico'} → ${re}`, () => {
      expect(smtpErrorMessage(err, { port: 587, host: 'smtp.x' })).toMatch(re)
    })
  }
})

describe('transporte', () => {
  const smtp = {
    ...DEFAULT_SETTINGS.smtp,
    host: 'smtp.gmail.com',
    user: 'eu@gmail.com',
    fromEmail: 'eu@gmail.com'
  }
  it('ssl → secure (465); starttls → requireTLS; none → ignoreTLS; certificado inválido opcional', () => {
    expect(transportOptions({ ...smtp, port: 465, security: 'ssl' }, 'x')).toMatchObject({
      secure: true,
      requireTLS: false,
      port: 465
    })
    expect(transportOptions({ ...smtp, security: 'starttls' }, 'x')).toMatchObject({
      secure: false,
      requireTLS: true
    })
    expect(transportOptions({ ...smtp, security: 'none' }, 'x')).toMatchObject({
      secure: false,
      ignoreTLS: true
    })
    const o = transportOptions({ ...smtp, allowInvalidCert: true, timeoutSec: 30 }, 'x')
    expect(o.tls.rejectUnauthorized).toBe(false)
    expect(o.connectionTimeout).toBe(15_000)
    expect(o.socketTimeout).toBe(30_000)
    expect(o.auth).toEqual({ user: 'eu@gmail.com', pass: 'x' })
  })
  it('isSmtpConfigured', () => {
    expect(isSmtpConfigured(DEFAULT_SETTINGS)).toBe(false)
    expect(isSmtpConfigured({ smtp: smtp })).toBe(true)
  })
})

function run(patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    routineId: 'rot-1',
    routineName: 'Financeiro diário',
    status: 'failed',
    trigger: 'schedule',
    startedAt: '2026-10-04T21:00:00.000Z',
    finishedAt: '2026-10-04T21:05:00.000Z',
    durationMs: 300_000,
    filesTotal: 10,
    filesCopied: 8,
    filesSkipped: 2,
    bytesTotal: 1000,
    bytesCopied: 800,
    warnings: 2,
    errors: 1,
    destinationCount: 1,
    errorMessage: 'Destino indisponível: verifique se o disco está conectado.',
    destinations: [
      {
        destinationId: 'd',
        path: 'E:\\',
        label: 'HD azul',
        status: 'failed',
        filesCopied: 0,
        bytesCopied: 0,
        skipped: [],
        pruned: [],
        error: 'Destino indisponível'
      }
    ],
    log: [{ t: '2026-10-04T21:00:00.000Z', level: 'error', message: 'Destino indisponível' }],
    ...patch
  }
}

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  clientName: 'Padaria Pão Quente',
  smtp: {
    ...DEFAULT_SETTINGS.smtp,
    host: '127.0.0.1',
    port: 2525,
    security: 'none',
    fromEmail: 'backup@padaria.com.br'
  }
}

describe('decideRunEmail', () => {
  const notif = {
    enabled: true,
    recipients: ['dono@padaria.com.br'],
    bcc: ['tecnico@bc.com.br'],
    onSuccess: false,
    onWarning: true,
    onFailure: true,
    attachLog: 'onFailure' as const
  }
  const ctx = { hostname: 'PC-RECEPCAO', appVersion: '0.1.0', nextRunAt: null }

  it('desligado → not_configured; SMTP vazio → not_configured', () => {
    const r = makeRoutine()
    expect(decideRunEmail({ run: run(), routine: r, settings, ...ctx }).status).toBe('not_configured')
    expect(
      decideRunEmail({
        run: run(),
        routine: makeRoutine({ notification: notif }),
        settings: DEFAULT_SETTINGS,
        ...ctx
      }).status
    ).toBe('not_configured')
  })
  it('status não marcado → skipped; cancelado → skipped', () => {
    const r = makeRoutine({ notification: notif })
    expect(decideRunEmail({ run: run({ status: 'success' }), routine: r, settings, ...ctx }).status).toBe(
      'skipped'
    )
    expect(decideRunEmail({ run: run({ status: 'cancelled' }), routine: r, settings, ...ctx }).status).toBe(
      'skipped'
    )
  })
  it('falha → envia com cópia oculta e log anexado (.txt)', () => {
    const d = decideRunEmail({ run: run(), routine: makeRoutine({ notification: notif }), settings, ...ctx })
    expect(d.status).toBe('send')
    if (d.status !== 'send') return
    expect(d.mail.to).toEqual(['dono@padaria.com.br'])
    expect(d.mail.bcc).toEqual(['tecnico@bc.com.br'])
    expect(d.mail.subject).toContain('Financeiro diário')
    expect(d.mail.attachments?.[0].filename).toMatch(
      /^log-Financeiro diário-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.txt$/
    )
    expect(d.mail.attachments?.[0].content).toContain('Destino indisponível')
  })
  it('aviso com attachLog=onFailure → sem anexo', () => {
    const d = decideRunEmail({
      run: run({ status: 'warning' }),
      routine: makeRoutine({ notification: notif }),
      settings,
      ...ctx
    })
    expect(d.status === 'send' && d.mail.attachments).toBeFalsy()
  })
  it('runLogText', () => {
    const t = runLogText(run(), { computer: 'PC', appVersion: '0.1.0' })
    expect(t).toContain('Rotina: Financeiro diário')
    expect(t).toContain('Status: Falha')
    expect(t).toContain('ERROR Destino indisponível')
  })
})

/** Servidor SMTP falso mínimo (sem TLS). mode 'auth-fail' responde 535 ao AUTH. */
function fakeSmtp(mode: 'ok' | 'auth-fail'): Promise<{ server: Server; port: number; messages: string[] }> {
  const messages: string[] = []
  const server = createServer((sock) => {
    let inData = false
    let buf = ''
    let data = ''
    sock.write('220 fake ESMTP\r\n')
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let i
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (inData) {
          if (line === '.') {
            inData = false
            messages.push(data)
            data = ''
            sock.write('250 OK queued\r\n')
          } else data += `${line}\n`
          continue
        }
        const cmd = line.slice(0, 4).toUpperCase()
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n')
        else if (cmd === 'AUTH')
          sock.write(mode === 'auth-fail' ? '535 5.7.8 Authentication failed\r\n' : '235 OK\r\n')
        else if (cmd === 'MAIL' || cmd === 'RCPT') sock.write('250 OK\r\n')
        else if (cmd === 'DATA') {
          inData = true
          sock.write('354 go\r\n')
        } else if (cmd === 'QUIT') {
          sock.write('221 bye\r\n')
          sock.end()
        } else sock.write('250 OK\r\n')
      }
    })
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port, messages })
    )
  )
}

describe('envio real contra servidor SMTP falso', () => {
  let srv: Awaited<ReturnType<typeof fakeSmtp>> | null = null
  afterEach(async () => {
    await new Promise<void>((r) => (srv ? srv.server.close(() => r()) : r()))
    srv = null
  })

  it('envia o e-mail consolidado com anexo', async () => {
    srv = await fakeSmtp('ok')
    const s = { ...settings.smtp, port: srv.port, user: 'backup@padaria.com.br' }
    const d = decideRunEmail({
      run: run(),
      routine: makeRoutine({
        notification: {
          enabled: true,
          recipients: ['dono@padaria.com.br'],
          bcc: [],
          onSuccess: true,
          onWarning: true,
          onFailure: true,
          attachLog: 'always'
        }
      }),
      settings: { ...settings, smtp: s },
      hostname: 'PC',
      appVersion: '0.1.0',
      nextRunAt: null
    })
    if (d.status !== 'send') throw new Error('esperava envio')
    await sendMail(s, 'senha', d.mail)
    expect(srv.messages.length).toBe(1)
    expect(srv.messages[0]).toMatch(/Content-Disposition: attachment/)
    expect(srv.messages[0]).toMatch(/To: dono@padaria\.com\.br/)
  })

  it('senha errada → EAUTH → mensagem amigável', async () => {
    srv = await fakeSmtp('auth-fail')
    const s = { ...settings.smtp, port: srv.port, user: 'eu@x.com' }
    const err = await sendMail(s, 'errada', { to: ['a@b.com'], subject: 't', html: 't', text: 't' }).catch(
      (e) => e
    )
    expect(err.code).toBe('EAUTH')
    expect(smtpErrorMessage(err, s)).toMatch(/Usuário ou senha recusados/)
  })

  it('porta fechada → conexão recusada', async () => {
    const tmp = await fakeSmtp('ok')
    const port = tmp.port
    await new Promise<void>((r) => tmp.server.close(() => r()))
    const s = { ...settings.smtp, port }
    const err = await sendMail(s, '', { to: ['a@b.com'], subject: 't', html: 't', text: 't' }).catch((e) => e)
    expect(smtpErrorMessage(err, s)).toMatch(/Conexão recusada|Não foi possível conectar/)
  })
})

describe('Outbox (fila de saída)', () => {
  let dir: string
  let cleanup: () => Promise<void>
  beforeEach(async () => {
    ;({ dir, cleanup } = await tempDir('bcb-outbox-'))
  })
  afterEach(() => cleanup())

  it('tenta a cada 15 min; envia quando a rede volta; persiste no disco', async () => {
    let now = new Date('2026-10-04T10:00:00Z')
    let online = false
    const sent: string[] = []
    const deps = {
      file: join(dir, 'outbox.json'),
      now: () => now,
      send: async () => {
        if (!online) throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'EDNS' })
      },
      onSent: (item: { runId: string }) => {
        sent.push(item.runId)
      },
      onExpired: () => {},
      errorMessage: (e: unknown) => smtpErrorMessage(e)
    }
    const ob = await Outbox.open(deps)
    await ob.add('run-1', { to: ['a@b.com'], subject: 's', html: 'h', text: 't' }, 'sem internet')
    ob.stop()
    await ob.processDue() // ainda não venceu
    expect(ob.items()[0].attempts).toBe(1)
    now = new Date('2026-10-04T10:15:01Z')
    await ob.processDue()
    ob.stop()
    expect(ob.items()[0].attempts).toBe(2)
    expect(ob.items()[0].lastError).toMatch(/não encontrado/)
    // Reabre do disco (app reiniciado) e a rede voltou.
    const ob2 = await Outbox.open(deps)
    expect(ob2.items().length).toBe(1)
    online = true
    now = new Date('2026-10-04T10:31:00Z')
    await ob2.processDue()
    ob2.stop()
    expect(sent).toEqual(['run-1'])
    expect(ob2.items()).toEqual([])
  })

  it('desiste depois de 24 h → onExpired', async () => {
    let now = new Date('2026-10-04T10:00:00Z')
    const expired: string[] = []
    const ob = await Outbox.open({
      file: join(dir, 'outbox.json'),
      now: () => now,
      send: async () => {
        throw Object.assign(new Error('x'), { code: 'EAUTH' })
      },
      onSent: () => {},
      onExpired: (item, err) => {
        expired.push(`${item.runId}:${err}`)
      },
      errorMessage: (e) => smtpErrorMessage(e)
    })
    await ob.add('run-9', { to: ['a@b.com'], subject: 's', html: 'h', text: 't' }, 'falhou')
    now = new Date('2026-10-05T09:50:00Z')
    await ob.processDue()
    ob.stop()
    expect(expired.length).toBe(1)
    expect(expired[0]).toMatch(/^run-9:Usuário ou senha/)
    expect(ob.items()).toEqual([])
  })
})
