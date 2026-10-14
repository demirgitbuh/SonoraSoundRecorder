import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareVersions, isNewer, normalizeVersion } from '../src/shared/version'
import { pickAsset, supportsAutoInstall } from '../src/main/services/update-utils'
import { SettingsStore } from '../src/main/services/settings-store'
import { LibraryStore } from '../src/main/services/library-store'
import { makeRecording, tempDir, testLogger } from './helpers'

const ASSETS = [
  'Sonora-Sound-Recorder-0.2.0-Setup-x64.exe',
  'Sonora-Sound-Recorder-0.2.0-Portable-x64.exe',
  'Sonora-Sound-Recorder-0.2.0-arm64.dmg',
  'Sonora-Sound-Recorder-0.2.0-x64.dmg',
  'Sonora-Sound-Recorder-0.2.0-x86_64.AppImage',
  'sonora-sound-recorder_0.2.0_amd64.deb',
  'latest.yml',
  'latest-linux.yml'
].map((name) => ({ name, browser_download_url: `https://example.invalid/${name}`, size: 1 }))

describe('release versions and assets', () => {
  it('reads the 0.1 tag as version 0.1.0 without renaming the tag', () => {
    expect(normalizeVersion('0.1')).toBe('0.1.0')
    expect(normalizeVersion('v1.2')).toBe('1.2.0')
    expect(normalizeVersion('1.2.3-beta.1')).toBe('1.2.3-beta.1')
    expect(normalizeVersion('release-x')).toBeNull()
  })

  it('compares versions semantically', () => {
    expect(isNewer('0.2', '0.1.0')).toBe(true)
    expect(isNewer('0.1', '0.1.0')).toBe(false)
    expect(isNewer('0.10.0', '0.9.9')).toBe(true)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0)
  })

  it('picks the package that matches the installation type and architecture', () => {
    expect(pickAsset(ASSETS, 'nsis', 'x64')?.name).toBe('Sonora-Sound-Recorder-0.2.0-Setup-x64.exe')
    expect(pickAsset(ASSETS, 'portable', 'x64')?.name).toBe('Sonora-Sound-Recorder-0.2.0-Portable-x64.exe')
    expect(pickAsset(ASSETS, 'dmg', 'arm64')?.name).toBe('Sonora-Sound-Recorder-0.2.0-arm64.dmg')
    expect(pickAsset(ASSETS, 'dmg', 'x64')?.name).toBe('Sonora-Sound-Recorder-0.2.0-x64.dmg')
    expect(pickAsset(ASSETS, 'appimage', 'x64')?.name).toBe('Sonora-Sound-Recorder-0.2.0-x86_64.AppImage')
    expect(pickAsset(ASSETS, 'deb', 'x64')?.name).toBe('sonora-sound-recorder_0.2.0_amd64.deb')
    expect(pickAsset(ASSETS, 'dev', 'x64')).toBeNull()
  })

  it('only the NSIS installer and the AppImage install updates by themselves', () => {
    expect(supportsAutoInstall('nsis')).toBe(true)
    expect(supportsAutoInstall('appimage')).toBe(true)
    for (const k of ['portable', 'dmg', 'deb', 'dev'] as const) expect(supportsAutoInstall(k)).toBe(false)
  })
})

describe('packaging keeps user data safe across updates', () => {
  const builder = readFileSync(join(__dirname, '..', 'electron-builder.yml'), 'utf8')
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))

  it('never deletes app data on uninstall/upgrade and upgrades the existing install', () => {
    expect(builder).toMatch(/deleteAppDataOnUninstall:\s*false/)
    expect(builder).toMatch(/appId:\s*io\.github\.demirgitbuh\.sonora/)
    expect(builder).toMatch(/provider:\s*github/)
    expect(builder).toMatch(/owner:\s*demirgitbuh/)
    expect(builder).toMatch(/repo:\s*SonoraSoundRecorder/)
  })

  it('offers the six languages in the Windows installer', () => {
    expect(builder).toMatch(/displayLanguageSelector:\s*true/)
    expect(builder).toMatch(/installerLanguages:\s*\[en_US, tr_TR, de_DE, fr_FR, zh_CN, ru_RU\]/)
  })

  it('declares explicit architectures for every target', () => {
    expect(builder).toMatch(/target: nsis\s+arch: \[x64\]/)
    expect(builder).toMatch(/target: portable\s+arch: \[x64\]/)
    expect(builder).toMatch(/target: dmg\s+arch: \[arm64, x64\]/)
    expect(builder).toMatch(/target: AppImage\s+arch: \[x64\]/)
    expect(builder).toMatch(/target: deb\s+arch: \[x64\]/)
    expect(builder).toMatch(/from: vendor\/bin\/\$\{os\}-\$\{arch\}/)
  })

  it('ships version 0.1.0 under GPL-3.0', () => {
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.license).toBe('GPL-3.0-only')
    expect(readFileSync(join(__dirname, '..', 'LICENSE'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
  })
})

