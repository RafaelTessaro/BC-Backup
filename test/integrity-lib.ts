// Utilitários dos testes de integridade (test/integrity-*.test.ts).
//
// Regra de ouro: NUNCA confiar no relatório do motor. Tudo aqui é independente dele:
//  - PRNG com semente (mulberry32) e conteúdo pseudoaleatório reproduzível (AES-256-CTR);
//  - sha256 de cada arquivo relendo do disco com um handle próprio;
//  - leitura de ZIP com o yauzl, conferindo sha256, tamanho e CRC-32 de CADA entrada
//    (o yauzl não confere CRC sozinho) e entradas repetidas/sobrando/faltando.
// A semente pode ser trocada com BC_SEED=<n> para reproduzir uma falha.

import { createCipheriv, createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { crc32 } from 'node:zlib'
import yauzl from 'yauzl'
import type { Routine } from '@shared/types'
import { MANIFEST_FILE } from '@shared/defaults'
import { runJob, type JobOptions } from '../src/main/engine/job'
import type { EngineEvent, JobResult, JobSpec } from '../src/main/engine/types'
import { makeRoutine } from './helpers'

export const STRESS = process.env.BC_STRESS === '1'
/** Semente base (BC_SEED sobrescreve). */
export const BASE_SEED = Number(process.env.BC_SEED) || 0x5eed_bc01
/** Linux diferencia NFC/NFD e maiúsculas e aceita nomes que o Windows recusa. */
export const LINUX = process.platform === 'linux'

export const KiB = 1024
export const MiB = 1024 * 1024

/* ------------------------------------------------------------------ */
/* PRNG                                                                */
/* ------------------------------------------------------------------ */

export class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  /** mulberry32: [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** Inteiro em [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1))
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.next() * a.length)]
  }
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  /** Gerador derivado (independente da ordem de uso do pai). */
  fork(label: string | number): Rng {
    const h = createHash('sha256').update(`${this.s}:${label}`).digest()
    return new Rng(h.readUInt32LE(0))
  }
}

/* ------------------------------------------------------------------ */
/* Conteúdo                                                            */
/* ------------------------------------------------------------------ */

export type ContentKind = 'random' | 'zeros' | 'text' | 'mixed'
export const KINDS: readonly ContentKind[] = ['random', 'zeros', 'text', 'mixed']

export interface FileSig {
  sha256: string
  size: number
}
/** rel (com "/") → assinatura. */
export type TreeMap = Map<string, FileSig>

/** Gera `size` bytes do tipo pedido, em blocos (serve para arquivos de centenas de MB). */
export function contentChunks(
  size: number,
  kind: ContentKind,
  seed: string,
  chunk = 1 * MiB
): Iterable<Buffer> {
  const key = createHash('sha256').update(`conteudo:${seed}`).digest()
  const cipher = createCipheriv('aes-256-ctr', key, Buffer.alloc(16))
  const line = Buffer.from(
    `Linha de relatório ${seed} — São Paulo, ação nº 42; 日本語 ✓ ${'='.repeat(key[0] % 40)}\n`,
    'utf8'
  )
  let produced = 0
  return {
    *[Symbol.iterator]() {
      while (produced < size) {
        const n = Math.min(chunk, size - produced)
        let buf: Buffer
        if (kind === 'random') buf = cipher.update(Buffer.alloc(n))
        else if (kind === 'zeros') buf = Buffer.alloc(n)
        else if (kind === 'text') {
          buf = Buffer.allocUnsafe(n)
          for (let i = 0; i < n; i++) buf[i] = line[(produced + i) % line.length]
        } else {
          // blocos de 4 KiB alternando aleatório e zeros (meio compressível)
          buf = cipher.update(Buffer.alloc(n))
          for (let i = 0; i < n; i++) if (((produced + i) >> 12) % 2 === 1) buf[i] = 0
        }
        produced += n
        yield buf
      }
    }
  }
}

