import { ArrowLeft, ArrowRight, Check, FileQuestion, Play, Upload } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import { createDefaultRoutine } from '@shared/defaults'
import { ROUTES } from '@shared/routes'
import type { Routine } from '@shared/types'
import { Page } from '@renderer/components/shell/Page'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Shortcut, TOOLTIP_KBD } from '@renderer/components/ui/Kbd'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { runNow } from '@renderer/lib/actions'
import { bc, errorMessage } from '@renderer/lib/bc'
import { cn } from '@renderer/lib/cn'
import { baseName } from '@renderer/lib/format'
import { useDebounced, useHotkey } from '@renderer/lib/hooks'
import { navigate, useRouter } from '@renderer/lib/router'
import { refreshRoutines, useApp } from '@renderer/lib/store'
import { notify } from '@renderer/lib/toast'
import { useFileDrop, type DropResult } from './drop'
import {
  STEPS,
  clearStash,
  peekStash,
  stashDraft,
  tidyForSave,
  toInput,
  withSources,
  type StepId
} from './model'
import { useSourceSizes } from './sizes'
import { Stepper, type StepState } from './Stepper'
import { DestinationsStep } from './steps/DestinationsStep'
import { NotificationStep } from './steps/NotificationStep'
import { RetentionStep } from './steps/RetentionStep'
import { ReviewStep } from './steps/ReviewStep'
import { ScheduleStep } from './steps/ScheduleStep'
import { SourcesStep } from './steps/SourcesStep'

/** Toast "Rascunho guardado" (sai sozinho quando o rascunho é retomado). */
const DRAFT_TOAST = 'rascunho-guardado'

const isSubmitKey = (e: KeyboardEvent): boolean => (e.ctrlKey || e.metaKey) && e.key === 'Enter'
const isSaveKey = (e: KeyboardEvent): boolean => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'

function scrollTop(): void {
  document.getElementById('conteudo')?.scrollTo({ top: 0, behavior: 'smooth' })
}

/**
 * Campos que só confirmam o valor ao perder o foco (horário, número, chips) seriam perdidos
 * com Ctrl+Enter: tira o foco deles e espera o React aplicar a alteração.
 */
async function commitPendingInput(): Promise<void> {
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.blur()
    await new Promise((r) => setTimeout(r, 0))
  }
}

/** Primeiro controle com erro na etapa (ou a mensagem de erro). */
const ERROR_TARGET =
  '[aria-invalid="true"], [data-invalid] input, [data-invalid] button:not([disabled]), [data-error-focus]'

export function EditorScreen({ routineId }: { routineId?: string }) {
  const existing = useApp((s) => (routineId ? s.routines.find((r) => r.id === routineId) : undefined))
  if (routineId && !existing) {
    return (
      <Page>
        <Card className="flex min-h-[380px] items-center justify-center rounded-xl p-10">
          <EmptyState
            icon={FileQuestion}
            title="Rotina não encontrada"
            description="Ela pode ter sido excluída. As cópias já feitas continuam no destino."
            action={
              <Button icon={ArrowLeft} onClick={() => navigate(ROUTES.routines)}>
                Voltar para Rotinas
              </Button>
            }
          />
        </Card>
      </Page>
    )
  }
  return <Editor existing={existing} />
}