describe('user data survives an app update', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('settings, language, theme, shortcuts, archive, notes, trash and model path are kept', async () => {
    // "Old version" writes its data files.
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        onboardingCompleted: true,
        language: 'ru',
        theme: 'dark',
        shortcuts: { scope: 'app', bindings: { toggleRecord: 'Control+R', togglePause: 'Control+P', addMarker: 'Control+M' } },
        files: { recordingsDir: '/srv/rec', layout: 'by-date' },
        transcription: { modelPath: '/models/ggml-base.bin', language: 'ru', threads: 4 },
        notifications: { desktop: false, sounds: true, scope: 'errors', inApp: true },
        unknownFutureField: 'ignored safely'
      })
    )
    const old = new LibraryStore({ dataDir: dir, platform: 'linux', logger: testLogger(dir), recordingsDir: () => '/srv/rec', layout: () => 'flat' })
    await old.load()
    const folderId = old.createFolder('Lectures').folders[0]!.id
    const tagId = old.createTag('Physics').tags[0]!.id
    old.add(makeRecording({ id: 'r1', note: 'Chapter 4', favorite: true, folderId, tagIds: [tagId], markers: [{ id: 'm', timeMs: 1500 }] }))
    old.add(makeRecording({ id: 'r2', trash: { trashedAt: '2026-01-01T00:00:00Z', originalPath: '/srv/rec/x.wav', trashPath: '/srv/rec/.sonora-trash/r2/x.wav' } }))
    await old.writeTranscript({ recordingId: 'r1', model: 'ggml-base.bin', language: 'ru', createdAt: '', segments: [{ fromMs: 0, toMs: 1000, text: 'привет' }] })
    old.patch('r1', { transcript: { updatedAt: '', language: 'ru', model: 'ggml-base.bin', remapped: false } })
    await old.flush()

    // "New version" starts with the same data directory.
    const settings = new SettingsStore(dir, testLogger(dir))
    const res = await settings.load('light')
    expect(res.firstRun).toBe(false)
    const s = settings.value
    expect(s.language).toBe('ru')
    expect(s.theme).toBe('dark')
    expect(s.onboardingCompleted).toBe(true)
    expect(s.shortcuts).toEqual({ scope: 'app', bindings: { toggleRecord: 'Control+R', togglePause: 'Control+P', addMarker: 'Control+M' } })
    expect(s.files).toEqual({ recordingsDir: '/srv/rec', layout: 'by-date' })
    expect(s.transcription.modelPath).toBe('/models/ggml-base.bin')
    expect(s.notifications.scope).toBe('errors')

    const lib = new LibraryStore({ dataDir: dir, platform: 'linux', logger: testLogger(dir), recordingsDir: () => '/srv/rec', layout: () => 'flat' })
    await lib.load()
    const r1 = lib.get('r1')
    expect(r1.note).toBe('Chapter 4')
    expect(r1.favorite).toBe(true)
    expect(r1.folderId).toBe(folderId)
    expect(r1.tagIds).toEqual([tagId])
    expect(r1.markers).toEqual([{ id: 'm', timeMs: 1500 }])
    expect(lib.get('r2').trash?.originalPath).toBe('/srv/rec/x.wav')
    expect(lib.searchTranscripts('ПРИВЕТ')).toEqual(['r1'])
  })
})
