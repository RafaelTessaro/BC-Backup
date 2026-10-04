// Cliente tipado para `window.bc`. Usamos um Proxy para que módulos possam importar
// `bc` antes de o mock (dev:web) ser instalado.
import type { BcApi } from '@shared/api'

export const bc: BcApi = new Proxy({} as BcApi, {
  get(_target, key: string) {
    return (window.bc as unknown as Record<string, unknown>)[key]
  }
})

/** Mensagem amigável de um erro vindo do IPC ("Error invoking remote method …: Error: X" → "X"). */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const m = /Error: (.+)$/.exec(raw)
  return (m ? m[1] : raw) || 'Algo deu errado. Tente de novo.'
}
