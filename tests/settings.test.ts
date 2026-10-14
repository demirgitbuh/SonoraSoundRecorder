import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SETTINGS_SCHEMA_VERSION,
  applySettingsPatch,
  defaultSettings,
  parseSettings,
  resetAll,
  resetCategory,
  runMigrations
} from '../src/shared/settings'
import { DEFAULT_BINDINGS } from '../src/shared/shortcuts'
import { SettingsStore } from '../src/main/services/settings-store'
import { tempDir, testLogger } from './helpers'

describe('settings defaults', () => {
  it('match the approved product defaults', () => {
    const s = defaultSettings()
    expect(s.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
    expect(s.recording.defaultSource).toBe('mic')
    expect(s.recording.defaultFormat).toBe('wav')
    expect(s.recording.defaultProfile).toBe('high')
    expect(s.recording.defaultCustom.sampleRate).toBe(48000)
    expect(s.recording.defaultCustom.channels).toBe(2)
    expect(s.recording.postAction).toBe('preview')
    expect(s.recording.countdownSeconds).toBe(0)
    expect(s.launchAtLogin).toBe(false)
    expect(s.audio.noiseSuppression).toBe(false)
    expect(s.audio.echoCancellation).toBe(false)
    expect(s.audio.autoGainControl).toBe(false)
    expect(s.export.normalize).toBe(false)
    expect(s.shortcuts.scope).toBe('global')
    expect(s.shortcuts.bindings).toEqual(DEFAULT_BINDINGS)
    expect(DEFAULT_BINDINGS).toEqual({ toggleRecord: 'K', togglePause: 'Space', addMarker: 'L' })
    expect(s.archive.view).toBe('list')
    expect(s.language).toBeNull()
    expect(s.onboardingCompleted).toBe(false)
  })

  it('invalid values fall back per field without losing valid ones', () => {
    const { settings } = parseSettings({
      schemaVersion: 1,
      language: 'tr',
      uiScale: 99,
      theme: 'purple',
      recording: { countdownSeconds: 7, postAction: 'autosave', defaultFormat: 'xyz' },
      files: { recordingsDir: '/music/sonora', layout: 'by-date' }
    })
    expect(settings.language).toBe('tr')
    expect(settings.uiScale).toBe(1)
    expect(settings.theme).toBe('light')
    expect(settings.recording.countdownSeconds).toBe(0)
    expect(settings.recording.postAction).toBe('autosave')
    expect(settings.recording.defaultFormat).toBe('wav')
    expect(settings.files.recordingsDir).toBe('/music/sonora')
    expect(settings.files.layout).toBe('by-date')
  })

  it('patches deeply and validates the result', () => {
    const s = applySettingsPatch(defaultSettings(), { recording: { countdownSeconds: 5 }, notifications: { scope: 'errors' } })
    expect(s.recording.countdownSeconds).toBe(5)
    expect(s.recording.postAction).toBe('preview')
    expect(s.notifications.scope).toBe('errors')
    expect(s.notifications.desktop).toBe(true)
  })
})

describe('schema migrations', () => {
  it('migrates an unversioned pre-release file and keeps user values', () => {
    const { settings, outcome } = parseSettings({ language: 'de', shortcutScope: 'app', theme: 'dark' })
    expect(outcome.fromVersion).toBe(0)
    expect(outcome.migrated).toBe(true)
    expect(settings.shortcuts.scope).toBe('app')
    expect(settings.language).toBe('de')
    expect(settings.theme).toBe('dark')
    expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION)
  })

  it('runs every step in order exactly once', () => {
    const calls: number[] = []
    const out = runMigrations({ schemaVersion: 1, a: 1 }, 4, {
      1: (d) => (calls.push(1), { ...d, b: 2 }),
      2: (d) => (calls.push(2), { ...d, c: (d.b as number) + 1 }),
      3: (d) => (calls.push(3), d)
    })
    expect(calls).toEqual([1, 2, 3])
    expect(out.data).toMatchObject({ a: 1, b: 2, c: 3, schemaVersion: 4 })
  })

  it('flags files from a newer version instead of migrating them', () => {
    const out = runMigrations({ schemaVersion: 9 }, 1, {})
    expect(out.tooNew).toBe(true)
    expect(out.migrated).toBe(false)
  })
})

