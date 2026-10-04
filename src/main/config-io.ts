// Exportar/importar configurações (JSON sem senhas) — para replicar o setup em outros clientes.
// Node puro.

import type { AppSettings } from '@shared/types'
import { migrateRoutine, migrateSettings, isObj, newId, type StoredRoutine } from './store'

export const EXPORT_FORMAT = 'bc-backup-config'

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: 1
  exportedAt: string
  appVersion: string
  settings: Omit<AppSettings, 'trayHintShown' | 'computerAlias'>
  routines: StoredRoutine[]
}

export function buildExport(
  settings: AppSettings,
  routines: StoredRoutine[],
  appVersion: string,
  now = new Date()
): ExportFile {
  const { trayHintShown: _t, computerAlias: _c, ...rest } = settings
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    appVersion,
    // A senha nunca sai daqui: só `hasPassword`, que na importação é ignorado.
    settings: { ...rest, smtp: { ...rest.smtp, hasPassword: false } },
    routines: routines.map((r) => {
      const copy = structuredClone(r) as StoredRoutine & { lastRun?: unknown }
      delete copy.lastRun
      return copy
    })
  }
}

export interface ImportPlan {
  routines: StoredRoutine[]
  /** Configurações a aplicar (sem senha, sem apelido do computador). */
  settings: Partial<AppSettings> | null
}

/** Valida o arquivo importado e prepara as rotinas (ids novos quando colidem, nomes únicos). */
export function planImport(raw: unknown, existing: StoredRoutine[], now = new Date()): ImportPlan {
  if (!isObj(raw) || raw.format !== EXPORT_FORMAT) {
    throw new Error('Este arquivo não é uma exportação de configurações do BC Backup.')
  }
  if (typeof raw.version !== 'number' || raw.version > 1) {
    throw new Error(
      'Este arquivo foi gerado por uma versão mais nova do BC Backup. Atualize o programa e tente de novo.'
    )
  }
  const ids = new Set(existing.map((r) => r.id))
  const names = new Set(existing.map((r) => r.name.trim().toLocaleLowerCase('pt-BR')))
  const routines: StoredRoutine[] = []
  for (const item of Array.isArray(raw.routines) ? raw.routines : []) {
    if (!isObj(item)) continue
    const r = migrateRoutine(item, now)
    if (!r.name) continue
    if (ids.has(r.id)) r.id = newId()
    ids.add(r.id)
    let name = r.name
    for (let n = 1; names.has(name.toLocaleLowerCase('pt-BR')); n++) {
      name = n === 1 ? `${r.name} (importada)` : `${r.name} (importada ${n})`
    }
    r.name = name
    names.add(name.toLocaleLowerCase('pt-BR'))
    r.sources = r.sources.map((s) => ({ ...s, id: newId() }))
    r.destinations = r.destinations.map((d) => ({ ...d, id: newId() }))
    r.updatedAt = now.toISOString()
    routines.push(r)
  }
  let settings: Partial<AppSettings> | null = null
  if (isObj(raw.settings)) {
    const s = migrateSettings(raw.settings)
    const { trayHintShown: _t, computerAlias: _c, ...rest } = s
    settings = { ...rest, smtp: { ...rest.smtp, hasPassword: false } }
  }
  return { routines, settings }
}
