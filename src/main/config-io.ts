// Exportar/importar configurações (JSON sem senhas) — para replicar o setup em outros clientes.
// Node puro.

import type { AppSettings } from '@shared/types'
import { migrateRoutine, migrateSettings, isObj, newId, type StoredRoutine } from './store'

export const EXPORT_FORMAT = 'bc-backup-config'

/** Tamanho máximo do nome da rotina aceito pelo editor (validate.ts). */
const MAX_NAME = 60

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
  /** Rotinas que vieram com "Mover" ligado e chegam com ele desligado. */
  moveDisabled: number
}

/**
 * Valida o arquivo importado e prepara as rotinas (ids SEMPRE novos, nomes únicos).
 * O id identifica a pasta da rotina no destino (marcador) e os backups dela (manifesto): se o
 * arquivo foi exportado de outro PC que grava no mesmo destino de rede, manter o id faria as
 * duas rotinas dividirem a pasta — a limpeza de sobras de uma apagaria a cópia em andamento da
 * outra e a retenção de uma apagaria os backups da outra.
 * "Mover" sempre chega DESLIGADO: apagar arquivos deste computador exige a confirmação do editor
 * ("Apagar arquivos da origem?"), que mostra as pastas daqui — o arquivo pode ter vindo de outro PC.
 */
export function planImport(raw: unknown, existing: StoredRoutine[], now = new Date()): ImportPlan {
  if (!isObj(raw) || raw.format !== EXPORT_FORMAT) {
    throw new Error('Este arquivo não é uma exportação de configurações do BC Backup.')
  }
  if (typeof raw.version !== 'number' || raw.version > 1) {
    throw new Error(
      'Este arquivo foi gerado por uma versão mais nova do BC Backup. Atualize o programa e tente de novo.'
    )
  }
  const names = new Set(existing.map((r) => r.name.trim().toLocaleLowerCase('pt-BR')))
  const routines: StoredRoutine[] = []
  let moveDisabled = 0
  for (const item of Array.isArray(raw.routines) ? raw.routines : []) {
    if (!isObj(item)) continue
    const r = migrateRoutine(item, now)
    if (!r.name) continue
    r.id = newId()
    if (r.moveSources?.enabled) {
      r.moveSources = { ...r.moveSources, enabled: false }
      moveDisabled++
    }
    // Limite do editor (validate.ts: 60 caracteres): o nome é encurtado ANTES do sufixo, senão a
    // rotina importada não poderia ser salva sem trocar o nome.
    const base = r.name.slice(0, MAX_NAME).trimEnd()
    let name = base
    for (let n = 1; names.has(name.toLocaleLowerCase('pt-BR')); n++) {
      const suffix = n === 1 ? ' (importada)' : ` (importada ${n})`
      name = `${base.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`
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
  return { routines, settings, moveDisabled }
}
