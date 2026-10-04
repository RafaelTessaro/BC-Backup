// Soltar pastas/arquivos na janela (etapa Origem). O caminho real vem do preload
// (`bc.system.pathForFile`, síncrono) e o tipo (pasta/arquivo) do main (`inspectPaths`).
import { useRef, useState, type DragEvent } from 'react'
import type { PathInfo } from '@shared/api'
import { bc } from '@renderer/lib/bc'

export interface DropResult {
  /** Caminhos lidos (pasta ou arquivo). */
  found: Array<PathInfo & { kind: 'file' | 'folder' }>
  /** Caminhos que não puderam ser lidos (kind null). */
  unreadable: string[]
  /** Itens sem caminho no disco (ex.: arrastados de um navegador). */
  withoutPath: number
  /** A ponte não oferece os métodos (versão antiga do preload/mock). */
  unsupported?: boolean
}

const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** Caminhos dos arquivos soltos — precisa rodar dentro do evento (depois o FileList esvazia). */
function pathsOf(list: FileList): { paths: string[]; withoutPath: number } | null {
  const toPath = bc.system.pathForFile
  if (typeof toPath !== 'function') return null
  const paths: string[] = []
  let withoutPath = 0
  for (const file of Array.from(list)) {
    let p = ''
    try {
      p = toPath(file)
    } catch {
      p = ''
    }
    if (p) paths.push(p)
    else withoutPath += 1
  }
  return { paths, withoutPath }
}

async function inspect(paths: string[], withoutPath: number): Promise<DropResult> {
  if (!paths.length) return { found: [], unreadable: [], withoutPath }
  let infos: PathInfo[]
  try {
    infos = await bc.system.inspectPaths(paths)
  } catch {
    infos = paths.map((path) => ({ path, kind: null }))
  }
  const found = infos.filter((i): i is DropResult['found'][number] => i.kind !== null)
  const unreadable = infos.filter((i) => i.kind === null).map((i) => i.path)
  return { found, unreadable, withoutPath }
}

/**
 * Área que aceita pastas/arquivos soltos. `dragging` fica true enquanto algo do sistema
 * de arquivos passa por cima (contador evita piscar ao cruzar elementos filhos).
 */
export function useFileDrop(
  enabled: boolean,
  onDrop: (result: DropResult) => void
): {
  dragging: boolean
  handlers: {
    onDragEnter?: (e: DragEvent) => void
    onDragOver?: (e: DragEvent) => void
    onDragLeave?: (e: DragEvent) => void
    onDrop?: (e: DragEvent) => void
  }
} {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  if (!enabled) return { dragging: false, handlers: {} }
  return {
    dragging,
    handlers: {
      onDragEnter: (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current += 1
        setDragging(true)
      },
      onDragOver: (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (e) => {
        if (!hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDrop: (e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setDragging(false)
        const read = pathsOf(e.dataTransfer.files)
        if (!read) {
          onDrop({ found: [], unreadable: [], withoutPath: 0, unsupported: true })
          return
        }
        void inspect(read.paths, read.withoutPath).then(onDrop)
      }
    }
  }
}
