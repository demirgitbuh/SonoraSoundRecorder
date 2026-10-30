import { z } from 'zod'
import { AUDIO_FORMATS, LOCALES } from './types'
import type { CustomEncoding, SessionConfig, ThemeName } from './types'
import { DEFAULT_CUSTOM_ENCODING } from './formats'
import { DEFAULT_BINDINGS } from './shortcuts'
import { developerSchema } from './developer'

/**
 * Settings are validated field by field: a missing or invalid value falls back to its default
 * without discarding the rest of the user's preferences.
 */
export const SETTINGS_SCHEMA_VERSION = 1

const customEncodingSchema = z
  .object({
    sampleRate: z.number().int().min(8000).max(192000).catch(DEFAULT_CUSTOM_ENCODING.sampleRate),
    channels: z.union([z.literal(1), z.literal(2)]).catch(DEFAULT_CUSTOM_ENCODING.channels),
    bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]).catch(DEFAULT_CUSTOM_ENCODING.bitDepth),
    bitrateKbps: z.number().int().min(16).max(512).catch(DEFAULT_CUSTOM_ENCODING.bitrateKbps),
    flacCompression: z.number().int().min(0).max(8).catch(DEFAULT_CUSTOM_ENCODING.flacCompression)
  })
  .catch({ ...DEFAULT_CUSTOM_ENCODING })

const sourceSchema = z.enum(['mic', 'system', 'both'])
const outputModeSchema = z.enum(['combined', 'separate', 'both'])
const formatSchema = z.enum(AUDIO_FORMATS)
const profileSchema = z.enum(['high', 'standard', 'compact', 'custom'])

export const sessionConfigSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(60).catch('Session'),
  source: sourceSchema.catch('mic'),
  micDeviceId: z.string().max(512).nullable().catch(null),
  systemDeviceId: z.string().max(512).nullable().catch(null),
  micLevel: z.number().min(0).max(2).catch(1),
  systemLevel: z.number().min(0).max(2).catch(1),
  monitor: z.boolean().catch(false),
  monitorLevel: z.number().min(0).max(1).catch(0.6),
  outputMode: outputModeSchema.catch('combined'),
  format: formatSchema.catch('wav'),
  qualityProfile: profileSchema.catch('high'),
  custom: customEncodingSchema
})

/** Width limits of the record page's side panel, in CSS pixels. */
export const SIDE_PANEL_MIN = 280
export const SIDE_PANEL_MAX = 560
export const SIDE_PANEL_DEFAULT = 360
export const RECORD_CARDS = ['levels', 'source', 'output', 'schedule'] as const
export type RecordCard = (typeof RECORD_CARDS)[number]

const bindingSchema = (fallback: string): z.ZodCatch<z.ZodString> => z.string().min(1).max(64).catch(fallback)