/** Grava o conteúdo (criando as pastas) e devolve a assinatura calculada sobre os bytes gerados. */
export async function writeContent(
  path: string,
  size: number,
  kind: ContentKind,
  seed: string
): Promise<FileSig> {
  await mkdir(dirname(path), { recursive: true })
  const h = createHash('sha256')
  const fh = await open(path, 'w')
  try {
    for (const buf of contentChunks(size, kind, seed)) {
      h.update(buf)
      let off = 0
      while (off < buf.length) off += (await fh.write(buf, off, buf.length - off)).bytesWritten
    }
  } finally {
    await fh.close()
  }
  return { sha256: h.digest('hex'), size }
}

export async function sha256File(path: string): Promise<FileSig> {
  const fh = await open(path, 'r')
  try {
    const h = createHash('sha256')
    const buf = Buffer.allocUnsafe(1 * MiB)
    let size = 0
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null)
      if (!bytesRead) break
      h.update(buf.subarray(0, bytesRead))
      size += bytesRead
    }
    return { sha256: h.digest('hex'), size }
  } finally {
    await fh.close()
  }
}

/* ------------------------------------------------------------------ */
/* Nomes                                                               */
/* ------------------------------------------------------------------ */

const NFC = (s: string) => s.normalize('NFC')
const NFD = (s: string) => s.normalize('NFD')

/** Nomes "difíceis" válidos em qualquer sistema. */
const PORTABLE_NAMES = [
  'relatorio',
  'Nota Fiscal 2026',
  'a.b.c',
  'arquivo..com..pontos',
  ' espaço no início',
  'file (1)',
  'a&b',
  '100%',
  '#hash',
  '@arroba',
  '[colchetes]',
  '{chaves}',
  'ponto;vírgula',
  'vírgula,nome',
  'mais+sinal',
  'igual=sinal',
  "apos'trofo",
  'til~de',
  '$cifrão',
  '!exclamação',
  'Ação Ñandú Zürich',
  NFC('coração'),
  NFC('São Paulo'),
  NFC('pão de açúcar'),
  NFC('crème brûlée'),
  '📁 pasta',
  'relatório 😀',
  '👨‍👩‍👧 família',
  '🇧🇷',
  '日本語のファイル',
  '中文文档',
  '한국어',
  'テスト',
  'Ελληνικά',
  'русский',
  'עברית',
  'العربية',
  '.oculto',
  'x'.repeat(200),
  // 85 × "日" = 255 bytes em UTF-8: o limite de um nome no ext4/NTFS(UTF-16 cabe)
  '日'.repeat(85),
  'ç'.repeat(120)
]

/** Só no Linux: formas NFD (convivem com a NFC), maiúsculas e nomes que o Windows recusa. */
const LINUX_ONLY_NAMES = [
  NFD('coração'),
  NFD('São Paulo'),
  NFD('pão de açúcar'),
  'RELATORIO',
  'ponto final.',
  'espaço no fim ',
  'tab\tinterno',
  'aspas "duplas"',
  'pipe|nome',
  'interrogação?',
  'asterisco*',
  'menor<maior>',
  'x‮txt.exe' // RLO (texto da direita para a esquerda)
]

export const NAME_POOL: readonly string[] = LINUX ? [...PORTABLE_NAMES, ...LINUX_ONLY_NAMES] : PORTABLE_NAMES

/** Primeiros `n` pontos de código (nunca corta um par substituto ao meio). */
export function cut(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('')
}

/** `base + suffix` cabendo em 255 bytes UTF-8 (limite de um nome no ext4), encurtando a base. */
export function fitName(base: string, suffix = ''): string {
  const cps = Array.from(base)
  while (cps.length && Buffer.byteLength(cps.join('') + suffix, 'utf8') > 255) cps.pop()
  return cps.join('') + suffix
}

/* ------------------------------------------------------------------ */
/* Árvores                                                             */
/* ------------------------------------------------------------------ */

export interface FilePlan {
  rel: string
  size: number
  kind: ContentKind
  seed: string
}

export interface TreePlan {
  files: FilePlan[]
  /** Pastas vazias (rel). */
  emptyDirs: string[]
}

