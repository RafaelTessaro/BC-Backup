// Tipos e utilidades do editor de rotina.
import type { RoutineInput, ValidationIssue } from '@shared/api'
import type { Routine, Schedule, SourceItem, SourceKind } from '@shared/types'
import { slotMinutes } from '@shared/schedule'
import { baseName } from '@renderer/lib/format'

export type StepId = ValidationIssue['step'] | 'revisao'

export interface StepMeta {
  id: StepId
  label: string
  title: string
  description: string
}

export const STEPS: StepMeta[] = [
  {
    id: 'origem',
    label: 'Origem',
    title: 'O que você quer copiar?',
    description: 'Dê um nome à rotina e escolha as pastas e os arquivos que entram no backup.'
  },
  {
    id: 'destinos',
    label: 'Destinos',
    title: 'Para onde as cópias vão?',
    description:
      'Dois discos diferentes = mais segurança. Use um HD externo, outra unidade ou uma pasta da rede.'
  },
  {
    id: 'agendamento',
    label: 'Agendamento',
    title: 'Quando executar?',
    description: 'O BC Backup roda sozinho nos horários escolhidos, mesmo com a janela fechada.'
  },
  {
    id: 'retencao',
    label: 'Retenção',
    title: 'Por quanto tempo guardar?',
    description: 'Os backups mais antigos são apagados sozinhos, para o disco de destino não encher.'
  },
  {
    id: 'notificacao',
    label: 'Notificação',
    title: 'Avisar alguém?',
    description: 'Envie um e-mail ao cliente ou ao técnico quando o backup terminar.'
  },
  {
    id: 'revisao',
    label: 'Revisão',
    title: 'Tudo certo?',
    description: 'Confira o resumo antes de salvar.'
  }
]

export type Update = (fn: (d: RoutineInput) => RoutineInput) => void

export function toInput(r: Routine): RoutineInput {
  const { createdAt: _c, updatedAt: _u, lastRun: _l, ...rest } = r
  return structuredClone(rest)
}

/** Níveis de compressão do ZIP oferecidos no editor. */
export const ZIP_LEVELS = [
  { value: '1', label: 'Rápida', description: 'Arquivo maior, termina antes' },
  { value: '6', label: 'Equilibrada', description: 'Padrão recomendado' },
  { value: '9', label: 'Máxima', description: 'Arquivo menor, mais demorado' }
]

/** Limite de caracteres do nome (o main recusa acima disso). */
export const NAME_MAX = 60

/**
 * Limpa o rascunho antes de salvar: nome sem espaços nas pontas e horários em ordem, sem repetição
 * (o editor deixa digitar à vontade; a ordem só é aplicada ao salvar para os campos não "pularem").
 */
export function tidyForSave(d: RoutineInput): RoutineInput {
  const times = [...new Set(d.schedule.times)].sort()
  return { ...d, name: d.name.trim(), schedule: { ...d.schedule, times } }
}

/** Horários que aparecem mais de uma vez. */
export function duplicateTimes(times: string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const t of times) (seen.has(t) ? dup : seen).add(t)
  return [...dup]
}

/** Igual ao `sanitizeName` do main: o nome da pasta da rotina dentro do destino. */
export function folderName(name: string, fallback = 'Rotina'): string {
  // eslint-disable-next-line no-control-regex
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  s = s.replace(/[. ]+$/, '').trim()
  if (s.length > 80)
    s = s
      .slice(0, 80)
      .replace(/[. ]+$/, '')
      .trim()
  if (!s) s = fallback
  if (/^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i.test(s)) s = `_${s}`
  return s
}

/** Junta partes de caminho com o separador do próprio caminho (Windows "\" ou POSIX "/"). */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') || /^[A-Za-z]:/.test(base) ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

/** Troca caminhos longos dentro de uma mensagem por versões curtas ("C:\Users\…\Backup"). */
export function shortenPaths(message: string, paths: string[], max = 44): string {
  let out = message
  for (const p of [...new Set(paths)].sort((a, b) => b.length - a.length)) {
    if (p.length > max && out.includes(p)) out = out.split(p).join(shortPath(p))
  }
  return out
}

/** Mantém a raiz e a última pasta: "C:\…\Backup", "\\SERVIDOR\…\Clientes". */
function shortPath(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/'
  const unc = p.startsWith('\\\\')
  const parts = (unc ? p.slice(2) : p).split(sep).filter(Boolean)
  if (parts.length < 3) return p
  const head = (unc ? '\\\\' : p.startsWith('/') ? '/' : '') + parts[0]
  return `${head}${sep}…${sep}${parts[parts.length - 1]}`
}

/** Execuções por dia estimadas a partir do agendamento (null = imprevisível). */
export function runsPerDay(s: Schedule): number | null {
  switch (s.kind) {
    case 'daily':
      return s.times.length
    case 'weekly':
      return (s.times.length * s.weekdays.length) / 7
    case 'interval':
      return (slotMinutes(s).length * (s.weekdays.length || 7)) / 7
    case 'startup':
      return 1
    case 'manual':
      return null
  }
}

let seq = 0
export function newId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

/** Chave de comparação de caminhos (Windows/macOS não diferenciam maiúsculas). */
export function pathKey(path: string, caseInsensitive: boolean): string {
  const p = path.length > 3 ? path.replace(/[\\/]+$/, '') : path
  return caseInsensitive ? p.toLowerCase() : p
}

/**
 * Acrescenta origens sem repetir caminhos. Se a rotina ainda não tem nome, sugere o nome
 * da primeira pasta/arquivo adicionado.
 */
export function withSources(
  d: RoutineInput,
  entries: Array<{ path: string; kind: SourceKind }>,
  caseInsensitive = true
): RoutineInput {
  const seen = new Set(d.sources.map((s) => pathKey(s.path, caseInsensitive)))
  const added: SourceItem[] = []
  for (const e of entries) {
    const key = pathKey(e.path, caseInsensitive)
    if (!e.path.trim() || seen.has(key)) continue
    seen.add(key)
    added.push({ id: newId('src'), path: e.path, kind: e.kind })
  }
  if (!added.length) return d
  const next = { ...d, sources: [...d.sources, ...added] }
  if (!d.name.trim()) next.name = baseName(added[0].path).slice(0, NAME_MAX)
  return next
}

/* Rascunho guardado ao sair para Configurações → E-mail (volta intacto). */
interface Stash {
  key: string
  draft: RoutineInput
  step: StepId
  reached: number
}
let stash: Stash | null = null

export function stashDraft(s: Stash): void {
  stash = s
}

export function peekStash(key: string): Stash | null {
  return stash && stash.key === key ? stash : null
}

export function clearStash(key: string): void {
  if (stash?.key === key) stash = null
}

export function hasStash(): { key: string; name: string } | null {
  return stash ? { key: stash.key, name: stash.draft.name } : null
}
