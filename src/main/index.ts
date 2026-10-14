import { join } from 'node:path'
import { Notification, app, desktopCapturer, dialog, globalShortcut, nativeTheme, session, shell } from 'electron'
import type { BootstrapData, EngineCommand, EngineSnapshot, NotifyRequest } from '../shared/ipc'
import { translate } from '../shared/i18n'
import type { MessageKey, TranslateParams } from '../shared/i18n'
import { shouldDeliver } from '../shared/notify-policy'
import { isBusy } from '../shared/state-machine'
import type { Locale, Schedule, ThemeName } from '../shared/types'
import { APP_ORIGIN, registerAppProtocol, registerMediaProtocol, registerSchemes } from './protocol'
import { registerIpc } from './ipc'
import type { AppContext } from './context'
import { WindowManager } from './windows'
import { TrayManager } from './tray'
import { Logger } from './services/logger'
import { SettingsStore } from './services/settings-store'
import { LibraryStore } from './services/library-store'
import { RunStore } from './services/run-store'
import { Ffmpeg } from './services/ffmpeg'
import { AudioService } from './services/audio-service'
import { TranscriptionService } from './services/transcription'
import { UpdateService } from './services/updater'
import { ShortcutService } from './services/shortcut-service'
import { JsonFile } from './services/json-store'
import { scheduleSchema } from '../shared/library-schema'
import {
  capabilities,
  currentPlatform,
  detectInstallKind,
  installerLocale,
  isWayland,
  loopbackFeatureFlags,
  setAutostart,
  systemLocale
} from './services/platform'

// ----------------------------------------------------------------------------- before ready
const featureFlags = loopbackFeatureFlags()
if (featureFlags.length > 0) app.commandLine.appendSwitch('enable-features', featureFlags.join(','))
if (process.platform === 'win32') app.setAppUserModelId('io.github.demirgitbuh.sonora')
registerSchemes()