export interface TreeOptions {
  /** Arquivos pequenos (0..maxSmall bytes) espalhados em várias pastas. */
  smallFiles: number
  maxSmall?: number
  /** Profundidade da cadeia de pastas aninhadas. */
  depth: number
  /** Tamanhos exatos (fronteiras de buffer). */
  boundarySizes?: number[]
  /** Pastas vazias. */
  emptyDirs?: number
  /** Um arquivo com cada nome do NAME_POOL. */
  allNames?: boolean
}

/** Fronteiras de buffer: 0, 1, 64 KiB±1 (highWaterMark do fs), 1 MiB±1 (blocos do motor), 4 MiB±1. */
export const BOUNDARY_SIZES = [
  0,
  1,
  2,
  4095,
  4096,
  4097,
  64 * KiB - 1,
  64 * KiB,
  64 * KiB + 1,
  MiB - 1,
  MiB,
  MiB + 1,
  4 * MiB - 1,
  4 * MiB,
  4 * MiB + 1
]

/** Planeja uma árvore (determinística pela semente do rng). */
export function planTree(rng: Rng, o: TreeOptions): TreePlan {
  const files: FilePlan[] = []
  const fileSet = new Set<string>()
  const dirSet = new Set<string>([''])
  let seq = 0
  const join2 = (d: string, n: string) => (d ? `${d}/${n}` : n)
  const addDir = (rel: string) => {
    const parts = rel.split('/')
    for (let i = 1; i <= parts.length; i++) dirSet.add(parts.slice(0, i).join('/'))
  }
  const freeName = (d: string, base: string): string => {
    let name = fitName(base)
    for (let n = 2; fileSet.has(join2(d, name)) || dirSet.has(join2(d, name)); n++)
      name = fitName(base, ` ${n}`)
    return name
  }
  const addFile = (d: string, base: string, size: number, kind?: ContentKind) => {
    const name = freeName(d, base)
    const rel = join2(d, name)
    fileSet.add(rel)
    addDir(d)
    files.push({ rel, size, kind: kind ?? rng.pick(KINDS), seed: `${rel}#${seq++}` })
  }
  const newDir = (parent: string, base: string): string => {
    const name = freeName(parent, base)
    const rel = join2(parent, name)
    addDir(rel)
    return rel
  }

  // 1) Fronteiras de buffer na raiz (cada uma com um tipo de conteúdo).
  for (const [i, size] of (o.boundarySizes ?? []).entries())
    addFile('', `fronteira-${String(size).padStart(8, '0')}.bin`, size, KINDS[i % KINDS.length])

  // 2) Cadeia profunda, com arquivos em todos os níveis.
  let d = ''
  for (let lvl = 1; lvl <= o.depth; lvl++) {
    d = newDir(d, `nível ${String(lvl).padStart(2, '0')} ${cut(rng.pick(NAME_POOL), 20)}`.trim())
    addFile(d, `arquivo do nível ${lvl}.dat`, rng.int(0, 3000))
  }
  addFile(d, 'fundo.txt', rng.int(1, 5000), 'text')

  // 2b) Pasta na raiz com nome começando por ".." (não é "subir um nível"!).
  addFile(newDir('', '..pasta com pontos'), '..arquivo', rng.int(1, 100))

  // 3) Um arquivo com cada nome difícil (mesma pasta: NFC e NFD convivem no Linux).
  if (o.allNames) {
    const nd = newDir('', 'nomes difíceis')
    for (const n of NAME_POOL) addFile(nd, n, rng.int(0, 2000))
    // …e como pastas também.
    for (const n of rng.shuffle([...NAME_POOL]).slice(0, 8)) {
      const sub = newDir(nd, `${n} (pasta)`)
      addFile(sub, rng.pick(NAME_POOL), rng.int(0, 500))
    }
  }

  // 4) Muitos arquivos pequenos em ~60 pastas de profundidade 1..4.
  const pool: string[] = []
  for (let i = 0; i < 60; i++) {
    let p = ''
    const depth = rng.int(1, 4)
    for (let k = 0; k < depth; k++) p = newDir(p, `p${rng.int(0, 9)} ${cut(rng.pick(NAME_POOL), 12)}`.trim())
    pool.push(p)
  }
  const maxSmall = o.maxSmall ?? 2048
  for (let i = 0; i < o.smallFiles; i++) {
    const size = rng.chance(0.1) ? 0 : rng.int(1, maxSmall)
    addFile(rng.pick(pool), `f${i}${rng.pick(['.txt', '.dat', '', '.json', '.xml', '.tar.gz'])}`, size)
  }

  // 5) Pastas vazias (inclusive aninhadas).
  const emptyDirs: string[] = []
  for (let i = 0; i < (o.emptyDirs ?? 0); i++) {
    const a = newDir(rng.chance(0.5) ? '' : rng.pick(pool), `vazia ${i}`)
    const leaf = rng.chance(0.5) ? newDir(a, 'sub vazia') : a
    emptyDirs.push(leaf)
  }
  return { files, emptyDirs }
}

