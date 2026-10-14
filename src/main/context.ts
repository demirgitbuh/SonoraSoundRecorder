import type { BrowserWindow } from 'electron'
import type { BootstrapData, EngineCommand, EngineSnapshot, NotifyRequest } from '../shared/ipc'
import type { MessageKey, TranslateParams } from '../shared/i18n'
import type { Schedule, ThemeName } from '../shared/types'
import type { AudioService } from './services/audio-service'
import type { Ffmpeg } from './services/ffmpeg'
import type { JsonFile } from './services/json-store'
import type { LibraryStore } from './services/library-store'
import type { Logger } from './services/logger'
import type { RunStore } from './services/run-store'
import type { SettingsStore } from './services/settings-store'
import type { ShortcutService } from './services/shortcut-service'
import type { TranscriptionService } from './services/transcription'
import type { UpdateService } from './services/updater'
import type { TrayManager } from './tray'
import type { WindowManager } from './windows'

/** Everything the IPC layer needs from the running application. */
export interface AppContext {
  logger: Logger
  settings: SettingsStore
  library: LibraryStore
  runs: RunStore
  ffmpeg: Ffmpeg
  audio: AudioService
  transcription: TranscriptionService
  updates: UpdateService
  shortcuts: ShortcutService
  windows: WindowManager
  tray: TrayManager
  schedules: JsonFile<{ schemaVersion: number; schedules: Schedule[] }>
  t: (key: MessageKey, params?: TranslateParams) => string
  systemTheme: () => ThemeName
  defaultRecordingsDir: () => string
  bootstrap: () => BootstrapData
  notify: (req: NotifyRequest) => void
  dispatch: (cmd: EngineCommand) => void
  engineSnapshot: () => EngineSnapshot
  setEngineSnapshot: (s: EngineSnapshot) => void
  broadcastRuns: () => Promise<void>
  requestQuit: () => Promise<void>
  onQuitAck: () => void
  onRendererReady: (win: BrowserWindow | null) => void
}
