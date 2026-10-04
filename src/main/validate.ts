// Validação de rotinas (assistente) — doc 01 §2.1 item 16. Node puro.

import { stat } from 'node:fs/promises'
import { dirname, posix, win32 } from 'node:path'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import type { ID } from '@shared/types'
import { parseTime } from '@shared/schedule'
import { withTimeout } from './engine/fsutil'

export interface ValidateContext {
  /** Rotinas já salvas (para nomes repetidos). */
  existing: Array<{ id: ID; name: string }>
  smtpConfigured: boolean
  platform?: NodeJS.Platform
  /** false = pula checagens no disco (acessível, mesmo disco). */
  checkFs?: boolean
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim())
}

function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix
}

export function isAbsolutePath(p: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathApi(platform).isAbsolute(p)
}

/** Normaliza para comparação: resolve, tira a barra final e ignora maiúsculas no Windows/macOS. */
export function normalizeForCompare(p: string, platform: NodeJS.Platform = process.platform): string {
  const api = pathApi(platform)
  let n = api.resolve(p)
  const root = api.parse(n).root
  if (n.length > root.length) n = n.replace(/[\\/]+$/, '')
  return platform === 'win32' || platform === 'darwin' ? n.toLowerCase() : n
}

/** true se `child` é `parent` ou está dentro dele. */
export function isInside(
  child: string,
  parent: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const api = pathApi(platform)
  const c = normalizeForCompare(child, platform)
  const p = normalizeForCompare(parent, platform)
  if (c === p) return true
  const withSep = p.endsWith(api.sep) ? p : p + api.sep
  return c.startsWith(withSep)
}

/** Raiz do volume pelo texto do caminho (Windows: "C:\" ou "\\servidor\share\"). */
export function volumeRoot(p: string, platform: NodeJS.Platform = process.platform): string {
  const api = pathApi(platform)
  const root = api.parse(api.resolve(p)).root
  return platform === 'win32' ? root.toLowerCase() : root
}

/** Id do dispositivo do caminho ou do ancestral mais próximo que existe (POSIX). */
async function deviceOf(p: string): Promise<number | null> {
  let cur = p
  for (let i = 0; i < 64; i++) {
    try {
      return (await withTimeout(stat(cur), 3000)).dev
    } catch {
      const parent = dirname(cur)
      if (parent === cur) return null
      cur = parent
    }
  }
  return null
}

async function sameDisk(a: string, b: string, platform: NodeJS.Platform): Promise<boolean> {
  if (platform === 'win32') return volumeRoot(a, platform) === volumeRoot(b, platform)
  const [da, db] = await Promise.all([deviceOf(a), deviceOf(b)])
  return da !== null && da === db
}

async function accessibleDir(p: string): Promise<boolean> {
  try {
    return (await withTimeout(stat(p), 4000)).isDirectory()
  } catch {
    return false
  }
}

