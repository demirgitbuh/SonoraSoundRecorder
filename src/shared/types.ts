/**
 * Domain types shared by the main process, the preload bridge and the renderer.
 * This module must stay free of Node.js and DOM specific APIs.
 */

export const LOCALES = ['en', 'tr', 'de', 'fr', 'zh', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

/** Language names are always shown in their own language. */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
  fr: 'Français',
  zh: '中文',
  ru: 'Русский'
}

export type ThemeName = 'light' | 'dark'
export type ReduceMotionPref = 'system' | 'on' | 'off'

export const AUDIO_FORMATS = ['wav', 'mp3', 'flac', 'opus', 'aac'] as const
export type AudioFormat = (typeof AUDIO_FORMATS)[number]

export type SourceKind = 'mic' | 'system' | 'both'
export type OutputMode = 'combined' | 'separate' | 'both'
/** Raw capture tracks. `mix` is the combined microphone + system track. */
export type TrackKind = 'mic' | 'system' | 'mix'
export type QualityProfile = 'high' | 'standard' | 'compact' | 'custom'
export type PostRecordAction = 'autosave' | 'ask-name' | 'preview'
export type FileLayout = 'flat' | 'by-date'
export type CountdownSeconds = 0 | 3 | 5 | 10

export const SHORTCUT_ACTIONS = ['toggleRecord', 'togglePause', 'addMarker'] as const
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]
export type ShortcutScope = 'global' | 'app'
export type ShortcutBindings = Record<ShortcutAction, string>

export type NotificationScope = 'all' | 'errors'

/** Every state a recording run can be in. */
export const RUN_STATES = [
  'ready',
  'countdown',
  'recording',
  'paused',
  'finalizing',
  'preview',
  'exporting',
  'recoverable',
  'error'
] as const
export type RunState = (typeof RUN_STATES)[number]

export interface CustomEncoding {
  sampleRate: number
  channels: 1 | 2
  /** WAV: 16, 24 or 32 (float). FLAC: 16 or 24. */
  bitDepth: 16 | 24 | 32
  /** Used by MP3, Opus and AAC. */
  bitrateKbps: number
  /** FLAC compression level 0-8. */
  flacCompression: number
}

export interface EncodingOptions extends CustomEncoding {
  format: AudioFormat
}

export interface MicProcessing {
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
}

export interface SessionConfig {
  id: string
  name: string
  source: SourceKind
  /** `null` means the operating system default input. */
  micDeviceId: string | null
  /** `null` means system output loopback; otherwise a monitor input device id (Linux). */
  systemDeviceId: string | null
  micLevel: number
  systemLevel: number
  monitor: boolean
  monitorLevel: number
  outputMode: OutputMode
  format: AudioFormat
  qualityProfile: QualityProfile
  custom: CustomEncoding
}

export interface Marker {
  id: string
  timeMs: number
}

export interface TimeRange {
  startMs: number
  endMs: number
}

export type RecordingSource = 'mic' | 'system' | 'mixed' | 'imported'
export type RecordingPart = 'combined' | 'mic' | 'system' | 'single'

export interface TrashInfo {
  trashedAt: string
  originalPath: string
  trashPath: string
}

export interface TranscriptMeta {
  updatedAt: string
  language: string
  model: string
  /** True when the audio was edited after transcription and timings were remapped. */
  remapped: boolean
}

export interface Recording {
  id: string
  name: string
  filePath: string
  format: AudioFormat
  durationMs: number
  sizeBytes: number
  sampleRate: number
  channels: number
  bitDepth: number | null
  bitrateKbps: number | null
  createdAt: string
  updatedAt: string
  source: RecordingSource
  part: RecordingPart
  groupId: string | null
  markers: Marker[]
  favorite: boolean
  tagIds: string[]
  folderId: string | null
  note: string
  processing: MicProcessing & { normalized: boolean }
  transcript: TranscriptMeta | null
  imported: { originalPath: string; importedAt: string } | null
  trash: TrashInfo | null
  /** Set when the file was not found on disk during the last check. */
  missing: boolean
}

export interface Folder {
  id: string
  name: string
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  createdAt: string
}

export interface LibrarySnapshot {
  recordings: Recording[]
  folders: Folder[]
  tags: Tag[]
}

export interface TranscriptSegment {
  fromMs: number
  toMs: number
  text: string
}

export interface Transcript {
  recordingId: string
  model: string
  language: string
  createdAt: string
  segments: TranscriptSegment[]
}

export interface Schedule {
  id: string
  sessionId: string
  startAt: string
  endAt: string
  status: 'upcoming' | 'running' | 'completed' | 'missed' | 'failed' | 'cancelled'
  /** Translation key describing why a schedule failed or was missed. */
  reasonKey: string | null
}

export type InstallKind = 'nsis' | 'portable' | 'appimage' | 'deb' | 'dmg' | 'dev'

export type SystemAudioStatus = 'supported' | 'needs-permission' | 'unsupported'

export interface PlatformCapabilities {
  platform: 'win32' | 'darwin' | 'linux'
  arch: string
  osVersion: string
  isWayland: boolean
  isPackaged: boolean
  installKind: InstallKind
  systemAudio: {
    status: SystemAudioStatus
    method: 'wasapi-loopback' | 'screencapturekit' | 'pulse-loopback' | 'none'
  }
  nativeShare: boolean
  autostart: boolean
  globalShortcuts: 'supported' | 'portal' | 'unsupported'
  ffmpeg: boolean
  whisper: boolean
}

export type MediaPermission = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

export interface PermissionStatus {
  microphone: MediaPermission
  screen: MediaPermission
}

export interface FolderCheck {
  path: string
  exists: boolean
  writable: boolean
  freeBytes: number | null
}

export interface ShortcutStatus {
  action: ShortcutAction
  accelerator: string
  scope: ShortcutScope
  /** `registered`: active globally. `in-app`: handled inside Sonora windows only. */
  state: 'registered' | 'in-app' | 'failed' | 'suspended'
  /** Translation key with the failure reason, if any. */
  reasonKey: string | null
}

export interface ModelInfo {
  path: string
  fileName: string
  sizeBytes: number
  valid: boolean
  /** e.g. tiny, base, small, medium, large */
  family: string | null
  multilingual: boolean | null
  reasonKey: string | null
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastPayload {
  id: string
  kind: ToastKind
  titleKey: string
  bodyKey?: string
  params?: Record<string, string | number>
  /** Free text that is not translated (file names, OS error messages). */
  detail?: string
}

export interface ItemResult {
  id: string
  name: string
  ok: boolean
  /** Translation key for the error, if any. */
  errorKey?: string
  detail?: string
  outputPath?: string
}

export interface BulkResult {
  results: ItemResult[]
}
