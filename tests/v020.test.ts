import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LEGAL_DOCS, LEGAL_VERSION, legalAccepted, legalDoc } from '../src/shared/legal'
import { defaultSessionName, defaultSessionNumber, localizeSessionNames, nextSessionNumber } from '../src/shared/sessions'
import {
  SIDE_PANEL_DEFAULT,
  SIDE_PANEL_MAX,
  applySettingsPatch,
  createSessionConfig,
  defaultSettings,
  mergeImported,
  parseSettings,
  resetAll,
  resetCategory,
  toPortable
} from '../src/shared/settings'
import { LOCALES } from '../src/shared/types'
import { LibraryStore } from '../src/main/services/library-store'
import { SettingsStore } from '../src/main/services/settings-store'
import { makeRecording, tempDir, testLogger } from './helpers'

describe('automatic session names follow the language', () => {
  it('recognises the automatic name in every language', () => {
    expect(defaultSessionNumber('Session 1')).toBe(1)
    expect(defaultSessionNumber('Oturum 12')).toBe(12)
    expect(defaultSessionNumber('Sitzung 3')).toBe(3)
    expect(defaultSessionNumber('Сеанс 2')).toBe(2)
    expect(defaultSessionNumber('会话 4')).toBe(4)
    expect(defaultSessionNumber('Interview')).toBeNull()
    expect(defaultSessionNumber('Session one')).toBeNull()
    expect(defaultSessionNumber('My Session 1')).toBeNull()
  })

  it('renames automatic names and never touches names chosen by the user', () => {
    const s = defaultSettings()
    const sessions = [createSessionConfig(s, 'a', 'Session 1'), createSessionConfig(s, 'b', 'Podcast'), createSessionConfig(s, 'c', 'Oturum 2')]
    const tr = localizeSessionNames(sessions, 'tr')
    expect(tr.changed).toBe(true)
    expect(tr.sessions.map((x) => x.name)).toEqual(['Oturum 1', 'Podcast', 'Oturum 2'])
    expect(tr.sessions[1]).toBe(sessions[1])
    const again = localizeSessionNames(tr.sessions, 'tr')
    expect(again.changed).toBe(false)
    expect(localizeSessionNames(tr.sessions, 'de').sessions.map((x) => x.name)).toEqual(['Sitzung 1', 'Podcast', 'Sitzung 2'])
  })

  it('picks the smallest free number for a new session', () => {
    expect(nextSessionNumber([])).toBe(1)
    expect(nextSessionNumber(['Oturum 1', 'Oturum 3'])).toBe(2)
    expect(nextSessionNumber(['Session 1', 'Podcast', 'Session 2'])).toBe(3)
    expect(defaultSessionName('fr', 5)).toBe('Session 5')
  })
})

describe('legal documents', () => {
  it('exist in every language with the same structure and no empty text', () => {
    const shape = (l: (typeof LOCALES)[number]): number[] => [LEGAL_DOCS[l].terms.sections.length, LEGAL_DOCS[l].privacy.sections.length]
    for (const l of LOCALES) {
      expect(shape(l)).toEqual(shape('en'))
      for (const id of ['terms', 'privacy'] as const) {
        const doc = legalDoc(l, id)
        expect(doc.title.trim()).not.toBe('')
        for (const s of doc.sections) {
          expect(s.title.trim()).not.toBe('')
          expect(s.body.length).toBeGreaterThan(0)
          for (const p of s.body) expect(p.trim()).not.toBe('')
        }
      }
    }
  })

  it('never contain an e-mail address', () => {
    const text = JSON.stringify(LEGAL_DOCS)
    expect(text).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)
  })

  it('count as accepted only for the current version', () => {
    expect(legalAccepted({ acceptedVersion: null })).toBe(false)
    expect(legalAccepted({ acceptedVersion: '2000-01-01' })).toBe(false)
    expect(legalAccepted({ acceptedVersion: LEGAL_VERSION })).toBe(true)
  })
})

