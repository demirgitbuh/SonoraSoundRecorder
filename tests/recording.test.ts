import { appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunInit } from '../src/shared/ipc'
import { RunStore, computePeaksFromRaw, rawPeak } from '../src/main/services/run-store'
import { outputTracksFor } from '../src/main/services/audio-service'
import { floatWavHeader } from '../src/main/services/wav'
import { RUN_A, RUN_B, RUN_C, sine, tempDir, testLogger } from './helpers'

function init(runId: string, patch: Partial<RunInit> = {}): RunInit {
  return {
    runId,
    sessionId: `session-${runId.slice(0, 4)}`,
    sessionName: 'Session',
    sampleRate: 48000,
    channels: 2,
    source: 'mic',
    outputMode: 'combined',
    tracks: ['mic'],
    encoding: { format: 'wav', sampleRate: 48000, channels: 2, bitDepth: 24, bitrateKbps: 0, flacCompression: 5 },
    processing: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
    devices: { mic: { label: 'Test mic', nativeSampleRate: 48000, nativeChannels: 1 }, system: null },
    startedAt: '2026-04-02T09:30:15.000Z',
    ...patch
  }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

describe('temporary recording storage', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('streams chunks to disk instead of keeping them in memory', async () => {
    const store = new RunStore(join(dir, 'sessions'), testLogger(dir))
    await store.begin(init(RUN_A))
    for (let i = 0; i < 20; i++) store.write(RUN_A, 'mic', sine(4800, 2, 48000).buffer as ArrayBuffer)
    const res = await store.end(RUN_A)
    expect(res.framesWritten).toBe(96_000)
    expect(res.durationMs).toBe(2000)
    expect(statSync(store.trackPath(RUN_A, 'mic')).size).toBe(96_000 * 2 * 4)
    const manifest = JSON.parse(readFileSync(join(store.runDir(RUN_A), 'manifest.json'), 'utf8'))
    expect(manifest.state).toBe('stopped')
    expect(manifest.suggestedName).toMatch(/^Sonora_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/)
  })

  it('rejects misaligned chunks and writes to unknown tracks', async () => {
    const store = new RunStore(join(dir, 'sessions'), testLogger(dir))
    await store.begin(init(RUN_A))
    store.write(RUN_A, 'mic', new ArrayBuffer(6))
    store.write(RUN_A, 'system', sine(100, 2, 48000).buffer as ArrayBuffer)
    store.write(RUN_A, 'mic', sine(100, 2, 48000).buffer as ArrayBuffer)
    const res = await store.end(RUN_A)
    expect(res.framesWritten).toBe(100)
  })

  it('keeps several sessions completely separate', async () => {
    const store = new RunStore(join(dir, 'sessions'), testLogger(dir))
    await store.begin(init(RUN_A, { sessionId: 'one' }))
    await store.begin(init(RUN_B, { sessionId: 'two', source: 'both', outputMode: 'both', tracks: ['mix', 'mic', 'system'], channels: 1 }))
    for (let i = 0; i < 10; i++) {
      store.write(RUN_A, 'mic', sine(1000, 2, 48000, 440).buffer as ArrayBuffer)
      store.write(RUN_B, 'mix', sine(500, 1, 48000, 220).buffer as ArrayBuffer)
      store.write(RUN_B, 'mic', sine(500, 1, 48000, 220, 0.2).buffer as ArrayBuffer)
      store.write(RUN_B, 'system', sine(500, 1, 48000, 220, 0.3).buffer as ArrayBuffer)
    }
    const a = await store.end(RUN_A)
    expect(store.isActive(RUN_B)).toBe(true)
    const b = await store.end(RUN_B)
    expect(a.framesWritten).toBe(10_000)
    expect(b.framesWritten).toBe(5_000)
    expect(store.runDir(RUN_A)).not.toBe(store.runDir(RUN_B))
    expect(existsSync(store.trackPath(RUN_A, 'system'))).toBe(false)
    for (const t of ['mix', 'mic', 'system'] as const) expect(statSync(store.trackPath(RUN_B, t)).size).toBe(5_000 * 4)
    const peakMic = await rawPeak(store.trackPath(RUN_B, 'mic'), 1, null)
    const peakSys = await rawPeak(store.trackPath(RUN_B, 'system'), 1, null)
    expect(peakMic).toBeCloseTo(0.2, 2)
    expect(peakSys).toBeCloseTo(0.3, 2)
    const pending = await store.listPending()
    expect(pending.map((p) => p.sessionId).sort()).toEqual(['one', 'two'])
  })

  it('refuses to reuse a run id', async () => {
    const store = new RunStore(join(dir, 'sessions'), testLogger(dir))
    await store.begin(init(RUN_A))
    await expect(store.begin(init(RUN_A))).rejects.toThrow()
  })

  it('computes waveform peaks while recording (50 per second)', async () => {
    const store = new RunStore(join(dir, 'sessions'), testLogger(dir))
    await store.begin(init(RUN_A))
    store.write(RUN_A, 'mic', sine(48000, 2, 48000, 440, 0.5).buffer as ArrayBuffer)
    await store.end(RUN_A)
    const peaks = await store.peaks(RUN_A, 'mic')
    expect(peaks.length).toBe(50)
    expect(Math.max(...peaks)).toBeGreaterThan(120)
    expect(Math.max(...peaks)).toBeLessThanOrEqual(128)
  })
})

