// Acompanhamento de progresso de uma execução: velocidade (média móvel ~3 s), ETA
// (só depois de 5 s copiando) e emissão limitada a no máximo 4 eventos por segundo.
//
// filesTotal/filesDone/bytesTotal/bytesDone referem-se ao DESTINO ATUAL
// (destinationIndex de destinationCount). Percentual geral:
//   (destinationIndex + bytesDone / bytesTotal) / destinationCount
// O etaMs considera também os destinos que ainda faltam.

import type { RunPhase, RunProgress } from '@shared/types'

export interface ProgressBase {
  runId: string
  routineId: string
  routineName: string
  startedAt: string
  destinationCount: number
}

const SPEED_WINDOW_MS = 3000
const ETA_AFTER_MS = 5000

export class ProgressTracker {
  private p: RunProgress
  private lastEmit = 0
  private samples: Array<{ t: number; b: number }> = []
  /** Bytes acumulados em todos os destinos (base da velocidade). */
  private cumulative = 0
  private copyStartedAt = 0

  constructor(
    base: ProgressBase,
    private readonly emit: (p: RunProgress) => void,
    private readonly now: () => number = Date.now,
    private readonly intervalMs = 250
  ) {
    this.p = {
      ...base,
      phase: 'scanning',
      filesTotal: 0,
      filesDone: 0,
      bytesTotal: 0,
      bytesDone: 0,
      speed: 0,
      destinationIndex: 0
    }
  }

  get snapshot(): RunProgress {
    return { ...this.p }
  }

  /** Muda a fase e emite imediatamente. */
  phase(phase: RunPhase, patch: Partial<RunProgress> = {}): void {
    this.p = { ...this.p, ...patch, phase }
    if (phase !== 'copying') {
      this.p.etaMs = undefined
    }
    this.tick(true)
  }

  scanned(files: number, bytes: number): void {
    this.p.filesTotal = files
    this.p.bytesTotal = bytes
    this.tick()
  }

  startDestination(index: number, path: string, filesTotal: number, bytesTotal: number): void {
    if (!this.copyStartedAt) this.copyStartedAt = this.now()
    this.p = {
      ...this.p,
      phase: 'copying',
      destinationIndex: index,
      destinationPath: path,
      filesTotal,
      bytesTotal,
      filesDone: 0,
      bytesDone: 0,
      currentFile: undefined
    }
    this.tick(true)
  }

  /** Reinicia contadores para a fase de verificação do destino atual. */
  startVerify(filesTotal: number, bytesTotal: number): void {
    this.p = { ...this.p, phase: 'verifying', filesTotal, bytesTotal, filesDone: 0, bytesDone: 0, etaMs: undefined }
    this.tick(true)
  }

  file(rel: string): void {
    this.p.currentFile = rel
    this.tick()
  }

  fileDone(): void {
    this.p.filesDone++
    this.tick()
  }

  addBytes(n: number): void {
    this.p.bytesDone += n
    if (this.p.phase === 'copying') this.cumulative += n
    this.tick()
  }

  flush(): void {
    this.tick(true)
  }

  private updateSpeed(t: number): void {
    this.samples.push({ t, b: this.cumulative })
    while (this.samples.length > 2 && t - this.samples[0].t > SPEED_WINDOW_MS) this.samples.shift()
    const first = this.samples[0]
    const dt = (t - first.t) / 1000
    if (dt >= 0.5) this.p.speed = Math.max(0, Math.round((this.cumulative - first.b) / dt))
  }

  private updateEta(t: number): void {
    if (this.p.phase !== 'copying' || !this.copyStartedAt || t - this.copyStartedAt < ETA_AFTER_MS || this.p.speed <= 0) {
      if (this.p.phase === 'copying') this.p.etaMs = undefined
      return
    }
    const remainingHere = Math.max(0, this.p.bytesTotal - this.p.bytesDone)
    const remainingDest = Math.max(0, this.p.destinationCount - this.p.destinationIndex - 1)
    const remaining = remainingHere + remainingDest * this.p.bytesTotal
    this.p.etaMs = Math.round((remaining / this.p.speed) * 1000)
  }

  private tick(force = false): void {
    const t = this.now()
    if (!force && t - this.lastEmit < this.intervalMs) return
    this.lastEmit = t
    this.updateSpeed(t)
    this.updateEta(t)
    this.emit({ ...this.p })
  }
}
