import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chromiumBootFlags,
  dbToLinear,
  defaultDeveloper,
  effectiveDeveloper,
  formatCommand,
  parseFeatureList,
  whisperExtraArgs
} from '../src/shared/developer'
import type { DeveloperSettings } from '../src/shared/developer'
import { applyProfile, applySettingsPatch, defaultSettings, mergeImported, parseSettings, resetAll, resetCategory, toPortable } from '../src/shared/settings'
import type { SettingsProfile } from '../src/shared/settings'
import { readDeveloperSettingsSync, sameBootFlags } from '../src/main/services/boot-flags'
import { checkBinary, clearTempDir, storageReport } from '../src/main/services/dev-tools'
import { Logger } from '../src/main/services/logger'
import { RunStore } from '../src/main/services/run-store'
import type { RunInit } from '../src/shared/ipc'
import { RUN_A, sine, tempDir, testLogger } from './helpers'

const PLATFORM = ['MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride']

function dev(patch: Partial<DeveloperSettings> = {}): DeveloperSettings {
  return { ...defaultDeveloper(), enabled: true, ...patch }
}

describe('developer settings', () => {
  it('start disabled with safe defaults, also for settings written by 0.1', () => {
    const d = defaultSettings().developer
    expect(d.enabled).toBe(false)
    expect(d.audio).toEqual({ latencyHint: 'interactive', chunkFrames: 4096, sendIntervalMs: 250, meterHz: 30, clipThresholdDb: -0.01, dataTimeoutMs: 4000 })
    expect(d.storage.syncIntervalMs).toBe(2000)
    expect(d.binaries).toEqual({ ffmpeg: null, ffprobe: null, whisper: null })
    const { settings } = parseSettings({ schemaVersion: 1, language: 'tr', onboardingCompleted: true })
    expect(settings.developer).toEqual(defaultDeveloper())
    expect(settings.language).toBe('tr')
  })

  it('fall back field by field for invalid values', () => {
    const s = applySettingsPatch(defaultSettings(), {
      developer: { enabled: true, audio: { chunkFrames: 3000 as never, meterHz: 999, sendIntervalMs: 500 }, logging: { level: 'loud' as never } }
    })
    expect(s.developer.enabled).toBe(true)
    expect(s.developer.audio.chunkFrames).toBe(4096)
    expect(s.developer.audio.meterHz).toBe(30)
    expect(s.developer.audio.sendIntervalMs).toBe(500)
    expect(s.developer.logging.level).toBe('info')
  })

  it('have no effect while developer mode is off', () => {
    const configured: DeveloperSettings = { ...dev(), enabled: false, audio: { ...defaultDeveloper().audio, chunkFrames: 16384 } }
    expect(effectiveDeveloper(configured)).toEqual(defaultDeveloper())
    expect(effectiveDeveloper({ ...configured, enabled: true }).audio.chunkFrames).toBe(16384)
  })

  it('are reset as a category without turning developer mode off', () => {
    const s = applySettingsPatch(defaultSettings(), { developer: { enabled: true, audio: { meterHz: 60 }, binaries: { ffmpeg: '/opt/ffmpeg' } } })
    const r = resetCategory(s, 'developer', 'light')
    expect(r.developer).toEqual({ ...defaultDeveloper(), enabled: true })
    expect(resetAll(s, 'light').developer.enabled).toBe(false)
  })

  it('never take executable paths or Chromium switches from imported files or profiles', () => {
    const local = applySettingsPatch(defaultSettings(), {
      developer: { enabled: true, binaries: { ffmpeg: '/local/ffmpeg' }, chromium: { hardwareAcceleration: true } }
    })
    const imported = applySettingsPatch(defaultSettings(), {
      developer: { enabled: true, audio: { meterHz: 50 }, binaries: { ffmpeg: '/other/ffmpeg', whisper: '/other/whisper' }, chromium: { hardwareAcceleration: false, enableFeatures: 'Foo' } }
    })
    const merged = mergeImported(local, imported, [])
    expect(merged.developer.audio.meterHz).toBe(50)
    expect(merged.developer.binaries).toEqual({ ffmpeg: '/local/ffmpeg', ffprobe: null, whisper: null })
    expect(merged.developer.chromium).toEqual(local.developer.chromium)

    const profile: SettingsProfile = { id: 'p', name: 'P', createdAt: '', settings: toPortable(imported) }
    const applied = applyProfile(local, profile)
    expect(applied.developer.audio.meterHz).toBe(50)
    expect(applied.developer.binaries.ffmpeg).toBe('/local/ffmpeg')
    expect(applied.developer.chromium.hardwareAcceleration).toBe(true)
  })
})

