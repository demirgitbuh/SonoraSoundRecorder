import { describe, expect, it } from 'vitest'
import {
  SettingsImportError,
  applySettingsPatch,
  buildSettingsExport,
  defaultSettings,
  mergeImported,
  parseSettingsExport
} from '../src/shared/settings'

function localSettings() {
  return applySettingsPatch(defaultSettings(), {
    language: 'en',
    onboardingCompleted: true,
    files: { recordingsDir: '/home/me/Recordings' },
    transcription: { modelPath: '/home/me/models/ggml-small.bin' },
    audio: { defaultMicDeviceId: 'local-mic' }
  })
}

function foreignExport(): string {
  const other = applySettingsPatch(defaultSettings(), {
    language: 'de',
    theme: 'dark',
    recording: { countdownSeconds: 3, defaultFormat: 'flac' },
    files: { recordingsDir: 'D:\\Aufnahmen', layout: 'by-date' },
    transcription: { modelPath: 'D:\\models\\ggml-medium.bin', language: 'de' },
    audio: { defaultMicDeviceId: 'foreign-mic', noiseSuppression: true },
    sessions: [
      {
        id: 's1',
        name: 'Studio',
        source: 'both',
        micDeviceId: 'foreign-mic',
        systemDeviceId: null,
        micLevel: 1.2,
        systemLevel: 0.8,
        monitor: false,
        monitorLevel: 0.5,
        outputMode: 'separate',
        format: 'flac',
        qualityProfile: 'high',
        custom: { sampleRate: 48000, channels: 2, bitDepth: 24, bitrateKbps: 192, flacCompression: 5 }
      }
    ],
    selectedSessionId: 's1'
  })
  return JSON.stringify(buildSettingsExport(other, '0.1.0', new Date('2026-05-01T00:00:00Z')))
}

describe('settings export and import', () => {
  it('exports a versioned, portable file without window state', () => {
    const file = buildSettingsExport(localSettings(), '0.1.0', new Date())
    expect(file.app).toBe('sonora-sound-recorder')
    expect(file.kind).toBe('settings')
    expect('window' in file.settings).toBe(false)
    expect('onboardingCompleted' in file.settings).toBe(false)
  })

  it('reports machine specific values separately', () => {
    const parsed = parseSettingsExport(foreignExport())
    const keys = parsed.machineFields.map((f) => [f.key, f.value])
    expect(keys).toContainEqual(['files.recordingsDir', 'D:\\Aufnahmen'])
    expect(keys).toContainEqual(['transcription.modelPath', 'D:\\models\\ggml-medium.bin'])
    expect(keys).toContainEqual(['audio.defaultMicDeviceId', 'foreign-mic'])
    expect(keys).toContainEqual(['sessions.devices', 'foreign-mic'])
  })

  it('never applies folder, device or model paths from another computer unless accepted', () => {
    const parsed = parseSettingsExport(foreignExport())
    const merged = mergeImported(localSettings(), parsed.imported, [])
    expect(merged.files.recordingsDir).toBe('/home/me/Recordings')
    expect(merged.transcription.modelPath).toBe('/home/me/models/ggml-small.bin')
    expect(merged.audio.defaultMicDeviceId).toBe('local-mic')
    expect(merged.sessions[0]!.micDeviceId).toBeNull()
    // Portable preferences are applied.
    expect(merged.language).toBe('de')
    expect(merged.recording.countdownSeconds).toBe(3)
    expect(merged.recording.defaultFormat).toBe('flac')
    expect(merged.files.layout).toBe('by-date')
    expect(merged.sessions[0]!.name).toBe('Studio')
    expect(merged.onboardingCompleted).toBe(true)
  })

  it('applies accepted machine values', () => {
    const parsed = parseSettingsExport(foreignExport())
    const merged = mergeImported(localSettings(), parsed.imported, ['files.recordingsDir', 'sessions.devices'])
    expect(merged.files.recordingsDir).toBe('D:\\Aufnahmen')
    expect(merged.sessions[0]!.micDeviceId).toBe('foreign-mic')
    expect(merged.transcription.modelPath).toBe('/home/me/models/ggml-small.bin')
  })

  it('rejects invalid input with a translated reason', () => {
    const reason = (json: string): string => {
      try {
        parseSettingsExport(json)
        return 'none'
      } catch (e) {
        return e instanceof SettingsImportError ? e.reasonKey : 'other'
      }
    }
    expect(reason('not json')).toBe('settings.import.errorNotJson')
    expect(reason('{"app":"something-else"}')).toBe('settings.import.errorNotSonora')
    const future = JSON.parse(foreignExport())
    future.schemaVersion = 99
    expect(reason(JSON.stringify(future))).toBe('settings.import.errorTooNew')
  })
})
