import type { ClipboardEvent } from 'react'
import { ChipInput } from '@renderer/components/ui/ChipInput'
import { EMAIL_RE } from '@renderer/lib/format'

/** "Carla <Carla@Z.com.br>", "mailto:x@y.com", "x@y.com." → "carla@z.com.br", "x@y.com". */
export function normalizeEmail(raw: string): string {
  const inner = /<([^<>]*@[^<>]*)>/.exec(raw)
  return (inner ? inner[1] : raw)
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^[<"'(]+|[>"')]+$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase()
}

export const isEmail = (v: string): boolean => EMAIL_RE.test(v) && !/[<>()"]/.test(v)

/** Endereços dentro de um texto colado (lista do Outlook, planilha, "Nome <e-mail>"…). */
function emailsIn(text: string): string[] {
  return text
    .replace(/[<>"'()[\]]/g, ' ')
    .split(/[\s,;]+/)
    .filter((t) => t.includes('@'))
    .map(normalizeEmail)
    .filter(Boolean)
}

/**
 * ChipInput para e-mails: aceita colar listas com nomes ("Carla <carla@x.com>") e separadores
 * variados, guardando só os endereços. Endereços inválidos ficam marcados em vermelho.
 */
export function EmailChips({
  id,
  values,
  onChange,
  placeholder,
  invalid
}: {
  id: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder: string
  invalid?: boolean
}) {
  const onPasteCapture = (e: ClipboardEvent): void => {
    const text = e.clipboardData.getData('text')
    // Um endereço só, sem nome nem separador: deixa colar no campo normalmente.
    if (!/[\s,;<>]/.test(text.trim())) return
    const found = emailsIn(text)
    if (!found.length) return
    e.preventDefault()
    e.stopPropagation()
    const next = [...values]
    for (const v of found) if (!next.includes(v)) next.push(v)
    onChange(next)
  }
  return (
    <div onPasteCapture={onPasteCapture}>
      <ChipInput
        id={id}
        values={values}
        splitOnWhitespace
        normalize={normalizeEmail}
        validate={(v) => (isEmail(v) ? null : 'E-mail inválido')}
        invalid={invalid}
        placeholder={placeholder}
        onChange={onChange}
      />
    </div>
  )
}
