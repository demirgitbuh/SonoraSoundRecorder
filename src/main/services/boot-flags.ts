import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromiumBootFlags, defaultDeveloper, developerSchema } from '../../shared/developer'
import type { ChromiumBootFlags, DeveloperSettings } from '../../shared/developer'

/**
 * Reads the developer settings straight from settings.json. Chromium switches must be applied
 * before the app is ready, which is earlier than the settings store loads. Any problem falls back
 * to the defaults, so a broken file can never prevent Sonora from starting.
 */
export function readDeveloperSettingsSync(userDataDir: string): DeveloperSettings {
  const file = join(userDataDir, 'settings.json')
  for (const path of [file, `${file}.bak`]) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { developer?: unknown }
      return developerSchema.parse(raw?.developer)
    } catch {
      // Try the backup, then use the defaults.
    }
  }
  return defaultDeveloper()
}

export function bootFlagsFor(userDataDir: string, platformFeatures: string[]): ChromiumBootFlags {
  return chromiumBootFlags(readDeveloperSettingsSync(userDataDir), platformFeatures)
}

export function sameBootFlags(a: ChromiumBootFlags, b: ChromiumBootFlags): boolean {
  return (
    a.hardwareAcceleration === b.hardwareAcceleration &&
    a.enableFeatures.join(',') === b.enableFeatures.join(',') &&
    a.disableFeatures.join(',') === b.disableFeatures.join(',')
  )
}