export const settingsSchema = z.object({
  schemaVersion: z.number().int().catch(SETTINGS_SCHEMA_VERSION),
  onboardingCompleted: z.boolean().catch(false),
  language: z.enum(LOCALES).nullable().catch(null),
  theme: z.enum(['light', 'dark']).catch('light'),
  uiScale: z.number().min(0.8).max(2).catch(1),
  highContrast: z.boolean().catch(false),
  reduceMotion: z.enum(['system', 'on', 'off']).catch('system'),
  launchAtLogin: z.boolean().catch(false),
  startHiddenAtLogin: z.boolean().catch(true),
  recording: z
    .object({
      countdownSeconds: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]).catch(0),
      postAction: z.enum(['autosave', 'ask-name', 'preview']).catch('preview'),
      defaultSource: sourceSchema.catch('mic'),
      defaultOutputMode: outputModeSchema.catch('combined'),
      defaultFormat: formatSchema.catch('wav'),
      defaultProfile: profileSchema.catch('high'),
      defaultCustom: customEncodingSchema
    })
    .catch({
      countdownSeconds: 0,
      postAction: 'preview',
      defaultSource: 'mic',
      defaultOutputMode: 'combined',
      defaultFormat: 'wav',
      defaultProfile: 'high',
      defaultCustom: { ...DEFAULT_CUSTOM_ENCODING }
    }),
  audio: z
    .object({
      defaultMicDeviceId: z.string().max(512).nullable().catch(null),
      noiseSuppression: z.boolean().catch(false),
      echoCancellation: z.boolean().catch(false),
      autoGainControl: z.boolean().catch(false)
    })
    .catch({ defaultMicDeviceId: null, noiseSuppression: false, echoCancellation: false, autoGainControl: false }),
  export: z
    .object({
      normalize: z.boolean().catch(false),
      normalizeTargetDb: z.number().min(-12).max(0).catch(-1)
    })
    .catch({ normalize: false, normalizeTargetDb: -1 }),
  files: z
    .object({
      recordingsDir: z.string().max(4096).nullable().catch(null),
      layout: z.enum(['flat', 'by-date']).catch('flat')
    })
    .catch({ recordingsDir: null, layout: 'flat' }),
  shortcuts: z
    .object({
      scope: z.enum(['global', 'app']).catch('global'),
      bindings: z
        .object({
          toggleRecord: bindingSchema(DEFAULT_BINDINGS.toggleRecord),
          togglePause: bindingSchema(DEFAULT_BINDINGS.togglePause),
          addMarker: bindingSchema(DEFAULT_BINDINGS.addMarker)
        })
        .catch(() => ({ ...DEFAULT_BINDINGS })),
      /** The mini panel handles the recording shortcuts itself while it has focus. */
      miniPanel: z.boolean().catch(true)
    })
    .catch(() => ({ scope: 'global' as const, bindings: { ...DEFAULT_BINDINGS }, miniPanel: true })),
  notifications: z
    .object({
      desktop: z.boolean().catch(true),
      sounds: z.boolean().catch(false),
      scope: z.enum(['all', 'errors']).catch('all'),
      inApp: z.boolean().catch(true)
    })
    .catch({ desktop: true, sounds: false, scope: 'all', inApp: true }),
  transcription: z
    .object({
      modelPath: z.string().max(4096).nullable().catch(null),
      language: z
        .string()
        .regex(/^(auto|[a-z]{2,3})$/)
        .catch('auto'),
      threads: z.number().int().min(0).max(64).catch(0)
    })
    .catch({ modelPath: null, language: 'auto', threads: 0 }),
  updates: z
    .object({
      checkOnStartup: z.boolean().catch(true)
    })
    .catch({ checkOnStartup: true }),
  archive: z
    .object({
      view: z.enum(['list', 'cards']).catch('list'),
      showWaveforms: z.boolean().catch(true)
    })
    .catch({ view: 'list', showWaveforms: true }),
  sessions: z.array(sessionConfigSchema).max(8).catch([]),
  selectedSessionId: z.string().max(64).nullable().catch(null),
  miniPanel: z
    .object({
      open: z.boolean().catch(false),
      x: z.number().int().nullable().catch(null),
      y: z.number().int().nullable().catch(null)
    })
    .catch({ open: false, x: null, y: null }),
  window: z
    .object({
      width: z.number().int().min(400).max(20000).nullable().catch(null),
      height: z.number().int().min(300).max(20000).nullable().catch(null),
      x: z.number().int().nullable().catch(null),
      y: z.number().int().nullable().catch(null),
      maximized: z.boolean().catch(false)
    })
    .catch({ width: null, height: null, x: null, y: null, maximized: false }),
  layout: z
    .object({
      sidePanelWidth: z.number().int().min(SIDE_PANEL_MIN).max(SIDE_PANEL_MAX).catch(SIDE_PANEL_DEFAULT),
      sidePanelCollapsed: z.boolean().catch(false),
      collapsedCards: z.array(z.enum(RECORD_CARDS)).max(RECORD_CARDS.length).catch([])
    })
    .catch(() => ({ sidePanelWidth: SIDE_PANEL_DEFAULT, sidePanelCollapsed: false, collapsedCards: [] })),
  legal: z
    .object({
      acceptedVersion: z.string().max(40).nullable().catch(null),
      acceptedAt: z.string().max(40).nullable().catch(null)
    })
    .catch(() => ({ acceptedVersion: null, acceptedAt: null })),
  developer: developerSchema
})

export type Settings = z.infer<typeof settingsSchema>

export type DeepPartial<T> = T extends Array<infer U>
  ? Array<U>
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

export type SettingsPatch = DeepPartial<Settings>

export function defaultSettings(theme: ThemeName = 'light'): Settings {
  const s = settingsSchema.parse({})
  s.theme = theme
  s.schemaVersion = SETTINGS_SCHEMA_VERSION
  return s
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep merge where arrays and scalars from `patch` replace the base value. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const current = (base as Record<string, unknown>)[k]
    out[k] = isPlainObject(current) && isPlainObject(v) ? deepMerge(current, v) : v
  }
  return out as T
}

export function applySettingsPatch(current: Settings, patch: SettingsPatch): Settings {
  const merged = deepMerge(current, patch)
  const parsed = settingsSchema.parse(merged)
  parsed.schemaVersion = SETTINGS_SCHEMA_VERSION
  return parsed
}

// ---------------------------------------------------------------------------
// Versioned migrations
// ---------------------------------------------------------------------------

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>

/**
 * `MIGRATIONS[n]` upgrades data from version n to n + 1.
 * Version 0 is an unversioned file written by pre-release builds.
 */
