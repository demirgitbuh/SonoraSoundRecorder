import { join } from 'node:path'
import { Menu, Tray, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import type { EngineCommand, EngineSnapshot, Route } from '../shared/ipc'
import type { MessageKey, TranslateParams } from '../shared/i18n'
import type { RunState } from '../shared/types'
import type { Logger } from './services/logger'

interface Deps {
  iconsDir: string
  logger: Logger
  t: (key: MessageKey, params?: TranslateParams) => string
  dispatch: (cmd: EngineCommand) => void
  showMain: (route: Route | null) => void
  openRecordingsFolder: () => void
  toggleMini: () => void
  miniOpen: () => boolean
  quit: () => void
}

const STATE_KEYS: Record<RunState, MessageKey> = {
  ready: 'state.ready',
  countdown: 'state.countdown',
  recording: 'state.recording',
  paused: 'state.paused',
  finalizing: 'state.finalizing',
  preview: 'state.preview',
  exporting: 'state.exporting',
  recoverable: 'state.recoverable',
  error: 'state.error'
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(h)}:${p(m)}:${p(s)}`
}

/** System tray icon and menu. Closing the window hides to the tray and keeps recordings running. */
export class TrayManager {
  private tray: Tray | null = null
  private snapshot: EngineSnapshot = { sessions: [], selectedId: null, unsavedPreviews: 0 }
  private lastMenuKey = ''
  private icons: { idle: NativeImage; recording: NativeImage } | null = null

  constructor(private readonly deps: Deps) {}

  private loadIcons(): { idle: NativeImage; recording: NativeImage } {
    const dir = this.deps.iconsDir
    if (process.platform === 'darwin') {
      const idle = nativeImage.createFromPath(join(dir, 'trayTemplate.png'))
      idle.setTemplateImage(true)
      return { idle, recording: idle }
    }
    const make = (base: string): NativeImage => {
      if (process.platform === 'win32') {
        const img = nativeImage.createFromPath(join(dir, `${base}-16.png`))
        const hi = nativeImage.createFromPath(join(dir, `${base}-32.png`))
        if (!hi.isEmpty()) img.addRepresentation({ scaleFactor: 2, buffer: hi.toPNG() })
        return img
      }
      return nativeImage.createFromPath(join(dir, `${base}-32.png`))
    }
    return { idle: make('tray'), recording: make('tray-recording') }
  }

  create(): void {
    try {
      this.icons = this.loadIcons()
      if (this.icons.idle.isEmpty()) this.deps.logger.warn('tray', 'tray icon could not be loaded')
      this.tray = new Tray(this.icons.idle)
      this.tray.setToolTip('Sonora Sound Recorder')
      this.tray.on('click', () => {
        if (process.platform !== 'darwin') this.deps.showMain(null)
      })
      this.render(true)
    } catch (err) {
      this.deps.logger.error('tray', 'could not create tray icon', err)
    }
  }

  update(snapshot: EngineSnapshot): void {
    this.snapshot = snapshot
    this.render(false)
  }

  /** Re-renders after a language change. */
  refresh(): void {
    this.render(true)
  }

  private render(force: boolean): void {
    if (!this.tray) return
    const { t } = this.deps
    const s = this.snapshot
    const selected = s.sessions.find((x) => x.id === s.selectedId) ?? s.sessions[0]
    const state: RunState = selected?.state ?? 'ready'
    const anyRecording = s.sessions.some((x) => x.state === 'recording' || x.state === 'paused')
    const elapsed = selected && (state === 'recording' || state === 'paused') ? formatElapsed(selected.elapsedMs) : null
    const key = JSON.stringify([s, this.deps.miniOpen(), elapsed])
    if (!force && key === this.lastMenuKey) return
    this.lastMenuKey = key

    const statusLine = selected
      ? t('tray.statusLine', { session: selected.name, state: t(STATE_KEYS[state]), time: elapsed ?? '--:--:--' })
      : t('state.ready')
    const capturing = state === 'recording' || state === 'paused'
    const canStart = state === 'ready' || state === 'error'
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Sonora Sound Recorder', enabled: false },
      { label: statusLine, enabled: false },
      ...(s.sessions.length > 1 ? [{ label: t('tray.controlling', { session: selected?.name ?? '' }), enabled: false }] : []),
      { type: 'separator' },
      {
        label: capturing ? t('tray.stop') : t('tray.start'),
        enabled: capturing || canStart || state === 'countdown',
        click: () => this.deps.dispatch({ action: 'toggleRecord', origin: 'tray' })
      },
      {
        label: state === 'paused' ? t('tray.resume') : t('tray.pause'),
        enabled: capturing,
        click: () => this.deps.dispatch({ action: 'togglePause', origin: 'tray' })
      },
      ...(s.sessions.length > 1
        ? [
            {
              label: t('tray.selectSession'),
              submenu: s.sessions.map((x) => ({
                label: `${x.name} — ${t(STATE_KEYS[x.state])}`,
                type: 'radio' as const,
                checked: x.id === selected?.id,
                click: () => this.deps.dispatch({ action: 'select', sessionId: x.id, origin: 'tray' })
              }))
            }
          ]
        : []),
      { type: 'separator' },
      { label: t('tray.miniPanel'), type: 'checkbox', checked: this.deps.miniOpen(), click: () => this.deps.toggleMini() },
      { label: t('tray.openFolder'), click: () => this.deps.openRecordingsFolder() },
      { label: t('tray.settings'), click: () => this.deps.showMain('settings') },
      { label: t('tray.show'), click: () => this.deps.showMain(null) },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => this.deps.quit() }
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
    this.tray.setToolTip(`Sonora Sound Recorder — ${statusLine}`)
    if (this.icons && process.platform !== 'darwin') this.tray.setImage(anyRecording ? this.icons.recording : this.icons.idle)
    if (process.platform === 'darwin') this.tray.setTitle(anyRecording && elapsed ? ` ${state === 'paused' ? '❚❚' : '●'} ${elapsed}` : '')
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
