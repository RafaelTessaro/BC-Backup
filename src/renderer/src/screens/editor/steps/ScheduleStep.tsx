import { CalendarClock, Plus, X } from 'lucide-react'
import type { RoutineInput, ValidationIssue } from '@shared/api'
import { describeSchedule, isClockSchedule, upcomingRuns } from '@shared/schedule'
import type { Schedule, ScheduleKind } from '@shared/types'
import { Button, IconButton } from '@renderer/components/ui/Button'
import { Callout } from '@renderer/components/ui/Callout'
import { Card } from '@renderer/components/ui/Card'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Select } from '@renderer/components/ui/Select'
import { Switch } from '@renderer/components/ui/Switch'
import { TimePicker } from '@renderer/components/ui/TimePicker'
import { WeekdayPicker } from '@renderer/components/ui/WeekdayPicker'
import { useNow } from '@renderer/lib/clock'
import { formatWhen } from '@renderer/lib/format'
import { navigate } from '@renderer/lib/router'
import { useApp } from '@renderer/lib/store'
import { ROUTES } from '@shared/routes'
import type { Update } from '../model'
import { IssueList, OptionRow, SectionTitle } from './shared'

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const MAX_TIMES = 6

const INTERVALS = [
  { value: '15', label: '15 minutos' },
  { value: '30', label: '30 minutos' },
  { value: '60', label: '1 hora' },
  { value: '120', label: '2 horas' },
  { value: '240', label: '4 horas' },
  { value: '360', label: '6 horas' },
  { value: '720', label: '12 horas' }
]

const DELAYS = [
  { value: '0', label: 'Sem espera' },
  { value: '1', label: '1 minuto depois' },
  { value: '5', label: '5 minutos depois' },
  { value: '10', label: '10 minutos depois' },
  { value: '15', label: '15 minutos depois' },
  { value: '30', label: '30 minutos depois' }
]

