// Modelos de e-mail do BC Backup (HTML + texto puro).
//
// Contrato estável: o envio (smtp.ts) só depende de `renderRunEmail` e `renderTestEmail`.
// Regras do HTML (docs/research/03-arquitetura-tecnica.md §10): layout em tabelas, estilos inline
// (Gmail e Outlook ignoram boa parte do <style>), 600 px, fundo claro, nenhuma imagem remota nem SVG
// (o Gmail não exibe SVG), todo texto vindo do usuário ou do disco escapado.
// Prévias: docs/email-preview/ (geradas por test/mail-template.test.ts com PREVIEW=1).

// Caminhos relativos (e não o alias @shared) para o módulo também carregar no vitest sem configuração extra.
import type {
  AppSettings,
  DestinationResult,
  Routine,
  RunRecord,
  RunStatus,
  RunTrigger
} from '../../shared/types'
import { formatBytes, formatDuration } from '../../shared/format'

export interface RunEmailContext {
  run: RunRecord
  routine: Pick<Routine, 'name' | 'notification'>
  settings: Pick<AppSettings, 'clientName' | 'computerAlias' | 'companyName'>
  hostname: string
  appVersion: string
  /** Próxima execução agendada (ISO) ou null (nenhuma). `undefined` omite a linha. */
  nextRunAt?: string | null
  /**
   * O log completo segue anexado? Se omitido, é deduzido de `routine.notification.attachLog`
   * (`always`, ou `onFailure` quando a execução falhou).
   */
  logAttached?: boolean
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface TestEmailContext {
  companyName: string
  hostname: string
  appVersion: string
  /** Opcionais: deixam o e-mail de teste mais informativo. */
  clientName?: string
  computerAlias?: string
  /** Servidor SMTP usado no teste (ex.: "smtp.gmail.com:465 (SSL/TLS)"). */
  smtpServer?: string
  /** Momento do envio (padrão: agora). */
  sentAt?: string | Date
}

/** Máximo de arquivos ignorados/erros listados no corpo do e-mail. */
export const MAX_LISTED_ISSUES = 20

/* ------------------------------------------------------------------ */
/* Paleta (docs/research/02-design-system.md §3, tema claro)           */
/* ------------------------------------------------------------------ */

const C = {
  page: '#F4F4F6',
  card: '#FFFFFF',
  border: '#E4E4E8',
  tile: '#F4F4F6',
  text: '#16171B',
  text2: '#4F5059',
  text3: '#696A73',
  accent: '#3254F0',
  accentDark: '#2843D6',
  accentLight: '#5674FF',
  accentSoft: '#EEF1FE',
  accentText: '#2B48DB'
} as const

interface StatusTheme {
  /** Rótulo curto (assunto, pílula). */
  label: string
  /** Título da faixa colorida. */
  title: string
  color: string
  soft: string
  /** Texto secundário sobre a faixa (cor sólida: o Outlook não entende rgba). */
  onColor: string
  /** Símbolo dentro do círculo branco da faixa (entidade HTML). */
  symbol: string
}

const STATUS: Record<RunStatus, StatusTheme> = {
  success: {
    label: 'Concluído',
    title: 'Backup concluído',
    color: '#16794A',
    soft: '#E7F6EE',
    onColor: '#D3EEDF',
    symbol: '&#10003;'
  },
  warning: {
    label: 'Com avisos',
    title: 'Backup concluído com avisos',
    color: '#9C540A',
    soft: '#FDF3E3',
    onColor: '#F6E3CC',
    symbol: '!'
  },
  failed: {
    label: 'Falhou',
    title: 'O backup falhou',
    color: '#C42727',
    soft: '#FDEDED',
    onColor: '#F8D6D6',
    symbol: '&#10005;'
  },
  cancelled: {
    label: 'Cancelado',
    title: 'Backup cancelado',
    color: '#4F5059',
    soft: '#EEEEF1',
    onColor: '#E1E1E6',
    symbol: '&#8211;'
  },
  running: {
    label: 'Em execução',
    title: 'Backup em execução',
    color: C.accent,
    soft: C.accentSoft,
    onColor: '#DCE3FD',
    symbol: '&#8635;'
  },
  queued: {
    label: 'Na fila',
    title: 'Backup na fila',
    color: C.accent,
    soft: C.accentSoft,
    onColor: '#DCE3FD',
    symbol: '&#8635;'
  }
}

const TRIGGER_LABEL: Record<RunTrigger, string> = {
  manual: 'Manual',
  schedule: 'Agendada',
  startup: 'Ao iniciar o computador',
  'catch-up': 'Backup atrasado (recuperado ao ligar)'
}

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif`
const MONO = `Consolas,'SF Mono',Menlo,'Liberation Mono','Courier New',monospace`
const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/** Escapa texto para HTML (conteúdo e atributos). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

// Caracteres de controle + separadores de linha/parágrafo Unicode.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\u{2028}\u{2029}]+/gu

/** Uma linha só: sem quebras nem caracteres de controle (assunto, títulos, células). */
function oneLine(value: unknown): string {
  return String(value ?? '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NUM = new Intl.NumberFormat('pt-BR')
const int = (n: number | undefined): string => NUM.format(Math.max(0, Math.round(n ?? 0)))
const plural = (n: number, one: string, many: string): string => `${int(n)} ${n === 1 ? one : many}`

const pad = (n: number): string => String(n).padStart(2, '0')
const WEEKDAYS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado'
]

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "04/10/2026 às 18:00" */
function dateTime(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "terça-feira, 06/10/2026 às 18:00" */
function longDateTime(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${dateTime(d)}`
}

