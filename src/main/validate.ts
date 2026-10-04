// Validação de rotinas (assistente) — doc 01 §2.1 item 16. Node puro.

import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'
import { dirname, posix, win32 } from 'node:path'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import type { ID, SourceItem } from '@shared/types'
import { parseTime } from '@shared/schedule'
import { withTimeout } from './engine/fsutil'

export interface ValidateContext {
  /** Rotinas já salvas (nomes repetidos; "Mover" avisa se outra rotina usa a mesma pasta). */
  existing: Array<{ id: ID; name: string; sources?: SourceItem[] }>
  smtpConfigured: boolean
  platform?: NodeJS.Platform
  /** false = pula checagens no disco (acessível, mesmo disco). */
  checkFs?: boolean
  /** Variáveis de ambiente e pasta pessoal usadas nas pastas bloqueadas do "Mover" (padrão: do processo). */
  env?: Record<string, string | undefined>
  homedir?: string
  /** Pasta de dados do BC Backup ("Mover" recusa uma origem que a contenha). */
  dataPath?: string
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

/* ------------------------------------------------------------------ */
/* "Mover": pastas que nunca podem ser origem (doc 04 §3)              */
/* ------------------------------------------------------------------ */

export interface MoveGuardContext {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  homedir?: string
  /** Pasta de dados do BC Backup: uma origem que a contenha é recusada. */
  dataPath?: string
}

/** Pastas conhecidas na raiz de cada perfil (nome no disco e o nome em português). */
const PROFILE_FOLDERS = new Set([
  'desktop',
  'área de trabalho',
  'documents',
  'documentos',
  'meus documentos',
  'my documents',
  'downloads',
  'pictures',
  'imagens',
  'minhas imagens'
])
const isOneDriveName = (name: string): boolean => /^onedrive( - .+)?$/i.test(name.trim())
const POSIX_BLOCKED = [
  '/',
  '/Users',
  '/home',
  '/System',
  '/usr',
  '/etc',
  '/var',
  '/Applications',
  '/Library',
  '/Volumes',
  '/private',
  '/private/var',
  '/private/etc',
  '/root',
  '/bin',
  '/sbin',
  '/lib',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/run',
  '/opt',
  '/srv',
  '/mnt',
  '/media',
  '/tmp'
]

/**
 * true se a pasta é uma unidade inteira ou pasta do sistema/perfil e por isso NÃO pode ser usada
 * com "Mover". Regra exata (subpastas como C:\Program Files (x86)\ERP\Backup são permitidas),
 * exceto %SystemRoot% (qualquer coisa dentro) e a pasta de dados do BC Backup (quem a contém ou
 * está dentro dela).
 */
export function isBlockedMoveSource(path: string, ctx: MoveGuardContext = {}): boolean {
  const platform = ctx.platform ?? process.platform
  const env = ctx.env ?? process.env
  const home = ctx.homedir ?? safeHomedir()
  const api = pathApi(platform)
  if (!path.trim() || !api.isAbsolute(path)) return true
  const eq = (a: string | undefined, b: string | undefined): boolean =>
    !!a && !!b && normalizeForCompare(a, platform) === normalizeForCompare(b, platform)
  const n = normalizeForCompare(path, platform)
  const name = api.basename(api.resolve(path))
  const parent = api.dirname(api.resolve(path))
  const grand = api.dirname(parent)

  if (ctx.dataPath && (isInside(ctx.dataPath, path, platform) || isInside(path, ctx.dataPath, platform)))
    return true
  // Raiz da unidade ou do compartilhamento ("C:\", "\\servidor\backup", "/").
  if (n === normalizeForCompare(api.parse(api.resolve(path)).root, platform)) return true

  if (platform === 'win32') {
    const drive = env.SystemDrive || 'C:'
    const sysRoot = env.SystemRoot || env.windir || `${drive}\\Windows`
    if (isInside(path, sysRoot, platform)) return true
    const usersDir = env.USERPROFILE ? win32.dirname(env.USERPROFILE) : `${drive}\\Users`
    const exact = [
      env.ProgramFiles || `${drive}\\Program Files`,
      env['ProgramFiles(x86)'] || `${drive}\\Program Files (x86)`,
      env.ProgramW6432,
      env.ProgramData || `${drive}\\ProgramData`,
      env.ALLUSERSPROFILE,
      env.PUBLIC,
      usersDir,
      `${drive}\\Users`,
      env.USERPROFILE,
      home,
      env.OneDrive,
      env.OneDriveCommercial,
      env.OneDriveConsumer
    ]
    if (exact.some((x) => eq(x, path))) return true
    const usersDirs = [usersDir, `${drive}\\Users`]
    // Raiz de cada perfil (C:\Users\Ana, C:\Users\Public…).
    if (usersDirs.some((u) => eq(parent, u))) return true
    // Desktop, Documentos, Downloads, Imagens e OneDrive na raiz do perfil…
    const lower = name.toLowerCase()
    const known = PROFILE_FOLDERS.has(lower) || isOneDriveName(name)
    if (known && usersDirs.some((u) => eq(grand, u))) return true
    // …e as mesmas pastas dentro do OneDrive (backup de pastas conhecidas).
    if (
      PROFILE_FOLDERS.has(lower) &&
      isOneDriveName(win32.basename(parent)) &&
      usersDirs.some((u) => eq(win32.dirname(grand), u))
    )
      return true
    return false
  }

  const exact = [...POSIX_BLOCKED, home]
  if (exact.some((x) => eq(x, path))) return true
  // Raiz de cada perfil (/home/ana, /Users/ana) e volumes do macOS (/Volumes/Backup).
  if (['/home', '/Users', '/Volumes'].some((d) => eq(parent, d))) return true
  // Desktop, Documentos, Downloads, Imagens e OneDrive na pasta pessoal.
  if ((PROFILE_FOLDERS.has(name.toLowerCase()) || isOneDriveName(name)) && eq(parent, home)) return true
  return false
}

function safeHomedir(): string | undefined {
  try {
    return homedir()
  } catch {
    return undefined
  }
}

/** Pasta sincronizada com a nuvem: apagar aqui também apaga lá. */
export function isCloudSyncedPath(path: string): boolean {
  return path
    .split(/[\\/]+/)
    .some(
      (seg) =>
        isOneDriveName(seg) ||
        /^dropbox( \(.+\))?$/i.test(seg) ||
        /^google drive$/i.test(seg) ||
        /^(meu drive|my drive)$/i.test(seg) ||
        /^icloud ?drive$/i.test(seg) ||
        seg === 'Mobile Documents'
    )
}

/** Exemplos do texto de erro do "Mover" conforme o sistema. */
function blockedExamples(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'C:\\, C:\\Windows, C:\\Users\\Ana…'
  if (platform === 'darwin') return '/, /Users, /Users/ana…'
  return '/, /home, /home/ana…'
}

export function moveBlockedMessage(platform: NodeJS.Platform = process.platform): string {
  return `Não é possível usar "Mover" em uma unidade inteira ou pasta do sistema (${blockedExamples(platform)}). Escolha a pasta onde o sistema grava os backups.`
}

export const MOVE_FILE_SOURCE_MESSAGE =
  '"Mover" só funciona com pastas. Troque o arquivo pela pasta que o contém.'

function intervalText(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return h === 1 ? 'a cada hora' : `a cada ${h} horas`
  }
  return `a cada ${minutes} minutos`
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
  const add = (
    level: ValidationIssue['level'],
    step: ValidationIssue['step'],
    message: string,
    destinationId?: string,
    topic?: ValidationIssue['topic']
  ) => {
    if (issues.some((i) => i.message === message && i.step === step)) return
    const issue: ValidationIssue = { level, step, message }
    if (destinationId) issue.destinationId = destinationId
    if (topic) issue.topic = topic
    issues.push(issue)
  }
  const move = input.moveSources?.enabled === true
  const destName = (d: { label?: string; path: string }) => (d.label ? `${d.label} (${d.path})` : d.path)

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
    if (seenDests.has(key)) add('error', 'destinos', `Destino repetido: ${d.path}`, d.id)
    seenDests.add(key)
  }
  for (const d of dests) {
    if (!d.path || !isAbsolutePath(d.path, platform)) continue
    for (const s of sources) {
      if (!s.path || !isAbsolutePath(s.path, platform)) continue
      if (isInside(d.path, s.path, platform)) {
        add(
          'error',
          'destinos',
          `O destino ${destName(d)} fica dentro da origem ${s.path}. Escolha outra pasta.`,
          d.id
        )
      } else if (isInside(s.path, d.path, platform)) {
        add(
          'error',
          'destinos',
          `O destino ${destName(d)} contém a origem ${s.path}. Escolha outra pasta.`,
          d.id
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
          `Destino indisponível agora: ${destName(d)}. Conecte o disco antes do horário do backup.`,
          d.id
        )
      }
      for (const s of sources) {
        if (!s.path || !isAbsolutePath(s.path, platform)) continue
        if (isInside(d.path, s.path, platform) || isInside(s.path, d.path, platform)) continue
        if (await sameDisk(s.path, d.path, platform)) {
          if (move)
            add(
              'warning',
              'destinos',
              `O destino ${destName(d)} fica no mesmo disco da origem: "Mover" não libera espaço nesse disco.`,
              d.id,
              'move'
            )
          else
            add(
              'warning',
              'destinos',
              `O destino ${destName(d)} está no mesmo disco da origem: se o disco falhar, perde os dois.`,
              d.id
            )
          break
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
  // Com o aviso desligado os campos ficam ocultos: não bloqueia o salvamento por e-mail inválido.
  if (n?.enabled) {
    for (const e of [...(n.recipients ?? []), ...(n.bcc ?? [])]) {
      if (!isValidEmail(e)) add('error', 'notificacao', `E-mail inválido: ${e}`)
    }
    {
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

  /* "Mover" (doc 04 §3) */
  if (move) {
    const guard = { platform, env: ctx.env, homedir: ctx.homedir, dataPath: ctx.dataPath }
    for (const s of sources) {
      if (!s.path?.trim() || !isAbsolutePath(s.path, platform)) continue
      if (s.kind === 'file') add('error', 'origem', MOVE_FILE_SOURCE_MESSAGE, undefined, 'move')
      else if (isBlockedMoveSource(s.path, guard))
        add('error', 'origem', moveBlockedMessage(platform), undefined, 'move')
      else if (checkFs) {
        const st = await withTimeout(stat(s.path), 4000).catch(() => null)
        if (st?.isFile()) add('error', 'origem', MOVE_FILE_SOURCE_MESSAGE, undefined, 'move')
      }
    }
    for (const s of sources) {
      if (!s.path?.trim() || !isAbsolutePath(s.path, platform)) continue
      for (const other of ctx.existing) {
        if (other.id === input.id) continue
        const overlaps = (other.sources ?? []).some(
          (o) =>
            !!o.path &&
            isAbsolutePath(o.path, platform) &&
            (isInside(o.path, s.path, platform) || isInside(s.path, o.path, platform))
        )
        if (overlaps)
          add(
            'warning',
            'origem',
            `A rotina "${other.name}" também usa esta pasta e pode não encontrar os arquivos depois que eles forem movidos.`,
            undefined,
            'move'
          )
      }
    }
    if (sources.some((s) => s.path && isCloudSyncedPath(s.path)))
      add(
        'warning',
        'origem',
        'Esta pasta é sincronizada com a nuvem (OneDrive/Dropbox): apagar aqui também apaga lá.',
        undefined,
        'move'
      )
    if (dests.length === 1)
      add(
        'warning',
        'destinos',
        'Só há 1 destino ativo: depois de mover, o backup existirá em um único lugar. Recomendamos 2 destinos.',
        undefined,
        'move'
      )
    if (ret && !ret.enabled)
      add(
        'warning',
        'retencao',
        'A retenção está desligada: os destinos vão acumular todos os backups movidos.',
        undefined,
        'move'
      )
    if (sch?.kind === 'interval' && input.moveSources?.warnIfEmpty !== false && sch.intervalMinutes >= 5)
      add(
        'warning',
        'agendamento',
        `Com execuções ${intervalText(sch.intervalMinutes)}, desmarque "Avisar se não houver arquivo novo".`,
        undefined,
        'move'
      )
  }

  return issues
}