export async function validateRoutine(input: RoutineInput, ctx: ValidateContext): Promise<ValidationIssue[]> {
  const platform = ctx.platform ?? process.platform
  const checkFs = ctx.checkFs ?? true
  const issues: ValidationIssue[] = []
  const add = (level: ValidationIssue['level'], step: ValidationIssue['step'], message: string) => {
    if (!issues.some((i) => i.message === message && i.step === step)) issues.push({ level, step, message })
  }

  /* Nome + origens */
  const name = (input.name ?? '').trim()
  if (!name) add('error', 'origem', 'Dê um nome para a rotina.')
  else if (name.length > 60) add('error', 'origem', 'Use no máximo 60 caracteres no nome da rotina.')
  else {
    const key = name.toLocaleLowerCase('pt-BR')
    if (ctx.existing.some((r) => r.id !== input.id && r.name.trim().toLocaleLowerCase('pt-BR') === key)) {
      add('error', 'origem', `Já existe uma rotina chamada "${name}". Escolha outro nome.`)
    }
  }

  const sources = input.sources ?? []
  if (!sources.length) add('error', 'origem', 'Escolha pelo menos uma pasta ou arquivo para copiar.')
  for (const s of sources) {
    if (!s.path?.trim() || !isAbsolutePath(s.path, platform))
      add('error', 'origem', `Caminho de origem inválido: ${s.path || '(vazio)'}`)
  }
  const seenSources = new Set<string>()
  for (const s of sources) {
    if (!s.path) continue
    const key = normalizeForCompare(s.path, platform)
    if (seenSources.has(key)) add('warning', 'origem', `Origem repetida: ${s.path}`)
    seenSources.add(key)
  }
  if (checkFs) {
    for (const s of sources) {
      if (s.path && isAbsolutePath(s.path, platform)) {
        const ok = await withTimeout(stat(s.path), 4000).then(
          () => true,
          () => false
        )
        if (!ok)
          add(
            'warning',
            'origem',
            `Origem não encontrada agora: ${s.path}. Conecte o disco ou confira o caminho.`
          )
      }
    }
  }

  /* Destinos */
  const dests = (input.destinations ?? []).filter((d) => d.enabled !== false)
  if (!dests.length) add('error', 'destinos', 'Escolha pelo menos um destino para as cópias.')
  const seenDests = new Set<string>()
  for (const d of input.destinations ?? []) {
    if (!d.path?.trim() || !isAbsolutePath(d.path, platform)) {
      add('error', 'destinos', `Caminho de destino inválido: ${d.path || '(vazio)'}`)
      continue
    }
    const key = normalizeForCompare(d.path, platform)
    if (seenDests.has(key)) add('error', 'destinos', `Destino repetido: ${d.path}`)
    seenDests.add(key)
  }
  for (const d of dests) {
    if (!d.path || !isAbsolutePath(d.path, platform)) continue
    for (const s of sources) {
      if (!s.path || !isAbsolutePath(s.path, platform)) continue
      if (isInside(d.path, s.path, platform) || isInside(s.path, d.path, platform)) {
        add(
          'error',
          'destinos',
          'O destino não pode ficar dentro da origem (nem a origem dentro do destino).'
        )
      }
    }
  }
  if (checkFs) {
    for (const d of dests) {
      if (!d.path || !isAbsolutePath(d.path, platform)) continue
      const accessible = await accessibleDir(d.path)
      if (!accessible) {
        add(
          'warning',
          'destinos',
          `Destino indisponível agora: ${d.label ? `${d.label} (${d.path})` : d.path}. Conecte o disco antes do horário do backup.`
        )
      }
      for (const s of sources) {
        if (!s.path || !isAbsolutePath(s.path, platform)) continue
        if (isInside(d.path, s.path, platform) || isInside(s.path, d.path, platform)) continue
        if (await sameDisk(s.path, d.path, platform)) {
          add('warning', 'destinos', 'Origem e destino no mesmo disco: se o disco falhar, perde os dois.')
        }
      }
    }
  }

  /* Agendamento */
  const sch = input.schedule
  if (sch) {
    if (sch.kind === 'daily' || sch.kind === 'weekly') {
      const valid = (sch.times ?? []).filter((t) => parseTime(t))
      if (!valid.length) add('error', 'agendamento', 'Informe pelo menos um horário (HH:MM).')
      if ((sch.times ?? []).length > 6) add('error', 'agendamento', 'Use no máximo 6 horários por dia.')
      if (valid.length !== (sch.times ?? []).length)
        add('error', 'agendamento', 'Há um horário inválido. Use o formato HH:MM.')
      if (sch.kind === 'weekly' && !(sch.weekdays ?? []).length)
        add('error', 'agendamento', 'Escolha pelo menos um dia da semana.')
    }
    if (sch.kind === 'interval') {
      if (!(sch.intervalMinutes >= 5)) add('error', 'agendamento', 'O intervalo mínimo é de 5 minutos.')
      if (sch.window) {
        const a = parseTime(sch.window.start)
        const b = parseTime(sch.window.end)
        if (!a || !b) add('error', 'agendamento', 'Janela de horário inválida. Use o formato HH:MM.')
        else if (b.h * 60 + b.m < a.h * 60 + a.m)
          add('error', 'agendamento', 'O fim da janela precisa ser depois do início.')
      }
    }
    if (sch.kind === 'startup' && !(sch.startupDelayMinutes >= 0)) {
      add('error', 'agendamento', 'O atraso ao iniciar não pode ser negativo.')
    }
  }

  /* Retenção */
  const ret = input.retention
  if (ret?.enabled) {
    if (!(ret.days >= 1)) add('error', 'retencao', 'Mantenha os backups por pelo menos 1 dia.')
    if (!(ret.minKeep >= 0)) add('error', 'retencao', 'O mínimo de backups guardados não pode ser negativo.')
    else if (ret.minKeep === 0)
      add(
        'warning',
        'retencao',
        'Sem um mínimo garantido, um computador desligado por dias pode ficar sem backups antigos.'
      )
  }

  /* Notificação */
  const n = input.notification
  if (n) {
    for (const e of [...(n.recipients ?? []), ...(n.bcc ?? [])]) {
      if (!isValidEmail(e)) add('error', 'notificacao', `E-mail inválido: ${e}`)
    }
    if (n.enabled) {
      if (!(n.recipients ?? []).length && !(n.bcc ?? []).length) {
        add('error', 'notificacao', 'Informe pelo menos um destinatário para os avisos por e-mail.')
      }
      if (!n.onSuccess && !n.onWarning && !n.onFailure) {
        add('warning', 'notificacao', 'Nenhuma situação marcada: nenhum e-mail será enviado.')
      }
      if (!ctx.smtpConfigured) {
        add(
          'warning',
          'notificacao',
          'Configure o servidor de e-mail (SMTP) em Configurações › E-mail para os avisos funcionarem.'
        )
      }
    }
  }

  return issues
}