/** "04/10 18:00" (assunto) */
function shortDateTime(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function versionLabel(v: string): string {
  const clean = oneLine(v)
  return clean ? `v${clean.replace(/^v/i, '')}` : ''
}

const isDefaultBrand = (company: string): boolean => !company || company.toLowerCase() === 'bc backup'

/** "Enviado automaticamente pelo {empresa} · BC Backup v{versão}" sem repetir a marca. */
function footerLine(companyName: string, appVersion: string): string {
  const company = oneLine(companyName)
  const product = ['BC Backup', versionLabel(appVersion)].filter(Boolean).join(' ')
  return isDefaultBrand(company)
    ? `Enviado automaticamente pelo ${product}`
    : `Enviado automaticamente pelo ${company} · ${product}`
}

function clientOf(ctx: RunEmailContext): string {
  return oneLine(ctx.routine.notification?.clientName) || oneLine(ctx.settings.clientName)
}

/** Nome curto (apelido ou hostname) e completo ("Recepção (DESKTOP-7F3K)"). */
function computerOf(alias: string | undefined, hostname: string): { name: string; full: string } {
  const a = oneLine(alias)
  const h = oneLine(hostname)
  const name = a || h
  const full = a && h && a.toLowerCase() !== h.toLowerCase() ? `${a} (${h})` : name
  return { name, full }
}

/** Evita quebrar "e-mail" no hífen em telas estreitas. */
const keepEmailTogether = (escaped: string): string =>
  escaped.replace(/\b(e-mails?)\b/gi, '<span style="white-space:nowrap;">$1</span>')

/* ------------------------------------------------------------------ */
/* Dados derivados da execução                                         */
/* ------------------------------------------------------------------ */

export interface EmailIssue {
  level: 'error' | 'warning'
  /** Caminho do arquivo (vazio para erros gerais). */
  path: string
  reason: string
}

/**
 * Itens da lista "Arquivos ignorados e erros": arquivos pulados (sem repetição — o mesmo arquivo
 * pulado em dois destinos conta uma vez) e o erro geral da execução quando ele ainda não aparece
 * em outro lugar do e-mail (na frase de falha ou na linha do destino).
 */
export function collectIssues(run: RunRecord): EmailIssue[] {
  const out: EmailIssue[] = []
  const dests = run.destinations ?? []
  const general = oneLine(run.errorMessage)
  const shownElsewhere = run.status === 'failed' || dests.some((d) => oneLine(d.error) === general)
  if (general && !shownElsewhere) out.push({ level: 'error', path: '', reason: general })
  const seen = new Set<string>()
  for (const d of dests) {
    for (const s of d.skipped ?? []) {
      const issue: EmailIssue = {
        level: 'warning',
        path: oneLine(s.path),
        reason: oneLine(s.reason) || 'Ignorado'
      }
      const key = `${issue.path}\u0000${issue.reason}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(issue)
    }
  }
  return out
}

interface IssueGroup {
  level: EmailIssue['level']
  reason: string
  /** Total de itens com este motivo (inclusive os que não couberam). */
  total: number
  /** Itens exibidos deste grupo. */
  shown: number
  /** Caminhos exibidos. */
  paths: string[]
}

/** Agrupa por motivo (erros primeiro) e exibe no máximo MAX_LISTED_ISSUES itens no total. */
function groupIssues(issues: EmailIssue[]): { groups: IssueGroup[]; hidden: number } {
  const map = new Map<string, IssueGroup>()
  const ordered = [...issues.filter((i) => i.level === 'error'), ...issues.filter((i) => i.level !== 'error')]
  let budget = MAX_LISTED_ISSUES
  let hidden = 0
  for (const it of ordered) {
    const key = `${it.level}\u0000${it.reason}`
    let g = map.get(key)
    if (!g) {
      g = { level: it.level, reason: it.reason, total: 0, shown: 0, paths: [] }
      map.set(key, g)
    }
    g.total++
    if (budget > 0) {
      budget--
      g.shown++
      if (it.path) g.paths.push(it.path)
    } else hidden++
  }
  return { groups: [...map.values()].filter((g) => g.shown > 0), hidden }
}

function durationOf(run: RunRecord): number | null {
  if (typeof run.durationMs === 'number') return run.durationMs
  const s = toDate(run.startedAt)
  const f = toDate(run.finishedAt)
  return s && f ? f.getTime() - s.getTime() : null
}

function prunedTotal(run: RunRecord): number {
  return (run.destinations ?? []).reduce((n, d) => n + (d.pruned?.length ?? 0), 0)
}

/* ------------------------------------------------------------------ */
/* "Mover" (doc 04 §6)                                                 */
/* ------------------------------------------------------------------ */

/** Pastas de origem de uma execução com "Mover" ("C:\\Backup" ou "C:\\A, D:\\B"). */
function moveFrom(run: RunRecord): string {
  return (run.move?.sources ?? []).map(oneLine).filter(Boolean).join(', ')
}

/** Caminho relativo à pasta de origem (lista mais curta); fora dela, o caminho inteiro. */
function relToSource(path: string, sources: string[]): string {
  const p = oneLine(path)
  for (const src of sources) {
    const base = oneLine(src).replace(/[\\/]+$/, '')
    const sepAt = p[base.length]
    if (
      base &&
      p.length > base.length + 1 &&
      p.slice(0, base.length).toLowerCase() === base.toLowerCase() &&
      (sepAt === '\\' || sepAt === '/')
    )
      return p.slice(base.length + 1)
  }
  return p
}

/** Execução "Mover" sem arquivo novo que terminou em Atenção (assunto e destaque especiais). */
export function isNothingNewWarning(run: RunRecord): boolean {
  return run.status === 'warning' && run.move?.nothingNew === true
}

/** O que ficou na origem (mantidos + aguardando), como itens agrupáveis por motivo. */
function stayedIssues(run: RunRecord): EmailIssue[] {
  const mv = run.move
  if (!mv) return []
  return [...(mv.kept ?? []), ...(mv.postponed ?? [])].map((k) => ({
    level: 'warning' as const,
    path: oneLine(k.path),
    reason: oneLine(k.reason) || 'Mantido'
  }))
}

function stayedTotal(run: RunRecord): number {
  const mv = run.move
  if (!mv) return 0
  return (mv.keptCount ?? mv.kept?.length ?? 0) + (mv.postponedCount ?? mv.postponed?.length ?? 0)
}

/**
 * Valores do "Mover" para modelos de e-mail personalizados ({{movidos}}, {{tamanho_movido}},
 * {{lista_movidos}}, {{mantidos_origem}}). A lista completa vai no log anexado.
 */
export function moveVariables(
  run: RunRecord
): Record<'movidos' | 'tamanho_movido' | 'lista_movidos' | 'mantidos_origem', string> {
  const mv = run.move
  const sources = mv?.sources ?? []
  return {
    movidos: int(mv?.removedCount ?? 0),
    tamanho_movido: formatBytes(mv?.removedBytes ?? 0),
    lista_movidos: (mv?.removed ?? [])
      .slice(0, MAX_LISTED_ISSUES)
      .map((f) => relToSource(f.path, sources))
      .join('\n'),
    mantidos_origem: int(stayedTotal(run))
  }
}

/** Frase do "Mover" acrescentada ao resumo (o que aconteceu com a origem). */
function moveSentence(run: RunRecord): string {
  const mv = run.move
  if (!mv || mv.nothingNew) return ''
  const n = mv.removedCount ?? 0
  const from = moveFrom(run)
  if (run.status === 'cancelled' && n > 0)
    return ` Antes do cancelamento, ${plural(n, 'arquivo já conferido foi apagado', 'arquivos já conferidos foram apagados')} da origem.`
  if (run.status === 'failed' || run.status === 'cancelled' || n === 0) return ' Nada foi apagado da origem.'
  return ` Depois de conferidos em todos os destinos, ${plural(n, 'arquivo foi apagado', 'arquivos foram apagados')}${from ? ` de ${from}` : ' da origem'}.`
}

function destinationPhrase(run: RunRecord): string {
  const dests = run.destinations ?? []
  const count = dests.length || run.destinationCount || 0
  if (count === 1 && dests[0]) return `para ${oneLine(dests[0].label) || oneLine(dests[0].path)}`
  return count > 1 ? `para ${count} destinos` : ''
}

/** Frase-resumo em pt-BR conforme o status (versões texto e HTML). */
function summarySentence(
  ctx: RunEmailContext,
  routine: string,
  computer: string
): { html: string; text: string } {
  const { run } = ctx
  const files = run.filesCopied ?? 0
  const filesPart =
    files > 0 ? `${plural(files, 'arquivo', 'arquivos')} (${formatBytes(run.bytesCopied ?? 0)})` : ''
  const dest = destinationPhrase(run)
  const ms = durationOf(run)
  const took = ms !== null ? ` em ${formatDuration(ms)}` : ''
  const keptOld = prunedTotal(run) === 0 ? ' Nenhum backup antigo foi apagado.' : ''
  const skipped = run.filesSkipped ?? 0
  const moved = moveSentence(run)

  let tail: string
  switch (run.status) {
    case 'success':
      tail = filesPart
        ? ` foi concluído com sucesso: ${filesPart} ${files === 1 ? 'copiado' : 'copiados'}${dest ? ` ${dest}` : ''}${took}.${moved}`
        : ` foi concluído com sucesso${took}.${run.move?.nothingNew ? ' Nada novo para mover.' : moved}`
      break
    case 'warning': {
      const copied = filesPart ? `${filesPart} ${files === 1 ? 'foi copiado' : 'foram copiados'}` : ''
      const left =
        skipped > 0
          ? `${plural(skipped, 'arquivo ficou', 'arquivos ficaram')} de fora`
          : 'houve avisos durante a cópia'
      const stayed = stayedTotal(run)
      const leftMove =
        run.move && stayed > 0 ? `${plural(stayed, 'arquivo ficou', 'arquivos ficaram')} na origem` : ''
      tail = ` foi concluído, mas com avisos: ${[copied, leftMove || left].filter(Boolean).join(' e ')}.${moved} Confira os detalhes abaixo.`
      break
    }
    case 'failed': {
      const reason = oneLine(run.errorMessage).replace(/[.\s]+$/, '')
      tail = ` falhou${reason ? `: ${reason}` : ''}.${keptOld}${moved} Verifique o problema o quanto antes para não ficar sem cópia.`
      break
    }
    case 'cancelled':
      tail = ` foi cancelado antes de terminar.${keptOld}${moved}`
      break
    default:
      tail = ` está ${STATUS[run.status].label.toLowerCase()}.`
  }
  // "Mover" sem arquivo novo: a frase do motor vira o destaque (logo abaixo, em faixa própria).
  if (isNothingNewWarning(run))
    tail = ' terminou sem backup novo. Os backups anteriores continuam guardados nos destinos.'
  const where = computer ? ` do computador ${computer}` : ''
  const whereHtml = computer
    ? ` do computador <strong style="white-space:nowrap;">${escapeHtml(computer)}</strong>`
    : ''
  return {
    text: `O backup “${routine}”${where}${tail}`,
    html: `O backup <strong>“${escapeHtml(routine)}”</strong>${whereHtml}${escapeHtml(tail)}`
  }
}

/* ------------------------------------------------------------------ */
/* Blocos HTML                                                         */
/* ------------------------------------------------------------------ */

function documentShell(opts: { title: string; preheader: string; body: string; footer: string }): string {
  // Preheader: texto da prévia na caixa de entrada; os caracteres invisíveis evitam que o cliente
  // complete a prévia com o começo do corpo.
  const filler = '&#8199;&#65279;&#847; '.repeat(30)
  return `<!doctype html>
<html lang="pt-BR" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(opts.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>body,table,td,th,p,a,span,div{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
<style>
  body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}
  a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
  @media only screen and (max-width:620px){
    .bc-container{width:100% !important;}
    .bc-px{padding-left:20px !important;padding-right:20px !important;}
    .bc-title{font-size:20px !important;line-height:26px !important;}
    .bc-stat{font-size:17px !important;line-height:22px !important;}
    .bc-hide-sm{display:none !important;}
    .bc-show-sm{display:block !important;max-height:none !important;overflow:visible !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}${filler}</div>
<table ${TABLE} width="100%" bgcolor="${C.page}" style="background-color:${C.page};width:100%;">
<tr>
<td align="center" style="padding:28px 12px 32px 12px;">
<!--[if mso]><table ${TABLE} width="600" align="center"><tr><td><![endif]-->
<table ${TABLE} class="bc-container" width="600" style="width:600px;max-width:600px;">
${opts.body}
<tr>
<td class="bc-px" style="padding:20px 32px 0 32px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.text3};text-align:center;">
${opts.footer}
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>
`
}

/** Cabeçalho com a marca desenhada em CSS (sem imagens) e, à direita, a empresa do técnico. */
function brandHeader(companyName: string): string {
  const company = oneLine(companyName)
  const right = isDefaultBrand(company)
    ? ''
    : `<td align="right" valign="middle" style="font-family:${FONT};font-size:13px;line-height:18px;color:${C.text2};">${escapeHtml(company)}</td>`
  return `<tr>
<td style="padding:0 4px 16px 4px;">
<table ${TABLE} width="100%">
<tr>
<td valign="middle" width="28" style="width:28px;">
<table ${TABLE}><tr>
<td width="28" height="28" align="center" valign="middle" bgcolor="${C.accent}" style="width:28px;height:28px;border-radius:7px;background-color:${C.accent};background-image:linear-gradient(135deg,${C.accentLight} 0%,${C.accentDark} 100%);font-family:${FONT};font-size:11px;line-height:28px;font-weight:700;letter-spacing:-0.2px;color:#FFFFFF;text-align:center;mso-line-height-rule:exactly;">BC</td>
</tr></table>
</td>
<td valign="middle" style="padding-left:10px;font-family:${FONT};font-size:16px;line-height:20px;color:${C.text};letter-spacing:-0.2px;"><span style="font-weight:600;color:${C.text};">BC</span> <span style="font-weight:400;color:${C.text2};">Backup</span></td>
${right}
</tr>
</table>
</td>
</tr>`
}

/** Faixa colorida do status. O subtítulo é uma lista de partes ("Rotina · Cliente · PC") que não quebram no meio. */
function statusBanner(theme: StatusTheme, titleHtml: string, subtitle: string[]): string {
  const sub = subtitle
    .filter(Boolean)
    .map((part) => `<span style="white-space:nowrap;">${escapeHtml(part)}</span>`)
    .join(' &middot; ')
  return `<tr>
<td class="bc-px" bgcolor="${theme.color}" style="background-color:${theme.color};padding:22px 32px;border-radius:12px 12px 0 0;">
<table ${TABLE} width="100%">
<tr>
<td valign="middle" width="36" style="width:36px;">
<table ${TABLE}><tr>
<td width="36" height="36" align="center" valign="middle" bgcolor="#FFFFFF" style="width:36px;height:36px;border-radius:18px;background-color:#FFFFFF;font-family:${FONT};font-size:19px;line-height:36px;font-weight:700;color:${theme.color};text-align:center;mso-line-height-rule:exactly;">${theme.symbol}</td>
</tr></table>
</td>
<td valign="middle" style="padding-left:14px;">
<div class="bc-title" style="font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.3px;color:#FFFFFF;">${titleHtml}</div>
<div style="font-family:${FONT};font-size:14px;line-height:20px;color:${theme.onColor};padding-top:2px;">${sub}</div>
</td>
</tr>
</table>
</td>
</tr>`
}

function paragraph(html: string, extra = ''): string {
  return `<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${C.text};${extra}">${html}</p>`
}

function sectionTitle(text: string, count?: number): string {
  const badge =
    count !== undefined
      ? `&nbsp;<span style="display:inline-block;padding:0 7px;border-radius:9px;background-color:${C.tile};color:${C.text2};font-size:12px;line-height:18px;font-weight:600;letter-spacing:0;">${int(count)}</span>`
      : ''
  return `<div style="margin:28px 0 8px 0;font-family:${FONT};font-size:12px;line-height:18px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:${C.text3};">${escapeHtml(text)}${badge}</div>`
}

interface Stat {
  label: string
  value: string
  note?: string
}

/** Três "cartões" de números grandes (arquivos, tamanho, duração). */
function statTiles(stats: Stat[]): string {
  const cells = stats
    .map(
      (
        s
      ) => `<td valign="top" width="${Math.floor(100 / stats.length)}%" bgcolor="${C.tile}" style="background-color:${C.tile};border-radius:10px;padding:12px 14px;">
<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${C.text2};">${escapeHtml(s.label)}</div>
<div class="bc-stat" style="font-family:${FONT};font-size:20px;line-height:26px;font-weight:600;letter-spacing:-0.3px;color:${C.text};padding-top:2px;white-space:nowrap;">${escapeHtml(s.value)}</div>${
        s.note
          ? `\n<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${C.text3};">${escapeHtml(s.note)}</div>`
          : ''
      }
</td>`
    )
    .join(`\n<td width="8" style="width:8px;font-size:0;line-height:0;">&nbsp;</td>\n`)
  return `<table ${TABLE} width="100%" style="width:100%;margin-top:22px;">
<tr>
${cells}
</tr>
</table>`
}

interface KV {
  label: string
  /** HTML já escapado. */
  value: string
}

function keyValueTable(rows: KV[]): string {
  const trs = rows
    .map((r, i) => {
      const line = i ? `border-top:1px solid ${C.border};` : ''
      return `<tr>
<td valign="top" width="36%" style="width:36%;padding:8px 12px 8px 0;${line}font-family:${FONT};font-size:14px;line-height:20px;color:${C.text2};">${escapeHtml(r.label)}</td>
<td valign="top" style="padding:8px 0;${line}font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};font-weight:500;">${r.value}</td>
</tr>`
    })
    .join('\n')
  return `<table ${TABLE} width="100%" style="width:100%;">
${trs}
</table>`
}

function pill(status: RunStatus): string {
  const t = STATUS[status] ?? STATUS.failed
  return `<span style="display:inline-block;padding:2px 9px;border-radius:11px;background-color:${t.soft};color:${t.color};font-family:${FONT};font-size:12px;line-height:18px;font-weight:600;white-space:nowrap;">${escapeHtml(t.label)}</span>`
}

const TH = `font-family:${FONT};font-size:11px;line-height:14px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:${C.text3};padding:0 0 8px 0;border-bottom:1px solid ${C.border};`
const TD = `font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};padding:12px 0 2px 0;`

/** Uma linha por destino com os números + uma linha de largura total com caminho, espaço livre e erro. */
function destinationsTable(dests: DestinationResult[]): string {
  const rows = dests
    .map((d) => {
      const label = oneLine(d.label)
      const path = oneLine(d.path)
      const output = oneLine(d.outputPath)
      const pruned = d.pruned?.length ?? 0
      const shownPath = output || (label ? path : '')
      const details: string[] = []
      if (shownPath) {
        details.push(
          `<div style="font-family:${MONO};font-size:12px;line-height:17px;color:${C.text2};word-break:break-all;">${escapeHtml(shownPath)}</div>`
        )
      }
      if (typeof d.freeBytesAfter === 'number') {
        details.push(
          `<div style="font-family:${FONT};font-size:12px;line-height:17px;color:${C.text3};padding-top:1px;">${escapeHtml(formatBytes(d.freeBytesAfter))} livres no destino</div>`
        )
      }
      if (d.error) {
        details.push(
          `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:${STATUS.failed.color};padding-top:3px;">${escapeHtml(oneLine(d.error))}</div>`
        )
      }
      // Em telas estreitas as colunas numéricas somem e os números aparecem nesta linha.
      const facts = [
        plural(d.filesCopied ?? 0, 'arquivo', 'arquivos'),
        formatBytes(d.bytesCopied ?? 0),
        plural(pruned, 'backup antigo removido', 'backups antigos removidos')
      ].join(' · ')
      details.unshift(
        `<div class="bc-show-sm" style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-family:${FONT};font-size:13px;line-height:18px;color:${C.text};padding-bottom:3px;">${escapeHtml(facts)}</div>`
      )
      return `<tr>
<td valign="top" style="${TD}font-weight:600;word-break:break-word;">${escapeHtml(label || path)}</td>
<td valign="top" style="${TD}padding-left:12px;">${pill(d.status)}</td>
<td valign="top" align="right" class="bc-hide-sm" style="${TD}padding-left:12px;white-space:nowrap;">${int(d.filesCopied)}</td>
<td valign="top" align="right" class="bc-hide-sm" style="${TD}padding-left:12px;white-space:nowrap;">${escapeHtml(formatBytes(d.bytesCopied ?? 0))}</td>
<td valign="top" align="right" class="bc-hide-sm" style="${TD}padding-left:12px;white-space:nowrap;${pruned ? '' : `color:${C.text3};`}">${int(pruned)}</td>
</tr>
<tr>
<td colspan="5" style="padding:4px 0 12px 0;border-bottom:1px solid ${C.border};">${details.join('')}</td>
</tr>`
    })
    .join('\n')
  return `<table ${TABLE} width="100%" style="width:100%;">
<tr>
<th align="left" style="${TH}">Destino</th>
<th align="left" width="104" style="${TH}width:104px;padding-left:12px;">Status</th>
<th align="right" width="80" class="bc-hide-sm" style="${TH}width:80px;padding-left:12px;">Arquivos</th>
<th align="right" width="80" class="bc-hide-sm" style="${TH}width:80px;padding-left:12px;">Tamanho</th>
<th align="right" width="88" class="bc-hide-sm" style="${TH}width:88px;padding-left:12px;">Antigos removidos</th>
</tr>
${rows}
</table>`
}