function Editor({ existing }: { existing?: Routine }) {
  const isNew = !existing
  const key = existing?.id ?? 'new'
  const [init] = useState(() => {
    const base = existing ? toInput(existing) : createDefaultRoutine()
    const stash = peekStash(key)
    return {
      draft: stash?.draft ?? base,
      baseline: JSON.stringify(base),
      step: stash?.step ?? ('origem' as StepId),
      reached: stash?.reached ?? 0,
      restored: !!stash
    }
  })
  const [draft, setDraft] = useState<RoutineInput>(init.draft)
  const [step, setStep] = useState<StepId>(init.step)
  const [reached, setReached] = useState(init.reached)
  const [attempted, setAttempted] = useState<Set<StepId>>(() => new Set())
  const [issues, setIssues] = useState<ValidationIssue[]>([])
  const [saving, setSaving] = useState<'save' | 'run' | null>(null)
  const [focusReq, setFocusReq] = useState<{ to: 'heading' | 'error'; n: number } | null>(null)
  const [dropNote, setDropNote] = useState<string | null>(null)
  const setBlocker = useRouter((s) => s.setBlocker)
  const platform = useApp((s) => s.info?.platform)
  const caseInsensitive = platform !== 'linux'
  const draftRef = useRef(draft)
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    draftRef.current = draft
  })

  // Troca de etapa: foco no título (leitor de tela anuncia; Tab segue para o formulário).
  // Continuar bloqueado: foco no primeiro campo com erro.
  useEffect(() => {
    if (!focusReq) return
    const target =
      focusReq.to === 'error'
        ? (sectionRef.current?.querySelector<HTMLElement>(ERROR_TARGET) ?? headingRef.current)
        : headingRef.current
    target?.focus({ preventScroll: focusReq.to === 'heading' })
  }, [focusReq])

  useEffect(() => {
    clearStash(key)
    // De volta ao rascunho: o aviso com "Voltar para a rotina" não serve mais.
    if (init.restored) notify.dismiss(DRAFT_TOAST)
  }, [key, init.restored])

  const json = JSON.stringify(draft)
  const dirty = json !== init.baseline
  const debounced = useDebounced(json, 250)

  useEffect(() => {
    let alive = true
    bc.routines
      .validate(JSON.parse(debounced) as RoutineInput)
      .then((list) => alive && setIssues(list))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [debounced])

  useEffect(() => {
    setBlocker(dirty ? () => true : null)
    return () => setBlocker(null)
  }, [dirty, setBlocker])

  const onDropped = (r: DropResult): void => {
    if (r.unsupported) {
      notify.info('Use os botões para adicionar', {
        description: 'Arrastar arquivos para cá não está disponível nesta versão.'
      })
      return
    }
    const before = draftRef.current
    const added = withSources(before, r.found, caseInsensitive).sources.length - before.sources.length
    if (added) setDraft((d) => withSources(d, r.found, caseInsensitive))
    const notes: string[] = []
    if (r.unreadable.length) notes.push(`Não foi possível ler: ${r.unreadable.map(baseName).join(', ')}.`)
    if (r.withoutPath)
      notes.push(
        `Só dá para soltar pastas e arquivos do computador — ${
          r.withoutPath === 1 ? '1 item foi ignorado' : `${r.withoutPath} itens foram ignorados`
        }.`
      )
    if (!added && r.found.length && !notes.length) notes.push('Esses itens já estão na lista.')
    setDropNote(notes.length ? notes.join(' ') : null)
  }
  const drop = useFileDrop(step === 'origem', onDropped)

  const sizes = useSourceSizes(draft.sources, draft.filters)
  const idx = STEPS.findIndex((s) => s.id === step)
  const meta = STEPS[idx]
  const showErrors = (id: StepId): boolean => !isNew || attempted.has(id)
  const issuesFor = (id: StepId): ValidationIssue[] =>
    issues.filter((i) => i.step === id && (i.level === 'warning' || showErrors(id)))

  const states = Object.fromEntries(
    STEPS.map((s, i) => {
      const list = issuesFor(s.id)
      const st: StepState = {
        status: s.id === step ? 'current' : !isNew || i < reached ? 'done' : 'pending',
        clickable: !isNew || i <= reached,
        issue: list.some((x) => x.level === 'error') ? 'error' : list.length ? 'warning' : undefined
      }
      return [s.id, st]
    })
  ) as Record<StepId, StepState>

  const goTo = (id: StepId, focus: 'heading' | 'error' = 'heading'): void => {
    setStep(id)
    setFocusReq((f) => ({ to: focus, n: (f?.n ?? 0) + 1 }))
    scrollTop()
  }

  const next = async (): Promise<void> => {
    await commitPendingInput()
    const current = draftRef.current
    const fresh = await bc.routines.validate(current).catch(() => issues)
    setIssues(fresh)
    setAttempted((prev) => new Set(prev).add(step))
    if (fresh.some((i) => i.level === 'error' && i.step === step)) {
      setFocusReq((f) => ({ to: 'error', n: (f?.n ?? 0) + 1 }))
      return
    }
    const ni = Math.min(idx + 1, STEPS.length - 1)
    setReached((r) => Math.max(r, ni))
    goTo(STEPS[ni].id)
  }

  const submit = async (run: boolean): Promise<void> => {
    await commitPendingInput()
    const current = tidyForSave(draftRef.current)
    const fresh = await bc.routines.validate(current).catch(() => issues)
    setIssues(fresh)
    const errors = fresh.filter((i) => i.level === 'error')
    if (errors.length) {
      setAttempted(new Set(STEPS.map((s) => s.id)))
      setReached(STEPS.length - 1)
      goTo(errors[0].step, 'error')
      notify.error('Revise a rotina antes de salvar', {
        description:
          errors.length === 1 ? errors[0].message : `${errors[0].message} (e mais ${errors.length - 1})`
      })
      return
    }
    setSaving(run ? 'run' : 'save')
    try {
      const saved = await bc.routines.save(isNew ? current : { ...current, id: existing!.id })
      await refreshRoutines()
      setBlocker(null)
      navigate(ROUTES.routines, { force: true })
      notify.success(isNew ? 'Rotina criada' : 'Alterações salvas', {
        description: saved.enabled ? saved.name : `${saved.name} · pausada`
      })
      if (run) await runNow(saved, { openDrawer: true })
    } catch (err) {
      notify.error('Não foi possível salvar', { description: errorMessage(err) })
    } finally {
      setSaving(null)
    }
  }

  const configureEmail = (): void => {
    stashDraft({ key, draft, step, reached })
    setBlocker(null)
    navigate(ROUTES.settingsEmail, { force: true })
    const back = isNew ? ROUTES.newRoutine : ROUTES.routine(key)
    notify.info('Rascunho guardado', {
      description: `Quando terminar, volte para “${draft.name.trim() || 'Nova rotina'}”.`,
      action: { label: 'Voltar para a rotina', onClick: () => navigate(back) },
      duration: 12000,
      id: DRAFT_TOAST
    })
  }

  const cancel = (): void => navigate(ROUTES.routines)
  const last = idx === STEPS.length - 1

  useHotkey(isSubmitKey, () => {
    if (saving) return
    if (isNew && !last) void next()
    else void submit(false)
  })
  useHotkey(isSaveKey, () => !isNew && !saving && void submit(false), !isNew)

  const update = (fn: (d: RoutineInput) => RoutineInput): void => setDraft((d) => fn(d))

  return (
    <div className="relative flex flex-1 flex-col" {...drop.handlers}>
      {drop.dragging && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-20">
          <div className="sticky top-0 flex h-[calc(100vh-56px)] max-h-full p-3">
            <div className="flex flex-1 items-end justify-center rounded-xl border-2 border-dashed border-accent-edge bg-accent-soft/40 pb-24">
              <span className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-small font-medium text-accent-foreground shadow-pop">
                <Upload className="size-4" strokeWidth={1.75} />
                Solte para adicionar à origem
              </span>
            </div>
          </div>
        </div>
      )}
      <Page className="flex-1 pb-10">
        <header className="mb-8 flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="truncate text-title font-semibold text-fg">
              {isNew ? 'Nova rotina' : existing!.name}
            </h1>
            <p className="mt-1 text-small text-fg-muted">
              {isNew
                ? 'Seis etapas rápidas, com padrões que servem para a maioria dos casos.'
                : 'Navegue pelas etapas à vontade e salve quando terminar.'}
            </p>
          </div>
        </header>

        <div className="flex items-start gap-10">
          <aside className="sticky top-6 w-[220px] shrink-0">
            <Stepper current={step} states={states} onSelect={(id) => goTo(id)} />
          </aside>
          <section
            key={step}
            ref={sectionRef}
            className="max-w-[640px] min-w-0 flex-1 animate-step-in"
            aria-labelledby="step-title"
          >
            <p className="text-caption font-medium text-fg-subtle tnum">
              Etapa {idx + 1} de {STEPS.length}
            </p>
            <h2
              id="step-title"
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 text-section font-semibold text-fg outline-none"
            >
              {meta.title}
            </h2>
            <p className="mt-1 text-small text-fg-muted">
              {step === 'revisao' && !isNew ? 'Confira o resumo da rotina.' : meta.description}
            </p>
            <div className="mt-6">
              {step === 'origem' && (
                <SourcesStep
                  draft={draft}
                  update={update}
                  sizes={sizes}
                  issues={issuesFor('origem')}
                  autoFocus={isNew}
                  dragging={drop.dragging}
                  dropNote={dropNote}
                  caseInsensitive={caseInsensitive}
                  onPicked={() => setDropNote(null)}
                />
              )}
              {step === 'destinos' && (
                <DestinationsStep
                  draft={draft}
                  update={update}
                  sizes={sizes}
                  issues={issuesFor('destinos')}
                />
              )}
              {step === 'agendamento' && (
                <ScheduleStep draft={draft} update={update} issues={issuesFor('agendamento')} />
              )}
              {step === 'retencao' && (
                <RetentionStep draft={draft} update={update} sizes={sizes} issues={issuesFor('retencao')} />
              )}
              {step === 'notificacao' && (
                <NotificationStep
                  draft={draft}
                  update={update}
                  issues={issuesFor('notificacao')}
                  onConfigureEmail={configureEmail}
                />
              )}
              {step === 'revisao' && (
                <ReviewStep
                  draft={draft}
                  update={update}
                  sizes={sizes}
                  issues={isNew ? issues.filter((i) => i.level === 'warning' || attempted.size > 0) : issues}
                  goTo={(id) => goTo(id)}
                  isNew={isNew}
                />
              )}
            </div>
          </section>
        </div>
      </Page>

      <footer className="sticky bottom-0 z-10 border-t border-border bg-surface-raised/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center gap-2 px-8">
          <Button variant="ghost" onClick={cancel}>
            Cancelar
          </Button>
          <div className="flex-1" />
          {!isNew && (
            <span
              className={cn(
                'mr-2 flex items-center gap-1.5 text-caption transition-opacity duration-[180ms]',
                dirty ? 'text-fg-muted opacity-100' : 'opacity-0'
              )}
              aria-hidden={!dirty}
            >
              <span className="size-1.5 rounded-full bg-warning-bar" /> Alterações não salvas
            </span>
          )}
          {isNew ? (
            <>
              {idx > 0 && (
                <Button variant="secondary" icon={ArrowLeft} onClick={() => goTo(STEPS[idx - 1].id)}>
                  Voltar
                </Button>
              )}
              {last ? (
                <>
                  <Button
                    variant="secondary"
                    icon={Play}
                    loading={saving === 'run'}
                    disabled={!!saving}
                    onClick={() => void submit(true)}
                  >
                    Criar e executar agora
                  </Button>
                  <Button
                    variant="primary"
                    icon={Check}
                    loading={saving === 'save'}
                    disabled={!!saving}
                    onClick={() => void submit(false)}
                  >
                    Criar rotina
                  </Button>
                </>
              ) : (
                <Tooltip
                  label={
                    <span className="flex items-center gap-2">
                      Continuar <Shortcut keys={['Ctrl', 'Enter']} className={TOOLTIP_KBD} />
                    </span>
                  }
                >
                  <Button
                    variant="primary"
                    iconRight={ArrowRight}
                    onClick={() => void next()}
                    className="min-w-[120px]"
                  >
                    Continuar
                  </Button>
                </Tooltip>
              )}
            </>
          ) : (
            <>
              {last && (
                <Button
                  variant="secondary"
                  icon={Play}
                  loading={saving === 'run'}
                  disabled={!!saving}
                  onClick={() => void submit(true)}
                >
                  Salvar e executar
                </Button>
              )}
              <Button
                variant="primary"
                icon={Check}
                loading={saving === 'save'}
                disabled={!dirty || !!saving}
                onClick={() => void submit(false)}
              >
                Salvar alterações
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  )
}
