// Integridade sob falhas injetadas. Depois de cada execução, com leitura própria:
//  - a origem está intacta (sha256 de tudo);
//  - nenhum backup "diz" que deu certo sem estar completo: todo backup com manifesto na pasta do
//    destino tem exatamente o conteúdo da origem (ou, com arquivo pulado, o conteúdo menos ele —
//    e o manifesto conta isso);
//  - nenhuma sobra fica para trás (".em-andamento", ".excluindo", temporários).
//
// Falhas no nível do sistema de arquivos (vi.mock de node:fs e node:fs/promises, só para os caminhos
// escolhidos): ENOSPC no meio da gravação, bit trocado em silêncio na gravação, bloco engolido em
// silêncio, EIO no meio da leitura da origem e EIO ao reler o destino na verificação.
// Falhas reais: disco cheio de verdade (tmpfs, Linux como root), destino que some no meio, e
// cancelamento em pontos sorteados.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BackupMode } from '@shared/types'
import { backupStamp } from '@shared/format'
import { IN_PROGRESS_MARKER_FILE, MANIFEST_FILE } from '@shared/defaults'
import { writeJsonAtomic } from '../src/main/engine/fsutil'
import type { EngineEvent } from '../src/main/engine/types'
import {
  BASE_SEED,
  KINDS,
  KiB,
  MiB,
  Rng,
  integrityRoutine,
  leftovers,
  materialize,
  planTree,
  readSnapshot,
  runAt,
  scanTree,
  snapshotProblems,
  treeDiff,
  writeContent,
  type TreeMap
} from './integrity-lib'
import { tempDir } from './helpers'

/* ------------------------------------------------------------------ */
/* Falhas no sistema de arquivos (só nos caminhos escolhidos)          */
/* ------------------------------------------------------------------ */

const ctl = vi.hoisted(() => {
  interface Fault {
    /** Caminhos afetados. */
    match: (p: string) => boolean
    /** error = falha com `code`; flip = troca 1 bit em silêncio; drop = engole o bloco em silêncio. */
    kind: 'error' | 'flip' | 'drop'
    /** Posição (em bytes, somando todos os fluxos afetados) em que a falha acontece. */
    at: number
    code?: string
    seen: number
    fired: boolean
  }
  type Chunk = { chunk: Buffer; encoding: BufferEncoding }
  type Cb = (e?: Error | null) => void
  const state = {
    write: null as Fault | null,
    read: null as Fault | null,
    /** fh.writeFile (manifestos: writeJsonAtomic): grava metade e falha com `code`. */
    wfile: null as Fault | null,
    /** Releitura do DESTINO (verificação do modo pasta). */
    reread: null as Fault | null
  }
  const mkErr = (f: Fault, syscall: string) =>
    Object.assign(new Error(`${f.code}: falha injetada, ${syscall}`), { code: f.code, syscall })
  /** Aplica a falha a um bloco: o bloco (talvez alterado), 'drop' ou o erro. */
  const apply = (f: Fault, chunk: Buffer, syscall: string): Buffer | 'drop' | Error => {
    const start = f.seen
    f.seen += chunk.length
    if (f.fired || f.seen <= f.at) return chunk
    f.fired = true
    if (f.kind === 'error') return mkErr(f, syscall)
    if (f.kind === 'drop') return 'drop'
    const c = Buffer.from(chunk)
    c[f.at - start] ^= 0x01
    return c
  }
  /** Gravação: troca _write/_writev do WriteStream real. */
  const wrapWrite = (ws: import('node:fs').WriteStream, f: Fault) => {
    const w = ws._write.bind(ws)
    const wv = ws._writev?.bind(ws)
    ws._write = (chunk: Buffer, enc: BufferEncoding, cb: Cb) => {
      const r = apply(f, chunk, 'write')
      if (r instanceof Error) return cb(r)
      if (r === 'drop') return cb()
      w(r, enc, cb)
    }
    ws._writev = (chunks: Chunk[], cb: Cb) => {
      const out: Chunk[] = []
      for (const c of chunks) {
        const r = apply(f, c.chunk, 'write')
        if (r instanceof Error) return cb(r)
        if (r !== 'drop') out.push({ chunk: r, encoding: c.encoding })
      }
      if (!out.length) return cb()
      if (wv) return wv(out, cb)
      w(Buffer.concat(out.map((o) => o.chunk)), 'binary', cb)
    }
  }
  return { state, apply, wrapWrite }
})

vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>()
  const { Transform } = await import('node:stream')
  const createWriteStream = ((p: string, o?: unknown) => {
    const ws = real.createWriteStream(p, o as never)
    const f = ctl.state.write
    if (f && !f.fired && f.match(String(p))) ctl.wrapWrite(ws, f)
    return ws
  }) as typeof real.createWriteStream
  const createReadStream = ((p: string, o?: unknown) => {
    const rs = real.createReadStream(p, o as never)
    const f = ctl.state.reread
    if (!f || f.fired || !f.match(String(p))) return rs
    const t = new Transform({
      transform(chunk: Buffer, _e, cb) {
        const r = ctl.apply(f, chunk, 'read')
        if (r instanceof Error) return cb(r)
        cb(null, r === 'drop' ? undefined : r)
      }
    })
    rs.on('error', (e) => t.destroy(e))
    t.on('close', () => rs.destroy())
    return rs.pipe(t)
  }) as unknown as typeof real.createReadStream
  return {
    ...real,
    default: { ...real, createWriteStream, createReadStream },
    createWriteStream,
    createReadStream
  }
})

vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>()
  const { Transform } = await import('node:stream')
  const open = (async (p: string, ...rest: unknown[]) => {
    const fh = await (real.open as (...a: unknown[]) => Promise<import('node:fs/promises').FileHandle>)(
      p,
      ...rest
    )
    const f = ctl.state.read
    const wf = ctl.state.wfile
    const readHit = !!f && !f.fired && f.match(String(p))
    const wfileHit = !!wf && !wf.fired && wf.match(String(p))
    if (!readHit && !wfileHit) return fh
    return new Proxy(fh, {
      get(target, key) {
        if (key === 'writeFile' && wfileHit)
          return async (data: string | Buffer, o?: unknown) => {
            const buf = Buffer.from(data)
            await target.write(buf, 0, Math.floor(buf.length / 2), 0)
            wf.fired = true
            void o
            throw Object.assign(new Error(`${wf.code}: falha injetada, write`), {
              code: wf.code,
              syscall: 'write'
            })
          }
        // Leitura da ORIGEM pelo handle (copy.ts/zip.ts usam fh.createReadStream): erro no meio do arquivo.
        if (key === 'createReadStream' && readHit && f)
          return (o: unknown) => {
            const rs = target.createReadStream(o as never)
            const t = new Transform({
              transform(chunk: Buffer, _e, cb) {
                const r = ctl.apply(f, chunk, 'read')
                if (r instanceof Error) return cb(r)
                cb(null, r === 'drop' ? undefined : r)
              }
            })
            rs.on('error', (e) => t.destroy(e))
            t.on('close', () => rs.destroy())
            return rs.pipe(t)
          }
        const v = Reflect.get(target, key, target) as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      }
    })
  }) as typeof real.open
  return { ...real, default: { ...real, open }, open }
})

function fault(kind: 'error' | 'flip' | 'drop', at: number, match: (p: string) => boolean, code?: string) {
  return { kind, at, match, code, seen: 0, fired: false }
}
function disarm(): void {
  ctl.state.write = null
  ctl.state.wfile = null
  ctl.state.read = null
  ctl.state.reread = null
}

/* ------------------------------------------------------------------ */
/* Cenário                                                             */
/* ------------------------------------------------------------------ */

const SEED = BASE_SEED + 300
let root: string
let cleanup: () => Promise<void>
let src: string
let want: TreeMap
/** Maiores arquivos da origem (para mirar falhas de leitura no meio de um arquivo grande). */
let bigRel: string

beforeAll(async () => {
  ;({ dir: root, cleanup } = await tempDir('bcb-integ-fault-'))
  src = join(root, 'origem')
  want = await materialize(
    src,
    planTree(new Rng(SEED), {
      smallFiles: 40,
      depth: 12,
      boundarySizes: [0, 1, 64 * KiB + 1, MiB - 1, MiB + 1, 2 * MiB + 7]
    })
  )
  bigRel = [...want].sort((a, b) => b[1].size - a[1].size)[0][0]
}, 60_000)
afterAll(async () => {
  disarm()
  await cleanup()
})