describe('developer helpers', () => {
  it('parse Chromium feature lists and reject invalid names', () => {
    expect(parseFeatureList('')).toEqual({ valid: [], invalid: [] })
    expect(parseFeatureList(' FeatureA, FeatureB  FeatureA\nBad-Name,2x ')).toEqual({ valid: ['FeatureA', 'FeatureB'], invalid: ['Bad-Name', '2x'] })
  })

  it('build the Chromium switches applied at startup', () => {
    expect(chromiumBootFlags(defaultDeveloper(), PLATFORM)).toEqual({ hardwareAcceleration: true, enableFeatures: PLATFORM, disableFeatures: [] })
    // Configured values are ignored while developer mode is off.
    const off = { ...dev({ chromium: { hardwareAcceleration: false, platformFlags: false, enableFeatures: 'X', disableFeatures: '' } }), enabled: false }
    expect(chromiumBootFlags(off, PLATFORM)).toEqual({ hardwareAcceleration: true, enableFeatures: PLATFORM, disableFeatures: [] })
    const on = dev({ chromium: { hardwareAcceleration: false, platformFlags: true, enableFeatures: 'Extra, MacSckSystemAudioLoopbackOverride', disableFeatures: 'Extra' } })
    expect(chromiumBootFlags(on, PLATFORM)).toEqual({ hardwareAcceleration: false, enableFeatures: PLATFORM, disableFeatures: ['Extra'] })
    const noPlatform = dev({ chromium: { hardwareAcceleration: true, platformFlags: false, enableFeatures: 'Mine', disableFeatures: '' } })
    expect(chromiumBootFlags(noPlatform, PLATFORM).enableFeatures).toEqual(['Mine'])
    expect(sameBootFlags(chromiumBootFlags(on, PLATFORM), chromiumBootFlags(on, PLATFORM))).toBe(true)
    expect(sameBootFlags(chromiumBootFlags(on, PLATFORM), chromiumBootFlags(defaultDeveloper(), PLATFORM))).toBe(false)
  })

  it('pass only non-default whisper options, using flags that exist in whisper-cli', () => {
    expect(whisperExtraArgs(defaultDeveloper().whisper)).toEqual([])
    const w = {
      ...defaultDeveloper().whisper,
      beamSize: 5,
      bestOf: 3,
      temperature: 0.2,
      maxLen: 60,
      maxContext: 0,
      prompt: 'Sonora,\nFFmpeg',
      translate: true,
      splitOnWord: true,
      noFallback: true,
      suppressNonSpeech: true,
      useGpu: false,
      flashAttention: false
    }
    expect(whisperExtraArgs(w)).toEqual([
      '-bs', '5', '-bo', '3', '-tp', '0.2', '-ml', '60', '-mc', '0', '--prompt', 'Sonora, FFmpeg', '-tr', '-sow', '-nf', '-sns', '-ng', '-nfa'
    ])
  })

  it('format command lines with quoting', () => {
    expect(formatCommand('whisper-cli', ['-m', '/models/a b.bin', '--prompt', 'say "hi"', ''])).toBe('whisper-cli -m "/models/a b.bin" --prompt "say \\"hi\\"" ""')
  })

  it('convert the clip threshold from dBFS', () => {
    expect(dbToLinear(0)).toBe(1)
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 3)
  })
})

