import { mkdir, readdir, readFile, rm, rmdir, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { LIBRARY_SCHEMA_VERSION, parseLibrary } from '../../shared/library-schema'
import type { LibraryFile } from '../../shared/library-schema'
import type { BulkResult, Folder, ItemResult, LibrarySnapshot, Recording, Tag, Transcript } from '../../shared/types'
import { dateFolderName, fileNameKey, sanitizeFileName, uniqueBaseName } from '../../shared/naming'
import type { PlatformName } from '../../shared/naming'
import { transcriptContains } from '../../shared/search'
import { NameConflictError, isWritableDir, moveFile, pathExists, readJson, splitName, withRetry, writeFileAtomic } from './fs-utils'
import { JsonFile } from './json-store'
import type { Logger } from './logger'

export const TRASH_DIR_NAME = '.sonora-trash'

export class LibraryError extends Error {
  constructor(
    public readonly reasonKey: string,
    detail?: string
  ) {
    super(detail ?? reasonKey)
  }
}

export interface LibraryStoreOptions {
  dataDir: string
  platform: PlatformName
  logger: Logger
  /** Current recordings folder, used when a restored file's original folder is gone. */
  recordingsDir: () => string | null
  layout: () => 'flat' | 'by-date'
}

/**
 * Archive metadata (recordings, folders, tags, trash) plus transcripts and waveform peaks.
 * Audio files live in the user's recordings folder; everything here lives in the app data
 * directory, which updates never touch.
 */
export class LibraryStore {
  private readonly file: JsonFile<LibraryFile>
  private readonly transcriptsDir: string
  private readonly peaksDir: string
  private readonly transcriptText = new Map<string, string>()
  private readonly listeners = new Set<(s: LibrarySnapshot) => void>()
  private readonly reservedNames = new Set<string>()

  constructor(private readonly opts: LibraryStoreOptions) {
    this.file = new JsonFile(join(opts.dataDir, 'library.json'), opts.logger, 'library', {
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      recordings: [],
      folders: [],
      tags: []
    })
    this.transcriptsDir = join(opts.dataDir, 'transcripts')
    this.peaksDir = join(opts.dataDir, 'peaks')
  }

  async load(): Promise<void> {
    await mkdir(this.transcriptsDir, { recursive: true })
    await mkdir(this.peaksDir, { recursive: true })
    const loaded = await this.file.loadRaw()
    if (loaded) {
      const { library, dropped, tooNew, migrated } = parseLibrary(loaded.raw)
      if (dropped > 0) this.opts.logger.warn('library', `skipped ${dropped} invalid entries`)
      if (tooNew) this.opts.logger.warn('library', 'library was written by a newer version; unknown fields are ignored')
      if (migrated) this.opts.logger.info('library', 'library schema migrated')
      this.file.set(library)
      await this.file.flush()
    }
    for (const r of this.file.value.recordings) {
      if (!r.transcript) continue
      const t = await this.readTranscript(r.id)
      if (t) this.transcriptText.set(r.id, t.segments.map((s) => s.text).join(' '))
    }
    await this.checkMissing()
  }

  snapshot(): LibrarySnapshot {
    const v = this.file.value
    return { recordings: v.recordings, folders: v.folders, tags: v.tags }
  }

  onChange(listener: (s: LibrarySnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    const snap = this.snapshot()
    for (const l of this.listeners) l(snap)
  }

  async flush(): Promise<void> {
    await this.file.flush()
  }

  get(id: string): Recording {
    const r = this.file.value.recordings.find((x) => x.id === id)
    if (!r) throw new LibraryError('errors.recordingNotFound')
    return r
  }

  find(id: string): Recording | undefined {
    return this.file.value.recordings.find((x) => x.id === id)
  }

  all(): Recording[] {
    return this.file.value.recordings
  }

  /** Marks recordings whose file vanished from disk (deleted or moved outside Sonora). */
  async checkMissing(): Promise<void> {
    let changed = false
    for (const r of this.file.value.recordings) {
      const exists = await pathExists(r.filePath)
      if (r.missing === exists) {
        r.missing = !exists
        changed = true
      }
    }
    if (changed) {
      this.file.set(this.file.value)
      this.changed()
    }
  }

  // ---------------------------------------------------------------------------
  // Names and paths
  // ---------------------------------------------------------------------------

  /** Directory for new files according to the folder layout. */
  targetDir(root: string, date: Date): string {
    return this.opts.layout() === 'by-date' ? join(root, dateFolderName(date)) : root
  }

  /**
   * Picks a free base name in `dir` for all given suffixes and reserves it in-process, so two
   * sessions finishing in the same second never receive the same name.
   */
  async reserveName(dir: string, base: string, suffixes: string[], ext: string): Promise<{ base: string; release: () => void }> {
    await mkdir(dir, { recursive: true })
    const existing = new Set((await readdir(dir).catch(() => [] as string[])).map((n) => fileNameKey(n, this.opts.platform)))
    const taken = (fileName: string): boolean => {
      const key = fileNameKey(fileName, this.opts.platform)
      return existing.has(key) || this.reservedNames.has(join(dir, key))
    }
    const chosen = uniqueBaseName(base, suffixes, ext, taken)
    const keys = (suffixes.length ? suffixes : ['']).map((s) => join(dir, fileNameKey(`${chosen}${s}.${ext}`, this.opts.platform)))
    for (const k of keys) this.reservedNames.add(k)
    return {
      base: chosen,
      release: () => {
        for (const k of keys) this.reservedNames.delete(k)
      }
    }
  }

  sanitize(name: string): string {
    return sanitizeFileName(name, this.opts.platform)
  }

  // ---------------------------------------------------------------------------
  // Recordings
  // ---------------------------------------------------------------------------

  add(recording: Recording): Recording {
    this.file.update((d) => {
      d.recordings.push(recording)
    })
    this.changed()
    return recording
  }

  removeEntry(id: string): void {
    this.file.update((d) => {
      d.recordings = d.recordings.filter((r) => r.id !== id)
    })
    this.transcriptText.delete(id)
    this.changed()
  }

  patch(id: string, patch: Partial<Recording>): Recording {
    const rec = this.get(id)
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() })
    this.file.set(this.file.value)
    this.changed()
    return rec
  }

  async rename(id: string, rawName: string): Promise<Recording> {
    const rec = this.get(id)
    if (rec.trash) throw new LibraryError('errors.recordingInTrash')
    const name = this.sanitize(rawName)
    if (!name) throw new LibraryError('errors.invalidName')
    if (name === rec.name) return rec
    const dir = dirname(rec.filePath)
    const { ext } = splitName(basename(rec.filePath))
    const target = join(dir, `${name}.${ext}`)
    const sameFile = fileNameKey(target, this.opts.platform) === fileNameKey(rec.filePath, this.opts.platform)
    if (!sameFile && (await pathExists(target))) throw new LibraryError('errors.nameTaken', `${name}.${ext}`)
    if (sameFile) {
      // Case-only rename on a case-insensitive volume: go through a temporary name.
      const tmp = join(dir, `.${randomUUID().slice(0, 8)}.${ext}`)
      await moveFile(rec.filePath, tmp)
      await moveFile(tmp, target)
    } else {
      await moveFile(rec.filePath, target)
    }
    return this.patch(id, { name, filePath: target })
  }

  /** Points a missing recording at a file chosen by the user. */
  relink(id: string, filePath: string): Recording {
    return this.patch(id, { filePath, missing: false })
  }

  // ---------------------------------------------------------------------------
  // Folders and tags (organizational, inside Sonora only)
  // ---------------------------------------------------------------------------

  createFolder(name: string): LibrarySnapshot {
    const clean = name.trim().slice(0, 80)
    if (!clean) throw new LibraryError('errors.invalidName')
    if (this.file.value.folders.some((f) => f.name.toLowerCase() === clean.toLowerCase())) throw new LibraryError('errors.folderExists')
    const folder: Folder = { id: randomUUID(), name: clean, createdAt: new Date().toISOString() }
    this.file.update((d) => {
      d.folders.push(folder)
    })
    this.changed()
    return this.snapshot()
  }

  renameFolder(id: string, name: string): LibrarySnapshot {
    const clean = name.trim().slice(0, 80)
    if (!clean) throw new LibraryError('errors.invalidName')
    if (this.file.value.folders.some((f) => f.id !== id && f.name.toLowerCase() === clean.toLowerCase())) throw new LibraryError('errors.folderExists')
    this.file.update((d) => {
      const f = d.folders.find((x) => x.id === id)
      if (!f) throw new LibraryError('errors.folderNotFound')
      f.name = clean
    })
    this.changed()
    return this.snapshot()
  }

  deleteFolder(id: string): LibrarySnapshot {
    this.file.update((d) => {
      d.folders = d.folders.filter((f) => f.id !== id)
      for (const r of d.recordings) if (r.folderId === id) r.folderId = null
    })
    this.changed()
    return this.snapshot()
  }

  createTag(name: string): LibrarySnapshot {
    const clean = name.trim().slice(0, 40)
    if (!clean) throw new LibraryError('errors.invalidName')
    if (this.file.value.tags.some((t) => t.name.toLowerCase() === clean.toLowerCase())) throw new LibraryError('errors.tagExists')
    const tag: Tag = { id: randomUUID(), name: clean, createdAt: new Date().toISOString() }
    this.file.update((d) => {
      d.tags.push(tag)
    })
    this.changed()
    return this.snapshot()
  }

  renameTag(id: string, name: string): LibrarySnapshot {
    const clean = name.trim().slice(0, 40)
    if (!clean) throw new LibraryError('errors.invalidName')
    if (this.file.value.tags.some((t) => t.id !== id && t.name.toLowerCase() === clean.toLowerCase())) throw new LibraryError('errors.tagExists')
    this.file.update((d) => {
      const t = d.tags.find((x) => x.id === id)
      if (!t) throw new LibraryError('errors.tagNotFound')
      t.name = clean
    })
    this.changed()
    return this.snapshot()
  }

  deleteTag(id: string): LibrarySnapshot {
    this.file.update((d) => {
      d.tags = d.tags.filter((t) => t.id !== id)
      for (const r of d.recordings) r.tagIds = r.tagIds.filter((x) => x !== id)
    })
    this.changed()
    return this.snapshot()
  }

  folderExists(id: string): boolean {
    return this.file.value.folders.some((f) => f.id === id)
  }

  tagExists(id: string): boolean {
    return this.file.value.tags.some((t) => t.id === id)
  }

  // ---------------------------------------------------------------------------
  // Trash
  // ---------------------------------------------------------------------------

  /** Moves recordings into a hidden `.sonora-trash` folder next to the file. */
  async trash(ids: string[]): Promise<BulkResult> {
    const results: ItemResult[] = []
    for (const id of ids) {
      const rec = this.find(id)
      if (!rec) {
        results.push({ id, name: id, ok: false, errorKey: 'errors.recordingNotFound' })
        continue
      }
      if (rec.trash) {
        results.push({ id, name: rec.name, ok: true })
        continue
      }
      try {
        const trashDir = join(dirname(rec.filePath), TRASH_DIR_NAME, rec.id)
        const trashPath = join(trashDir, basename(rec.filePath))
        if (await pathExists(rec.filePath)) {
          await moveFile(rec.filePath, trashPath)
        }
        rec.trash = { trashedAt: new Date().toISOString(), originalPath: rec.filePath, trashPath }
        rec.filePath = trashPath
        rec.updatedAt = new Date().toISOString()
        results.push({ id, name: rec.name, ok: true })
      } catch (err) {
        results.push({ id, name: rec.name, ok: false, errorKey: 'errors.moveFailed', detail: (err as Error).message })
      }
    }
    this.file.set(this.file.value)
    this.changed()
    return { results }
  }

  /**
   * Restores recordings. When the original folder no longer exists or is not writable the file
   * goes to the current recordings folder; name clashes get a unique suffix instead of overwriting.
   */
  async restore(ids: string[]): Promise<BulkResult> {
    const results: ItemResult[] = []
    for (const id of ids) {
      const rec = this.find(id)
      if (!rec || !rec.trash) {
        results.push({ id, name: rec?.name ?? id, ok: false, errorKey: 'errors.notInTrash' })
        continue
      }
      try {
        if (!(await pathExists(rec.trash.trashPath))) throw new LibraryError('errors.fileMissing')
        let dir = dirname(rec.trash.originalPath)
        let relocated = false
        if (!(await isWritableDir(dir))) {
          const root = this.opts.recordingsDir()
          if (!root) throw new LibraryError('errors.noRecordingsFolder')
          dir = this.targetDir(root, new Date(rec.createdAt))
          await mkdir(dir, { recursive: true })
          relocated = true
        }
        const { base, ext } = splitName(basename(rec.trash.originalPath))
        const reservation = await this.reserveName(dir, base, [''], ext)
        const target = join(dir, `${reservation.base}.${ext}`)
        try {
          await moveFile(rec.trash.trashPath, target)
        } finally {
          reservation.release()
        }
        await this.removeEmptyTrashDir(rec.trash.trashPath)
        const renamed = reservation.base !== base
        rec.filePath = target
        rec.name = reservation.base
        rec.trash = null
        rec.missing = false
        rec.updatedAt = new Date().toISOString()
        results.push({
          id,
          name: rec.name,
          ok: true,
          outputPath: target,
          detail: relocated ? 'relocated' : renamed ? 'renamed' : undefined
        })
      } catch (err) {
        const key = err instanceof LibraryError ? err.reasonKey : err instanceof NameConflictError ? 'errors.nameTaken' : 'errors.moveFailed'
        results.push({ id, name: rec.name, ok: false, errorKey: key, detail: (err as Error).message })
      }
    }
    this.file.set(this.file.value)
    this.changed()
    return { results }
  }

  private async removeEmptyTrashDir(trashPath: string): Promise<void> {
    const idDir = dirname(trashPath)
    try {
      await rmdir(idDir)
      await rmdir(dirname(idDir))
    } catch {
      // Not empty or already gone.
    }
  }

  /** Permanently deletes trashed recordings, their transcripts and peaks. */
  async deleteForever(ids: string[]): Promise<BulkResult> {
    const results: ItemResult[] = []
    for (const id of ids) {
      const rec = this.find(id)
      if (!rec) {
        results.push({ id, name: id, ok: false, errorKey: 'errors.recordingNotFound' })
        continue
      }
      if (!rec.trash) {
        results.push({ id, name: rec.name, ok: false, errorKey: 'errors.notInTrash' })
        continue
      }
      try {
        await withRetry(() => rm(rec.trash!.trashPath, { force: true }))
        await this.removeEmptyTrashDir(rec.trash.trashPath)
        await rm(this.transcriptPath(id), { force: true })
        await rm(this.peaksPath(id), { force: true })
        this.file.update((d) => {
          d.recordings = d.recordings.filter((r) => r.id !== id)
        })
        this.transcriptText.delete(id)
        results.push({ id, name: rec.name, ok: true })
      } catch (err) {
        results.push({ id, name: rec.name, ok: false, errorKey: 'errors.deleteFailed', detail: (err as Error).message })
      }
    }
    this.changed()
    return { results }
  }

  async emptyTrash(): Promise<BulkResult> {
    return this.deleteForever(this.file.value.recordings.filter((r) => r.trash).map((r) => r.id))
  }

  // ---------------------------------------------------------------------------
  // Transcripts and peaks
  // ---------------------------------------------------------------------------

  transcriptPath(id: string): string {
    return join(this.transcriptsDir, `${id}.json`)
  }

  peaksPath(id: string): string {
    return join(this.peaksDir, `${id}.peaks`)
  }

  async readTranscript(id: string): Promise<Transcript | null> {
    const res = await readJson(this.transcriptPath(id))
    if (res.status !== 'ok') return null
    const t = res.data as Transcript
    if (!t || !Array.isArray(t.segments)) return null
    return t
  }

  async writeTranscript(t: Transcript): Promise<void> {
    await writeFileAtomic(this.transcriptPath(t.recordingId), JSON.stringify(t))
    this.transcriptText.set(t.recordingId, t.segments.map((s) => s.text).join(' '))
  }

  /** Ids of recordings whose transcript contains `text` (case and accent insensitive). */
  searchTranscripts(text: string): string[] {
    const out: string[] = []
    for (const [id, body] of this.transcriptText) if (transcriptContains(body, text)) out.push(id)
    return out
  }

  async writePeaks(id: string, peaks: Uint8Array): Promise<void> {
    await writeFileAtomic(this.peaksPath(id), peaks)
  }

  async readPeaks(id: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.peaksPath(id)))
    } catch {
      return null
    }
  }

  async fileSize(path: string): Promise<number> {
    try {
      return (await stat(path)).size
    } catch {
      return 0
    }
  }
}
