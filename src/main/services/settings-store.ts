import { copyFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  SETTINGS_SCHEMA_VERSION,
  applyProfile,
  applySettingsPatch,
  createSessionConfig,
  defaultSettings,
  parseSettings,
  profilesFileSchema,
  resetAll,
  resetCategory,
  settingsSchema,
  toPortable
} from '../../shared/settings'
import type { Settings, SettingsCategory, SettingsPatch, SettingsProfile } from '../../shared/settings'
import type { ThemeName } from '../../shared/types'
import { JsonFile } from './json-store'
import type { Logger } from './logger'

export interface SettingsLoadResult {
  settings: Settings
  firstRun: boolean
  migratedFrom: number | null
}

/** Persistent settings and named profiles stored in the user data directory. */
export class SettingsStore {
  private readonly file: JsonFile<Settings>
  private readonly profilesFile: JsonFile<{ schemaVersion: number; profiles: SettingsProfile[] }>
  private readonly listeners = new Set<(s: Settings, prev: Settings) => void>()
  private normalizer: ((s: Settings) => Settings) | null = null

  constructor(
    private readonly dir: string,
    private readonly logger: Logger
  ) {
    this.file = new JsonFile(join(dir, 'settings.json'), logger, 'settings', defaultSettings())
    this.profilesFile = new JsonFile(join(dir, 'profiles.json'), logger, 'profiles', { schemaVersion: 1, profiles: [] })
  }

  get value(): Settings {
    return this.file.value
  }

  /**
   * Loads settings. On the very first run the theme follows the operating system appearance
   * and is then stored, so later launches keep the user's choice.
   */
  async load(systemTheme: ThemeName): Promise<SettingsLoadResult> {
    const loaded = await this.file.loadRaw()
    let settings: Settings
    let firstRun = false
    let migratedFrom: number | null = null
    if (!loaded) {
      firstRun = true
      settings = defaultSettings(systemTheme)
    } else {
      const { settings: parsed, outcome } = parseSettings(loaded.raw)
      settings = parsed
      if (outcome.tooNew) {
        const backup = join(this.dir, `settings.v${outcome.fromVersion}.json`)
        try {
          await copyFile(join(this.dir, 'settings.json'), backup)
        } catch {
          /* ignore */
        }
        this.logger.warn('settings', `settings written by a newer version (${outcome.fromVersion}); a copy was kept at ${backup}`)
      }
      if (outcome.migrated) {
        migratedFrom = outcome.fromVersion
        this.logger.info('settings', `migrated settings from schema ${outcome.fromVersion} to ${SETTINGS_SCHEMA_VERSION}`)
      }
    }
    if (settings.sessions.length === 0) {
      settings.sessions = [createSessionConfig(settings, randomUUID(), 'Session 1')]
    }
    if (!settings.sessions.some((s) => s.id === settings.selectedSessionId)) {
      settings.selectedSessionId = settings.sessions[0]!.id
    }
    this.file.set(settings)
    await this.file.flush()

    const profiles = await this.profilesFile.loadRaw()
    if (profiles) {
      const parsed = profilesFileSchema.parse(profiles.raw)
      this.profilesFile.set({
        schemaVersion: 1,
        profiles: parsed.profiles.map((p) => ({ ...p, settings: toPortable(settingsSchema.parse(p.settings)) }))
      })
    }
    return { settings, firstRun, migratedFrom }
  }

  /**
   * Adjusts every new settings value before it is stored (and the current one right away). It
   * must return the same object when nothing changes.
   */
  setNormalizer(fn: (s: Settings) => Settings): void {
    this.normalizer = fn
    const current = this.file.value
    const next = fn(current)
    if (next !== current) this.file.set(next)
  }

  onChange(listener: (s: Settings, prev: Settings) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(proposed: Settings): Settings {
    const next = this.normalizer ? this.normalizer(proposed) : proposed
    const prev = this.file.value
    this.file.set(next)
    for (const l of this.listeners) {
      try {
        l(next, prev)
      } catch (err) {
        this.logger.error('settings', 'listener failed', err)
      }
    }
    return next
  }

  update(patch: SettingsPatch): Settings {
    return this.commit(applySettingsPatch(this.file.value, patch))
  }

  replace(next: Settings): Settings {
    return this.commit(settingsSchema.parse(next))
  }

  reset(category: SettingsCategory | 'all', systemTheme: ThemeName): Settings {
    const current = this.file.value
    let next = category === 'all' ? resetAll(current, systemTheme) : resetCategory(current, category, systemTheme)
    if (next.sessions.length === 0) {
      next = { ...next, sessions: [createSessionConfig(next, randomUUID(), 'Session 1')] }
    }
    if (!next.sessions.some((s) => s.id === next.selectedSessionId)) next.selectedSessionId = next.sessions[0]!.id
    return this.commit(next)
  }

  profiles(): SettingsProfile[] {
    return this.profilesFile.value.profiles
  }

  saveProfile(name: string): SettingsProfile[] {
    const trimmed = name.trim().slice(0, 60)
    const existing = this.profilesFile.value.profiles.find((p) => p.name === trimmed)
    const profile: SettingsProfile = {
      id: existing?.id ?? randomUUID(),
      name: trimmed,
      createdAt: new Date().toISOString(),
      settings: toPortable(this.file.value)
    }
    this.profilesFile.update((d) => {
      d.profiles = [...d.profiles.filter((p) => p.id !== profile.id), profile]
    })
    return this.profilesFile.value.profiles
  }

  applyProfile(id: string): Settings | null {
    const profile = this.profilesFile.value.profiles.find((p) => p.id === id)
    if (!profile) return null
    return this.commit(applyProfile(this.file.value, profile))
  }

  deleteProfile(id: string): SettingsProfile[] {
    this.profilesFile.update((d) => {
      d.profiles = d.profiles.filter((p) => p.id !== id)
    })
    return this.profilesFile.value.profiles
  }

  async flush(): Promise<void> {
    await Promise.all([this.file.flush(), this.profilesFile.flush()])
  }
}
