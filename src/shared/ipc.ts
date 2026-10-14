/**
 * Typed IPC contract between the renderer (through the preload bridge) and the main process.
 * Every invoke channel is validated in the main process with a zod schema (src/main/ipc).
 */
import type {
  AudioFormat,
  BulkResult,
  CustomEncoding,
  EncodingOptions,
  FolderCheck,
  InstallKind,
  LibrarySnapshot,
  Locale,
  Marker,
  MicProcessing,
  ModelInfo,
  OutputMode,
  PermissionStatus,
  PlatformCapabilities,
  QualityProfile,
  Recording,
  RunState,
  Schedule,
  ShortcutAction,
  ShortcutBindings,
  ShortcutScope,
  ShortcutStatus,
  SourceKind,
  ThemeName,
  TimeRange,
  ToastKind,
  ToastPayload,
  TrackKind,
  Transcript
} from './types'
import type { MachineFieldKey, Settings, SettingsCategory, SettingsPatch, SettingsProfile } from './settings'

export type WindowKind = 'main' | 'mini'

export interface BootstrapData {
  settings: Settings
  capabilities: PlatformCapabilities
  version: string
  systemLocale: Locale
  installerLocale: Locale | null
  systemTheme: ThemeName
  defaultRecordingsDir: string
  dataDir: string
}

export interface DeviceInfo {
  label: string
  nativeSampleRate: number | null
  nativeChannels: number | null
}

export interface RunInit {
  runId: string
  sessionId: string
  sessionName: string
  sampleRate: number
  channels: 1 | 2
  source: SourceKind
  outputMode: OutputMode
  tracks: TrackKind[]
  encoding: EncodingOptions
  processing: MicProcessing
  devices: { mic: DeviceInfo | null; system: DeviceInfo | null }
  startedAt: string
}

export type RunPhase = 'recording' | 'paused' | 'stopped' | 'saving' | 'saved'
export type PauseReason = 'user' | 'device-lost' | null

export interface RunPatch {
  state?: 'recording' | 'paused'
  pauseReason?: PauseReason
  markers?: Marker[]
}

export interface RunEndResult {
  framesWritten: number
  durationMs: number
}

export interface PendingRun {
  runId: string
  sessionId: string
  sessionName: string
  startedAt: string
  durationMs: number
  sizeBytes: number
  sampleRate: number
  channels: number
  tracks: TrackKind[]
  source: SourceKind
  outputMode: OutputMode
  encoding: EncodingOptions
  processing: MicProcessing
  markers: Marker[]
  suggestedName: string
  /** `crashed`: the app ended while capturing. `unsaved`: stopped normally but not saved yet. */
  kind: 'crashed' | 'unsaved'
}

export interface RunMedia {
  track: TrackKind
  url: string
}

export interface SaveRunRequest {
  name: string | null
  encoding: EncodingOptions
  /** `null` saves the full recording without edits. */
  keep: TimeRange[] | null
  saveMode: 'edited-only' | 'original-and-edited'
  markers: Marker[]
  normalize: boolean
}

export interface EditRequest {
  keep: TimeRange[]
  mode: 'copy' | 'replace'
  markers: Marker[]
}

export interface ExportRequest {
  format: AudioFormat | 'original'
  profile: QualityProfile
  custom: CustomEncoding
  normalize: boolean
}

export type BulkAction =
  | { kind: 'trash' }
  | { kind: 'move'; folderId: string | null }
  | { kind: 'tag'; tagId: string; add: boolean }
  | { kind: 'favorite'; value: boolean }

export interface MetaPatch {
  favorite?: boolean
  note?: string
  folderId?: string | null
  tagIds?: string[]
  markers?: Marker[]
}