/** ["+5 outros", "veja a lista completa…"] */
function overflowNote(hidden: number, logAttached: boolean): [string, string] {
  const where = logAttached
    ? 'a lista completa está no log anexado.'
    : 'veja a lista completa no Histórico do BC Backup.'
  return [`+${int(hidden)} ${hidden === 1 ? 'outro' : 'outros'}`, where]
}

/** `extraHidden`: itens que nem chegaram à lista (o histórico guarda uma lista limitada). */
function issuesList(issues: EmailIssue[], logAttached: boolean, extraHidden = 0): string {
  const grouped = groupIssues(issues)
  const groups = grouped.groups
  const hidden = grouped.hidden + Math.max(0, extraHidden)
  const blocks = groups
    .map((g, i) => {
      const color = g.level === 'error' ? STATUS.failed.color : STATUS.warning.color
      const head = `<tr><td style="padding:${i ? 14 : 2}px 0 4px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};"><span style="color:${color};font-size:12px;">&#9679;</span>&nbsp; <strong style="font-weight:600;">${escapeHtml(g.reason)}</strong>${g.paths.length ? `<span style="color:${C.text3};">&nbsp;·&nbsp;${plural(g.total, 'arquivo', 'arquivos')}</span>` : ''}</td></tr>`
      const paths = g.paths
        .map(
          (p) =>
            `<tr><td style="padding:3px 0 3px 19px;font-family:${MONO};font-size:12px;line-height:17px;color:${C.text2};word-break:break-all;">${escapeHtml(p)}</td></tr>`
        )
        .join('\n')
      return `${head}\n${paths}`
    })
    .join('\n')
  const [lead, where] = overflowNote(hidden, logAttached)
  const more =
    hidden > 0
      ? `<tr><td style="padding:14px 0 0 0;font-family:${FONT};font-size:13px;line-height:18px;color:${C.text2};"><strong style="color:${C.text};">${escapeHtml(lead)}</strong> — ${escapeHtml(where)}</td></tr>`
      : ''
  return `<table ${TABLE} width="100%" style="width:100%;">
${blocks}
${more}
</table>`
}