describe('crash recovery', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('detects a run interrupted by a crash on the next launch', async () => {
    const base = join(dir, 'sessions')
    const crashed = new RunStore(base, testLogger(dir))
    await crashed.begin(init(RUN_A))
    crashed.write(RUN_A, 'mic', sine(24000, 2, 48000).buffer as ArrayBuffer)
    await crashed.update(RUN_A, { markers: [{ id: 'm1', timeMs: 120 }] })
    await settle()
    // No end(): the process "dies" here. A new process scans the directory.
    const next = new RunStore(base, testLogger(dir))
    const pending = await next.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.kind).toBe('crashed')
    expect(pending[0]!.durationMs).toBe(500)
    expect(pending[0]!.markers).toEqual([{ id: 'm1', timeMs: 120 }])
    await crashed.end(RUN_A)
  })

  it('repairs a torn last frame left by a crash', async () => {
    const base = join(dir, 'sessions')
    const store = new RunStore(base, testLogger(dir))
    await store.begin(init(RUN_A))
    store.write(RUN_A, 'mic', sine(1000, 2, 48000).buffer as ArrayBuffer)
    await store.end(RUN_A)
    appendFileSync(store.trackPath(RUN_A, 'mic'), Buffer.from([1, 2, 3]))
    expect(await store.trackFrames(RUN_A, 'mic', 2, true)).toBe(1000)
    expect(statSync(store.trackPath(RUN_A, 'mic')).size).toBe(8000)
  })

  it('normally stopped runs are offered as unsaved, not as crashed', async () => {
    const base = join(dir, 'sessions')
    const store = new RunStore(base, testLogger(dir))
    await store.begin(init(RUN_A))
    store.write(RUN_A, 'mic', sine(4800, 2, 48000).buffer as ArrayBuffer)
    await store.end(RUN_A)
    const pending = await new RunStore(base, testLogger(dir)).listPending()
    expect(pending[0]!.kind).toBe('unsaved')
  })

  it('saved runs are cleaned up and never shown again', async () => {
    const base = join(dir, 'sessions')
    const store = new RunStore(base, testLogger(dir))
    await store.begin(init(RUN_A))
    store.write(RUN_A, 'mic', sine(4800, 2, 48000).buffer as ArrayBuffer)
    await store.end(RUN_A)
    await store.setPhase(RUN_A, 'saved')
    const pending = await new RunStore(base, testLogger(dir)).listPending()
    expect(pending).toHaveLength(0)
    expect(existsSync(store.runDir(RUN_A))).toBe(false)
  })

  it('recomputes peaks from raw data when the peaks file is incomplete', async () => {
    const base = join(dir, 'sessions')
    const store = new RunStore(base, testLogger(dir))
    await store.begin(init(RUN_A))
    store.write(RUN_A, 'mic', sine(48000, 2, 48000, 440, 0.25).buffer as ArrayBuffer)
    await store.end(RUN_A)
    rmSync(store.peaksPath(RUN_A, 'mic'))
    const peaks = await store.peaks(RUN_A, 'mic')
    expect(peaks.length).toBe(50)
    const direct = await computePeaksFromRaw(store.trackPath(RUN_A, 'mic'), 2, 48000)
    expect(Array.from(peaks)).toEqual(Array.from(direct))
  })

  it('ignores directories without a valid manifest', async () => {
    const base = join(dir, 'sessions')
    const store = new RunStore(base, testLogger(dir))
    await store.begin(init(RUN_C))
    await store.end(RUN_C)
    writeFileSync(join(store.runDir(RUN_C), 'manifest.json'), '{oops')
    expect(await new RunStore(base, testLogger(dir)).listPending()).toEqual([])
  })

  it('discarding removes every file of the run', async () => {
    const store = new RunStore(join(dir, 'sessions'), testLogger(dir))
    await store.begin(init(RUN_A))
    await store.end(RUN_A)
    await store.discard(RUN_A)
    expect(existsSync(store.runDir(RUN_A))).toBe(false)
  })
})

describe('output tracks and preview wav', () => {
  it('chooses output files from the source and output mode', () => {
    expect(outputTracksFor({ source: 'mic', outputMode: 'both', tracks: ['mic'] })).toEqual(['mic'])
    expect(outputTracksFor({ source: 'system', outputMode: 'combined', tracks: ['system'] })).toEqual(['system'])
    expect(outputTracksFor({ source: 'both', outputMode: 'combined', tracks: ['mix'] })).toEqual(['mix'])
    expect(outputTracksFor({ source: 'both', outputMode: 'separate', tracks: ['mic', 'system'] })).toEqual(['mic', 'system'])
    expect(outputTracksFor({ source: 'both', outputMode: 'both', tracks: ['mix', 'mic', 'system'] })).toEqual(['mix', 'mic', 'system'])
  })

  it('builds a valid IEEE float WAV header for the raw preview stream', () => {
    const h = floatWavHeader(96_000, 48_000, 2)
    expect(h.length).toBe(44)
    expect(h.toString('ascii', 0, 4)).toBe('RIFF')
    expect(h.readUInt32LE(4)).toBe(36 + 96_000)
    expect(h.toString('ascii', 8, 12)).toBe('WAVE')
    expect(h.readUInt16LE(20)).toBe(3)
    expect(h.readUInt16LE(22)).toBe(2)
    expect(h.readUInt32LE(24)).toBe(48_000)
    expect(h.readUInt32LE(28)).toBe(48_000 * 8)
    expect(h.readUInt16LE(32)).toBe(8)
    expect(h.readUInt16LE(34)).toBe(32)
    expect(h.readUInt32LE(40)).toBe(96_000)
  })
})