/** Cria a árvore planejada em `root` e devolve o mapa esperado (calculado na geração). */
export async function materialize(root: string, plan: TreePlan): Promise<TreeMap> {
  const out: TreeMap = new Map()
  for (const f of plan.files)
    out.set(f.rel, await writeContent(join(root, ...f.rel.split('/')), f.size, f.kind, f.seed))
  for (const e of plan.emptyDirs) await mkdir(join(root, ...e.split('/')), { recursive: true })
  return out
}

/* ------------------------------------------------------------------ */
/* Leitura independente (pasta e ZIP)                                  */
/* ------------------------------------------------------------------ */

export interface TreeScan {
  files: TreeMap
  /** Todas as pastas (rel), inclusive as vazias. */
  dirs: Set<string>
  /** Links e arquivos especiais (não deveria haver nenhum). */
  others: string[]
}

/** Varre `root` relendo cada arquivo (sha256 próprio). Nunca segue links. */
export async function scanTree(root: string): Promise<TreeScan> {
  const files: TreeMap = new Map()
  const dirs = new Set<string>()
  const others: string[] = []
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop() as string
    const abs = rel ? join(root, ...rel.split('/')) : root
    for (const ent of await readdir(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        dirs.add(r)
        stack.push(r)
      } else if (ent.isFile()) files.set(r, await sha256File(join(abs, ent.name)))
      else others.push(r)
    }
  }
  return { files, dirs, others }
}

export interface ZipScan {
  files: TreeMap
  dirEntries: string[]
  duplicates: string[]
  crcErrors: string[]
}