/** "Movidos para os destinos (apagados de C:\\Backup): 3 arquivos · 4,2 GB" + até 20 nomes. */
function movedHeadline(run: RunRecord): string {
  const mv = run.move
  const from = moveFrom(run)
  const facts = `${plural(mv?.removedCount ?? 0, 'arquivo', 'arquivos')} · ${formatBytes(mv?.removedBytes ?? 0)}`
  return `Movidos para os destinos${from ? ` (apagados de ${from})` : ''}: ${facts}`
}

function movedList(run: RunRecord, logAttached: boolean): string {
  const mv = run.move
  if (!mv) return ''
  const sources = mv.sources ?? []
  const from = moveFrom(run)
  const shown = (mv.removed ?? []).slice(0, MAX_LISTED_ISSUES)
  const hidden = Math.max(0, (mv.removedCount ?? shown.length) - shown.length)
  const head = `<tr><td style="padding:2px 0 6px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};"><span style="color:${STATUS.success.color};font-size:12px;">&#9679;</span>&nbsp; <strong style="font-weight:600;">${escapeHtml(`${plural(mv.removedCount ?? 0, 'arquivo', 'arquivos')} · ${formatBytes(mv.removedBytes ?? 0)}`)}</strong>${from ? `<span style="color:${C.text2};"> apagados de </span><span style="font-family:${MONO};font-size:13px;color:${C.text2};word-break:break-all;">${escapeHtml(from)}</span>` : ''}<span style="color:${C.text3};"> depois de conferidos em todos os destinos</span></td></tr>`
  const rows = shown
    .map(
      (f) =>
        `<tr><td style="padding:3px 0 3px 19px;font-family:${MONO};font-size:12px;line-height:17px;color:${C.text2};word-break:break-all;">${escapeHtml(relToSource(f.path, sources))} <span style="font-family:${FONT};color:${C.text3};white-space:nowrap;">${escapeHtml(formatBytes(f.bytes))}</span></td></tr>`
    )
    .join('\n')
  const [lead, where] = overflowNote(hidden, logAttached)
  const more =
    hidden > 0
      ? `<tr><td style="padding:14px 0 0 0;font-family:${FONT};font-size:13px;line-height:18px;color:${C.text2};"><strong style="color:${C.text};">${escapeHtml(lead)}</strong> — ${escapeHtml(where)}</td></tr>`
      : ''
  return `<table ${TABLE} width="100%" style="width:100%;">
${head}
${rows}
${more}
</table>`
}