export interface SettingsImportPreview {
  token: string
  sourceVersion: number
  machineFields: Array<{ key: MachineFieldKey; value: string | null; valid: boolean | null; reasonKey: string | null }>
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'waiting-for-idle'
  | 'installing'
  | 'error'

export interface ReleaseInfo {
  version: string
  tag: string
  name: string
  notes: string
  publishedAt: string | null
  url: string
}

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  installKind: InstallKind
  /** True when this package type can install updates by itself. */
  autoInstall: boolean
  release: ReleaseInfo | null
  progress: { percent: number; transferred: number; total: number } | null
  downloadedFile: string | null
  installAfterDownload: boolean
  errorKey: string | null
  errorDetail: string | null
  checkedAt: string | null
}

export type TranscribePhase = 'queued' | 'converting' | 'transcribing' | 'saving' | 'done' | 'error' | 'cancelled'

export interface TranscribeProgress {
  jobId: string
  recordingId: string
  phase: TranscribePhase
  percent: number
  errorKey: string | null
  detail: string | null
}

export interface TaskProgress {
  taskId: string
  labelKey: string
  percent: number
}

export interface EngineSessionSnapshot {
  id: string
  name: string
  state: RunState
  elapsedMs: number
  capturesSystem: boolean
}

export interface EngineSnapshot {
  sessions: EngineSessionSnapshot[]
  selectedId: string | null
  unsavedPreviews: number
}

export type EngineAction = ShortcutAction | 'stopAll' | 'select'

export interface EngineCommand {
  action: EngineAction
  sessionId?: string
  origin: 'shortcut' | 'tray' | 'mini' | 'schedule'
}

export interface NotifyRequest {
  kind: ToastKind
  titleKey: string
  bodyKey?: string
  params?: Record<string, string | number>
  detail?: string
}

export interface AutostartStatus {
  supported: boolean
  enabled: boolean
  method: 'login-items' | 'xdg-autostart' | 'none'
  noteKey: string | null
}

export type Route = 'record' | 'archive' | 'favorites' | 'collections' | 'trash' | 'settings'

