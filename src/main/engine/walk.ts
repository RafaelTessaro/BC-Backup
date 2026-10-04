// Varredura das origens com filtros (picomatch). Node puro.
//
// Semântica dos padrões (parecida com .gitignore, mais fácil de explicar):
//   "*.tmp"          → qualquer arquivo .tmp em qualquer pasta
//   "node_modules/"  → a pasta node_modules (e tudo dentro) em qualquer nível
//   "/Temp"          → só a pasta/arquivo "Temp" na raiz da origem
//   "Docs/*.bak"     → relativo à raiz da origem
//   "**/x/**"        → glob completo, usado como está
// Barras invertidas viram "/" (globs sempre enxergam "/"). No Windows e no macOS a
// comparação ignora maiúsculas/minúsculas.

import { opendir, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import picomatch from 'picomatch'
import type { Filters } from '@shared/types'
import { errCode, errMessage } from './fsutil'

export interface FileItem {
  /** Caminho absoluto na origem. */
  abs: string
  /** Caminho relativo (com "/") dentro do backup. */
  rel: string
  size: number
  mtime: Date
  atime: Date
}

export interface WalkIssue {
  path: string
  code: string
  message: string
  /** true = pasta inteira não pôde ser lida. */
  dir?: boolean
}

export interface WalkStats {
  /** Arquivos ignorados por serem maiores que o limite. */
  tooBig: number
  /** Arquivos ocultos/de sistema ignorados. */
  hidden: number
  /** Links simbólicos/junções ignorados (nunca seguimos). */
  links: number
}

export interface FileFilter {
  dirExcluded(rel: string, name: string): boolean
  /** 'ok' | 'excluded' (filtro) | 'hidden' (oculto/sistema) | 'too-big' */
  fileVerdict(rel: string, name: string, size: number): 'ok' | 'excluded' | 'hidden' | 'too-big'
}

/** Nomes de sistema que nunca fazem sentido copiar (comparação em minúsculas). */
const SYSTEM_NAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  'ehthumbs.db',
  '$recycle.bin',
  'system volume information',
  'pagefile.sys',
  'hiberfil.sys',
  'swapfile.sys',
  'dumpstack.log',
  'dumpstack.log.tmp',
  '.ds_store',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  '.temporaryitems',
  '.localized'
])

export function isHiddenOrSystem(name: string): boolean {
  if (name.startsWith('.')) return true
  const lower = name.toLowerCase()
  if (SYSTEM_NAMES.has(lower)) return true
  return /^ntuser\.(dat|ini|pol)/.test(lower) || /^usrclass\.dat/.test(lower)
}

/** Converte um padrão digitado pelo usuário em glob do picomatch (ver regras no topo). */
export function normalizePattern(raw: string): string | null {
  let p = raw.trim().replace(/\\/g, '/')
  if (!p) return null
  while (p.startsWith('./')) p = p.slice(2)
  let dirOnly = false
  if (p.endsWith('/')) {
    dirOnly = true
    p = p.replace(/\/+$/, '')
  }
  if (!p) return null
  let rooted = false
  if (p.startsWith('/')) {
    rooted = true
    p = p.replace(/^\/+/, '')
  }
  if (!rooted && !p.includes('/')) p = `**/${p}`
  if (dirOnly) p = `${p}/**`
  return p
}