describe('settings store persistence', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('first run follows the OS theme and later launches keep the choice', async () => {
    const a = new SettingsStore(dir, testLogger(dir))
    const first = await a.load('dark')
    expect(first.firstRun).toBe(true)
    expect(a.value.theme).toBe('dark')
    expect(a.value.sessions.length).toBe(1)
    a.update({ theme: 'light', language: 'fr' })
    await a.flush()

    const b = new SettingsStore(dir, testLogger(dir))
    const second = await b.load('dark')
    expect(second.firstRun).toBe(false)
    expect(b.value.theme).toBe('light')
    expect(b.value.language).toBe('fr')
    expect(b.value.selectedSessionId).toBe(b.value.sessions[0]!.id)
  })

  it('writes atomically and recovers from a corrupt file using the backup', async () => {
    const a = new SettingsStore(dir, testLogger(dir))
    await a.load('light')
    a.update({ language: 'ru' })
    await a.flush()
    // A second load refreshes the .bak copy from the good file.
    const b = new SettingsStore(dir, testLogger(dir))
    await b.load('light')
    writeFileSync(join(dir, 'settings.json'), '{"language": "tr", broken')
    const c = new SettingsStore(dir, testLogger(dir))
    const res = await c.load('light')
    expect(res.firstRun).toBe(false)
    expect(c.value.language).toBe('ru')
  })

  it('keeps a copy of a settings file written by a newer version', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ schemaVersion: 7, language: 'zh' }))
    const s = new SettingsStore(dir, testLogger(dir))
    await s.load('light')
    expect(s.value.language).toBe('zh')
    expect(JSON.parse(readFileSync(join(dir, 'settings.v7.json'), 'utf8')).schemaVersion).toBe(7)
  })

  it('saves, applies and deletes named profiles', async () => {
    const s = new SettingsStore(dir, testLogger(dir))
    await s.load('light')
    s.update({ recording: { countdownSeconds: 10 } })
    s.saveProfile('Interviews')
    s.update({ recording: { countdownSeconds: 0 } })
    const id = s.profiles()[0]!.id
    expect(s.applyProfile(id)?.recording.countdownSeconds).toBe(10)
    expect(s.deleteProfile(id)).toEqual([])
  })
})

describe('resetting settings', () => {
  const custom = applySettingsPatch(defaultSettings(), {
    language: 'tr',
    onboardingCompleted: true,
    theme: 'dark',
    uiScale: 1.5,
    files: { recordingsDir: '/data/rec', layout: 'by-date' },
    shortcuts: { scope: 'app', bindings: { toggleRecord: 'Control+R', togglePause: 'Control+P', addMarker: 'Control+M' } },
    transcription: { modelPath: '/models/ggml-base.bin', language: 'tr' }
  })

  it('a single category only resets its own fields', () => {
    const s = resetCategory(custom, 'shortcuts', 'light')
    expect(s.shortcuts.bindings).toEqual(DEFAULT_BINDINGS)
    expect(s.shortcuts.scope).toBe('global')
    expect(s.theme).toBe('dark')
    expect(s.files.recordingsDir).toBe('/data/rec')
  })

  it('resetting files keeps the recordings folder; resetting transcription keeps the model', () => {
    expect(resetCategory(custom, 'files', 'light').files).toEqual({ recordingsDir: '/data/rec', layout: 'flat' })
    const t = resetCategory(custom, 'transcription', 'light').transcription
    expect(t.modelPath).toBe('/models/ggml-base.bin')
    expect(t.language).toBe('auto')
  })

  it('reset all keeps language, onboarding, recordings folder and model path', () => {
    const s = resetAll(custom, 'light')
    expect(s.language).toBe('tr')
    expect(s.onboardingCompleted).toBe(true)
    expect(s.files.recordingsDir).toBe('/data/rec')
    expect(s.transcription.modelPath).toBe('/models/ggml-base.bin')
    expect(s.uiScale).toBe(1)
    expect(s.theme).toBe('light')
    expect(s.shortcuts.bindings).toEqual(DEFAULT_BINDINGS)
  })
})
