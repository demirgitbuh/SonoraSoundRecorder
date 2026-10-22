import { mkdir, open, readdir, readFile, rm, stat, truncate } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { PendingRun, PauseReason, RunEndResult, RunInit, RunPatch, RunPhase } from '../../shared/ipc'
import type { Marker, TrackKind } from '../../shared/types'
import { AUDIO_FORMATS } from '../../shared/types'
import { timestampName } from '../../shared/naming'
import { pathExists, readJson, writeFileAtomic } from './fs-utils'
import type { Logger } from './logger'

export const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const PEAKS_PER_SECOND = 50
const SYNC_INTERVAL_MS = 2000

export interface RunManifest extends RunInit {
  schemaVersion: 1
  state: RunPhase
  pauseReason: PauseReason
  updatedAt: string
  markers: Marker[]
  suggestedName: string
}

const deviceSchema = z.object({ label: z.string(), nativeSampleRate: z.number().nullable(), nativeChannels: z.number().nullable() }).nullable()

const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(RUN_ID_PATTERN),
  sessionId: z.string(),
  sessionName: z.string(),
  sampleRate: z.number().int().min(8000).max(384000),
  channels: z.union([z.literal(1), z.literal(2)]),
  source: z.enum(['mic', 'system', 'both']),
  outputMode: z.enum(['combined', 'separate', 'both']),
  tracks: z.array(z.enum(['mic', 'system', 'mix'])).min(1),
  encoding: z.object({
    format: z.enum(AUDIO_FORMATS),
    sampleRate: z.number(),
    channels: z.union([z.literal(1), z.literal(2)]),
    bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]),
    bitrateKbps: z.number(),
    flacCompression: z.number()
  }),
  processing: z.object({ noiseSuppression: z.boolean(), echoCancellation: z.boolean(), autoGainControl: z.boolean() }),
  devices: z.object({ mic: deviceSchema, system: deviceSchema }),
  startedAt: z.string(),
  state: z.enum(['recording', 'paused', 'stopped', 'saving', 'saved']),
  pauseReason: z.enum(['user', 'device-lost']).nullable().catch(null),
  updatedAt: z.string(),
  markers: z.array(z.object({ id: z.string(), timeMs: z.number() })).catch([]),
  suggestedName: z.string()
})

interface TrackWriter {
  fh: FileHandle
  peaksFh: FileHandle
  bytes: number
  queue: Promise<void>
  bucketFrames: number
  bucketCount: number
  bucketMax: number
  pendingPeaks: number[]
}

interface ActiveRun {
  dir: string
  manifest: RunManifest
  tracks: Map<TrackKind, TrackWriter>
  timer: NodeJS.Timeout
  failed: boolean
  /** Syncs run one after another; `end` waits for the last one before closing the files. */
  syncing: Promise<void>
  ending: boolean
}

export interface RunStoreOptions {
  /** Called once when writing to disk fails (disk full, device removed...). */
  onWriteError?: (runId: string, err: Error) => void
  /** How often audio is forced to disk, read when a run begins (developer option). */
  syncIntervalMs?: () => number
}

/**
 * Stores in-progress recordings on disk. Each run has its own directory with a manifest and
 * one append-only raw float32 file per track, so no audio is kept in memory and an interrupted
 * run can be recovered on the next launch.
 */
export class RunStore {
  private readonly active = new Map<string, ActiveRun>()

  constructor(
    readonly baseDir: string,
    private readonly logger: Logger,
    private readonly opts: RunStoreOptions = {}
  ) {}

  private syncInterval(): number {
    const ms = this.opts.syncIntervalMs?.() ?? SYNC_INTERVAL_MS
    return Number.isFinite(ms) ? Math.min(10_000, Math.max(250, ms)) : SYNC_INTERVAL_MS
  }