/** Faixa de destaque (Atenção) usada quando o "Mover" não encontrou arquivo novo. */
function highlight(textHtml: string, theme: StatusTheme): string {
  return `<table ${TABLE} width="100%" style="width:100%;margin-top:18px;">
<tr>
<td bgcolor="${theme.soft}" style="background-color:${theme.soft};border-left:3px solid ${theme.color};border-radius:8px;padding:12px 14px;font-family:${FONT};font-size:14px;line-height:21px;color:${C.text};font-weight:500;">${textHtml}</td>
</tr>
</table>`
}

function callout(label: string, valueHtml: string): string {
  return `<table ${TABLE} width="100%" style="width:100%;margin-top:28px;">
<tr>
<td bgcolor="${C.accentSoft}" style="background-color:${C.accentSoft};border-radius:10px;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};">
<span style="color:${C.accentText};font-weight:600;">${escapeHtml(label)}</span>&nbsp; ${valueHtml}
</td>
</tr>
</table>`
}

function card(inner: string): string {
  return `<tr>
<td style="padding:0;">
<table ${TABLE} width="100%" bgcolor="${C.card}" style="width:100%;background-color:${C.card};border:1px solid ${C.border};border-radius:12px;">
${inner}
</table>
</td>
</tr>`
}

function cardBody(html: string): string {
  return `<tr>
<td class="bc-px" style="padding:28px 32px 32px 32px;">
${html}
</td>
</tr>`
}

