import { join } from 'node:path'
import { Menu, Notification, app, desktopCapturer, dialog, globalShortcut, nativeTheme, session, shell } from 'electron'
import type { BootstrapData, EngineCommand, EngineSnapshot, NotifyRequest } from '../shared/ipc'
import { effectiveDeveloper, whisperExtraArgs } from '../shared/developer'
import type { BinaryKind } from '../shared/developer'
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
import { bootFlagsFor } from './services/boot-flags'
import { localizeSessionNames } from '../shared/sessions'
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
// Unpackaged runs (tests, screenshots) can use an isolated data folder.
if (!app.isPackaged && process.env.SONORA_USER_DATA) app.setPath('userData', process.env.SONORA_USER_DATA)

// Chromium switches, including the developer ones, must be set before the app is ready.
const platformFeatures = loopbackFeatureFlags()
const appliedBoot = bootFlagsFor(app.getPath('userData'), platformFeatures)
if (appliedBoot.enableFeatures.length > 0) app.commandLine.appendSwitch('enable-features', appliedBoot.enableFeatures.join(','))
if (appliedBoot.disableFeatures.length > 0) app.commandLine.appendSwitch('disable-features', appliedBoot.disableFeatures.join(','))
if (!appliedBoot.hardwareAcceleration) app.disableHardwareAcceleration()
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
  // Started early and awaited only by the first bootstrap request, so it never delays the window.
  const installerLangPromise = installerLocale()
  const userData = app.getPath('userData')
  const logger = new Logger(join(userData, 'logs'))
  logger.info('app', `Sonora ${app.getVersion()} on ${process.platform} ${process.arch} ${process.getSystemVersion()} (${detectInstallKind()}${isWayland() ? ', wayland' : ''})`)
  process.on('uncaughtException', (err) => logger.error('process', 'uncaught exception', err))
  process.on('unhandledRejection', (err) => logger.error('process', 'unhandled rejection', err))

  // The OS appearance is captured before the app forces its own theme on native UI.
  const osTheme: ThemeName = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const settings = new SettingsStore(userData, logger)
  const loaded = await settings.load(osTheme)
  // Automatic session names ("Session 1") always follow the interface language.
  settings.setNormalizer((s) => {
    const res = localizeSessionNames(s.sessions, s.language ?? systemLocale())
    return res.changed ? { ...s, sessions: res.sessions } : s
  })
  nativeTheme.themeSource = settings.value.theme
  if (loaded.firstRun) logger.info('app', `first run, theme ${osTheme}`)
  const dev = () => effectiveDeveloper(settings.value.developer)
  logger.setLevel(dev().logging.level)
  if (settings.value.developer.enabled) {
    logger.info('dev', `developer mode on; chromium: hw=${appliedBoot.hardwareAcceleration} enable=${appliedBoot.enableFeatures.join(',') || '-'} disable=${appliedBoot.disableFeatures.join(',') || '-'}`)
  }

  // No default menu: its reload and DevTools shortcuts would bypass the recorder's safety. macOS
  // keeps the application, edit and window menus that text fields and Cmd+Q rely on.
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
  } else {
    Menu.setApplicationMenu(null)
  }

  const locale = (): Locale => settings.value.language ?? systemLocale()
  const t = (key: MessageKey, params?: TranslateParams): string => translate(locale(), key, params)

  const binDir = app.isPackaged ? join(process.resourcesPath, 'bin') : join(app.getAppPath(), 'vendor', 'bin', `${OS_NAME[process.platform]}-${process.arch}`)
  const exe = (name: string): string => join(binDir, process.platform === 'win32' ? `${name}.exe` : name)
  const iconsDir = app.isPackaged ? join(process.resourcesPath, 'icons') : join(app.getAppPath(), 'resources', 'icons')

  const bundledBinaries: Record<BinaryKind, string> = { ffmpeg: exe('ffmpeg'), ffprobe: exe('ffprobe'), whisper: exe('whisper-cli') }
  const binaryPath = (kind: BinaryKind): string => dev().binaries[kind] ?? bundledBinaries[kind]
  const tmpDir = join(app.getPath('temp'), 'sonora-sound-recorder')

  const ffmpeg = new Ffmpeg(binaryPath('ffmpeg'), binaryPath('ffprobe'), logger)
  ffmpeg.logCommands = dev().logging.commandLines
  if (!ffmpeg.available) logger.error('app', `ffmpeg not found at ${ffmpeg.ffmpegPath}`)

  const library = new LibraryStore({
    dataDir: userData,
    platform: currentPlatform(),
    logger,
    recordingsDir: () => settings.value.files.recordingsDir,
    layout: () => settings.value.files.layout
  })
  await library.load({ deferred: true })

  let windows: WindowManager | null = null
  const runs = new RunStore(join(userData, 'sessions'), logger, {
    onWriteError: (runId, err) => {
      const key = (err as NodeJS.ErrnoException).code === 'ENOSPC' ? 'errors.diskFull' : 'errors.writeFailed'
      windows?.sendMain('rec:failed', { runId, errorKey: key })
      notify({ kind: 'error', titleKey: 'notify.recordingFailed', bodyKey: key })
    },
    syncIntervalMs: () => dev().storage.syncIntervalMs
  })
  const audio = new AudioService({ ffmpeg, library, runs, logger, recordingsDir: () => settings.value.files.recordingsDir })
  await audio.recoverInterruptedReplaces()

  const transcription = new TranscriptionService({
    whisperPath: () => binaryPath('whisper'),
    ffmpeg,
    library,
    logger,
    tmpDir,
    modelPath: () => settings.value.transcription.modelPath,
    language: () => settings.value.transcription.language,
    threads: () => settings.value.transcription.threads,
    extraArgs: () => whisperExtraArgs(dev().whisper),
    keepTempFiles: () => dev().storage.keepTempFiles,
    logCommands: () => dev().logging.commandLines,
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
    allowPrerelease: () => dev().updates.allowPrerelease,
    emit: (s) => windows?.send('update:status', s)
  })

  let quitConfirmed = false
  let quitInProgress = false
  let quitAck: (() => void) | null = null
  let relaunchRequested = false

  windows = new WindowManager({
    settings,
    logger,
    preloadPath: join(__dirname, '../preload/index.js'),
    iconsDir,
    onHidden: () => logger.info('window', 'main window hidden to tray'),
    onFocusChange: (focused) => shortcuts.setAppFocused(focused),
    isQuitting: () => quitConfirmed,
    devToolsShortcut: () => settings.value.developer.enabled && settings.value.developer.ui.devToolsShortcut,
    miniHandlesKeys: () => settings.value.shortcuts.miniPanel,
    onMainRendererGone: async () => {
      // The recorder lost its audio graph: close its runs so they are offered as recovered recordings.
      await runs.endAll(true)
      quitAck?.()
      quitAck = null
      ctx.setEngineSnapshot({ sessions: [], selectedId: null, unsavedPreviews: 0 })
    }
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
      logger.info('app', relaunchRequested ? 'restarting' : 'quitting')
      if (relaunchRequested) app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') })
      app.quit()
    } finally {
      quitInProgress = false
    }
  }

  async function requestRelaunch(): Promise<void> {
    relaunchRequested = true
    await requestQuit()
    if (!quitConfirmed) relaunchRequested = false
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
    bootstrap: async (): Promise<BootstrapData> => ({
      settings: settings.value,
      capabilities: capabilities({ ffmpeg: ffmpeg.available, whisper: transcription.available }),
      version: app.getVersion(),
      systemLocale: systemLocale(),
      installerLocale: await installerLangPromise,
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
    requestRelaunch,
    developer: { bundledBinaries, binaryPath, appliedBoot, platformFeatures, binDir, tmpDir },
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
    if (s.shortcuts.scope !== prev.shortcuts.scope || JSON.stringify(s.shortcuts.bindings) !== JSON.stringify(prev.shortcuts.bindings)) {
      shortcuts.apply(s.shortcuts.bindings, s.shortcuts.scope)
    }
    const nextDev = effectiveDeveloper(s.developer)
    const prevDev = effectiveDeveloper(prev.developer)
    if (nextDev.logging.level !== prevDev.logging.level) logger.setLevel(nextDev.logging.level)
    ffmpeg.logCommands = nextDev.logging.commandLines
    if (JSON.stringify(nextDev.binaries) !== JSON.stringify(prevDev.binaries)) {
      ffmpeg.setPaths(binaryPath('ffmpeg'), binaryPath('ffprobe'))
      logger.info('dev', `binaries: ffmpeg=${ffmpeg.ffmpegPath} ffprobe=${ffmpeg.ffprobePath} whisper=${binaryPath('whisper')}`)
    }
    if (s.developer.enabled !== prev.developer.enabled) logger.info('dev', `developer mode ${s.developer.enabled ? 'on' : 'off'}`)
  })
  library.onChange((snap) => win.send('library:changed', snap))
  // Live log for the developer page; nothing is sent unless developer mode is on.
  logger.subscribe((entry) => {
    if (settings.value.developer.enabled) win.sendMain('dev:log', entry)
  })

  shortcuts.apply(settings.value.shortcuts.bindings, settings.value.shortcuts.scope)

  const loginLaunch =
    process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin && settings.value.startHiddenAtLogin)
  win.createMain(!loginLaunch)
  tray.create()
  if (settings.value.miniPanel.open) win.setMini(true)
  // Transcript search index and the missing-file check run after the window is up.
  setTimeout(() => void library.warmUp().catch((err) => logger.warn('library', `warm-up failed: ${(err as Error).message}`)), 1200)

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