export interface InvokeMap {
  'app:bootstrap': { args: []; result: BootstrapData }
  'app:open-external': { args: [url: string]; result: void }
  'app:quit': { args: []; result: void }
  'settings:update': { args: [patch: SettingsPatch]; result: Settings }
  'settings:reset': { args: [category: SettingsCategory | 'all']; result: Settings }
  'settings:export': { args: []; result: string | null }
  'settings:import-preview': { args: []; result: SettingsImportPreview | null }
  'settings:import-apply': { args: [token: string, accepted: MachineFieldKey[]]; result: Settings }
  'profiles:list': { args: []; result: SettingsProfile[] }
  'profiles:save': { args: [name: string]; result: SettingsProfile[] }
  'profiles:apply': { args: [id: string]; result: Settings }
  'profiles:delete': { args: [id: string]; result: SettingsProfile[] }
  'dialog:choose-folder': { args: [initial: string | null]; result: string | null }
  'files:check-folder': { args: [path: string]; result: FolderCheck }
  'files:move-recordings': { args: [targetDir: string]; result: BulkResult }
  'files:open-recordings-folder': { args: []; result: void }
  'files:free-space': { args: [dir: string | null]; result: number | null }
  'rec:begin': { args: [init: RunInit]; result: void }
  'rec:update': { args: [runId: string, patch: RunPatch]; result: void }
  'rec:end': { args: [runId: string]; result: RunEndResult }
  'runs:list': { args: []; result: PendingRun[] }
  'runs:media': { args: [runId: string]; result: RunMedia[] }
  'runs:peaks': { args: [runId: string, track: TrackKind]; result: Uint8Array }
  'runs:save': { args: [runId: string, request: SaveRunRequest]; result: Recording[] }
  'runs:discard': { args: [runId: string]; result: void }
  'library:get': { args: []; result: LibrarySnapshot }
  'library:rename': { args: [id: string, name: string]; result: Recording }
  'library:update-meta': { args: [id: string, patch: MetaPatch]; result: Recording }
  'library:bulk': { args: [ids: string[], action: BulkAction]; result: BulkResult }
  'library:export': { args: [ids: string[], request: ExportRequest]; result: BulkResult | null }
  'library:import': { args: [paths: string[] | null]; result: BulkResult | null }
  'library:peaks': { args: [id: string]; result: Uint8Array | null }
  'library:media-url': { args: [id: string]; result: string }
  'library:apply-edit': { args: [id: string, request: EditRequest]; result: Recording }
  'library:restore': { args: [ids: string[]]; result: BulkResult }
  'library:delete-forever': { args: [ids: string[]]; result: BulkResult }
  'library:empty-trash': { args: []; result: BulkResult }
  'library:locate': { args: [id: string]; result: Recording | null }
  'library:refresh': { args: []; result: LibrarySnapshot }
  'library:folder-create': { args: [name: string]; result: LibrarySnapshot }
  'library:folder-rename': { args: [id: string, name: string]; result: LibrarySnapshot }
  'library:folder-delete': { args: [id: string]; result: LibrarySnapshot }
  'library:tag-create': { args: [name: string]; result: LibrarySnapshot }
  'library:tag-rename': { args: [id: string, name: string]; result: LibrarySnapshot }
  'library:tag-delete': { args: [id: string]; result: LibrarySnapshot }
  'library:search-transcripts': { args: [text: string]; result: string[] }
  'files:show': { args: [id: string]; result: void }
  'files:copy-path': { args: [id: string]; result: void }
  'files:share': { args: [ids: string[]]; result: boolean }
  'transcript:get': { args: [id: string]; result: Transcript | null }
  'transcribe:start': { args: [id: string]; result: string }
  'transcribe:cancel': { args: [jobId: string]; result: void }
  'transcribe:jobs': { args: []; result: TranscribeProgress[] }
  'transcribe:choose-model': { args: []; result: ModelInfo | null }
  'transcribe:model-info': { args: []; result: ModelInfo | null }
  'shortcuts:apply': { args: [bindings: ShortcutBindings, scope: ShortcutScope]; result: ShortcutStatus[] }
  'shortcuts:suspend': { args: [suspended: boolean]; result: ShortcutStatus[] }
  'shortcuts:status': { args: []; result: ShortcutStatus[] }
  'permissions:status': { args: []; result: PermissionStatus }
  'permissions:request-mic': { args: []; result: PermissionStatus }
  'permissions:open-settings': { args: [kind: 'microphone' | 'screen']; result: boolean }
  'autostart:status': { args: []; result: AutostartStatus }
  'update:check': { args: []; result: UpdateStatus }
  'update:download': { args: [installAfter: boolean]; result: UpdateStatus }
  'update:install': { args: []; result: UpdateStatus }
  'update:status': { args: []; result: UpdateStatus }
  'update:open-download': { args: []; result: void }
  'notify': { args: [request: NotifyRequest]; result: void }
  'logs:export': { args: []; result: string | null }
  'logs:open-folder': { args: []; result: void }
  'schedules:list': { args: []; result: Schedule[] }
  'schedules:save': { args: [schedules: Schedule[]]; result: Schedule[] }
  'window:mini': { args: [open: boolean]; result: boolean }
  'window:show-main': { args: [route: Route | null]; result: void }
  'engine:dispatch': { args: [command: EngineCommand]; result: void }
  'engine:snapshot': { args: []; result: EngineSnapshot }
}

export type InvokeChannel = keyof InvokeMap
export type InvokeArgs<C extends InvokeChannel> = InvokeMap[C]['args']
export type InvokeResult<C extends InvokeChannel> = InvokeMap[C]['result']

export type IpcEnvelope<T> = { ok: true; value: T } | { ok: false; errorKey: string; detail: string | null }

export interface SendMap {
  'rec:chunk': [runId: string, track: TrackKind, data: ArrayBuffer]
  'engine:state': [snapshot: EngineSnapshot]
  'engine:quit-ack': []
  'log:write': [level: 'info' | 'warn' | 'error', scope: string, message: string]
  'window:control': [action: 'minimize' | 'maximize' | 'close']
  'app:ready': []
}
export type SendChannel = keyof SendMap