/** Pares "Rótulo: valor" alinhados para o texto puro. */
function textTable(rows: [string, string][]): string[] {
  const width = Math.max(...rows.map(([k]) => k.length)) + 2
  return rows.map(([k, v]) => `  ${`${k}:`.padEnd(width)} ${v}`)
}

/* ------------------------------------------------------------------ */
/* E-mail de execução                                                  */
/* ------------------------------------------------------------------ */

/** Assunto: `[BC Backup] {status} – {rotina} – {cliente} ({computador}) – {data} {hora}`. */
export function buildRunSubject(ctx: RunEmailContext): string {
  const theme = STATUS[ctx.run.status] ?? STATUS.failed
  const routine = oneLine(ctx.routine.name) || 'Rotina sem nome'
  // "Mover" sem arquivo novo: o sistema (ERP) pode ter parado de gerar backups.
  if (isNothingNewWarning(ctx.run)) return `[ATENÇÃO] ${routine}: nenhum backup novo do sistema`
  const client = clientOf(ctx)
  const computer = computerOf(ctx.settings.computerAlias, ctx.hostname).name
  const when = toDate(ctx.run.startedAt)
  const parts = [`[BC Backup] ${theme.label}`]
  if (client) parts.push(computer ? `${routine} – ${client} (${computer})` : `${routine} – ${client}`)
  else parts.push(computer ? `${routine} (${computer})` : routine)
  if (when) parts.push(shortDateTime(when))
  return parts.join(' – ')
}

