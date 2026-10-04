// Mapa único de status → texto, tom e ícone (design system §8 StatusPill, §9 microcopy).
import {
  Ban,
  CircleCheck,
  CircleX,
  Clock,
  Hand,
  LoaderCircle,
  Pause,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import type { Routine, RunProgress, RunStatus } from '@shared/types'

export type Tone = 'success' | 'warning' | 'danger' | 'accent' | 'info' | 'neutral' | 'muted'

export interface StatusMeta {
  label: string
  tone: Tone
  icon: LucideIcon
  spin?: boolean
}

export const RUN_STATUS: Record<RunStatus, StatusMeta> = {
  success: { label: 'Concluído', tone: 'success', icon: CircleCheck },
  warning: { label: 'Com avisos', tone: 'warning', icon: TriangleAlert },
  failed: { label: 'Falhou', tone: 'danger', icon: CircleX },
  running: { label: 'Em execução', tone: 'accent', icon: LoaderCircle, spin: true },
  queued: { label: 'Na fila', tone: 'neutral', icon: Clock },
  cancelled: { label: 'Cancelado', tone: 'muted', icon: Ban }
}

export type RoutineState = 'running' | 'paused' | 'failed' | 'warning' | 'scheduled' | 'manual'

export const ROUTINE_STATUS: Record<RoutineState, StatusMeta> = {
  running: { label: 'Em execução', tone: 'accent', icon: LoaderCircle, spin: true },
  paused: { label: 'Pausada', tone: 'neutral', icon: Pause },
  failed: { label: 'Falhou', tone: 'danger', icon: CircleX },
  warning: { label: 'Com avisos', tone: 'warning', icon: TriangleAlert },
  scheduled: { label: 'Agendada', tone: 'info', icon: Clock },
  manual: { label: 'Manual', tone: 'neutral', icon: Hand }
}

export function routineState(r: Routine, progress?: RunProgress): RoutineState {
  if (progress) return 'running'
  if (!r.enabled) return 'paused'
  if (r.lastRun?.status === 'failed') return 'failed'
  if (r.lastRun?.status === 'warning') return 'warning'
  if (r.schedule.kind === 'manual') return 'manual'
  return 'scheduled'
}

/** Classes de texto/fundo por tom (sempre acompanhadas de ícone + texto). */
export const TONE_SOFT: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent-text',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-hover text-fg-muted',
  muted: 'bg-surface-hover text-fg-subtle'
}

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  accent: 'text-accent-text',
  info: 'text-info',
  neutral: 'text-fg-muted',
  muted: 'text-fg-subtle'
}

/** Cor sólida das barras de status (14 dias). */
export const STATUS_BAR: Record<string, string> = {
  success: 'bg-success-bar',
  warning: 'bg-warning-bar',
  failed: 'bg-danger-bar',
  cancelled: 'bg-fg-subtle/50',
  none: 'bg-border'
}

export const PHASE_LABEL: Record<RunProgress['phase'], string> = {
  queued: 'Na fila',
  scanning: 'Preparando…',
  copying: 'Copiando',
  verifying: 'Verificando a cópia…',
  pruning: 'Limpando cópias antigas…',
  notifying: 'Enviando e-mail…',
  done: 'Concluído'
}

export const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Executada manualmente',
  schedule: 'Agendada',
  startup: 'Ao iniciar o computador',
  'catch-up': 'Backup atrasado'
}