describe('developer services', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('reads the developer settings before the app is ready, falling back safely', () => {
    expect(readDeveloperSettingsSync(dir)).toEqual(defaultDeveloper())
    writeFileSync(join(dir, 'settings.json'), '{ broken')
    writeFileSync(join(dir, 'settings.json.bak'), JSON.stringify({ developer: { enabled: true, chromium: { hardwareAcceleration: false } } }))
    const d = readDeveloperSettingsSync(dir)
    expect(d.enabled).toBe(true)
    expect(d.chromium.hardwareAcceleration).toBe(false)
    expect(d.chromium.platformFlags).toBe(true)
  })

  it('keeps recent log entries, filters by level and notifies listeners', () => {
    const logger = new Logger(join(dir, 'logs'))
    const seen: string[] = []
    const off = logger.subscribe((e) => seen.push(`${e.level}:${e.message}`))
    logger.debug('t', 'hidden at info')
    logger.info('t', 'one')
    logger.setLevel('warn')
    logger.info('t', 'hidden at warn')
    logger.warn('t', 'two')
    logger.setLevel('error')
    logger.error('t', 'three')
    logger.setLevel('debug')
    logger.debug('t', 'four')
    off()
    logger.info('t', 'after unsubscribe')
    expect(seen).toEqual(['info:one', 'warn:two', 'error:three', 'debug:four'])
    expect(logger.recent().map((e) => e.message)).toEqual(['one', 'two', 'three', 'four', 'after unsubscribe'])
    const file = readFileSync(join(dir, 'logs', 'sonora.log'), 'utf8')
    expect(file).not.toContain('hidden')
    const seqs = logger.recent().map((e) => e.seq)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
  })

  it('offers runs of a crashed recorder window as recovered recordings', async () => {
    const init: RunInit = {
      runId: RUN_A,
      sessionId: 's',
      sessionName: 'Session',
      sampleRate: 48000,
      channels: 2,
      source: 'mic',
      outputMode: 'combined',
      tracks: ['mic'],
      encoding: { format: 'wav', sampleRate: 48000, channels: 2, bitDepth: 24, bitrateKbps: 0, flacCompression: 5 },
      processing: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
      devices: { mic: null, system: null },
      startedAt: '2026-10-15T10:00:00.000Z'
    }
    const store = new RunStore(join(dir, 'sessions'), testLogger(dir), { syncIntervalMs: () => 500 })
    await store.begin(init)
    store.write(RUN_A, 'mic', sine(4800, 2, 48000).buffer as ArrayBuffer)
    await store.endAll(true)
    expect(store.activeCount()).toBe(0)
    const pending = await store.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.kind).toBe('crashed')
    expect(pending[0]!.durationMs).toBe(100)
  })

  it('reports storage sizes and clears temporary files except active work folders', async () => {
    const tmp = join(dir, 'tmp')
    mkdirSync(join(tmp, 'transcribe-active'), { recursive: true })
    mkdirSync(join(tmp, 'transcribe-old'), { recursive: true })
    writeFileSync(join(tmp, 'transcribe-active', 'input.wav'), Buffer.alloc(100))
    writeFileSync(join(tmp, 'transcribe-old', 'input.wav'), Buffer.alloc(300))
    writeFileSync(join(tmp, 'stray.bin'), Buffer.alloc(50))
    const report = await storageReport([
      { id: 'temp', path: tmp },
      { id: 'missing', path: join(dir, 'nope.json') }
    ])
    expect(report[0]).toMatchObject({ id: 'temp', bytes: 450, files: 3, exists: true })
    expect(report[1]).toMatchObject({ id: 'missing', exists: false })
    const res = await clearTempDir(tmp, [join(tmp, 'transcribe-active')])
    expect(res).toEqual({ removed: 2, bytes: 350, skipped: 1 })
    expect((await storageReport([{ id: 'temp', path: tmp }]))[0]!.bytes).toBe(100)
  })

  it('rejects files that are not working executables', async () => {
    const fake = join(dir, 'ffmpeg-fake.txt')
    writeFileSync(fake, 'not a program')
    expect(await checkBinary('ffmpeg', fake)).toEqual({ ok: false, version: null })
    expect(await checkBinary('whisper', join(dir, 'missing'))).toEqual({ ok: false, version: null })
  })
})