  runDir(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) throw new Error('invalid run id')
    return join(this.baseDir, runId)
  }

  trackPath(runId: string, track: TrackKind): string {
    return join(this.runDir(runId), `${track}.f32`)
  }

  peaksPath(runId: string, track: TrackKind): string {
    return join(this.runDir(runId), `${track}.peaks`)
  }

  /** Compressed preview used only for runs too long to be served as a virtual WAV. */
  proxyPath(runId: string, track: TrackKind): string {
    return join(this.runDir(runId), `${track}.preview.ogg`)
  }

  isActive(runId: string): boolean {
    return this.active.has(runId)
  }

  activeCount(): number {
    return this.active.size
  }

  async begin(init: RunInit): Promise<void> {
    const dir = this.runDir(init.runId)
    if (this.active.has(init.runId) || (await pathExists(dir))) throw new Error('run already exists')
    await mkdir(dir, { recursive: true })
    const manifest: RunManifest = {
      ...init,
      schemaVersion: 1,
      state: 'recording',
      pauseReason: null,
      updatedAt: new Date().toISOString(),
      markers: [],
      suggestedName: timestampName(new Date(init.startedAt))
    }
    const tracks = new Map<TrackKind, TrackWriter>()
    try {
      for (const track of init.tracks) {
        const fh = await open(join(dir, `${track}.f32`), 'a')
        const peaksFh = await open(join(dir, `${track}.peaks`), 'a')
        tracks.set(track, {
          fh,
          peaksFh,
          bytes: 0,
          queue: Promise.resolve(),
          bucketFrames: Math.max(1, Math.round(init.sampleRate / PEAKS_PER_SECOND)),
          bucketCount: 0,
          bucketMax: 0,
          pendingPeaks: []
        })
      }
      await writeFileAtomic(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    } catch (err) {
      for (const t of tracks.values()) {
        await t.fh.close().catch(() => undefined)
        await t.peaksFh.close().catch(() => undefined)
      }
      await rm(dir, { recursive: true, force: true })
      throw err
    }
    const run: ActiveRun = {
      dir,
      manifest,
      tracks,
      failed: false,
      syncing: Promise.resolve(),
      ending: false,
      timer: setInterval(() => void this.sync(init.runId), this.syncInterval())
    }
    run.timer.unref?.()
    this.active.set(init.runId, run)
    this.logger.info('runs', `begin ${init.runId} tracks=${init.tracks.join(',')} rate=${init.sampleRate} ch=${init.channels}`)
  }

  /** Appends interleaved float32 frames to a track. Order is preserved per track. */
  write(runId: string, track: TrackKind, data: ArrayBuffer): void {
    const run = this.active.get(runId)
    if (!run || run.failed) return
    const writer = run.tracks.get(track)
    if (!writer) return
    const frameBytes = 4 * run.manifest.channels
    if (data.byteLength === 0 || data.byteLength % frameBytes !== 0) {
      this.logger.warn('runs', `dropped misaligned chunk (${data.byteLength} bytes) for ${runId}`)
      return
    }
    const bytes = new Uint8Array(data)
    this.collectPeaks(writer, new Float32Array(data), run.manifest.channels)
    writer.queue = writer.queue.then(async () => {
      if (run.failed) return
      try {
        let offset = 0
        while (offset < bytes.length) {
          const { bytesWritten } = await writer.fh.write(bytes, offset, bytes.length - offset)
          offset += bytesWritten
        }
        writer.bytes += bytes.length
      } catch (err) {
        this.fail(runId, run, err as Error)
      }
    })
  }

  private collectPeaks(writer: TrackWriter, samples: Float32Array, channels: number): void {
    const frames = samples.length / channels
    for (let f = 0; f < frames; f++) {
      let m = 0
      for (let c = 0; c < channels; c++) {
        const v = Math.abs(samples[f * channels + c]!)
        if (v > m) m = v
      }
      if (m > writer.bucketMax) writer.bucketMax = m
      writer.bucketCount++
      if (writer.bucketCount >= writer.bucketFrames) {
        writer.pendingPeaks.push(Math.min(255, Math.round(Math.min(1, writer.bucketMax) * 255)))
        writer.bucketCount = 0
        writer.bucketMax = 0
      }
    }
  }

  private fail(runId: string, run: ActiveRun, err: Error): void {
    if (run.failed) return
    run.failed = true
    this.logger.error('runs', `write failed for ${runId}`, err)
    this.opts.onWriteError?.(runId, err)
  }

  private async flushPeaks(writer: TrackWriter): Promise<void> {
    if (writer.pendingPeaks.length === 0) return
    const chunk = Uint8Array.from(writer.pendingPeaks)
    writer.pendingPeaks = []
    await writer.peaksFh.write(chunk)
  }

  /**
   * Forces audio, peaks and the manifest to disk. Calls are chained, so the timer and `update`
   * never sync at the same time, and nothing is synced once the run is ending (its files are
   * about to be closed).
   */
  private sync(runId: string): Promise<void> {
    const run = this.active.get(runId)
    if (!run || run.failed || run.ending) return Promise.resolve()
    run.syncing = run.syncing.then(async () => {
      if (run.failed || run.ending) return
      try {
        for (const writer of run.tracks.values()) {
          await writer.queue
          await this.flushPeaks(writer)
          await writer.fh.datasync()
          await writer.peaksFh.datasync()
        }
        run.manifest.updatedAt = new Date().toISOString()
        await writeFileAtomic(join(run.dir, 'manifest.json'), JSON.stringify(run.manifest, null, 2))
      } catch (err) {
        this.fail(runId, run, err as Error)
      }
    })
    return run.syncing
  }

  async update(runId: string, patch: RunPatch): Promise<void> {
    const run = this.active.get(runId)
    if (!run) throw new Error('run is not active')
    if (patch.state) run.manifest.state = patch.state
    if (patch.pauseReason !== undefined) run.manifest.pauseReason = patch.pauseReason
    if (patch.markers) run.manifest.markers = patch.markers.map((m) => ({ id: m.id, timeMs: Math.max(0, m.timeMs) }))
    await this.sync(runId)
  }

  /**
   * Flushes and closes a run. The data stays on disk in the `stopped` state until saved or
   * discarded. With `interrupted`, the recording state is kept, so the run is offered as a
   * recovered recording (used when the recorder window crashed).
   */
  async end(runId: string, interrupted = false): Promise<RunEndResult> {
    const run = this.active.get(runId)
    if (!run || run.ending) throw new Error('run is not active')
    run.ending = true
    clearInterval(run.timer)
    // A periodic sync may still be using the files; closing them under it would report a
    // spurious write failure.
    await run.syncing
    let frames = Number.POSITIVE_INFINITY
    try {
      for (const writer of run.tracks.values()) {
        await writer.queue
        if (writer.bucketCount > 0) {
          writer.pendingPeaks.push(Math.min(255, Math.round(Math.min(1, writer.bucketMax) * 255)))
          writer.bucketCount = 0
          writer.bucketMax = 0
        }
        try {
          await this.flushPeaks(writer)
          await writer.fh.datasync()
          await writer.peaksFh.datasync()
        } catch (err) {
          this.fail(runId, run, err as Error)
        }
        await writer.fh.close().catch(() => undefined)
        await writer.peaksFh.close().catch(() => undefined)
        frames = Math.min(frames, writer.bytes / (4 * run.manifest.channels))
      }
      if (!Number.isFinite(frames)) frames = 0
      if (!interrupted) run.manifest.state = 'stopped'
      run.manifest.updatedAt = new Date().toISOString()
      await writeFileAtomic(join(run.dir, 'manifest.json'), JSON.stringify(run.manifest, null, 2))
    } finally {
      // Even when the manifest cannot be written (disk full), the files are closed: the run is
      // then listed from its last synced manifest and can still be recovered.
      this.active.delete(runId)
    }
    const durationMs = (frames / run.manifest.sampleRate) * 1000
    this.logger.info('runs', `end ${runId} duration=${Math.round(durationMs)}ms`)
    return { framesWritten: frames, durationMs }
  }

  /** Stops every active run (used when the app quits, or interrupted when the recorder crashed). */
  async endAll(interrupted = false): Promise<void> {
    for (const runId of [...this.active.keys()]) {
      try {
        await this.end(runId, interrupted)
      } catch (err) {
        this.logger.error('runs', `could not end ${runId}`, err)
      }
    }
  }

  async readManifest(runId: string): Promise<RunManifest | null> {
    const active = this.active.get(runId)
    if (active) return active.manifest
    const res = await readJson(join(this.runDir(runId), 'manifest.json'))
    if (res.status !== 'ok') return null
    const parsed = manifestSchema.safeParse(res.data)
    return parsed.success ? (parsed.data as RunManifest) : null
  }

  async setPhase(runId: string, state: RunPhase): Promise<void> {
    const m = await this.readManifest(runId)
    if (!m) throw new Error('run not found')
    m.state = state
    m.updatedAt = new Date().toISOString()
    await writeFileAtomic(join(this.runDir(runId), 'manifest.json'), JSON.stringify(m, null, 2))
  }

  /** Number of complete frames stored for a track; trims a torn last frame left by a crash. */
  async trackFrames(runId: string, track: TrackKind, channels: number, repair = false): Promise<number> {
    const p = this.trackPath(runId, track)
    try {
      const s = await stat(p)
      const frameBytes = 4 * channels
      const aligned = s.size - (s.size % frameBytes)
      if (repair && aligned !== s.size) await truncate(p, aligned)
      return aligned / frameBytes
    } catch {
      return 0
    }
  }

  /** Lists runs that are not active in this process: crashed ones and stopped-but-unsaved ones. */
  async listPending(): Promise<PendingRun[]> {
    let entries: string[] = []
    try {
      entries = await readdir(this.baseDir)
    } catch {
      return []
    }
    const out: PendingRun[] = []
    for (const name of entries) {
      if (!RUN_ID_PATTERN.test(name) || this.active.has(name)) continue
      const m = await this.readManifest(name)
      if (!m) {
        this.logger.warn('runs', `ignoring run directory without a valid manifest: ${name}`)
        continue
      }
      if (m.state === 'saved') {
        // A previous save finished but cleanup was interrupted.
        await this.discard(name).catch(() => undefined)
        continue
      }
      let frames = Number.POSITIVE_INFINITY
      let sizeBytes = 0
      for (const t of m.tracks) {
        const f = await this.trackFrames(name, t, m.channels)
        frames = Math.min(frames, f)
        sizeBytes += f * 4 * m.channels
      }
      if (!Number.isFinite(frames)) frames = 0
      out.push({
        runId: m.runId,
        sessionId: m.sessionId,
        sessionName: m.sessionName,
        startedAt: m.startedAt,
        durationMs: (frames / m.sampleRate) * 1000,
        sizeBytes,
        sampleRate: m.sampleRate,
        channels: m.channels,
        tracks: m.tracks,
        source: m.source,
        outputMode: m.outputMode,
        encoding: m.encoding,
        processing: m.processing,
        markers: m.markers,
        suggestedName: m.suggestedName,
        kind: m.state === 'recording' || m.state === 'paused' ? 'crashed' : 'unsaved'
      })
    }
    return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  /** Peaks for a stopped run. Recomputed from the raw data when the peaks file is incomplete. */
  async peaks(runId: string, track: TrackKind): Promise<Uint8Array> {
    const m = await this.readManifest(runId)
    if (!m || !m.tracks.includes(track)) throw new Error('track not found')
    const frames = await this.trackFrames(runId, track, m.channels)
    const expected = Math.ceil(frames / Math.max(1, Math.round(m.sampleRate / PEAKS_PER_SECOND)))
    try {
      const data = await readFile(this.peaksPath(runId, track))
      if (Math.abs(data.length - expected) <= 1) return new Uint8Array(data)
    } catch {
      /* recompute */
    }
    const peaks = await computePeaksFromRaw(this.trackPath(runId, track), m.channels, m.sampleRate)
    await writeFileAtomic(this.peaksPath(runId, track), peaks).catch(() => undefined)
    return peaks
  }

  async discard(runId: string): Promise<void> {
    if (this.active.has(runId)) throw new Error('run is active')
    await rm(this.runDir(runId), { recursive: true, force: true, maxRetries: 8, retryDelay: 120 })
    this.logger.info('runs', `discarded ${runId}`)
  }
}

/** Streams a raw float32 file and reduces it to one peak byte per 1/50 s. */
export async function computePeaksFromRaw(file: string, channels: number, sampleRate: number): Promise<Uint8Array> {
  const bucketFrames = Math.max(1, Math.round(sampleRate / PEAKS_PER_SECOND))
  const fh = await open(file, 'r')
  const peaks: number[] = []
  try {
    const frameBytes = 4 * channels
    const buf = Buffer.alloc(frameBytes * 65536)
    let count = 0
    let max = 0
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, null)
      if (bytesRead <= 0) break
      const usable = bytesRead - (bytesRead % frameBytes)
      for (let i = 0; i < usable; i += frameBytes) {
        for (let c = 0; c < channels; c++) {
          const v = Math.abs(buf.readFloatLE(i + c * 4))
          if (v > max) max = v
        }
        count++
        if (count >= bucketFrames) {
          peaks.push(Math.min(255, Math.round(Math.min(1, max) * 255)))
          count = 0
          max = 0
        }
      }
      if (usable < bytesRead) break
    }
    if (count > 0) peaks.push(Math.min(255, Math.round(Math.min(1, max) * 255)))
  } finally {
    await fh.close()
  }
  return Uint8Array.from(peaks)
}

/** Highest absolute sample value of a raw float32 file inside the given frame ranges. */
export async function rawPeak(file: string, channels: number, ranges: Array<{ start: number; end: number }> | null): Promise<number> {
  const fh = await open(file, 'r')
  const frameBytes = 4 * channels
  let peak = 0
  try {
    const size = (await fh.stat()).size
    const total = Math.floor(size / frameBytes)
    const list = ranges ?? [{ start: 0, end: total }]
    const buf = Buffer.alloc(frameBytes * 65536)
    for (const r of list) {
      let pos = Math.max(0, r.start)
      const end = Math.min(total, r.end)
      while (pos < end) {
        const frames = Math.min(65536, end - pos)
        const { bytesRead } = await fh.read(buf, 0, frames * frameBytes, pos * frameBytes)
        if (bytesRead <= 0) break
        for (let i = 0; i + 4 <= bytesRead; i += 4) {
          const v = Math.abs(buf.readFloatLE(i))
          if (v > peak) peak = v
        }
        pos += Math.floor(bytesRead / frameBytes)
      }
    }
  } finally {
    await fh.close()
  }
  return peak
}
