import type { ToastKind } from './types'

export interface NotificationPrefs {
  desktop: boolean
  sounds: boolean
  scope: 'all' | 'errors'
  inApp: boolean
}

export type NotificationChannel = 'desktop' | 'inApp'

/**
 * The scope decides *which* events are delivered; the channel switches decide *where*.
 * "Errors only" therefore narrows both desktop notifications and in-app cards, and a disabled
 * channel never receives anything regardless of scope.
 */
export function shouldDeliver(prefs: NotificationPrefs, kind: ToastKind, channel: NotificationChannel): boolean {
  if (channel === 'desktop' && !prefs.desktop) return false
  if (channel === 'inApp' && !prefs.inApp) return false
  if (prefs.scope === 'errors' && kind !== 'error') return false
  return true
}

/**
 * Start/stop sound cues are recording feedback, not notifications, so the scope does not
 * apply to them. They are skipped while any session captures system audio, so the cue cannot
 * end up inside a recording.
 */
export function shouldPlayCue(prefs: NotificationPrefs, systemAudioCaptureActive: boolean): boolean {
  return prefs.sounds && !systemAudioCaptureActive
}