/** Lê o ZIP com o yauzl e confere sha256 + CRC-32 de cada entrada (relendo o .zip do disco). */
export function scanZip(path: string): Promise<ZipScan> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip'))
      const out: ZipScan = { files: new Map(), dirEntries: [], duplicates: [], crcErrors: [] }
      zip.on('error', reject)
      zip.on('end', () => resolve(out))
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName
        if (name.endsWith('/')) {
          out.dirEntries.push(name)
          return zip.readEntry()
        }
        zip.openReadStream(entry, (e2, rs) => {
          if (e2 || !rs) return reject(e2 ?? new Error('entrada'))
          const h = createHash('sha256')
          let crc = 0
          let size = 0
          rs.on('data', (c: Buffer) => {
            h.update(c)
            crc = crc32(c, crc)
            size += c.length
          })
          rs.on('error', reject)
          rs.on('end', () => {
            if (out.files.has(name)) out.duplicates.push(name)
            if (crc >>> 0 !== entry.crc32 >>> 0) out.crcErrors.push(name)
            out.files.set(name, { sha256: h.digest('hex'), size })
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })
}

/** Diferenças legíveis entre o esperado e o encontrado (vazio = idênticos). */
export function treeDiff(expected: TreeMap, actual: TreeMap, max = 20): string[] {
  const out: string[] = []
  for (const [rel, sig] of expected) {
    const got = actual.get(rel)
    if (!got) out.push(`faltando: ${JSON.stringify(rel)}`)
    else if (got.sha256 !== sig.sha256 || got.size !== sig.size)
      out.push(`diferente: ${JSON.stringify(rel)} (${sig.size} → ${got.size} bytes)`)
  }
  for (const rel of actual.keys()) if (!expected.has(rel)) out.push(`sobrando: ${JSON.stringify(rel)}`)
  return out.length > max ? [...out.slice(0, max), `… e mais ${out.length - max}`] : out
}

/** Prefixa todos os caminhos do mapa (layout com subpasta por origem). */
export function prefixed(m: TreeMap, prefix: string): TreeMap {
  return new Map([...m].map(([k, v]) => [`${prefix}/${k}`, v]))
}

export function mergeMaps(...ms: TreeMap[]): TreeMap {
  const out: TreeMap = new Map()
  for (const m of ms) for (const [k, v] of m) out.set(k, v)
  return out
}

/* ------------------------------------------------------------------ */
/* Backups no destino                                                  */
/* ------------------------------------------------------------------ */

export interface SnapshotContent {
  kind: 'dir' | 'zip'
  files: TreeMap
  /** Manifesto (pasta: o arquivo; ZIP: o arquivo ao lado). */
  manifest: Record<string, unknown> | null
  /** ZIP: o manifesto interno. */
  innerManifest?: Record<string, unknown> | null
  /** Problemas estruturais (links, entradas repetidas, CRC, pastas no ZIP…). */
  problems: string[]
  dirs: Set<string>
}

async function readJson(p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Lê um backup (pasta "<carimbo>" ou "<carimbo>.zip") com leitura própria. */
export async function readSnapshot(path: string): Promise<SnapshotContent> {
  if (path.endsWith('.zip')) {
    const z = await scanZip(path)
    const problems = [
      ...z.duplicates.map((d) => `entrada repetida: ${d}`),
      ...z.crcErrors.map((d) => `CRC-32 inválido: ${d}`),
      ...z.dirEntries.map((d) => `entrada de pasta: ${d}`)
    ]
    let innerManifest: Record<string, unknown> | null = null
    if (z.files.has(MANIFEST_FILE)) {
      innerManifest = await readZipText(path, MANIFEST_FILE).then(
        (t) => JSON.parse(t) as Record<string, unknown>,
        () => null
      )
      z.files.delete(MANIFEST_FILE)
    }
    return {
      kind: 'zip',
      files: z.files,
      manifest: await readJson(`${path}.manifesto.json`),
      innerManifest,
      problems,
      dirs: new Set()
    }
  }
  const t = await scanTree(path)
  const manifest = await readJson(join(path, MANIFEST_FILE))
  t.files.delete(MANIFEST_FILE)
  return {
    kind: 'dir',
    files: t.files,
    manifest,
    problems: t.others.map((o) => `não é arquivo: ${o}`),
    dirs: t.dirs
  }
}

function readZipText(zipPath: string, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip'))
      let found = false
      zip.on('error', reject)
      zip.on('end', () => (found ? undefined : reject(new Error('sem entrada'))))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName !== name) return zip.readEntry()
        found = true
        zip.openReadStream(entry, (e2, rs) => {
          if (e2 || !rs) return reject(e2 ?? new Error('entrada'))
          const chunks: Buffer[] = []
          rs.on('data', (c: Buffer) => chunks.push(c))
          rs.on('error', reject)
          rs.on('end', () => {
            zip.close()
            resolve(Buffer.concat(chunks).toString('utf8'))
          })
        })
      })
      zip.readEntry()
    })
  })
}

/**
 * Confere um backup contra o esperado: conteúdo idêntico byte a byte, sem nada a mais ou a menos,
 * manifesto válido desta rotina e coerente (status, verificado, contagem). Devolve a lista de problemas.
 */
