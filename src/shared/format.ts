// Formatação pt-BR usada pela interface e pelos e-mails.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** i
  const digits = i === 0 ? 0 : value >= 100 ? 0 : decimals
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${UNITS[i]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}min ${rs}s` : `${m}min`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}min` : `${h}h`
}

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** "há 5 min", "em 2 h", "ontem às 18:00"… */
export function formatRelative(iso: string | Date, now: Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const diff = d.getTime() - now.getTime()
  const abs = Math.abs(diff)
  const future = diff > 0
  const min = Math.round(abs / 60_000)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  if (min < 1) return future ? 'em instantes' : 'agora mesmo'
  if (min < 60) return future ? `em ${min} min` : `há ${min} min`

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)

  if (sameDay(d, now)) return `hoje às ${time}`
  if (sameDay(d, tomorrow)) return `amanhã às ${time}`
  if (sameDay(d, yesterday)) return `ontem às ${time}`

  const days = Math.round(abs / 86_400_000)
  if (days < 7) {
    const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' })
    return `${weekday} às ${time}`
  }
  return formatDateTime(d)
}

/** Carimbo usado no nome das pastas de backup: 2026-10-04_18-00-00 */
export function backupStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:\.zip)?$/

export function parseBackupStamp(name: string): Date | null {
  const m = STAMP_RE.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const date = new Date(y, mo - 1, d, h, mi, s)
  return Number.isNaN(date.getTime()) ? null : date
}