export function renderRunEmail(ctx: RunEmailContext): RenderedEmail {
  const { run } = ctx
  const theme = STATUS[run.status] ?? STATUS.failed
  const subject = buildRunSubject(ctx)
  const routine = oneLine(ctx.routine.name) || 'Rotina sem nome'
  const client = clientOf(ctx)
  const computer = computerOf(ctx.settings.computerAlias, ctx.hostname)
  const started = toDate(run.startedAt)
  const finished = toDate(run.finishedAt)
  const ms = durationOf(run)
  const dests = run.destinations ?? []
  const issues = collectIssues(run)
  const hasErrors = issues.some((i) => i.level === 'error')
  const issuesTitle = hasErrors ? 'Arquivos ignorados e erros' : 'Arquivos ignorados'
  const attach = ctx.routine.notification?.attachLog
  const logAttached =
    ctx.logAttached ?? (attach === 'always' || (attach === 'onFailure' && run.status === 'failed'))
  const summary = summarySentence(ctx, routine, computer.name)
  const nothingNew = isNothingNewWarning(run)
  const notice = nothingNew ? oneLine(run.move?.notice) || 'Nenhum arquivo novo para mover.' : ''
  const title = nothingNew ? 'Nenhum backup novo do sistema' : theme.title
  const moved = run.move && !run.move.nothingNew ? run.move : null
  const stayed = stayedIssues(run)
  const stayedCount = stayedTotal(run)
  const greeting = client ? `Olá, ${client},` : 'Olá,'
  const subtitle = [routine, client, computer.name].filter(Boolean).join(' · ')
  const footer = footerLine(ctx.settings.companyName, ctx.appVersion)
  const next = ctx.nextRunAt === undefined ? undefined : toDate(ctx.nextRunAt)
  const nextText =
    next === undefined
      ? null
      : next
        ? longDateTime(next)
        : 'nenhum agendamento — esta rotina só roda quando alguém pedir.'

  const total = run.filesTotal ?? 0
  const copied = run.filesCopied ?? 0
  const filesOf = total > copied ? `de ${int(total)}` : undefined
  const values = {
    routine,
    computer: computer.full || '—',
    start: started ? dateTime(started) : '—',
    end: finished ? dateTime(finished) : '—',
    duration: ms !== null ? formatDuration(ms) : '—',
    files: int(copied),
    size: formatBytes(run.bytesCopied ?? 0),
    warnings: run.warnings ?? 0,
    errors: run.errors ?? 0,
    trigger: run.trigger ? (TRIGGER_LABEL[run.trigger] ?? run.trigger) : ''
  }
  const count = (n: number, color: string): string =>
    n > 0 ? `<span style="color:${color};font-weight:600;">${int(n)}</span>` : int(n)

  const kv: KV[] = [
    { label: 'Rotina', value: escapeHtml(values.routine) },
    { label: 'Computador', value: escapeHtml(values.computer) },
    { label: 'Início', value: escapeHtml(values.start) },
    { label: 'Fim', value: escapeHtml(values.end) },
    { label: 'Avisos', value: count(values.warnings, STATUS.warning.color) },
    { label: 'Erros', value: count(values.errors, STATUS.failed.color) }
  ]
  if (values.trigger) kv.push({ label: 'Execução', value: escapeHtml(values.trigger) })

  const body: string[] = [
    paragraph(escapeHtml(greeting), 'margin-bottom:10px;'),
    paragraph(summary.html, 'margin-bottom:0;'),
    ...(nothingNew ? [highlight(escapeHtml(notice), STATUS.warning)] : []),
    statTiles([
      { label: 'Arquivos copiados', value: values.files, note: filesOf },
      { label: 'Tamanho', value: values.size },
      { label: 'Duração', value: values.duration }
    ]),
    sectionTitle('Resumo'),
    keyValueTable(kv)
  ]
  if (dests.length) body.push(sectionTitle('Destinos'), destinationsTable(dests))
  if (moved && (moved.removedCount ?? 0) > 0)
    body.push(sectionTitle('Movidos para os destinos', moved.removedCount), movedList(run, logAttached))
  if (stayedCount > 0)
    body.push(
      sectionTitle('Ficaram na origem', stayedCount),
      issuesList(stayed, logAttached, stayedCount - stayed.length)
    )
  if (issues.length) body.push(sectionTitle(issuesTitle, issues.length), issuesList(issues, logAttached))
  if (nextText !== null) body.push(callout('Próximo backup:', escapeHtml(nextText)))
  if (logAttached && !(issues.length > MAX_LISTED_ISSUES)) {
    body.push(
      paragraph(
        'O log completo desta execução está anexado.',
        `margin:20px 0 0 0;font-size:13px;color:${C.text2};`
      )
    )
  }

  const html = documentShell({
    title: subject,
    preheader: nothingNew ? notice : summary.text,
    body: [
      brandHeader(ctx.settings.companyName),
      card(
        statusBanner(theme, escapeHtml(title), [routine, client, computer.name]) + cardBody(body.join('\n'))
      )
    ].join('\n'),
    footer: `${escapeHtml(footer)}<br>Para deixar de receber estes avisos, ajuste as notificações da rotina no BC Backup.`
  })

  /* ----- texto puro ----- */
  const lines: string[] = [title.toUpperCase(), subtitle, '', greeting, '', summary.text]
  if (nothingNew) lines.push('', notice)
  lines.push('', 'RESUMO')
  lines.push(
    ...textTable([
      ['Rotina', values.routine],
      ['Computador', values.computer],
      ['Início', values.start],
      ['Fim', values.end],
      ['Duração', values.duration],
      ['Arquivos copiados', filesOf ? `${values.files} ${filesOf}` : values.files],
      ['Tamanho', values.size],
      ['Avisos', int(values.warnings)],
      ['Erros', int(values.errors)],
      ...(values.trigger ? [['Execução', values.trigger] as [string, string]] : [])
    ])
  )
  if (dests.length) {
    lines.push('', 'DESTINOS')
    for (const d of dests) {
      const label = oneLine(d.label)
      const path = oneLine(d.path)
      const shownPath = oneLine(d.outputPath) || (label ? path : '')
      lines.push(`  • ${label || path} — ${(STATUS[d.status] ?? STATUS.failed).label}`)
      if (shownPath) lines.push(`    ${shownPath}`)
      const facts = [
        plural(d.filesCopied ?? 0, 'arquivo', 'arquivos'),
        formatBytes(d.bytesCopied ?? 0),
        plural(d.pruned?.length ?? 0, 'backup antigo removido', 'backups antigos removidos')
      ]
      if (typeof d.freeBytesAfter === 'number') facts.push(`${formatBytes(d.freeBytesAfter)} livres`)
      lines.push(`    ${facts.join(' · ')}`)
      if (d.error) lines.push(`    Erro: ${oneLine(d.error)}`)
    }
  }
  if (moved && (moved.removedCount ?? 0) > 0) {
    lines.push('', movedHeadline(run))
    const sources = moved.sources ?? []
    const shown = (moved.removed ?? []).slice(0, MAX_LISTED_ISSUES)
    for (const f of shown) lines.push(`  • ${relToSource(f.path, sources)} (${formatBytes(f.bytes)})`)
    const hidden = Math.max(0, (moved.removedCount ?? 0) - shown.length)
    if (hidden > 0) lines.push(`  ${overflowNote(hidden, logAttached).join(' — ')}`)
  }
  if (stayedCount > 0) {
    lines.push('', `Ficaram na origem: ${int(stayedCount)}`)
    const { groups, hidden } = groupIssues(stayed)
    for (const g of groups) {
      lines.push(`  ${g.reason} (${plural(g.total, 'arquivo', 'arquivos')})`)
      for (const p of g.paths) lines.push(`    • ${p}`)
    }
    const more = hidden + Math.max(0, stayedCount - stayed.length)
    if (more > 0) lines.push(`  ${overflowNote(more, logAttached).join(' — ')}`)
  }
  if (issues.length) {
    lines.push('', `${issuesTitle.toUpperCase()} (${int(issues.length)})`)
    const { groups, hidden } = groupIssues(issues)
    for (const g of groups) {
      const tag = g.level === 'error' ? 'Erro: ' : ''
      lines.push(
        g.paths.length
          ? `  ${tag}${g.reason} (${plural(g.total, 'arquivo', 'arquivos')})`
          : `  ${tag}${g.reason}`
      )
      for (const p of g.paths) lines.push(`    • ${p}`)
    }
    if (hidden > 0) lines.push(`  ${overflowNote(hidden, logAttached).join(' — ')}`)
  }
  if (logAttached && !(issues.length > MAX_LISTED_ISSUES))
    lines.push('', 'O log completo desta execução está anexado.')
  if (nextText !== null) lines.push('', `Próximo backup: ${nextText}`)
  lines.push(
    '',
    '—',
    footer,
    'Para deixar de receber estes avisos, ajuste as notificações da rotina no BC Backup.',
    ''
  )

  return { subject, html, text: lines.join('\n') }
}