describe('0.2.0 settings', () => {
  it('have safe defaults and accept files written by 0.1', () => {
    const d = defaultSettings()
    expect(d.shortcuts.miniPanel).toBe(true)
    expect(d.layout).toEqual({ sidePanelWidth: SIDE_PANEL_DEFAULT, sidePanelCollapsed: false, collapsedCards: [] })
    expect(d.legal).toEqual({ acceptedVersion: null, acceptedAt: null })
    const { settings } = parseSettings({ schemaVersion: 1, onboardingCompleted: true, shortcuts: { scope: 'app', bindings: { toggleRecord: 'F8', togglePause: 'F9', addMarker: 'F10' } } })
    expect(settings.shortcuts).toEqual({ scope: 'app', bindings: { toggleRecord: 'F8', togglePause: 'F9', addMarker: 'F10' }, miniPanel: true })
    expect(settings.legal.acceptedVersion).toBeNull()
  })

  it('validate the panel layout field by field', () => {
    const s = applySettingsPatch(defaultSettings(), { layout: { sidePanelWidth: 9999, collapsedCards: ['levels', 'nope' as never] } })
    expect(s.layout.sidePanelWidth).toBe(SIDE_PANEL_DEFAULT)
    expect(s.layout.collapsedCards).toEqual([])
    const ok = applySettingsPatch(defaultSettings(), { layout: { sidePanelWidth: SIDE_PANEL_MAX, collapsedCards: ['levels', 'schedule'] } })
    expect(ok.layout.sidePanelWidth).toBe(SIDE_PANEL_MAX)
    expect(ok.layout.collapsedCards).toEqual(['levels', 'schedule'])
  })

  it('keep the acceptance of the terms through resets and imports', () => {
    const accepted = applySettingsPatch(defaultSettings(), { legal: { acceptedVersion: LEGAL_VERSION, acceptedAt: '2026-10-31T10:00:00.000Z' } })
    expect(resetAll(accepted, 'light').legal.acceptedVersion).toBe(LEGAL_VERSION)
    expect(resetCategory(accepted, 'appearance', 'light').legal.acceptedVersion).toBe(LEGAL_VERSION)
    expect('legal' in toPortable(accepted)).toBe(false)
    const other = applySettingsPatch(defaultSettings(), { legal: { acceptedVersion: null } })
    expect(mergeImported(accepted, other, []).legal.acceptedVersion).toBe(LEGAL_VERSION)
  })
})

describe('settings store normalizer', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('localizes automatic session names when loading and when the language changes', async () => {
    const store = new SettingsStore(dir, testLogger(dir))
    await store.load('light')
    expect(store.value.sessions[0]!.name).toBe('Session 1')
    store.setNormalizer((s) => {
      const res = localizeSessionNames(s.sessions, s.language ?? 'tr')
      return res.changed ? { ...s, sessions: res.sessions } : s
    })
    expect(store.value.sessions[0]!.name).toBe('Oturum 1')
    const next = store.update({ language: 'de' })
    expect(next.sessions[0]!.name).toBe('Sitzung 1')
    expect(store.value.sessions[0]!.name).toBe('Sitzung 1')
    const renamed = store.update({ sessions: store.value.sessions.map((x) => ({ ...x, name: 'Interview' })) })
    expect(renamed.sessions[0]!.name).toBe('Interview')
    expect(store.update({ language: 'ru' }).sessions[0]!.name).toBe('Interview')
  })
})

describe('library start-up', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('defers the transcript index and the missing-file check, and does not rewrite a healthy file', async () => {
    const data = join(dir, 'data')
    const present = join(dir, 'present.wav')
    writeFileSync(present, 'audio')
    const first = new LibraryStore({ dataDir: data, platform: 'linux', logger: testLogger(dir), recordingsDir: () => dir, layout: () => 'flat' })
    await first.load()
    first.add(makeRecording({ id: 'here', filePath: present }))
    first.add(makeRecording({ id: 'gone', filePath: join(dir, 'gone.wav') }))
    await first.writeTranscript({ recordingId: 'here', model: 'm', language: 'en', createdAt: '', segments: [{ fromMs: 0, toMs: 1, text: 'hello world' }] })
    first.patch('here', { transcript: { updatedAt: '', language: 'en', model: 'm', remapped: false } })
    await first.flush()
    const before = statSync(join(data, 'library.json')).mtimeMs

    const lib = new LibraryStore({ dataDir: data, platform: 'linux', logger: testLogger(dir), recordingsDir: () => dir, layout: () => 'flat' })
    await lib.load({ deferred: true })
    expect(statSync(join(data, 'library.json')).mtimeMs).toBe(before)
    expect(lib.searchTranscripts('hello')).toEqual([])
    expect(lib.get('gone').missing).toBe(false)
    await lib.warmUp()
    expect(lib.searchTranscripts('hello')).toEqual(['here'])
    expect(lib.get('gone').missing).toBe(true)
    expect(lib.get('here').missing).toBe(false)
  })

  it('builds the transcript index only once', async () => {
    const data = join(dir, 'data')
    mkdirSync(data, { recursive: true })
    const lib = new LibraryStore({ dataDir: data, platform: 'linux', logger: testLogger(dir), recordingsDir: () => dir, layout: () => 'flat' })
    await lib.load({ deferred: true })
    const a = lib.ensureTranscriptIndex()
    const b = lib.ensureTranscriptIndex()
    expect(a).toBe(b)
    await a
  })
})
