import { copyFile, rename } from 'node:fs/promises'
import type { Logger } from './logger'
import { pathExists, readJson, writeFileAtomic } from './fs-utils'

/**
 * Debounced, serialized JSON persistence with crash-safe writes. On load a corrupt file is
 * moved aside and the last known good backup (`.bak`) is used instead.
 */
export class JsonFile<T> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private dirty = false

  constructor(
    private readonly file: string,
    private readonly logger: Logger,
    private readonly scope: string,
    initial: T,
    private readonly debounceMs = 150
  ) {
    this.data = initial
  }

  get value(): T {
    return this.data
  }

  /** Reads the raw JSON (main file, else backup). Returns undefined when neither is usable. */
  async loadRaw(): Promise<{ raw: unknown; source: 'main' | 'backup' } | undefined> {
    const main = await readJson(this.file)
    if (main.status === 'ok') {
      // Keep a last known good copy for recovery from later corruption.
      try {
        await copyFile(this.file, `${this.file}.bak`)
      } catch (err) {
        this.logger.warn(this.scope, `could not refresh backup: ${(err as Error).message}`)
      }
      return { raw: main.data, source: 'main' }
    }
    if (main.status === 'corrupt') {
      const aside = `${this.file}.corrupt-${Date.now()}`
      this.logger.error(this.scope, `file is corrupt, moved to ${aside}`, main.error)
      try {
        await rename(this.file, aside)
      } catch {
        /* ignore */
      }
    }
    const backupPath = `${this.file}.bak`
    if (await pathExists(backupPath)) {
      const backup = await readJson(backupPath)
      if (backup.status === 'ok') {
        this.logger.warn(this.scope, 'restored from backup')
        return { raw: backup.data, source: 'backup' }
      }
    }
    return undefined
  }

  set(next: T): void {
    this.data = next
    this.schedule()
  }

  update(mutator: (draft: T) => void): T {
    mutator(this.data)
    this.schedule()
    return this.data
  }

  private schedule(): void {
    this.dirty = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      // flush() already logged the failure and keeps the data dirty for the next write.
      this.flush().catch(() => undefined)
    }, this.debounceMs)
  }

  /** Writes pending changes now and resolves when they are on disk. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return this.writing
    this.dirty = false
    const snapshot = JSON.stringify(this.data, null, 2)
    this.writing = this.writing
      .catch(() => undefined)
      .then(() => writeFileAtomic(this.file, snapshot))
      .catch((err) => {
        this.dirty = true
        this.logger.error(this.scope, 'write failed', err)
        throw err
      })
    return this.writing
  }
}