/* ------------------------------------------------------------------ */
/* E-mail de teste                                                     */
/* ------------------------------------------------------------------ */

export function renderTestEmail(ctx: TestEmailContext): RenderedEmail {
  const computer = computerOf(ctx.computerAlias, ctx.hostname)
  const client = oneLine(ctx.clientName)
  const sent = toDate(ctx.sentAt ?? new Date()) ?? new Date()
  const subject = computer.name
    ? `[BC Backup] E-mail de teste – ${computer.name}`
    : '[BC Backup] E-mail de teste'
  const footer = footerLine(ctx.companyName, ctx.appVersion)
  const theme: StatusTheme = { ...STATUS.success, color: C.accent, onColor: '#DCE3FD', soft: C.accentSoft }
  const title = 'Tudo certo com o envio de e-mails'
  const greeting = client ? `Olá, ${client}!` : 'Olá!'
  const intro = (who: string) =>
    `Este é um e-mail de teste enviado pelo BC Backup${who}. Se ele chegou até você, o envio de e-mails está configurado corretamente.`
  const after =
    'A partir de agora, os avisos das rotinas de backup chegam neste endereço quando um backup terminar, tiver avisos ou falhar — conforme o que foi escolhido em cada rotina.'
  const tip = 'se este e-mail caiu no spam, marque-o como “não é spam” para receber os próximos avisos.'

  const rows: [string, string][] = [
    ['Computador', computer.full || '—'],
    ['Enviado em', dateTime(sent)]
  ]
  const server = oneLine(ctx.smtpServer)
  if (server) rows.push(['Servidor de envio', server])
  const ver = versionLabel(ctx.appVersion)
  if (ver) rows.push(['Versão', `BC Backup ${ver}`])

  const body = [
    paragraph(escapeHtml(greeting), 'margin-bottom:10px;'),
    paragraph(
      intro(
        computer.name
          ? ` do computador <strong style="white-space:nowrap;">${escapeHtml(computer.name)}</strong>`
          : ''
      )
    ),
    paragraph(escapeHtml(after), `color:${C.text2};margin-bottom:0;`),
    sectionTitle('Detalhes'),
    keyValueTable(rows.map(([label, value]) => ({ label, value: escapeHtml(value) }))),
    callout('Dica:', escapeHtml(tip))
  ].join('\n')

  const html = documentShell({
    title: subject,
    preheader: 'Tudo certo: o BC Backup consegue enviar e-mails por este servidor.',
    body: [
      brandHeader(ctx.companyName),
      card(
        statusBanner(theme, keepEmailTogether(escapeHtml(title)), ['Mensagem de teste do BC Backup']) +
          cardBody(body)
      )
    ].join('\n'),
    footer: escapeHtml(footer)
  })

  const text = [
    title.toUpperCase(),
    'Mensagem de teste do BC Backup',
    '',
    greeting,
    '',
    intro(computer.name ? ` do computador ${computer.name}` : ''),
    '',
    after,
    '',
    'DETALHES',
    ...textTable(rows),
    '',
    `Dica: ${tip}`,
    '',
    '—',
    footer,
    ''
  ].join('\n')

  return { subject, html, text }
}