let seq = 0
async function freshDests(n: number): Promise<string[]> {
  const base = join(root, `caso-${++seq}`)
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    out.push(join(base, `d${i}`))
    await mkdir(out[i - 1], { recursive: true })
  }
  return out
}
const routineFor = (dests: string[], mode: BackupMode, patch = {}) =>
  integrityRoutine({
    sources: [{ id: 's1', path: src, kind: 'folder' }],
    destinations: dests.map((p, i) => ({ id: `d${i + 1}`, path: p, label: `D${i + 1}` })),
    mode,
    ...patch
  })
const totalBytes = () => [...want.values()].reduce((a, f) => a + f.size, 0)

/**
 * Invariantes depois de QUALQUER execução: origem intacta; na pasta do destino só backups finais
 * (sem sobras), e todo backup com manifesto está completo (== origem, a menos de `skipped`).
 */
async function invariants(dest: string, label: string, skipped: string[] = []): Promise<string[]> {
  expect(await leftovers(dest), label).toEqual([])
  const finals: string[] = []
  for (const name of await readdir(dest)) {
    if (name.endsWith('.manifesto.json')) continue
    const p = join(dest, name)
    const s = await readSnapshot(p)
    if (!s.manifest && !s.innerManifest) continue // sem manifesto não é backup (e não conta na retenção)
    const exp = new Map(want)
    for (const k of skipped) exp.delete(k)
    expect(await snapshotProblems(p, exp, { routineId: 'rot-1' }), `${label}: ${name}`).toEqual([])
    finals.push(name)
  }
  return finals
}
async function sourceIntact(label: string): Promise<void> {
  expect(treeDiff(want, (await scanTree(src)).files), label).toEqual([])
}

describe(`falhas no destino durante a gravação (semente ${SEED})`, () => {
  for (const mode of ['copy', 'zip'] as const) {
    for (const kind of ['error', 'flip', 'drop'] as const) {
      it(`${mode}: ${kind === 'error' ? 'ENOSPC' : kind === 'flip' ? 'bit trocado em silêncio' : 'bloco engolido em silêncio'} num ponto sorteado do destino 1 → só o destino 2 fica com backup, completo`, async () => {
        const rng = new Rng(SEED).fork(`${mode}-${kind}`)
        for (let round = 0; round < 3; round++) {
          const ds = await freshDests(2)
          // A posição é sorteada dentro do volume gravado (no ZIP comprimido, menos que o total).
          const at = rng.int(0, Math.floor(totalBytes() * (mode === 'zip' ? 0.3 : 0.98)))
          ctl.state.write = fault(kind, at, (p) => p.startsWith(ds[0] + '/'), 'ENOSPC')
          const t = new Date(2026, 4, 1, 10, round, 0)
          let r
          try {
            r = await runAt(routineFor(ds, mode), t)
          } finally {
            disarm()
          }
          const label = `${mode}/${kind} rodada ${round} (byte ${at})`
          expect(r.status, label).toBe('failed')
          expect(r.destinations[0].status, label).toBe('failed')
          if (kind === 'error') expect(r.destinations[0].error, label).toBe('Sem espaço no destino.')
          expect(await invariants(ds[0], label), label).toEqual([])
          expect(await invariants(ds[1], label), label).toEqual([
            mode === 'zip' ? `${backupStamp(t)}.zip` : backupStamp(t)
          ])
        }
        await sourceIntact(`${mode}/${kind}`)
      }, 60_000)
    }
  }
})

