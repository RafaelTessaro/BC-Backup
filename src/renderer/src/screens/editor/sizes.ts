import { useEffect, useSyncExternalStore } from 'react'
import type { SizeEstimate } from '@shared/api'
import type { Filters, SourceItem } from '@shared/types'
import { bc } from '@renderer/lib/bc'

// Cache de estimativas por caminho + filtros, compartilhado entre telas.
const cache = new Map<string, SizeEstimate | 'error'>()
const inflight = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(): void {
  version += 1
  for (const l of listeners) l()
}

export interface SourceSizes {
  get(path: string): SizeEstimate | 'error' | undefined
  total: SizeEstimate | null
  loading: boolean
}

/** Tamanho estimado de cada origem (com cache) e o total. */
export function useSourceSizes(sources: SourceItem[], filters: Filters): SourceSizes {
  useSyncExternalStore(subscribe, () => version)
  const fkey = JSON.stringify(filters)
  const paths = sources.map((s) => s.path)
  const key = paths.join('\n')

  useEffect(() => {
    const parsed = JSON.parse(fkey) as Filters
    for (const p of key ? key.split('\n') : []) {
      const ck = `${p}|${fkey}`
      if (cache.has(ck) || inflight.has(ck)) continue
      inflight.add(ck)
      bc.system
        .estimateSize([p], parsed)
        .then((est) => cache.set(ck, est))
        .catch(() => cache.set(ck, 'error'))
        .finally(() => {
          inflight.delete(ck)
          emit()
        })
    }
  }, [key, fkey])

  const get = (p: string): SizeEstimate | 'error' | undefined => cache.get(`${p}|${fkey}`)
  let loading = false
  let files = 0
  let bytes = 0
  let partial = false
  for (const p of paths) {
    const e = get(p)
    if (e === undefined) loading = true
    else if (e !== 'error') {
      files += e.files
      bytes += e.bytes
      partial ||= e.partial
    }
  }
  return { get, total: paths.length && !loading ? { files, bytes, partial } : null, loading }
}
