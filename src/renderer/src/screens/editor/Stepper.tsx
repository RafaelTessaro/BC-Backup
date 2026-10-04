import { Check } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { STEPS, type StepId } from './model'

export interface StepState {
  status: 'current' | 'done' | 'pending'
  clickable: boolean
  issue?: 'error' | 'warning'
}

/** Stepper vertical (§8): itens 36 px; círculo 20 px; linha 1 px ligando os círculos. */
export function Stepper({
  current,
  states,
  onSelect
}: {
  current: StepId
  states: Record<StepId, StepState>
  onSelect: (id: StepId) => void
}) {
  return (
    <nav aria-label="Etapas da rotina">
      <ol className="flex flex-col">
        {STEPS.map((step, i) => {
          const st = states[step.id]
          const isCurrent = step.id === current
          return (
            <li key={step.id} className="relative">
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-[28px] left-[19.5px] h-[16px] w-px',
                    st.status === 'done' ? 'bg-accent/35' : 'bg-border'
                  )}
                />
              )}
              <button
                type="button"
                disabled={!st.clickable}
                onClick={() => onSelect(step.id)}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'group flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left transition-colors duration-[120ms]',
                  isCurrent ? 'bg-surface-hover' : st.clickable && 'hover:bg-surface-hover/70',
                  !st.clickable && 'cursor-not-allowed'
                )}
              >
                <span
                  className={cn(
                    'relative flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tnum transition-colors duration-[180ms]',
                    isCurrent && 'bg-accent text-accent-foreground shadow-[0_0_0_3px_var(--accent-soft)]',
                    !isCurrent && st.status === 'done' && 'bg-accent-soft text-accent-text',
                    !isCurrent && st.status === 'pending' && 'border border-border-strong bg-surface-raised text-fg-subtle'
                  )}
                >
                  {!isCurrent && st.status === 'done' ? <Check className="size-3" strokeWidth={2.75} /> : i + 1}
                  {st.issue && (
                    <span
                      className={cn(
                        'absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-bg',
                        st.issue === 'error' ? 'bg-danger' : 'bg-warning-bar'
                      )}
                      aria-label={st.issue === 'error' ? 'Precisa de correção' : 'Tem avisos'}
                    />
                  )}
                </span>
                <span
                  className={cn(
                    'text-small',
                    isCurrent ? 'font-medium text-fg' : st.status === 'done' ? 'text-fg-muted' : 'text-fg-subtle',
                    st.clickable && !isCurrent && 'group-hover:text-fg'
                  )}
                >
                  {step.label}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