describe('EIO na leitura da origem (no meio de um arquivo)', () => {
  it('pasta: o arquivo com erro de leitura fica de fora (aviso); o backup tem todo o resto, íntegro', async () => {
    const rng = new Rng(SEED + 1)
    const candidates = [...want].filter(([, s]) => s.size > 0).map(([k]) => k)
    for (let round = 0; round < 4; round++) {
      const rel = round === 0 ? bigRel : rng.pick(candidates)
      const at = rng.int(0, want.get(rel)!.size - 1)
      const ds = await freshDests(2)
      ctl.state.read = fault('error', at, (p) => p === join(src, ...rel.split('/')), 'EIO')
      let r
      try {
        r = await runAt(routineFor(ds, 'copy'), new Date(2026, 4, 2, 10, round))
      } finally {
        disarm()
      }
      const label = `EIO em ${rel} @${at}`
      // A falha é de uma leitura só: o 2º destino lê de novo e copia tudo.
      expect(r.status, label).toBe('warning')
      expect(
        r.destinations[0].skipped.map((s) => s.reason),
        label
      ).toEqual(['Erro de leitura no disco de origem'])
      const [f1] = await invariants(ds[0], label, [rel])
      expect((await readSnapshot(join(ds[0], f1))).manifest, label).toMatchObject({
        skipped: 1,
        status: 'warning'
      })
      expect((await invariants(ds[1], label)).length, label).toBe(1)
    }
    await sourceIntact('EIO pasta')
  }, 60_000)

  it('ZIP: arquivo lido para a memória fica de fora; arquivo grande (direto no ZIP) faz o destino falhar sem backup', async () => {
    const small = [...want].filter(([, s]) => s.size > 0 && s.size < 64 * KiB).map(([k]) => k)
    const rng = new Rng(SEED + 2)
    // 1) pequeno (vai para a memória antes de entrar no ZIP) → pulado com aviso
    {
      const rel = rng.pick(small)
      const ds = await freshDests(1)
      ctl.state.read = fault('error', 0, (p) => p === join(src, ...rel.split('/')), 'EIO')
      let r
      try {
        r = await runAt(routineFor(ds, 'zip'), new Date(2026, 4, 3, 10))
      } finally {
        disarm()
      }
      expect(r.status, rel).toBe('warning')
      expect((await invariants(ds[0], rel, [rel])).length).toBe(1)
    }
    // 2) grande, acima do limite da memória (entra direto no ZIP) → a entrada já foi começada: o
    //    destino falha (nada fica), em vez de gravar um ZIP com uma entrada cortada.
    {
      const ds = await freshDests(2)
      const at = rng.int(1, want.get(bigRel)!.size - 1)
      ctl.state.read = fault('error', at, (p) => p === join(src, ...bigRel.split('/')), 'EIO')
      let r
      try {
        r = await runAt(routineFor(ds, 'zip'), new Date(2026, 4, 3, 11), { job: { zipBufferMax: 64 * KiB } })
      } finally {
        disarm()
      }
      expect(r.destinations[0].status, bigRel).toBe('failed')
      expect(await invariants(ds[0], bigRel)).toEqual([])
      expect((await invariants(ds[1], bigRel)).length).toBe(1)
    }
    await sourceIntact('EIO zip')
  }, 60_000)

  it('EIO já na abertura (gancho) em arquivos sorteados: pulados, o resto íntegro, nos dois modos', async () => {
    const rng = new Rng(SEED + 3)
    for (const mode of ['copy', 'zip'] as const) {
      const bad = new Set(rng.shuffle([...want.keys()]).slice(0, 5))
      const ds = await freshDests(1)
      const r = await runAt(routineFor(ds, mode), new Date(2026, 4, 4, 10), {
        job: {
          hooks: {
            beforeOpen: (item) => {
              if (bad.has(item.rel)) throw Object.assign(new Error('i/o error'), { code: 'EIO' })
            }
          }
        }
      })
      expect(r.status, mode).toBe('warning')
      expect((await invariants(ds[0], mode, [...bad])).length).toBe(1)
    }
    await sourceIntact('EIO abertura')
  }, 60_000)
})

describe('verificação completa relê o destino de verdade', () => {
  it('EIO ao reler uma cópia na verificação → o destino falha, nenhum backup fica', async () => {
    const rng = new Rng(SEED + 4)
    for (let round = 0; round < 3; round++) {
      const ds = await freshDests(2)
      ctl.state.reread = fault('error', rng.int(0, totalBytes() - 1), (p) => p.startsWith(ds[1] + '/'), 'EIO')
      let r
      try {
        r = await runAt(routineFor(ds, 'copy'), new Date(2026, 4, 5, 10, round))
      } finally {
        disarm()
      }
      expect(r.status).toBe('failed')
      expect(r.destinations[1].error).toMatch(/verificação encontrou/)
      expect((await invariants(ds[0], 'd1')).length).toBe(1)
      expect(await invariants(ds[1], 'd2')).toEqual([])
    }
  }, 60_000)

  it('cópia corrompida em disco depois de gravada (mesmo tamanho e data) → detectada, sem backup', async () => {
    const rng = new Rng(SEED + 5)
    for (const mode of ['copy', 'zip'] as const) {
      const ds = await freshDests(1)
      const rel = rng.pick([...want].filter(([, s]) => s.size > 0).map(([k]) => k))
      const r = await runAt(routineFor(ds, mode), new Date(2026, 4, 6, 10), {
        job: {
          hooks: {
            beforeVerify: async (out) => {
              const { open } = await import('node:fs/promises')
              const target = mode === 'zip' ? out : join(out, ...rel.split('/'))
              const fh = await open(target, 'r+')
              const { size, mtime, atime } = await fh.stat()
              const pos = rng.int(0, size - 1)
              const b = Buffer.alloc(1)
              await fh.read(b, 0, 1, pos)
              b[0] ^= 0x80
              await fh.write(b, 0, 1, pos)
              await fh.utimes(atime, mtime)
              await fh.close()
            }
          }
        }
      })
      expect(r.status, mode).toBe('failed')
      expect(await invariants(ds[0], mode)).toEqual([])
    }
  }, 60_000)
})