export async function snapshotProblems(
  path: string,
  expected: TreeMap,
  o: {
    routineId: string
    verified?: boolean
    /** ZIP: aceita só o manifesto interno (o de fora não pôde ser gravado; o .zip já estava conferido). */
    sidecarOptional?: boolean
  }
): Promise<string[]> {
  const s = await readSnapshot(path)
  const out = [...s.problems, ...treeDiff(expected, s.files)]
  const innerOnly = !s.manifest && s.kind === 'zip' && !!o.sidecarOptional
  const m = innerOnly ? s.innerManifest : s.manifest
  if (!m) out.push('sem manifesto')
  else {
    if (m.format !== 'bcbackup-manifesto') out.push('manifesto com formato errado')
    if (m.routineId !== o.routineId) out.push(`manifesto de outra rotina (${String(m.routineId)})`)
    if (m.status !== 'success' && m.status !== 'warning') out.push(`status do manifesto: ${String(m.status)}`)
    if (m.files !== expected.size)
      out.push(`manifesto diz ${String(m.files)} arquivos, esperado ${expected.size}`)
    const bytes = [...expected.values()].reduce((a, f) => a + f.size, 0)
    if (m.bytes !== bytes) out.push(`manifesto diz ${String(m.bytes)} bytes, esperado ${bytes}`)
    if ((o.verified ?? true) && !innerOnly && m.verified !== true) out.push('manifesto sem "verified: true"')
  }
  if (s.kind === 'zip' && !s.innerManifest) out.push('ZIP sem o manifesto interno')
  return out
}

/** Nomes que um backup válido pode deixar direto na pasta do destino. */
export const RE_SNAPSHOT_NAME =
  /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?(?:\.zip(?:\.manifesto\.json)?)?$/

/** Sobras que nunca deveriam ficar depois de uma execução terminada (com sucesso, falha ou cancelada). */
export async function leftovers(destDir: string): Promise<string[]> {
  const names = await readdir(destDir).catch(() => [] as string[])
  return names.filter((n) => /\.em-andamento$|\.excluindo$|\.tmp$|^\.bcbackup-temp/.test(n))
}

/** Backups (por nome) desta rotina direto na pasta: leitura própria do manifesto. */
export async function routineSnapshots(destDir: string, routineId: string): Promise<string[]> {
  const out: string[] = []
  for (const name of await readdir(destDir).catch(() => [] as string[])) {
    if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:_\d+)?(?:\.zip)?$/.test(name)) continue
    const p = join(destDir, name)
    const st = await lstat(p).catch(() => null)
    if (!st || st.isSymbolicLink()) continue
    const m = name.endsWith('.zip')
      ? ((await readJson(`${p}.manifesto.json`)) ??
        (await readZipText(p, MANIFEST_FILE).then(
          (t) => JSON.parse(t) as Record<string, unknown>,
          () => null
        )))
      : await readJson(join(p, MANIFEST_FILE))
    if (m && m.routineId === routineId) out.push(name)
  }
  return out.sort()
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

/** Relógio injetado que anda junto com o real a partir de `base`. */
export function clockAt(base: Date): () => Date {
  const t0 = Date.now()
  return () => new Date(base.getTime() + (Date.now() - t0))
}

export function integrityRoutine(patch: Partial<Routine> = {}) {
  return makeRoutine({
    filters: { include: [], exclude: [], skipHiddenAndSystem: false, maxFileSizeMB: null },
    verify: 'full',
    retention: { enabled: false, days: 7, minKeep: 3 },
    ...patch
  })
}

export interface RunOptions {
  runId?: string
  hostname?: string
  signal?: AbortSignal
  onEvent?: (e: EngineEvent) => void
  job?: JobOptions
}

/** Executa a rotina "no instante" `at` (carimbo e relógio do motor). */
export function runAt(
  routine: ReturnType<typeof makeRoutine>,
  at: Date,
  o: RunOptions = {}
): Promise<JobResult> {
  const spec: JobSpec = {
    runId: o.runId ?? `run-${at.getTime()}`,
    routine,
    trigger: 'manual',
    startedAt: at.toISOString(),
    appVersion: '0.1.0',
    hostname: o.hostname ?? 'pc-integridade'
  }
  return runJob(spec, o.onEvent ?? (() => {}), o.signal ?? new AbortController().signal, {
    now: clockAt(at),
    probeRetryMs: 1,
    ...o.job
  })
}

/** Entradas novas na pasta do destino (comparando com a listagem anterior). */
export async function newEntries(destDir: string, before: readonly string[]): Promise<string[]> {
  const names = await readdir(destDir).catch(() => [] as string[])
  return names.filter((n) => !before.includes(n)).sort()
}
