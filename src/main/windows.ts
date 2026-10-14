import { join } from 'node:path'
import { BrowserWindow, app, nativeImage, screen, shell } from 'electron'
import type { EventChannel, EventMap, Route } from '../shared/ipc'
import type { ThemeName } from '../shared/types'
import { APP_ORIGIN } from './protocol'
import type { Logger } from './services/logger'
import type { SettingsStore } from './services/settings-store'

export const THEME_BACKGROUND: Record<ThemeName, string> = { light: '#F8F8FF', dark: '#20292F' }
const OVERLAY_SYMBOL: Record<ThemeName, string> = { light: '#36454F', dark: '#F8F8FF' }
export const TITLEBAR_HEIGHT = 44

interface Deps {
  settings: SettingsStore
  logger: Logger
  preloadPath: string
  iconsDir: string
  /** Called when the main window is closed by the user (hide to tray). */
  onHidden: () => void
  onFocusChange: (anyFocused: boolean) => void
  isQuitting: () => boolean
}

function rendererUrl(kind: 'main' | 'mini'): string {
  const hash = kind === 'mini' ? '#mini' : ''
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && dev) return `${dev}/index.html${hash}`
  return `${APP_ORIGIN}/index.html${hash}`
}

/** Owns the main window and the optional mini recording panel. */
export class WindowManager {
  main: BrowserWindow | null = null
  mini: BrowserWindow | null = null
  private focusTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: Deps) {}

  private secure(win: BrowserWindow): void {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      const allowed = url.startsWith(APP_ORIGIN) || (!!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))
      if (!allowed) event.preventDefault()
    })
    win.on('focus', () => this.focusChanged())
    win.on('blur', () => this.focusChanged())
  }

  private focusChanged(): void {
    // Moving focus between the main window and the mini panel fires blur then focus quickly.
    if (this.focusTimer) clearTimeout(this.focusTimer)
    this.focusTimer = setTimeout(() => {
      const focused = BrowserWindow.getFocusedWindow()
      const ours = !!focused && (focused === this.main || focused === this.mini)
      this.deps.onFocusChange(ours)
      this.send('window:state', { maximized: this.main?.isMaximized() ?? false, focused: ours })
    }, 80)
  }

  createMain(show: boolean): BrowserWindow {
    const s = this.deps.settings.value
    const theme = s.theme
    const bounds = this.restoreBounds(s.window.width, s.window.height, s.window.x, s.window.y)
    const platform = process.platform
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 760,
      minHeight: 560,
      show: false,
      title: 'Sonora Sound Recorder',
      backgroundColor: THEME_BACKGROUND[theme],
      icon: platform === 'linux' ? join(this.deps.iconsDir, 'app-256.png') : undefined,
      frame: platform === 'linux' ? false : undefined,
      titleBarStyle: platform === 'darwin' ? 'hiddenInset' : platform === 'win32' ? 'hidden' : undefined,
      titleBarOverlay:
        platform === 'win32' ? { color: THEME_BACKGROUND[theme], symbolColor: OVERLAY_SYMBOL[theme], height: TITLEBAR_HEIGHT } : undefined,
      trafficLightPosition: platform === 'darwin' ? { x: 16, y: 15 } : undefined,
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        // Recording keeps running while the window is hidden in the tray.
        backgroundThrottling: false,
        additionalArguments: ['--sonora-window=main']
      }
    })
    this.secure(win)
    if (s.window.maximized) win.maximize()
    win.once('ready-to-show', () => {
      if (show) win.show()
    })
    win.on('close', (event) => {
      if (this.deps.isQuitting()) return
      event.preventDefault()
      win.hide()
      this.deps.onHidden()
    })
    win.on('maximize', () => this.send('window:state', { maximized: true, focused: win.isFocused() }))
    win.on('unmaximize', () => this.send('window:state', { maximized: false, focused: win.isFocused() }))
    const saveBounds = (): void => {
      if (win.isDestroyed() || win.isMinimized()) return
      const maximized = win.isMaximized()
      const b = win.getNormalBounds()
      this.deps.settings.update({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized } })
    }
    let boundsTimer: NodeJS.Timeout | null = null
    const scheduleBounds = (): void => {
      if (boundsTimer) clearTimeout(boundsTimer)
      boundsTimer = setTimeout(saveBounds, 600)
    }
    win.on('resize', scheduleBounds)
    win.on('move', scheduleBounds)
    win.webContents.on('render-process-gone', (_e, details) => {
      this.deps.logger.error('window', `renderer gone: ${details.reason} (${details.exitCode})`)
      if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload()
    })
    void win.loadURL(rendererUrl('main'))
    this.main = win
    return win
  }

  private restoreBounds(width: number | null, height: number | null, x: number | null, y: number | null): Electron.Rectangle | { width: number; height: number } {
    const w = width ?? 1240
    const h = height ?? 820
    if (x === null || y === null) return { width: w, height: h }
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return x + 80 > a.x && x < a.x + a.width - 80 && y >= a.y - 10 && y < a.y + a.height - 80
    })
    return visible ? { width: w, height: h, x, y } : { width: w, height: h }
  }

  showMain(route: Route | null = null): void {
    if (!this.main || this.main.isDestroyed()) this.createMain(true)
    const win = this.main!
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (route) this.send('navigate', route)
  }

  setMini(open: boolean): boolean {
    if (!open) {
      if (this.mini && !this.mini.isDestroyed()) this.mini.destroy()
      this.mini = null
      return false
    }
    if (this.mini && !this.mini.isDestroyed()) {
      this.mini.showInactive()
      return true
    }
    const s = this.deps.settings.value
    const theme = s.theme
    const width = 340
    const height = 132
    const area = screen.getPrimaryDisplay().workArea
    const x = s.miniPanel.x ?? area.x + area.width - width - 24
    const y = s.miniPanel.y ?? area.y + area.height - height - 24
    const mini = new BrowserWindow({
      width,
      height,
      x,
      y,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Sonora',
      backgroundColor: THEME_BACKGROUND[theme],
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        additionalArguments: ['--sonora-window=mini']
      }
    })
    this.secure(mini)
    mini.setAlwaysOnTop(true, 'floating')
    mini.once('ready-to-show', () => mini.showInactive())
    mini.on('moved', () => {
      const b = mini.getBounds()
      this.deps.settings.update({ miniPanel: { x: b.x, y: b.y } })
    })
    mini.on('closed', () => {
      if (this.mini === mini) this.mini = null
    })
    void mini.loadURL(rendererUrl('mini'))
    this.mini = mini
    return true
  }

  applyTheme(theme: ThemeName): void {
    for (const win of [this.main, this.mini]) {
      if (!win || win.isDestroyed()) continue
      win.setBackgroundColor(THEME_BACKGROUND[theme])
    }
    if (process.platform === 'win32' && this.main && !this.main.isDestroyed()) {
      try {
        this.main.setTitleBarOverlay({ color: THEME_BACKGROUND[theme], symbolColor: OVERLAY_SYMBOL[theme], height: TITLEBAR_HEIGHT })
      } catch (err) {
        this.deps.logger.warn('window', `title bar overlay update failed: ${(err as Error).message}`)
      }
    }
  }

  send<C extends EventChannel>(channel: C, payload: EventMap[C]): void {
    for (const win of [this.main, this.mini]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  sendMain<C extends EventChannel>(channel: C, payload: EventMap[C]): void {
    if (this.main && !this.main.isDestroyed()) this.main.webContents.send(channel, payload)
  }

  windowControl(action: 'minimize' | 'maximize' | 'close'): void {
    const win = this.main
    if (!win || win.isDestroyed()) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else win.close()
  }

  appIcon(): Electron.NativeImage {
    return nativeImage.createFromPath(join(this.deps.iconsDir, 'app-256.png'))
  }
}