describe('destino que some no meio da execução', () => {
  it('a pasta do destino é renomeada (disco desconectado) num arquivo sorteado: nenhum backup incompleto fica com manifesto', async () => {
    const rng = new Rng(SEED + 6)
    const files = want.size
    for (let round = 0; round < 6; round++) {
      const mode = round % 2 ? 'zip' : 'copy'
      const ds = await freshDests(2)
      const k = round < 2 ? 0 : rng.int(1, files - 1)
      let n = 0
      const gone = `${ds[0]}-desconectado`
      const r = await runAt(routineFor(ds, mode), new Date(2026, 4, 7, 10, round), {
        job: {
          hooks: {
            beforeOpen: async () => {
              if (n++ === k) await rename(ds[0], gone)
            }
          }
        }
      })
      const label = `${mode} rodada ${round}, some antes do arquivo ${k}`
      // O destino que sumiu falha — inclusive quando sumiu antes do 1º arquivo: o backup nunca é
      // gravado numa pasta recriada pelo caminho (no Linux/macOS, o ponto de montagem vazio de um
      // disco desconectado continua lá; o backup iria parar no disco do sistema, escondido).
      expect(r.destinations[0].status, label).toBe('failed')
      expect(r.status, label).toBe('failed')
      // Na pasta original (se recriada) nada com cara de backup; nada de sobra.
      if (
        await stat(ds[0]).then(
          () => true,
          () => false
        )
      )
        expect(await invariants(ds[0], label), label).toEqual([])
      // No disco "desconectado" fica só a cópia em andamento interrompida, com o marcador (a próxima
      // execução neste disco a reconhece e limpa), e nunca um manifesto.
      for (const name of await readdir(gone)) {
        expect(name, label).toMatch(/\.em-andamento$/)
        const inside = await readdir(join(gone, name))
        expect(inside, label).toContain(IN_PROGRESS_MARKER_FILE)
        expect(inside, label).not.toContain(MANIFEST_FILE)
      }
      expect((await invariants(ds[1], label)).length, label).toBe(1)
    }
    await sourceIntact('destino some')
  }, 60_000)
})

describe('manifesto gravado de forma atômica', () => {
  it('falha ao gravar (disco cheio no meio) → o erro sobe e o temporário não fica para trás', async () => {
    const d = join(root, 'atomico')
    await mkdir(d, { recursive: true })
    const file = join(d, '2026-05-11_10-00-00.zip.manifesto.json')
    ctl.state.wfile = fault('error', 0, (p) => p.startsWith(`${file}.`) && p.endsWith('.tmp'), 'ENOSPC')
    try {
      await expect(writeJsonAtomic(file, { a: 1 })).rejects.toMatchObject({ code: 'ENOSPC' })
    } finally {
      disarm()
    }
    expect(await readdir(d)).toEqual([])
    // Sem falha: grava normalmente.
    await writeJsonAtomic(file, { a: 2 })
    expect(await readdir(d)).toEqual(['2026-05-11_10-00-00.zip.manifesto.json'])
  })
})

/* ------------------------------------------------------------------ */
/* Disco cheio de verdade (tmpfs)                                      */
/* ------------------------------------------------------------------ */

