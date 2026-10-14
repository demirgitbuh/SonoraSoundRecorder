import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, shell, systemPreferences } from 'electron'
import type { AutostartStatus } from '../../shared/ipc'
import type { InstallKind, Locale, MediaPermission, PermissionStatus, PlatformCapabilities } from '../../shared/types'
import type { Logger } from './logger'

export type Platform = 'win32' | 'darwin' | 'linux'

export function currentPlatform(): Platform {
  return process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
}

export function isWayland(): boolean {
  return process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
}

export function detectInstallKind(): InstallKind {
  if (!app.isPackaged) return 'dev'
  if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'nsis'
  if (process.platform === 'darwin') return 'dmg'
  return process.env.APPIMAGE ? 'appimage' : 'deb'
}

function macMajor(): number {
  return Number(process.getSystemVersion().split('.')[0] ?? 0)
}

/**
 * Chromium feature switches that enable system audio loopback for getDisplayMedia. They must be
 * appended before the app is ready. Unknown features are ignored by Chromium.
 */
export function loopbackFeatureFlags(): string[] {
  if (process.platform === 'darwin') return ['MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride']
  if (process.platform === 'linux') return ['PulseaudioLoopbackForScreenShare', 'GlobalShortcutsPortal']
  return []
}

export function capabilities(binaries: { ffmpeg: boolean; whisper: boolean }): PlatformCapabilities {
  const platform = currentPlatform()
  let systemAudio: PlatformCapabilities['systemAudio']
  if (platform === 'win32') {
    systemAudio = { status: 'supported', method: 'wasapi-loopback' }
  } else if (platform === 'darwin') {
    if (macMajor() < 13) {
      systemAudio = { status: 'unsupported', method: 'none' }
    } else {
      const screen = systemPreferences.getMediaAccessStatus('screen')
      systemAudio = { status: screen === 'granted' ? 'supported' : 'needs-permission', method: 'screencapturekit' }
    }
  } else {
    systemAudio = { status: 'supported', method: 'pulse-loopback' }
  }
  return {
    platform,
    arch: process.arch,
    osVersion: process.getSystemVersion(),
    isWayland: isWayland(),
    isPackaged: app.isPackaged,
    installKind: detectInstallKind(),
    systemAudio,
    nativeShare: platform === 'darwin',
    autostart: app.isPackaged,
    globalShortcuts: isWayland() ? 'portal' : 'supported',
    ffmpeg: binaries.ffmpeg,
    whisper: binaries.whisper
  }
}

function mapStatus(s: string): MediaPermission {
  if (s === 'granted' || s === 'denied' || s === 'restricted' || s === 'not-determined') return s
  return 'unknown'
}

export function permissionStatus(): PermissionStatus {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return {
      microphone: mapStatus(systemPreferences.getMediaAccessStatus('microphone')),
      screen: process.platform === 'darwin' ? mapStatus(systemPreferences.getMediaAccessStatus('screen')) : 'unknown'
    }
  }
  // Linux has no OS-level media permission API; access is decided by PipeWire/PulseAudio.
  return { microphone: 'unknown', screen: 'unknown' }
}

export async function requestMicrophone(): Promise<PermissionStatus> {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('microphone')
  }
  return permissionStatus()
}

export async function openPermissionSettings(kind: 'microphone' | 'screen'): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      const pane = kind === 'microphone' ? 'Privacy_Microphone' : 'Privacy_ScreenCapture'
      await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
      return true
    }
    if (process.platform === 'win32' && kind === 'microphone') {
      await shell.openExternal('ms-settings:privacy-microphone')
      return true
    }
  } catch {
    return false
  }
  return false
}

const LCID_TO_LOCALE: Record<string, Locale> = {
  '1033': 'en',
  '1055': 'tr',
  '1031': 'de',
  '1036': 'fr',
  '2052': 'zh',
  '1049': 'ru'
}

/** Language chosen in the Windows installer (written by build/installer.nsh), if any. */
export function installerLocale(): Promise<Locale | null> {
  if (process.platform !== 'win32' || !app.isPackaged) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\SonoraSoundRecorder', '/v', 'InstallerLanguage'], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = /InstallerLanguage\s+REG_SZ\s+(\d+)/.exec(stdout)
      resolve(m ? (LCID_TO_LOCALE[m[1]!] ?? null) : null)
    })
  })
}

export function systemLocale(): Locale {
  const raw = (app.getPreferredSystemLanguages()[0] ?? app.getLocale() ?? 'en').toLowerCase()
  if (raw.startsWith('tr')) return 'tr'
  if (raw.startsWith('de')) return 'de'
  if (raw.startsWith('fr')) return 'fr'
  if (raw.startsWith('zh')) return 'zh'
  if (raw.startsWith('ru')) return 'ru'
  return 'en'
}

// ---------------------------------------------------------------------------
// Launch at login
// ---------------------------------------------------------------------------

const AUTOSTART_FILE = join(homedir(), '.config', 'autostart', 'sonora-sound-recorder.desktop')

function linuxExecPath(): string {
  return process.env.APPIMAGE || process.execPath
}

export function autostartStatus(): AutostartStatus {
  if (!app.isPackaged) return { supported: false, enabled: false, method: 'none', noteKey: 'settings.general.autostartDev' }
  if (process.platform === 'linux') {
    return {
      supported: true,
      enabled: existsSync(AUTOSTART_FILE),
      method: 'xdg-autostart',
      noteKey: process.env.APPIMAGE ? 'settings.general.autostartAppImage' : null
    }
  }
  const s = app.getLoginItemSettings(process.env.PORTABLE_EXECUTABLE_FILE ? { path: process.env.PORTABLE_EXECUTABLE_FILE } : undefined)
  return {
    supported: true,
    enabled: s.openAtLogin,
    method: 'login-items',
    noteKey: process.env.PORTABLE_EXECUTABLE_FILE ? 'settings.general.autostartPortable' : null
  }
}

export async function setAutostart(enabled: boolean, hidden: boolean, logger: Logger): Promise<AutostartStatus> {
  if (!app.isPackaged) return autostartStatus()
  try {
    if (process.platform === 'linux') {
      if (enabled) {
        await mkdir(join(homedir(), '.config', 'autostart'), { recursive: true })
        const exec = `"${linuxExecPath().replace(/"/g, '\\"')}"${hidden ? ' --hidden' : ''}`
        const entry = [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Sonora Sound Recorder',
          `Exec=${exec}`,
          'X-GNOME-Autostart-enabled=true',
          'Terminal=false',
          ''
        ].join('\n')
        await writeFile(AUTOSTART_FILE, entry, 'utf8')
      } else {
        await rm(AUTOSTART_FILE, { force: true })
      }
    } else {
      const portable = process.env.PORTABLE_EXECUTABLE_FILE
      app.setLoginItemSettings({
        openAtLogin: enabled,
        ...(portable ? { path: portable } : {}),
        args: hidden ? ['--hidden'] : []
      })
    }
  } catch (err) {
    logger.error('autostart', 'could not update login item', err)
  }
  return autostartStatus()
}