export const SETTINGS_MIGRATIONS: Record<number, Migration> = {
  0: (data) => {
    const out = { ...data }
    // Pre-release builds stored the shortcut scope at the top level.
    if (typeof out.shortcutScope === 'string') {
      const shortcuts = isPlainObject(out.shortcuts) ? { ...out.shortcuts } : {}
      shortcuts.scope = out.shortcutScope
      out.shortcuts = shortcuts
      delete out.shortcutScope
    }
    return out
  }
}

export interface MigrationOutcome {
  data: Record<string, unknown>
  fromVersion: number
  /** The file was written by a newer version of the app. */
  tooNew: boolean
  migrated: boolean
}

export function runMigrations(raw: unknown, currentVersion: number, migrations: Record<number, Migration>): MigrationOutcome {
  if (!isPlainObject(raw)) return { data: {}, fromVersion: currentVersion, tooNew: false, migrated: false }
  const fromVersion = typeof raw.schemaVersion === 'number' && Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 0
  if (fromVersion > currentVersion) return { data: { ...raw }, fromVersion, tooNew: true, migrated: false }
  let data: Record<string, unknown> = { ...raw }
  for (let v = fromVersion; v < currentVersion; v++) {
    const step = migrations[v]
    if (step) data = step(data)
    data.schemaVersion = v + 1
  }
  return { data, fromVersion, tooNew: false, migrated: fromVersion !== currentVersion }
}

export function parseSettings(raw: unknown): { settings: Settings; outcome: MigrationOutcome } {
  const outcome = runMigrations(raw, SETTINGS_SCHEMA_VERSION, SETTINGS_MIGRATIONS)
  const settings = settingsSchema.parse(outcome.data)
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION
  return { settings, outcome }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSessionConfig(settings: Settings, id: string, name: string): SessionConfig {
  return {
    id,
    name,
    source: settings.recording.defaultSource,
    micDeviceId: settings.audio.defaultMicDeviceId,
    systemDeviceId: null,
    micLevel: 1,
    systemLevel: 1,
    monitor: false,
    monitorLevel: 0.6,
    outputMode: settings.recording.defaultOutputMode,
    format: settings.recording.defaultFormat,
    qualityProfile: settings.recording.defaultProfile,
    custom: { ...(settings.recording.defaultCustom as CustomEncoding) }
  }
}

// ---------------------------------------------------------------------------
// Reset, profiles, import/export
// ---------------------------------------------------------------------------

export const SETTINGS_CATEGORIES = [
  'general',
  'recording',
  'audio',
  'files',
  'shortcuts',
  'appearance',
  'notifications',
  'transcription',
  'updates',
  'advanced',
  'developer'
] as const
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]

/**
 * Resets one category. Data locations (recordings folder, model file) and the chosen language
 * are kept; resetting never touches recordings.
 */
export function resetCategory(current: Settings, category: SettingsCategory, systemTheme: ThemeName): Settings {
  const d = defaultSettings(systemTheme)
  const s: Settings = structuredClone(current)
  switch (category) {
    case 'general':
      s.launchAtLogin = d.launchAtLogin
      s.startHiddenAtLogin = d.startHiddenAtLogin
      break
    case 'recording':
      s.recording = d.recording
      s.export = d.export
      break
    case 'audio':
      s.audio = d.audio
      break
    case 'files':
      s.files = { ...d.files, recordingsDir: current.files.recordingsDir }
      break
    case 'shortcuts':
      s.shortcuts = d.shortcuts
      break
    case 'appearance':
      s.theme = d.theme
      s.uiScale = d.uiScale
      s.highContrast = d.highContrast
      s.reduceMotion = d.reduceMotion
      s.layout = d.layout
      break
    case 'notifications':
      s.notifications = d.notifications
      break
    case 'transcription':
      s.transcription = { ...d.transcription, modelPath: current.transcription.modelPath }
      break
    case 'updates':
      s.updates = d.updates
      break
    case 'advanced':
      s.archive = d.archive
      break
    case 'developer':
      // Developer mode stays as it is; every developer value returns to its default.
      s.developer = { ...d.developer, enabled: current.developer.enabled }
      break
  }
  return s
}

export function resetAll(current: Settings, systemTheme: ThemeName): Settings {
  const d = defaultSettings(systemTheme)
  d.language = current.language
  d.onboardingCompleted = current.onboardingCompleted
  d.files.recordingsDir = current.files.recordingsDir
  d.transcription.modelPath = current.transcription.modelPath
  d.window = current.window
  d.legal = current.legal
  return d
}

/** Settings that make sense to move between profiles and computers. */
export type PortableSettings = Omit<Settings, 'onboardingCompleted' | 'window' | 'miniPanel' | 'selectedSessionId' | 'schemaVersion' | 'legal'>