const canMount = (() => {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) return false
  try {
    execFileSync('mount', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.runIf(canMount)('disco cheio de verdade (tmpfs de 8 MiB)', () => {
  let mnt: string
  let small: string
  let smallWant: TreeMap
  beforeAll(async () => {
    mnt = join(root, 'tmpfs')
    await mkdir(mnt, { recursive: true })
    execFileSync('mount', ['-t', 'tmpfs', '-o', 'size=8m', 'tmpfs', mnt])
    small = join(root, 'origem-pequena')
    const rng = new Rng(SEED + 7)
    smallWant = new Map()
    for (let i = 0; i < 24; i++) {
      const rel = `pasta ${i % 4}/arquivo ${i}.bin`
      smallWant.set(
        rel,
        await writeContent(join(small, ...rel.split('/')), rng.int(100, 250) * KiB, rng.pick(KINDS), `t${i}`)
      )
    }
  })
  afterAll(() => {
    try {
      execFileSync('umount', [mnt])
    } catch {
      // já desmontado
    }
  })

  /** Ocupa o que sobra no tmpfs (fica só `leave` bytes livres). */
  async function fill(leave = 0): Promise<void> {
    const s = await statfs(mnt)
    const free = Number(s.bavail) * Number(s.bsize)
    await writeFile(join(mnt, 'enchimento.bin'), Buffer.alloc(Math.max(0, free - leave)))
  }
  const routineSmall = (dests: string[], mode: BackupMode) =>
    integrityRoutine({
      sources: [{ id: 's1', path: small, kind: 'folder' }],
      destinations: dests.map((p, i) => ({ id: `d${i}`, path: p })),
      mode
    })
  async function reset(): Promise<string> {
    for (const n of await readdir(mnt)) await rm(join(mnt, n), { recursive: true, force: true })
    const d = join(mnt, 'backups')
    await mkdir(d)
    return d
  }
  async function smallInvariants(dest: string, label: string, sidecarOptional = false): Promise<string[]> {
    expect(await leftovers(dest), label).toEqual([])
    const out: string[] = []
    for (const name of await readdir(dest)) {
      if (name.endsWith('.manifesto.json')) continue
      const s = await readSnapshot(join(dest, name))
      if (!s.manifest && !s.innerManifest) continue
      expect(
        await snapshotProblems(join(dest, name), smallWant, { routineId: 'rot-1', sidecarOptional }),
        label
      ).toEqual([])
      out.push(name)
    }
    return out
  }

  for (const mode of ['copy', 'zip'] as const) {
    it(`${mode}: o disco enche no meio da cópia → falha "Sem espaço", a cópia parcial sai e libera o espaço`, async () => {
      const d = await reset()
      const [other] = await freshDests(1)
      let n = 0
      const r = await runAt(routineSmall([d, other], mode), new Date(2026, 4, 8, 10), {
        job: {
          hooks: {
            beforeOpen: async () => {
              if (n++ === 8) await fill(32 * KiB)
            }
          }
        }
      })
      expect(r.destinations[0].status).toBe('failed')
      expect(r.destinations[0].error).toBe('Sem espaço no destino.')
      expect(await smallInvariants(d, mode)).toEqual([])
      expect((await readdir(d)).length).toBe(0)
      expect((await smallInvariants(other, mode)).length).toBe(1)
      expect(treeDiff(smallWant, (await scanTree(small)).files)).toEqual([])
    })

    it(`${mode}: o disco enche entre a cópia e o manifesto → nada fica com cara de backup incompleto`, async () => {
      const d = await reset()
      const r = await runAt(routineSmall([d], mode), new Date(2026, 4, 8, 11), {
        job: { hooks: { beforeVerify: () => fill(0) } }
      })
      const label = `${mode} cheio antes do manifesto`
      // Pasta: o manifesto não pôde ser gravado → falha e nada fica. ZIP: o .zip já verificado recebeu o
      // nome final (com o manifesto interno) e só o manifesto ao lado falhou → o destino é dado como
      // falho, mas o .zip que ficou está completo e conferido (a retenção o reconhece pelo interno).
      const finals = await smallInvariants(d, label, mode === 'zip')
      expect(r.status, label).toBe('failed')
      expect(finals.length, label).toBe(mode === 'zip' ? 1 : 0)
      // Nenhum temporário perdido na pasta do destino.
      expect(
        (await readdir(d)).filter((x) => !x.startsWith('2026-')),
        label
      ).toEqual([])
    })
  }
})

/* ------------------------------------------------------------------ */
/* Cancelamento em pontos sorteados                                    */
/* ------------------------------------------------------------------ */

describe('cancelamento em pontos sorteados', () => {
  for (const mode of ['copy', 'zip'] as const) {
    it(`${mode}: cancelar no k-ésimo evento (k sorteado) nunca deixa backup incompleto nem mexe na origem`, async () => {
      const rng = new Rng(SEED + 8).fork(mode)
      // Quantos eventos uma execução completa emite (progresso sem limite de frequência).
      let total = 0
      {
        const ds = await freshDests(2)
        const r = await runAt(routineFor(ds, mode), new Date(2026, 4, 9, 9), {
          onEvent: () => total++,
          job: { progressIntervalMs: 0 }
        })
        expect(r.status).toBe('success')
      }
      for (let round = 0; round < 10; round++) {
        const ds = await freshDests(2)
        const k = rng.int(1, total)
        const ac = new AbortController()
        let n = 0
        const at = new Date(2026, 4, 9, 10, round)
        let abortedAt: string | null = null
        const r = await runAt(routineFor(ds, mode), at, {
          signal: ac.signal,
          onEvent: (e: EngineEvent) => {
            if (++n === k) {
              abortedAt = e.type === 'progress' ? e.progress.phase : 'log'
              ac.abort()
            }
          },
          job: { progressIntervalMs: 0 }
        })
        const label = `${mode} rodada ${round}: cancelado no evento ${k}/${total} (${abortedAt})`
        if (abortedAt && abortedAt !== 'done') expect(r.status, label).toBe('cancelled')
        for (const d of ds) await invariants(d, label)
      }
      await sourceIntact(`cancelamento ${mode}`)
    }, 90_000)
  }

  it('cancelar dentro dos ganchos (abertura, leitura, verificação, entre destinos) em pontos sorteados', async () => {
    const rng = new Rng(SEED + 9)
    const where = ['beforeOpen', 'afterRead', 'beforeVerify', 'afterDestination'] as const
    for (let round = 0; round < 8; round++) {
      const mode = rng.pick(['copy', 'zip'] as const)
      const hook = where[round % where.length]
      const ds = await freshDests(2)
      const ac = new AbortController()
      const target = rng.int(0, hook === 'beforeVerify' || hook === 'afterDestination' ? 1 : want.size - 1)
      let n = 0
      const tick = () => {
        if (n++ === target) ac.abort()
      }
      const r = await runAt(routineFor(ds, mode), new Date(2026, 4, 10, 10, round), {
        signal: ac.signal,
        job: {
          hooks:
            hook === 'beforeOpen'
              ? { beforeOpen: tick }
              : hook === 'afterRead'
                ? { afterRead: tick }
                : hook === 'beforeVerify'
                  ? { beforeVerify: tick }
                  : { afterDestination: tick }
        }
      })
      const label = `${mode} ${hook} #${target}`
      expect(r.status, label).toBe('cancelled')
      const done = await Promise.all(ds.map((d) => invariants(d, label)))
      // Cancelado entre os destinos: o 1º ficou completo (com manifesto), o 2º nem começou.
      if (hook === 'afterDestination' && target === 0)
        expect(
          done.map((x) => x.length),
          label
        ).toEqual([1, 0])
    }
    await sourceIntact('cancelamento nos ganchos')
  }, 90_000)
})

/* ------------------------------------------------------------------ */
/* Leitura rasgada sorteada                                            */
/* ------------------------------------------------------------------ */

describe('leitura rasgada sorteada (outro programa grava enquanto o backup lê)', () => {
  for (const mode of ['copy', 'zip'] as const) {
    it(`${mode}: cada arquivo no backup é uma versão inteira conhecida; o que ficou de fora foi avisado`, async () => {
      const rng = new Rng(SEED + 10).fork(mode)
      let skippedSeen = 0
      let retriedSeen = 0
      for (let round = 0; round < 4; round++) {
        const live = join(root, `rasgada-${mode}-${round}`)
        const versions = new Map<string, Set<string>>()
        const cur: TreeMap = await materialize(
          live,
          planTree(rng.fork(`t${round}`), {
            smallFiles: 25,
            depth: 2,
            boundarySizes: [0, 1, 300 * KiB + 1, MiB + 1]
          })
        )
        for (const [k, v] of cur) versions.set(k, new Set([v.sha256]))
        // Arquivos "vivos": mudam nas primeiras `times` leituras (1 → recopiado; muitas → fica de fora).
        const victims = new Map<string, { times: number; how: 'append' | 'overwrite' | 'truncate' }>()
        for (const rel of rng.shuffle([...cur.keys()]).slice(0, 6))
          victims.set(rel, {
            times: rng.pick([1, 2, 5]),
            how: rng.pick(['append', 'overwrite', 'truncate'] as const)
          })
        const hits = new Map<string, number>()
        const ds = await freshDests(2)
        const r = await runAt(
          integrityRoutine({
            sources: [{ id: 's1', path: live, kind: 'folder' }],
            destinations: ds.map((p, i) => ({ id: `d${i}`, path: p })),
            mode
          }),
          new Date(2026, 4, 12, 10, round),
          {
            job: {
              zipBufferMax: rng.pick([0, 64 * KiB, undefined]),
              hooks: {
                afterRead: async (item) => {
                  const rel = item.rel
                  const v = victims.get(rel)
                  const n = (hits.get(rel) ?? 0) + 1
                  hits.set(rel, n)
                  if (!v || n > v.times) return
                  const { open } = await import('node:fs/promises')
                  const fh = await open(item.abs, 'r+')
                  try {
                    const { size } = await fh.stat()
                    const junk = Buffer.from(`~${rel}#${n}~`)
                    if (v.how === 'append' || size < junk.length) await fh.write(junk, 0, junk.length, size)
                    else if (v.how === 'overwrite')
                      await fh.write(junk, 0, junk.length, rng.int(0, size - junk.length))
                    else {
                      await fh.truncate(Math.floor(size / 2))
                      const fill = Buffer.alloc(size - Math.floor(size / 2), n)
                      await fh.write(fill, 0, fill.length, Math.floor(size / 2))
                    }
                  } finally {
                    await fh.close()
                  }
                  const { sha256File: h } = await import('./integrity-lib')
                  versions.get(rel)!.add((await h(item.abs)).sha256)
                }
              }
            }
          }
        )
        const label = `${mode} rodada ${round}: ${JSON.stringify([...victims])}`
        expect(['success', 'warning'], label).toContain(r.status)
        for (const [i, d] of ds.entries()) {
          expect(await leftovers(d), label).toEqual([])
          const names = (await readdir(d)).filter((x) => !x.endsWith('.manifesto.json'))
          expect(names.length, label).toBe(1)
          const snap = await readSnapshot(join(d, names[0]))
          expect(snap.problems, label).toEqual([])
          // a) nunca uma mistura: cada arquivo do backup é exatamente uma versão inteira conhecida
          for (const [rel, sig] of snap.files)
            expect(versions.get(rel)?.has(sig.sha256), `${label} d${i + 1}: ${rel}`).toBe(true)
          // b) nada some em silêncio: fora do backup ⇒ listado como pulado ("alterado durante a cópia")
          const skipped = new Set(r.destinations[i].skipped.map((s) => s.path))
          for (const rel of cur.keys())
            if (!snap.files.has(rel))
              expect(skipped.has(join(live, ...rel.split('/'))), `${label}: ${rel}`).toBe(true)
          for (const s of r.destinations[i].skipped)
            expect(s.reason, label).toBe('Arquivo alterado durante a cópia')
          // c) o manifesto conta exatamente isso
          expect(snap.manifest, label).toMatchObject({
            files: snap.files.size,
            skipped: cur.size - snap.files.size,
            status: snap.files.size === cur.size ? 'success' : 'warning',
            verified: true
          })
          // d) só os arquivos alterados podem ter ficado de fora
          for (const rel of cur.keys())
            if (!victims.has(rel)) expect(snap.files.get(rel), label).toEqual(cur.get(rel))
          skippedSeen += cur.size - snap.files.size
          for (const rel of victims.keys())
            if (snap.files.has(rel) && snap.files.get(rel)!.sha256 !== cur.get(rel)!.sha256) retriedSeen++
        }
      }
      // O cenário exercitou os dois caminhos: arquivo pulado e arquivo recopiado na versão nova.
      expect(skippedSeen).toBeGreaterThan(0)
      expect(retriedSeen).toBeGreaterThan(0)
    }, 90_000)
  }
})