function nextFreeTime(times: string[]): string {
  const last = times[times.length - 1] ?? '12:00'
  const [h, m] = last.split(':').map(Number)
  let nh = (h + 6) % 24
  while (times.includes(`${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`)) nh = (nh + 1) % 24
  return `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function SchedulePreview({ schedule }: { schedule: Schedule }) {
  const now = useNow()
  const runs = upcomingRuns(schedule, now, 4)
  const [first, ...rest] = runs
  return (
    <div className="flex gap-3 rounded-lg bg-accent-soft p-4">
      <CalendarClock className="mt-0.5 size-4 shrink-0 text-accent-text" strokeWidth={1.75} />
      <div className="flex min-w-0 flex-col gap-1">
        {first ? (
          <>
            <p className="text-small font-medium text-fg">
              Próxima execução: <span className="text-accent-text">{formatWhen(first, now)}</span>.
            </p>
            {rest.length > 0 && (
              <p className="text-caption text-fg-muted tnum">Depois: {rest.map((d) => formatWhen(d, now)).join(' · ')}</p>
            )}
          </>
        ) : schedule.kind === 'manual' ? (
          <p className="text-small font-medium text-fg">Sem horário fixo: a rotina roda quando você clicar em “Executar agora”.</p>
        ) : schedule.kind === 'startup' ? (
          <p className="text-small font-medium text-fg">{describeSchedule(schedule)}.</p>
        ) : (
          <p className="text-small font-medium text-fg">Escolha os dias e horários para ver as próximas execuções.</p>
        )}
        {first && <p className="text-caption text-fg-subtle">{describeSchedule(schedule)}</p>}
      </div>
    </div>
  )
}

export function ScheduleStep({
  draft,
  update,
  issues
}: {
  draft: RoutineInput
  update: Update
  issues: ValidationIssue[]
}) {
  const s = draft.schedule
  const launchAtLogin = useApp((st) => st.settings?.launchAtLogin ?? true)
  const set = (patch: Partial<Schedule>): void => update((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }))

  const setKind = (kind: ScheduleKind): void => {
    const patch: Partial<Schedule> = { kind }
    if ((kind === 'daily' || kind === 'weekly') && s.times.length === 0) patch.times = ['18:00']
    if (kind === 'weekly' && s.weekdays.length === 0) patch.weekdays = [1, 2, 3, 4, 5]
    if (kind === 'interval' && !s.intervalMinutes) patch.intervalMinutes = 240
    set(patch)
  }

  const times = (
    <section className="flex flex-col gap-3">
      <SectionTitle title="Horários" description={`Até ${MAX_TIMES} por dia, no formato 24 h.`} />
      <div className="flex flex-wrap items-center gap-2">
        {s.times.map((t, i) => (
          <div key={i} className="group flex items-center">
            <TimePicker
              value={t}
              label={`Horário ${i + 1}`}
              onChange={(v) => set({ times: s.times.map((x, j) => (j === i ? v : x)) })}
            />
            {s.times.length > 1 && (
              <IconButton
                icon={X}
                label="Remover horário"
                className="ml-0.5 size-6"
                onClick={() => set({ times: s.times.filter((_, j) => j !== i) })}
              />
            )}
          </div>
        ))}
        {s.times.length < MAX_TIMES && (
          <Button variant="ghost" icon={Plus} onClick={() => set({ times: [...s.times, nextFreeTime(s.times)] })}>
            Adicionar horário
          </Button>
        )}
      </div>
    </section>
  )

  return (
    <div className="flex flex-col gap-8">
      <Segmented<ScheduleKind>
        label="Tipo de agendamento"
        value={s.kind}
        onChange={setKind}
        className="w-full"
        options={[
          { value: 'daily', label: 'Diariamente' },
          { value: 'weekly', label: 'Dias da semana' },
          { value: 'interval', label: 'A cada N horas' },
          { value: 'startup', label: 'Ao iniciar' },
          { value: 'manual', label: 'Manual' }
        ]}
      />

      {s.kind === 'weekly' && (
        <section className="flex flex-col gap-3">
          <SectionTitle title="Dias" />
          <WeekdayPicker value={s.weekdays} onChange={(weekdays) => set({ weekdays })} />
        </section>
      )}

      {(s.kind === 'daily' || s.kind === 'weekly') && times}

      {s.kind === 'interval' && (
        <>
          <section className="flex flex-col gap-3">
            <SectionTitle title="Frequência" />
            <div className="flex flex-wrap items-center gap-3 text-small text-fg-muted">
              <span>A cada</span>
              <Select
                className="w-[160px]"
                label="Intervalo"
                value={String(s.intervalMinutes)}
                onChange={(v) => set({ intervalMinutes: Number(v) })}
                options={INTERVALS}
              />
              {s.window && (
                <>
                  <span>das</span>
                  <TimePicker
                    label="Início"
                    value={s.window.start}
                    onChange={(start) => set({ window: { ...s.window!, start } })}
                  />
                  <span>às</span>
                  <TimePicker label="Fim" value={s.window.end} onChange={(end) => set({ window: { ...s.window!, end } })} />
                </>
              )}
            </div>
          </section>
          <Card>
            <OptionRow
              title="Só em um horário do dia"
              description="Ex.: apenas no expediente, para não pesar à noite ou na madrugada."
            >
              <Switch
                label="Só em um horário do dia"
                checked={s.window !== null}
                onCheckedChange={(v) => set({ window: v ? { start: '08:00', end: '18:00' } : null })}
              />
            </OptionRow>
          </Card>
          <section className="flex flex-col gap-3">
            <SectionTitle title="Dias" />
            <WeekdayPicker
              value={s.weekdays.length ? s.weekdays : ALL_DAYS}
              onChange={(days) => set({ weekdays: days.length === 7 ? [] : days })}
            />
          </section>
        </>
      )}

      {s.kind === 'startup' && (
        <section className="flex flex-col gap-3">
          <SectionTitle title="Quando ligar o computador" description="Esperar um pouco deixa o computador terminar de iniciar." />
          <Select
            className="w-[220px]"
            label="Atraso"
            value={String(s.startupDelayMinutes)}
            onChange={(v) => set({ startupDelayMinutes: Number(v) })}
            options={DELAYS}
          />
          {!launchAtLogin && (
            <Callout
              tone="warning"
              action={
                <Button variant="link" size="sm" onClick={() => navigate(ROUTES.settings)}>
                  Abrir Configurações
                </Button>
              }
            >
              “Iniciar com o Windows” está desligado. Ligue em Configurações → Geral para esta rotina funcionar.
            </Callout>
          )}
        </section>
      )}

      {s.kind === 'manual' && (
        <Callout tone="neutral">
          A rotina só roda quando você clicar em “Executar agora” — aqui no aplicativo ou no menu da bandeja.
        </Callout>
      )}

      {isClockSchedule(s) && (
        <Card>
          <OptionRow
            title="Executar backups atrasados ao ligar o computador"
            description="Se o computador estiver desligado no horário, o backup roda uma vez quando ele ligar."
          >
            <Switch
              label="Executar backups atrasados"
              checked={s.catchUpMissed}
              onCheckedChange={(catchUpMissed) => set({ catchUpMissed })}
            />
          </OptionRow>
        </Card>
      )}

      <SchedulePreview schedule={s} />
      <IssueList issues={issues} />
    </div>
  )
}