const OS_NAME: Record<string, string> = { win32: 'win', darwin: 'mac', linux: 'linux' }

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()
  const userData = app.getPath('userData')
  const logger = new Logger(join(userData, 'logs'))
  logger.info('app', `Sonora ${app.getVersion()} on ${process.platform} ${process.arch} ${process.getSystemVersion()} (${detectInstallKind()}${isWayland() ? ', wayland' : ''})`)
  process.on('uncaughtException', (err) => logger.error('process', 'uncaught exception', err))
  process.on('unhandledRejection', (err) => logger.error('process', 'unhandled rejection', err))

  // The OS appearance is captured before the app forces its own theme on native UI.
  const osTheme: ThemeName = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const settings = new SettingsStore(userData, logger)
  const loaded = await settings.load(osTheme)
  nativeTheme.themeSource = settings.value.theme
  if (loaded.firstRun) logger.info('app', `first run, theme ${osTheme}`)

  const locale = (): Locale => settings.value.language ?? systemLocale()
  const t = (key: MessageKey, params?: TranslateParams): string => translate(locale(), key, params)

  const binDir = app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'vendor', 'bin', `${OS_NAME[process.platform]}-${process.arch}`)
  const exe = (name: string): string => join(binDir, process.platform === 'win32' ? `${name}.exe` : name)
  const iconsDir = app.isPackaged ? join(process.resourcesPath, 'icons') : join(app.getAppPath(), 'resources', 'icons')

  const ffmpeg = new Ffmpeg(exe('ffmpeg'), exe('ffprobe'), logger)
  if (!ffmpeg.available) logger.error('app', `ffmpeg not found in ${binDir}`)

  const library = new LibraryStore({
    dataDir: userData,
    platform: currentPlatform(),
    logger,
    recordingsDir: () => settings.value.files.recordingsDir,
    layout: () => settings.value.files.layout
  })
  await library.load()

  let windows: WindowManager | null = null
  const runs = new RunStore(join(userData, 'sessions'), logger, {
    onWriteError: (runId, err) => {
      const key = (err as NodeJS.ErrnoException).code === 'ENOSPC' ? 'errors.diskFull' : 'errors.writeFailed'
      windows?.sendMain('rec:failed', { runId, errorKey: key })
      notify({ kind: 'error', titleKey: 'notify.recordingFailed', bodyKey: key })
    }
  })
  const audio = new AudioService({ ffmpeg, library, runs, logger, recordingsDir: () => settings.value.files.recordingsDir })
  await audio.recoverInterruptedReplaces()

  const transcription = new TranscriptionService({
    whisperPath: exe('whisper-cli'),
    ffmpeg,
    library,
    logger,
    tmpDir: join(app.getPath('temp'), 'sonora-sound-recorder'),
    modelPath: () => settings.value.transcription.modelPath,
    language: () => settings.value.transcription.language,
    threads: () => settings.value.transcription.threads,
    emit: (p) => windows?.send('transcribe:progress', p)
  })

  const schedules = new JsonFile<{ schemaVersion: number; schedules: Schedule[] }>(join(userData, 'schedules.json'), logger, 'schedules', {
    schemaVersion: 1,
    schedules: []
  })
  const rawSchedules = await schedules.loadRaw()
  if (rawSchedules) {
    const list = Array.isArray((rawSchedules.raw as { schedules?: unknown }).schedules) ? (rawSchedules.raw as { schedules: unknown[] }).schedules : []
    schedules.set({ schemaVersion: 1, schedules: list.flatMap((s) => (scheduleSchema.safeParse(s).success ? [s as Schedule] : [])) })
  }

  let engineSnapshot: EngineSnapshot = { sessions: [], selectedId: null, unsavedPreviews: 0 }
  const anyBusy = (): boolean => engineSnapshot.sessions.some((s) => isBusy(s.state))

  const updates = new UpdateService({
    logger,
    currentVersion: app.getVersion(),
    installKind: detectInstallKind(),
    arch: process.arch,
    isPackaged: app.isPackaged,
    downloadsDir: () => app.getPath('downloads'),
    isBusy: anyBusy,
    beforeInstall: async () => {
      quitConfirmed = true
      await Promise.all([settings.flush(), library.flush(), schedules.flush()])
      globalShortcut.unregisterAll()
    },
    emit: (s) => windows?.send('update:status', s)
  })

  let quitConfirmed = false
  let quitInProgress = false
  let quitAck: (() => void) | null = null

  windows = new WindowManager({
    settings,
    logger,
    preloadPath: join(__dirname, '../preload/index.js'),
    iconsDir,
    onHidden: () => logger.info('window', 'main window hidden to tray'),
    onFocusChange: (focused) => shortcuts.setAppFocused(focused),
    isQuitting: () => quitConfirmed
  })
  const win = windows

  const caps = capabilities({ ffmpeg: ffmpeg.available, whisper: transcription.available })
  const shortcuts = new ShortcutService(
    globalShortcut,
    (action) => dispatch({ action, origin: 'shortcut' }),
    logger,
    (status) => win.send('shortcuts:status', status),
    caps.globalShortcuts !== 'unsupported'
  )

  function dispatch(cmd: EngineCommand): void {
    win.sendMain('engine:command', cmd)
  }

  function notify(req: NotifyRequest): void {
    const prefs = settings.value.notifications
    const params = req.params ?? {}
    const anyFocused = !!(win.main?.isFocused() || win.mini?.isFocused())
    if (!anyFocused && shouldDeliver(prefs, req.kind, 'desktop') && Notification.isSupported()) {
      const body = [req.bodyKey ? t(req.bodyKey as MessageKey, params) : '', req.detail ?? ''].filter(Boolean).join('\n')
      // Desktop notifications are always silent so no system sound can end up in a recording.
      const n = new Notification({ title: t(req.titleKey as MessageKey, params), body, silent: true })
      n.on('click', () => win.showMain(null))
      n.show()
    }
    if (shouldDeliver(prefs, req.kind, 'inApp')) {
      win.sendMain('toast', { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...req })
    }
  }

  const tray = new TrayManager({
    iconsDir,
    logger,
    t,
    dispatch,
    showMain: (route) => win.showMain(route),
    openRecordingsFolder: () => {
      const dir = settings.value.files.recordingsDir
      if (dir) void shell.openPath(dir)
      else win.showMain('settings')
    },
    toggleMini: () => {
      const open = win.setMini(!(win.mini && !win.mini.isDestroyed()))
      settings.update({ miniPanel: { open } })
      tray.refresh()
    },
    miniOpen: () => !!win.mini && !win.mini.isDestroyed(),
    quit: () => void requestQuit()
  })

  const installerLang = await installerLocale()

  async function requestQuit(): Promise<void> {
    if (quitConfirmed) {
      app.quit()
      return
    }
    if (quitInProgress) return
    quitInProgress = true
    try {
      const busy = engineSnapshot.sessions.filter((s) => isBusy(s.state)).length
      const unsaved = engineSnapshot.unsavedPreviews
      if (busy > 0 || unsaved > 0) {
        const parent = win.main && win.main.isVisible() ? win.main : undefined
        const options: Electron.MessageBoxOptions = {
          type: 'question',
          buttons: [t('quit.confirm'), t('common.cancel')],
          defaultId: 1,
          cancelId: 1,
          title: 'Sonora Sound Recorder',
          message: t('quit.title'),
          detail: t('quit.detail', { recording: busy, unsaved })
        }
        const res = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
        if (res.response !== 0) return
        // Ask the recorder to stop every capture; the audio stays on disk as unsaved recordings.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 15000)
          quitAck = () => {
            clearTimeout(timer)
            resolve()
          }
          win.sendMain('app:prepare-quit', null)
        })
      }
      await runs.endAll()
      transcription.cancelAll()
      await Promise.all([settings.flush(), library.flush(), schedules.flush()])
      shortcuts.unregisterAll()
      quitConfirmed = true
      logger.info('app', 'quitting')
      app.quit()
    } finally {
      quitInProgress = false
    }
  }

  const ctx: AppContext = {
    logger,
    settings,
    library,
    runs,
    ffmpeg,
    audio,
    transcription,
    updates,
    shortcuts,
    windows: win,
    tray,
    schedules,
    t,
    systemTheme: () => osTheme,
    defaultRecordingsDir: () => join(app.getPath('music'), 'Sonora Recordings'),
    bootstrap: (): BootstrapData => ({
      settings: settings.value,
      capabilities: capabilities({ ffmpeg: ffmpeg.available, whisper: transcription.available }),
      version: app.getVersion(),
      systemLocale: systemLocale(),
      installerLocale: installerLang,
      systemTheme: osTheme,
      defaultRecordingsDir: join(app.getPath('music'), 'Sonora Recordings'),
      dataDir: userData
    }),
    notify,
    dispatch,
    engineSnapshot: () => engineSnapshot,
    setEngineSnapshot: (s) => {
      engineSnapshot = s
      tray.update(s)
      win.send('engine:snapshot', s)
      if (!anyBusy()) updates.onIdle()
    },
    broadcastRuns: async () => {
      win.send('runs:changed', await runs.listPending())
    },
    requestQuit,
    onQuitAck: () => {
      quitAck?.()
      quitAck = null
    },
    onRendererReady: (w) => {
      if (w && w === win.main && settings.value.updates.checkOnStartup && app.isPackaged && updates.current.phase === 'idle') {
        void updates.check()
      }
    }
  }

  // ----------------------------------------------------------------------------- protocols & permissions
  registerAppProtocol(join(__dirname, '../renderer'))
  registerMediaProtocol(library, runs)

  const isOurs = (url: string): boolean => {
    if (url.startsWith(APP_ORIGIN)) return true
    const dev = process.env.ELECTRON_RENDERER_URL
    return !app.isPackaged && !!dev && url.startsWith(dev)
  }
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = details.requestingUrl || wc.getURL()
    callback(isOurs(url) && (permission === 'media' || permission === 'display-capture' || permission === 'clipboard-sanitized-write'))
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => isOurs(origin) && (permission === 'media' || permission === 'clipboard-sanitized-write'))
  // System audio: getDisplayMedia is answered with the first screen as (discarded) video
  // and the platform loopback device as audio.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isOurs(request.securityOrigin ?? request.frame?.url ?? '')) {
        callback({})
        return
      }
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const source = sources[0]
          if (!source) {
            logger.warn('capture', 'no screen source available for system audio capture')
            callback({})
            return
          }
          callback(request.audioRequested ? { video: source, audio: 'loopback' } : { video: source })
        })
        .catch((err) => {
          logger.error('capture', 'desktopCapturer failed', err)
          callback({})
        })
    },
    { useSystemPicker: false }
  )

  registerIpc(ctx)

  settings.onChange((s, prev) => {
    win.send('settings:changed', s)
    if (s.theme !== prev.theme) {
      nativeTheme.themeSource = s.theme
      win.applyTheme(s.theme)
    }
    if (s.language !== prev.language) tray.refresh()
    if (s.launchAtLogin !== prev.launchAtLogin || s.startHiddenAtLogin !== prev.startHiddenAtLogin) {
      void setAutostart(s.launchAtLogin, s.startHiddenAtLogin, logger)
    }
    if (JSON.stringify(s.shortcuts) !== JSON.stringify(prev.shortcuts)) shortcuts.apply(s.shortcuts.bindings, s.shortcuts.scope)
  })
  library.onChange((snap) => win.send('library:changed', snap))

  shortcuts.apply(settings.value.shortcuts.bindings, settings.value.shortcuts.scope)

  const loginLaunch =
    process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin && settings.value.startHiddenAtLogin)
  win.createMain(!loginLaunch)
  tray.create()
  if (settings.value.miniPanel.open) win.setMini(true)

  app.on('second-instance', () => win.showMain(null))
  app.on('activate', () => win.showMain(null))
  app.on('before-quit', (event) => {
    if (quitConfirmed) return
    event.preventDefault()
    void requestQuit()
  })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    tray.destroy()
  })
  // The app lives in the tray; closing windows never quits it.
  app.on('window-all-closed', () => undefined)
}
