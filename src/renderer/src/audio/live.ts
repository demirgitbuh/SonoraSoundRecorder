/**
 * Live meter and waveform data for one session. Written by the capture worklet messages at
 * ~30 Hz and read by canvas components inside requestAnimationFrame, outside React state, so the
 * UI does not re-render on every audio callback. Memory is bounded by a fixed ring buffer.
 */
export interface MeterValue {
  peak: number
  rms: number
  /** performance.now() of the last clipped sample, or 0. */
  clipAt: number
  /** Peak hold for the meter needle. */
  hold: number
  holdAt: number
}

const RING = 2400

function meter(): MeterValue {
  return { peak: 0, rms: 0, clipAt: 0, hold: 0, holdAt: 0 }
}

export class LiveData {
  readonly wave = new Float32Array(RING)
  /** Total number of points ever written; index = written % RING. */
  written = 0
  readonly mic = meter()
  readonly system = meter()
  readonly mix = meter()
  updatedAt = 0
  clipCount = 0

  pushWave(points: number[]): void {
    for (const p of points) {
      this.wave[this.written % RING] = p
      this.written++
    }
  }

  setMeter(target: MeterValue, peak: number, rms: number, clip: boolean, now: number): void {
    target.peak = peak
    target.rms = rms
    if (clip) {
      if (now - target.clipAt > 500) this.clipCount++
      target.clipAt = now
    }
    if (peak >= target.hold || now - target.holdAt > 1200) {
      target.hold = peak
      target.holdAt = now
    }
    this.updatedAt = now
  }

  /** The most recent `count` points, oldest first. */
  recent(count: number, out: Float32Array): number {
    const n = Math.min(count, this.written, RING, out.length)
    const start = this.written - n
    for (let i = 0; i < n; i++) out[i] = this.wave[(start + i) % RING]!
    return n
  }

  reset(): void {
    this.wave.fill(0)
    this.written = 0
    for (const m of [this.mic, this.system, this.mix]) {
      m.peak = 0
      m.rms = 0
      m.clipAt = 0
      m.hold = 0
      m.holdAt = 0
    }
    this.clipCount = 0
  }

  decay(): void {
    for (const m of [this.mic, this.system, this.mix]) {
      m.peak *= 0.6
      m.rms *= 0.6
    }
  }
}

const registry = new Map<string, LiveData>()

export function liveData(sessionId: string): LiveData {
  let d = registry.get(sessionId)
  if (!d) {
    d = new LiveData()
    registry.set(sessionId, d)
  }
  return d
}
