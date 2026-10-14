/**
 * End-to-end audio tests against the real FFmpeg/FFprobe binaries that are bundled with the app
 * (downloaded by `npm run fetch:ffmpeg`). They run in CI; locally they are skipped when the
 * binaries are not present.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AUDIO_FORMATS } from '../src/shared/types'
import type { AudioFormat, TrackKind } from '../src/shared/types'
import type { RunInit } from '../src/shared/ipc'
import { DEFAULT_CUSTOM_ENCODING, resolveEncoding } from '../src/shared/formats'
import { Ffmpeg } from '../src/main/services/ffmpeg'
import { LibraryStore } from '../src/main/services/library-store'
import { RunStore } from '../src/main/services/run-store'
import { AudioService, sniffBytes } from '../src/main/services/audio-service'
import { sine, tempDir, testLogger } from './helpers'

const OS = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
const binDir = join(__dirname, '..', 'vendor', 'bin', `${OS}-${process.arch}`)
const exe = (n: string): string => join(binDir, process.platform === 'win32' ? `${n}.exe` : n)
const available = existsSync(exe('ffmpeg')) && existsSync(exe('ffprobe'))

let counter = 0
function runId(): string {
  counter++
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(counter).padStart(12, '0')}`
}

describe.skipIf(!available)('real audio processing with the bundled FFmpeg', () => {
  let dir: string
  let cleanup: () => void
  let ffmpeg: Ffmpeg
  let library: LibraryStore
  let runs: RunStore
  let audio: AudioService

  beforeAll(async () => {
    ;({ dir, cleanup } = tempDir('sonora-ffmpeg-'))
    const logger = testLogger(dir)
    ffmpeg = new Ffmpeg(exe('ffmpeg'), exe('ffprobe'), logger)
    library = new LibraryStore({ dataDir: join(dir, 'data'), platform: 'linux', logger, recordingsDir: () => join(dir, 'rec'), layout: () => 'flat' })
    await library.load()
    runs = new RunStore(join(dir, 'sessions'), logger)
    audio = new AudioService({ ffmpeg, library, runs, logger, recordingsDir: () => join(dir, 'rec') })
  })
  afterAll(() => cleanup())

  async function recordRun(opts: { seconds: number; channels?: 1 | 2; tracks?: TrackKind[]; source?: RunInit['source']; outputMode?: RunInit['outputMode']; amp?: number }): Promise<string> {
    const id = runId()
    const channels = opts.channels ?? 2
    const tracks = opts.tracks ?? ['mic']
    await runs.begin({
      runId: id,
      sessionId: 's',
      sessionName: 'Session',
      sampleRate: 48000,
      channels,
      source: opts.source ?? 'mic',
      outputMode: opts.outputMode ?? 'combined',
      tracks,
      encoding: { format: 'wav', sampleRate: 48000, channels, bitDepth: 24, bitrateKbps: 0, flacCompression: 5 },
      processing: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
      devices: { mic: null, system: null },
      startedAt: new Date(2026, 9, 14, 15, 30, counter % 60).toISOString()
    })
    const frames = Math.round(opts.seconds * 48000)
    for (const t of tracks) {
      for (let off = 0; off < frames; off += 4800) {
        runs.write(id, t, sine(Math.min(4800, frames - off), channels, 48000, t === 'system' ? 660 : 440, opts.amp ?? 0.5).buffer as ArrayBuffer)
      }
    }
    await runs.end(id)
    return id
  }

  const EXPECT: Record<AudioFormat, { codec: RegExp; container: RegExp }> = {
    wav: { codec: /^pcm_s24le$/, container: /wav/ },
    flac: { codec: /^flac$/, container: /flac/ },
    mp3: { codec: /^mp3$/, container: /mp3/ },
    opus: { codec: /^opus$/, container: /ogg/ },
    aac: { codec: /^aac$/, container: /mp4|m4a|mov/ }
  }

  for (const format of AUDIO_FORMATS) {
    it(`saves a real ${format} file with the requested settings`, async () => {
      const id = await recordRun({ seconds: 2 })
      const encoding = resolveEncoding(format, 'high', DEFAULT_CUSTOM_ENCODING)
      const [rec] = await audio.saveRun(id, { name: null, encoding, keep: null, saveMode: 'edited-only', markers: [{ id: 'm', timeMs: 900 }], normalize: false })
      expect(rec).toBeDefined()
      expect(existsSync(rec!.filePath)).toBe(true)
      expect(rec!.name).toMatch(/^Sonora_2026-10-14_15-30-\d{2}(_\d+)?$/)
      const probe = await ffmpeg.probe(rec!.filePath)
      expect(probe.audio?.codecName).toMatch(EXPECT[format].codec)
      expect(probe.formatName).toMatch(EXPECT[format].container)
      expect(probe.audio?.sampleRate).toBe(48000)
      expect(probe.audio?.channels).toBe(2)
      expect(Math.abs(rec!.durationMs - 2000)).toBeLessThan(80)
      expect(rec!.markers).toEqual([{ id: 'm', timeMs: 900 }])
      expect(existsSync(runs.runDir(id))).toBe(false)
      expect(library.get(rec!.id).format).toBe(format)
    })
  }

  it('stores 24-bit FLAC as 24 bits', async () => {
    const id = await recordRun({ seconds: 1 })
    const [rec] = await audio.saveRun(id, {
      name: 'flac24',
      encoding: resolveEncoding('flac', 'high', DEFAULT_CUSTOM_ENCODING),
      keep: null,
      saveMode: 'edited-only',
      markers: [],
      normalize: false
    })
    const probe = await ffmpeg.probe(rec!.filePath)
    expect(probe.audio?.bitsPerRawSample).toBe(24)
  })

  it('trims and cuts sample-accurately and remaps markers', async () => {
    const id = await recordRun({ seconds: 4 })
    const keep = [
      { startMs: 500, endMs: 1500 },
      { startMs: 2500, endMs: 3500 }
    ]
    const [rec] = await audio.saveRun(id, {
      name: 'edited',
      encoding: resolveEncoding('wav', 'standard', DEFAULT_CUSTOM_ENCODING),
      keep,
      saveMode: 'edited-only',
      markers: [
        { id: 'a', timeMs: 1000 },
        { id: 'b', timeMs: 2000 },
        { id: 'c', timeMs: 3000 }
      ],
      normalize: false
    })
    const probe = await ffmpeg.probe(rec!.filePath)
    expect(Math.abs(probe.durationMs - 2000)).toBeLessThan(2)
    expect(rec!.markers).toEqual([
      { id: 'a', timeMs: 500 },
      { id: 'c', timeMs: 1500 }
    ])
  })

  it('“new copy” on a preview keeps the full recording and adds an edited copy', async () => {
    const id = await recordRun({ seconds: 2 })
    const recs = await audio.saveRun(id, {
      name: 'both',
      encoding: resolveEncoding('wav', 'standard', DEFAULT_CUSTOM_ENCODING),
      keep: [{ startMs: 0, endMs: 1000 }],
      saveMode: 'original-and-edited',
      markers: [],
      normalize: false
    })
    expect(recs.map((r) => r.name)).toEqual(['both', 'both_edited'])
    expect(Math.abs(recs[0]!.durationMs - 2000)).toBeLessThan(5)
    expect(Math.abs(recs[1]!.durationMs - 1000)).toBeLessThan(5)
  })

  it('writes separate files for microphone and system audio plus a mix', async () => {
    const id = await recordRun({ seconds: 1, source: 'both', outputMode: 'both', tracks: ['mix', 'mic', 'system'] })
    const recs = await audio.saveRun(id, {
      name: 'call',
      encoding: resolveEncoding('flac', 'standard', DEFAULT_CUSTOM_ENCODING),
      keep: null,
      saveMode: 'edited-only',
      markers: [],
      normalize: false
    })
    expect(recs.map((r) => r.name)).toEqual(['call', 'call_mic', 'call_system'])
    expect(recs.map((r) => r.part)).toEqual(['combined', 'mic', 'system'])
    expect(new Set(recs.map((r) => r.groupId)).size).toBe(1)
    expect(recs[0]!.groupId).not.toBeNull()
  })

  it('normalizes the loudest peak to about −1 dBFS only when asked', async () => {
    const quiet = await recordRun({ seconds: 1, amp: 0.25 })
    const [plain] = await audio.saveRun(quiet, { name: 'quiet', encoding: resolveEncoding('wav', 'high', DEFAULT_CUSTOM_ENCODING), keep: null, saveMode: 'edited-only', markers: [], normalize: false })
    const loud = await recordRun({ seconds: 1, amp: 0.25 })
    const [norm] = await audio.saveRun(loud, { name: 'norm', encoding: resolveEncoding('wav', 'high', DEFAULT_CUSTOM_ENCODING), keep: null, saveMode: 'edited-only', markers: [], normalize: true })
    const plainDb = await ffmpeg.maxVolumeDb(plain!.filePath)
    const normDb = await ffmpeg.maxVolumeDb(norm!.filePath)
    expect(plainDb!).toBeCloseTo(-12, 0)
    expect(normDb!).toBeGreaterThan(-1.6)
    expect(normDb!).toBeLessThanOrEqual(-0.4)
    expect(norm!.processing.normalized).toBe(true)
    expect(plain!.processing.normalized).toBe(false)
  })

  it('imports by content, not by extension, and rejects fake files', async () => {
    const id = await recordRun({ seconds: 1 })
    const [rec] = await audio.saveRun(id, { name: 'src', encoding: resolveEncoding('wav', 'standard', DEFAULT_CUSTOM_ENCODING), keep: null, saveMode: 'edited-only', markers: [], normalize: false })
    const disguised = join(dir, 'disguised.mp3')
    copyFileSync(rec!.filePath, disguised)
    const fake = join(dir, 'fake.mp3')
    writeFileSync(fake, 'this is not audio at all, just some text that is long enough to be read as a header')
    const res = await audio.importFiles([disguised, fake])
    expect(res.results[0]!.ok).toBe(true)
    expect(res.results[0]!.outputPath!.endsWith('.wav')).toBe(true)
    expect(res.results[1]).toMatchObject({ ok: false, errorKey: 'errors.unsupportedFile' })
    const imported = library.get(res.results[0]!.id)
    expect(imported.source).toBe('imported')
    expect(imported.imported?.originalPath).toBe(disguised)
    expect(existsSync(disguised)).toBe(true)
  })

  it('edits an archived recording as a new copy or by replacing the original safely', async () => {
    const id = await recordRun({ seconds: 3 })
    const [rec] = await audio.saveRun(id, { name: 'archive', encoding: resolveEncoding('flac', 'standard', DEFAULT_CUSTOM_ENCODING), keep: null, saveMode: 'edited-only', markers: [{ id: 'x', timeMs: 2500 }], normalize: false })
    const copy = await audio.applyEdit(rec!.id, { keep: [{ startMs: 1000, endMs: 3000 }], mode: 'copy', markers: [{ id: 'x', timeMs: 2500 }] })
    expect(copy.id).not.toBe(rec!.id)
    expect(copy.name).toBe('archive_edited')
    expect(Math.abs(copy.durationMs - 2000)).toBeLessThan(20)
    expect(copy.markers).toEqual([{ id: 'x', timeMs: 1500 }])
    expect(Math.abs(library.get(rec!.id).durationMs - 3000)).toBeLessThan(20)

    const before = readFileSync(rec!.filePath).length
    const replaced = await audio.applyEdit(rec!.id, { keep: [{ startMs: 0, endMs: 1000 }], mode: 'replace', markers: [] })
    expect(replaced.id).toBe(rec!.id)
    expect(Math.abs(replaced.durationMs - 1000)).toBeLessThan(20)
    expect(readFileSync(rec!.filePath).length).toBeLessThan(before)
    const probe = await ffmpeg.probe(rec!.filePath)
    expect(probe.audio?.codecName).toBe('flac')
  })

  it('exports to another format next to the original without overwriting', async () => {
    const id = await recordRun({ seconds: 1 })
    const [rec] = await audio.saveRun(id, { name: 'exportme', encoding: resolveEncoding('wav', 'standard', DEFAULT_CUSTOM_ENCODING), keep: null, saveMode: 'edited-only', markers: [], normalize: false })
    const out = join(dir, 'exports')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(out, { recursive: true })
    const first = await audio.exportRecordings([rec!.id], { format: 'mp3', profile: 'standard', custom: DEFAULT_CUSTOM_ENCODING, normalize: false }, out)
    const second = await audio.exportRecordings([rec!.id], { format: 'mp3', profile: 'standard', custom: DEFAULT_CUSTOM_ENCODING, normalize: false }, out)
    expect(first.results[0]!.outputPath).toBe(join(out, 'exportme.mp3'))
    expect(second.results[0]!.outputPath).toBe(join(out, 'exportme_2.mp3'))
    const probe = await ffmpeg.probe(first.results[0]!.outputPath!)
    expect(probe.audio?.codecName).toBe('mp3')
  })

  it('decodes peaks for the waveform from real files', async () => {
    const id = await recordRun({ seconds: 2 })
    const [rec] = await audio.saveRun(id, { name: 'peaks', encoding: resolveEncoding('mp3', 'standard', DEFAULT_CUSTOM_ENCODING), keep: null, saveMode: 'edited-only', markers: [], normalize: false })
    const peaks = await library.readPeaks(rec!.id)
    expect(peaks).not.toBeNull()
    expect(Math.abs(peaks!.length - 100)).toBeLessThanOrEqual(3)
  })
})

describe('content sniffing', () => {
  const bytes = (s: string, extra: number[] = []): Uint8Array => Uint8Array.from([...Buffer.from(s, 'latin1'), ...extra])
  it('recognizes containers from their first bytes', () => {
    expect(sniffBytes(bytes('RIFF\0\0\0\0WAVEfmt '))).toBe('wav')
    expect(sniffBytes(bytes('fLaC\0\0\0\0\0\0\0\0'))).toBe('flac')
    expect(sniffBytes(bytes('OggS\0\0\0\0\0\0\0\0'))).toBe('ogg')
    expect(sniffBytes(bytes('\0\0\0\x20ftypM4A '))).toBe('mp4')
    expect(sniffBytes(bytes('ID3\x04\0\0\0\0\0\0\0\0'))).toBe('id3')
    expect(sniffBytes(Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('mp3')
    expect(sniffBytes(bytes('hello world, text'))).toBeNull()
  })
})
