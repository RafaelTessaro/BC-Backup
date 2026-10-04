// Envio SMTP com nodemailer 10 (guia §10). Node puro — a senha chega já decifrada.

import { createTransport } from 'nodemailer'
import type { AppSettings, SmtpSettings } from '@shared/types'

export interface OutgoingMail {
  to: string[]
  bcc?: string[]
  subject: string
  html: string
  text: string
  attachments?: Array<{ filename: string; content: string }>
}

export interface TransportOverrides {
  /** Tempo limite de conexão/saudação em ms (padrão 15 s). */
  connectTimeoutMs?: number
}

/** SMTP mínimo preenchido para tentar enviar. */
export function isSmtpConfigured(s: Pick<AppSettings, 'smtp'> | SmtpSettings): boolean {
  const smtp = 'smtp' in s ? s.smtp : s
  return !!smtp.host.trim() && smtp.port > 0 && !!(smtp.fromEmail.trim() || smtp.user.trim())
}

/** Mapeamento do doc 01 §7: ssl → secure (465), starttls → requireTLS (587), none → ignoreTLS. */
export function transportOptions(smtp: Omit<SmtpSettings, 'hasPassword'>, password: string, o: TransportOverrides = {}) {
  const connect = o.connectTimeoutMs ?? 15_000
  return {
    host: smtp.host.trim(),
    port: smtp.port,
    secure: smtp.security === 'ssl',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: smtp.user.trim() ? { user: smtp.user.trim(), pass: password } : undefined,
    connectionTimeout: connect,
    greetingTimeout: connect,
    socketTimeout: Math.max(5, smtp.timeoutSec || 30) * 1000,
    tls: {
      minVersion: 'TLSv1.2' as const,
      rejectUnauthorized: !smtp.allowInvalidCert,
      servername: smtp.host.trim()
    }
  }
}

function quoteName(name: string): string {
  return `"${name.replace(/["\\\r\n]/g, ' ').trim()}"`
}

export function fromAddress(smtp: Omit<SmtpSettings, 'hasPassword'>): string {
  const email = smtp.fromEmail.trim() || smtp.user.trim()
  const name = smtp.fromName.trim()
  return name ? `${quoteName(name)} <${email}>` : email
}

export async function sendMail(
  smtp: Omit<SmtpSettings, 'hasPassword'>,
  password: string,
  mail: OutgoingMail,
  o: TransportOverrides = {}
): Promise<void> {
  const transporter = createTransport(transportOptions(smtp, password, o))
  try {
    await transporter.sendMail({
      from: fromAddress(smtp),
      to: mail.to.length ? mail.to : undefined,
      bcc: mail.bcc?.length ? mail.bcc : undefined,
      replyTo: smtp.replyTo.trim() || undefined,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments: mail.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: 'text/plain; charset=utf-8'
      }))
    })
  } finally {
    transporter.close()
  }
}

interface SmtpErrorLike {
  code?: string
  responseCode?: number
  response?: string
  message?: string
  command?: string
}

/** Erro técnico do nodemailer → mensagem amigável em pt-BR (doc 01 §7, guia §10). */
export function smtpErrorMessage(e: unknown, smtp?: Pick<SmtpSettings, 'port' | 'host'>): string {
  const err: SmtpErrorLike = e && typeof e === 'object' ? (e as SmtpErrorLike) : { message: String(e) }
  const msg = err.message ?? ''
  const resp = err.response ?? ''
  const port = smtp?.port ? ` (porta ${smtp.port})` : ''

  if (/5\.7\.30|basic authentication is (not supported|disabled)/i.test(resp + msg)) {
    return 'A Microsoft recusou a autenticação básica (SMTP AUTH). Peça ao administrador do Microsoft 365 para habilitá-la ou use outro provedor.'
  }
  if (/wrong version number|tls_validate_record_header|ssl3_get_record|packet length too long|unknown protocol/i.test(msg)) {
    return 'A porta e a segurança não combinam. Use 465 com SSL/TLS ou 587 com STARTTLS.'
  }
  if (/self[- ]signed|unable to verify|certificate|CERT_|ERR_TLS_CERT/i.test(msg) && err.code !== 'EAUTH') {
    return 'Certificado do servidor inválido. Só marque "Ignorar erros de certificado" se confiar no servidor.'
  }
  switch (err.code) {
    case 'EAUTH':
      return 'Usuário ou senha recusados. No Gmail ou Outlook com verificação em duas etapas, use uma "senha de app", não a senha normal.'
    case 'ENOAUTH':
      return 'O servidor exige autenticação: preencha o usuário e a senha.'
    case 'EDNS':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Servidor SMTP não encontrado. Confira o endereço e a conexão com a internet.'
    case 'ETIMEDOUT':
      return `Tempo esgotado ao falar com o servidor${port}. Confira servidor e porta, e se um firewall ou antivírus bloqueia o envio.`
    case 'ECONNREFUSED':
      return `Conexão recusada${port}: porta fechada ou servidor incorreto.`
    case 'ESOCKET':
    case 'ECONNECTION':
      if (/ECONNREFUSED/.test(msg)) return `Conexão recusada${port}: porta fechada ou servidor incorreto.`
      if (/ETIMEDOUT|timed? ?out/i.test(msg)) {
        return `Tempo esgotado ao falar com o servidor${port}. Confira servidor e porta, e se um firewall ou antivírus bloqueia o envio.`
      }
      if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Servidor SMTP não encontrado. Confira o endereço e a conexão com a internet.'
      return `Não foi possível conectar ao servidor SMTP${port}. Verifique a internet, o firewall e a porta.`
    case 'ETLS':
      return 'Falha ao negociar a conexão segura (TLS/STARTTLS). Use 465 com SSL/TLS ou 587 com STARTTLS.'
    case 'EENVELOPE':
      return 'Remetente ou destinatário recusado pelo servidor. Use como remetente o mesmo e-mail da conta.'
    case 'EMESSAGE':
      if (/^55[0-4]|5\.7\.1|sender|from/i.test(resp)) return 'Remetente recusado: use como remetente o mesmo e-mail da conta.'
      return `O servidor recusou a mensagem: ${resp || msg}`
    default:
      if (err.responseCode === 535) {
        return 'Usuário ou senha recusados. No Gmail ou Outlook com verificação em duas etapas, use uma "senha de app", não a senha normal.'
      }
      if (err.responseCode === 550 || err.responseCode === 553) {
        return 'Remetente ou destinatário recusado pelo servidor. Use como remetente o mesmo e-mail da conta.'
      }
      return `Erro ao enviar e-mail: ${msg || 'erro desconhecido'}`
  }
}