export interface EventMap {
  'settings:changed': Settings
  'library:changed': LibrarySnapshot
  'runs:changed': PendingRun[]
  'engine:command': EngineCommand
  'engine:snapshot': EngineSnapshot
  'app:prepare-quit': null
  'update:status': UpdateStatus
  'transcribe:progress': TranscribeProgress
  'task:progress': TaskProgress
  'toast': ToastPayload
  'window:state': { maximized: boolean; focused: boolean }
  'shortcuts:status': ShortcutStatus[]
  'navigate': Route
  'schedules:changed': Schedule[]
  'rec:failed': { runId: string; errorKey: string }
}
export type EventChannel = keyof EventMap

export const INVOKE_CHANNELS = [
  'app:bootstrap',
  'app:open-external',
  'app:quit',
  'settings:update',
  'settings:reset',
  'settings:export',
  'settings:import-preview',
  'settings:import-apply',
  'profiles:list',
  'profiles:save',
  'profiles:apply',
  'profiles:delete',
  'dialog:choose-folder',
  'files:check-folder',
  'files:move-recordings',
  'files:open-recordings-folder',
  'files:free-space',
  'rec:begin',
  'rec:update',
  'rec:end',
  'runs:list',
  'runs:media',
  'runs:peaks',
  'runs:save',
  'runs:discard',
  'library:get',
  'library:rename',
  'library:update-meta',
  'library:bulk',
  'library:export',
  'library:import',
  'library:peaks',
  'library:media-url',
  'library:apply-edit',
  'library:restore',
  'library:delete-forever',
  'library:empty-trash',
  'library:locate',
  'library:refresh',
  'library:folder-create',
  'library:folder-rename',
  'library:folder-delete',
  'library:tag-create',
  'library:tag-rename',
  'library:tag-delete',
  'library:search-transcripts',
  'files:show',
  'files:copy-path',
  'files:share',
  'transcript:get',
  'transcribe:start',
  'transcribe:cancel',
  'transcribe:jobs',
  'transcribe:choose-model',
  'transcribe:model-info',
  'shortcuts:apply',
  'shortcuts:suspend',
  'shortcuts:status',
  'permissions:status',
  'permissions:request-mic',
  'permissions:open-settings',
  'autostart:status',
  'update:check',
  'update:download',
  'update:install',
  'update:status',
  'update:open-download',
  'notify',
  'logs:export',
  'logs:open-folder',
  'schedules:list',
  'schedules:save',
  'window:mini',
  'window:show-main',
  'engine:dispatch',
  'engine:snapshot'
] as const satisfies readonly InvokeChannel[]

export const SEND_CHANNELS = [
  'rec:chunk',
  'engine:state',
  'engine:quit-ack',
  'log:write',
  'window:control',
  'app:ready'
] as const satisfies readonly SendChannel[]

export const EVENT_CHANNELS = [
  'settings:changed',
  'library:changed',
  'runs:changed',
  'engine:command',
  'engine:snapshot',
  'app:prepare-quit',
  'update:status',
  'transcribe:progress',
  'task:progress',
  'toast',
  'window:state',
  'shortcuts:status',
  'navigate',
  'schedules:changed',
  'rec:failed'
] as const satisfies readonly EventChannel[]

// Compile-time checks that the whitelists above cover the whole contract.
type MissingInvoke = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>
type MissingSend = Exclude<SendChannel, (typeof SEND_CHANNELS)[number]>
type MissingEvent = Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>
export const IPC_WHITELISTS_COMPLETE: [MissingInvoke, MissingSend, MissingEvent] extends [never, never, never] ? true : never = true

export interface SonoraBridge {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<IpcEnvelope<InvokeResult<C>>>
  send<C extends SendChannel>(channel: C, ...args: SendMap[C]): void
  on<C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void): () => void
  getPathForFile(file: File): string
  setZoomFactor(factor: number): void
  platform: 'win32' | 'darwin' | 'linux'
  windowKind: WindowKind
}