export function toPortable(s: Settings): PortableSettings {
  const copy: Partial<Settings> = structuredClone(s)
  delete copy.onboardingCompleted
  delete copy.window
  delete copy.miniPanel
  delete copy.selectedSessionId
  delete copy.schemaVersion
  delete copy.legal
  return copy as PortableSettings
}

/** Values tied to one computer. They are never applied from an imported file without confirmation. */
export type MachineFieldKey = 'files.recordingsDir' | 'transcription.modelPath' | 'audio.defaultMicDeviceId' | 'sessions.devices'

export interface SettingsExportFile {
  app: 'sonora-sound-recorder'
  kind: 'settings'
  schemaVersion: number
  exportedAt: string
  appVersion: string
  settings: PortableSettings
}

const exportFileSchema = z.object({
  app: z.literal('sonora-sound-recorder'),
  kind: z.literal('settings'),
  schemaVersion: z.number().int().min(0),
  exportedAt: z.string(),
  appVersion: z.string(),
  settings: z.record(z.string(), z.unknown())
})

export interface ParsedImport {
  /** Imported settings with every machine specific field still holding the imported value. */
  imported: Settings
  sourceVersion: number
  machineFields: Array<{ key: MachineFieldKey; value: string | null }>
}

export class SettingsImportError extends Error {
  constructor(public readonly reasonKey: string) {
    super(reasonKey)
  }
}

export function parseSettingsExport(json: string): ParsedImport {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new SettingsImportError('settings.import.errorNotJson')
  }
  const file = exportFileSchema.safeParse(raw)
  if (!file.success) throw new SettingsImportError('settings.import.errorNotSonora')
  if (file.data.schemaVersion > SETTINGS_SCHEMA_VERSION) throw new SettingsImportError('settings.import.errorTooNew')
  const { settings } = parseSettings({ ...file.data.settings, schemaVersion: file.data.schemaVersion })
  const deviceIds = settings.sessions.flatMap((s) => [s.micDeviceId, s.systemDeviceId]).filter((v): v is string => !!v)
  return {
    imported: settings,
    sourceVersion: file.data.schemaVersion,
    machineFields: [
      { key: 'files.recordingsDir', value: settings.files.recordingsDir },
      { key: 'transcription.modelPath', value: settings.transcription.modelPath },
      { key: 'audio.defaultMicDeviceId', value: settings.audio.defaultMicDeviceId },
      { key: 'sessions.devices', value: deviceIds.length > 0 ? deviceIds.join(', ') : null }
    ]
  }
}

/**
 * Combines imported settings with the current ones. Machine specific values from the file are
 * only used for keys explicitly accepted by the user; everything else keeps the local value.
 */
export function mergeImported(current: Settings, imported: Settings, accepted: MachineFieldKey[]): Settings {
  const next: Settings = {
    ...structuredClone(imported),
    onboardingCompleted: current.onboardingCompleted,
    window: current.window,
    miniPanel: current.miniPanel,
    legal: current.legal,
    schemaVersion: SETTINGS_SCHEMA_VERSION
  }
  if (!accepted.includes('files.recordingsDir')) next.files.recordingsDir = current.files.recordingsDir
  if (!accepted.includes('transcription.modelPath')) next.transcription.modelPath = current.transcription.modelPath
  if (!accepted.includes('audio.defaultMicDeviceId')) next.audio.defaultMicDeviceId = current.audio.defaultMicDeviceId
  if (!accepted.includes('sessions.devices')) {
    next.sessions = next.sessions.map((s) => ({ ...s, micDeviceId: null, systemDeviceId: null }))
  }
  if (!next.sessions.some((s) => s.id === next.selectedSessionId)) next.selectedSessionId = next.sessions[0]?.id ?? null
  keepMachineDeveloperValues(next, current)
  return settingsSchema.parse(next)
}

export function buildSettingsExport(s: Settings, appVersion: string, now: Date): SettingsExportFile {
  return {
    app: 'sonora-sound-recorder',
    kind: 'settings',
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    settings: toPortable(s)
  }
}

export interface SettingsProfile {
  id: string
  name: string
  createdAt: string
  settings: PortableSettings
}

export function applyProfile(current: Settings, profile: SettingsProfile): Settings {
  const next = applySettingsPatch(current, profile.settings as SettingsPatch)
  keepMachineDeveloperValues(next, current)
  return next
}

/** Binary paths and Chromium switches belong to one computer and are never taken from a file or profile. */
function keepMachineDeveloperValues(next: Settings, current: Settings): void {
  next.developer = { ...next.developer, binaries: { ...current.developer.binaries }, chromium: { ...current.developer.chromium } }
}

export const profilesFileSchema = z.object({
  schemaVersion: z.number().int().catch(1),
  profiles: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(60),
        createdAt: z.string(),
        settings: z.record(z.string(), z.unknown())
      })
    )
    .catch([])
})
