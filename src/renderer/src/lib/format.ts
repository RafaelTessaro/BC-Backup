// Formatação específica da interface (complementa @shared/format).
import { formatDateTime } from '@shared/format'

const nf = new Intl.NumberFormat('pt-BR')
const pf = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 })

export function formatNumber(n: number): string {
  return nf.format(Math.round(n))
}

/** 0–100 → "42%" (Intl pt-BR). */
export function formatPercent(value: number): string {
  return pf.format(Math.max(0, Math.min(100, value)) / 100)
}

export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

const p2 = (n: number): string => String(n).padStart(2, '0')

export function dayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`
}

export function formatTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** "05/10" */
export function formatDayMonth(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Diferença em dias de calendário (positivo = futuro). */
export function calendarDiff(d: Date, now: Date): number {
  return Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000)
}

export function capitalize(s: string): string {
  return s ? s[0].toLocaleUpperCase('pt-BR') + s.slice(1) : s
}

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const WEEKDAY_FULL = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado'
]

/** "hoje", "amanhã", "ontem", "sexta, 09/10" */
export function formatDayWord(iso: string | Date, now: Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const diff = calendarDiff(d, now)
  if (diff === 0) return 'hoje'
  if (diff === 1) return 'amanhã'
  if (diff === -1) return 'ontem'
  return `${WEEKDAY[d.getDay()]}, ${formatDayMonth(d)}`
}

/** "hoje às 22:00", "amanhã às 06:00", "sexta, 09/10 às 22:00" */
export function formatWhen(iso: string | Date, now: Date): string {
  return `${formatDayWord(iso, now)} às ${formatTime(iso)}`
}

/** Cabeçalho de grupo do histórico: "Hoje", "Ontem", "Sexta-feira, 02/10". */
export function formatDayHeading(iso: string | Date, now: Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const diff = calendarDiff(d, now)
  if (diff === 0) return 'Hoje'
  if (diff === -1) return 'Ontem'
  return `${capitalize(WEEKDAY_FULL[d.getDay()])}, ${formatDayMonth(d)}`
}

/** "agora mesmo", "há 5 min", "há 2 h", "ontem às 18:00", "há 3 dias" */
export function formatAgo(iso: string | Date, now: Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const diff = now.getTime() - d.getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24 && calendarDiff(d, now) === 0) return `há ${h} h`
  const days = -calendarDiff(d, now)
  if (days === 1) return `ontem às ${formatTime(d)}`
  if (days < 30) return `há ${days} dias`
  return formatDateTime(d)
}

export function formatFull(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' })
  return `${capitalize(weekday)}, ${formatDateTime(d).replace(',', ' às')}`
}

/** "~5 min", "~1 h 20 min", "menos de 1 min" */
export function formatEta(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return 'Calculando…'
  const s = Math.round(ms / 1000)
  if (s < 60) return 'menos de 1 min'
  const m = Math.round(s / 60)
  if (m < 60) return `~${m} min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `~${h} h ${rm} min` : `~${h} h`
}

/** Separador de caminho (Windows usa "\", demais "/"). */
function splitPath(path: string): { root: string; parts: string[]; sep: string } {
  const sep = path.includes('\\') ? '\\' : '/'
  let root = ''
  let rest = path
  if (path.startsWith('\\\\')) {
    const segs = path.slice(2).split('\\')
    root = `\\\\${segs.slice(0, 2).join('\\')}`
    rest = segs.slice(2).join('\\')
  } else if (/^[A-Za-z]:[\\/]/.test(path)) {
    root = path.slice(0, 2)
    rest = path.slice(3)
  } else if (path.startsWith('/')) {
    root = ''
    rest = path.slice(1)
  }
  return { root, parts: rest.split(sep).filter(Boolean), sep }
}

/** Último segmento de um caminho ("NF-e 2026"). Para raízes devolve o próprio caminho. */
export function baseName(path: string): string {
  const { root, parts } = splitPath(path.replace(/[\\/]+$/, '') || path)
  return parts.length ? parts[parts.length - 1] : root || path
}

/**
 * Trunca um caminho no meio preservando raiz e último segmento:
 * "C:\Clientes\…\NF-e 2026". Cai para truncamento por caractere se necessário.
 */
export function middleTruncate(path: string, max: number): string {
  if (path.length <= max || max < 8) return path
  const { root, parts, sep } = splitPath(path)
  const head = root ? root + sep : path.startsWith('/') ? '/' : ''
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    // tenta manter o máximo de segmentos iniciais
    for (let keep = parts.length - 2; keep >= 0; keep--) {
      const candidate = `${head}${parts.slice(0, keep).join(sep)}${keep ? sep : ''}…${sep}${last}`
      if (candidate.length <= max) return candidate
    }
  }
  const keepEnd = Math.ceil((max - 1) * 0.6)
  const keepStart = max - 1 - keepEnd
  return `${path.slice(0, keepStart)}…${path.slice(path.length - keepEnd)}`
}

/** Caminho da unidade/raiz ("E:\", "\\SERVIDOR\backup", "/Volumes/X"). */
export function pathRoot(path: string): string {
  if (/^[A-Za-z]:/.test(path)) return `${path.slice(0, 2).toUpperCase()}\\`
  if (path.startsWith('\\\\')) {
    const segs = path.slice(2).split('\\')
    return `\\\\${segs.slice(0, 2).join('\\')}`
  }
  const m = /^\/(Volumes|media|mnt)\/[^/]+/.exec(path)
  return m ? m[0] : '/'
}

export function isNetworkPath(path: string): boolean {
  return path.startsWith('\\\\') || path.startsWith('//')
}

export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/