export function caseInsensitiveFs(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

export function makeFilter(filters: Partial<Filters> | undefined, platform: NodeJS.Platform = process.platform): FileFilter {
  const opts = { dot: true, nocase: caseInsensitiveFs(platform) }
  const include = (filters?.include ?? []).map(normalizePattern).filter((p): p is string => !!p)
  const exclude = (filters?.exclude ?? []).map(normalizePattern).filter((p): p is string => !!p)
  const inc = include.length ? picomatch(include, opts) : () => true
  const exc = exclude.length ? picomatch(exclude, opts) : () => false
  const skipHidden = filters?.skipHiddenAndSystem ?? false
  const maxMB = filters?.maxFileSizeMB
  const maxBytes = typeof maxMB === 'number' && maxMB > 0 ? maxMB * 1024 * 1024 : Infinity
  return {
    dirExcluded: (rel, name) => (skipHidden && isHiddenOrSystem(name)) || exc(rel),
    fileVerdict: (rel, name, size) => {
      if (skipHidden && isHiddenOrSystem(name)) return 'hidden'
      if (!inc(rel) || exc(rel)) return 'excluded'
      if (size > maxBytes) return 'too-big'
      return 'ok'
    }
  }
}

const toPosix = (p: string) => (sep === '/' ? p : p.split(sep).join('/'))

/**
 * Varre `root` (pasta ou arquivo). Iterativo (sem recursão), nunca segue links simbólicos/junções.
 * Erros de leitura viram `issues` — nunca exceções (exceto cancelamento e a raiz inexistente).
 */
export async function* walk(
  root: string,
  filter: FileFilter,
  issues: WalkIssue[],
  stats: WalkStats,
  signal?: AbortSignal
): AsyncGenerator<FileItem> {
  const rootSt = await stat(root)
  if (rootSt.isFile()) {
    yield { abs: root, rel: basename(root), size: rootSt.size, mtime: rootSt.mtime, atime: rootSt.atime }
    return
  }
  const stack = [root]
  while (stack.length) {
    signal?.throwIfAborted()
    const dir = stack.pop() as string
    let handle
    try {
      handle = await opendir(dir, { bufferSize: 128 })
    } catch (e) {
      issues.push({ path: dir, code: errCode(e) || 'EUNKNOWN', message: errMessage(e), dir: true })
      continue
    }
    try {
      for await (const ent of handle) {
        signal?.throwIfAborted()
        const abs = join(dir, ent.name)
        const rel = toPosix(relative(root, abs))
        if (ent.isSymbolicLink()) {
          stats.links++
          continue
        }
        if (ent.isDirectory()) {
          if (!filter.dirExcluded(rel, ent.name)) stack.push(abs)
          continue
        }
        if (!ent.isFile()) continue
        let st
        try {
          st = await stat(abs)
        } catch (e) {
          issues.push({ path: abs, code: errCode(e) || 'EUNKNOWN', message: errMessage(e) })
          continue
        }
        const verdict = filter.fileVerdict(rel, ent.name, st.size)
        if (verdict === 'too-big') stats.tooBig++
        else if (verdict === 'hidden') stats.hidden++
        if (verdict !== 'ok') continue
        yield { abs, rel, size: st.size, mtime: st.mtime, atime: st.atime }
      }
    } catch (e) {
      if (signal?.aborted) throw e
      // Erro no meio da listagem (ex.: disco de rede caiu): registra e segue.
      issues.push({ path: dir, code: errCode(e) || 'EUNKNOWN', message: errMessage(e), dir: true })
    }
  }
}

export function emptyWalkStats(): WalkStats {
  return { tooBig: 0, hidden: 0, links: 0 }
}

/** Motivo em pt-BR para um arquivo que não pôde ser lido/copiado. */
export function skipReason(code: string, isDir = false): string {
  switch (code) {
    case 'EBUSY':
      return 'Arquivo em uso (ignorado)'
    case 'EPERM':
    case 'EACCES':
      return isDir ? 'Pasta sem permissão de leitura' : 'Sem permissão para ler o arquivo'
    case 'ENOENT':
      return isDir ? 'Pasta removida durante o backup' : 'Arquivo removido durante o backup'
    case 'ENAMETOOLONG':
      return 'Caminho longo demais'
    case 'ELOOP':
      return 'Link simbólico ignorado'
    case 'EINVAL':
      return 'Nome de arquivo inválido'
    case 'EIO':
      return 'Erro de leitura no disco de origem'
    default:
      return isDir ? `Não foi possível ler a pasta (${code || 'erro'})` : `Não foi possível ler o arquivo (${code || 'erro'})`
  }
}

export interface SizeEstimateResult {
  files: number
  bytes: number
  partial: boolean
}

/** Soma arquivos/bytes das origens com os filtros; para no tempo limite (resultado parcial). */
export async function estimateSize(
  sources: string[],
  filters: Partial<Filters> | undefined,
  timeoutMs = 4000
): Promise<SizeEstimateResult> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const filter = makeFilter(filters)
  const issues: WalkIssue[] = []
  const stats = emptyWalkStats()
  let files = 0
  let bytes = 0
  let partial = false
  try {
    for (const src of sources) {
      try {
        for await (const f of walk(src, filter, issues, stats, ac.signal)) {
          files++
          bytes += f.size
        }
      } catch {
        if (ac.signal.aborted) {
          partial = true
          break
        }
        // origem inexistente: ignora
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return { files, bytes, partial }
}
