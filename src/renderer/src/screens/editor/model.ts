// Tipos e utilidades do editor de rotina.
import type { RoutineInput, ValidationIssue } from '@shared/api'
import type { Routine, Schedule } from '@shared/types'
import { slotMinutes } from '@shared/schedule'

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
    description: 'Escolha as pastas e os arquivos deste backup. Cada item vira uma subpasta no destino.'
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
    description: 'Backups antigos são apagados automaticamente para o disco não encher.'
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
