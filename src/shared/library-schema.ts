import { z } from 'zod'
import { AUDIO_FORMATS } from './types'
import type { Folder, LibrarySnapshot, Recording, Tag } from './types'
import { runMigrations } from './settings'
import type { Migration } from './settings'

export const LIBRARY_SCHEMA_VERSION = 1

const markerSchema = z.object({ id: z.string().min(1).max(64), timeMs: z.number().min(0) })

export const recordingSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(400),
  filePath: z.string().min(1).max(4096),
  format: z.enum(AUDIO_FORMATS),
  durationMs: z.number().min(0).catch(0),
  sizeBytes: z.number().min(0).catch(0),
  sampleRate: z.number().int().min(0).catch(0),
  channels: z.number().int().min(0).catch(0),
  bitDepth: z.number().int().nullable().catch(null),
  bitrateKbps: z.number().nullable().catch(null),
  createdAt: z.string(),
  updatedAt: z.string().catch(() => new Date().toISOString()),
  source: z.enum(['mic', 'system', 'mixed', 'imported']).catch('mic'),
  part: z.enum(['combined', 'mic', 'system', 'single']).catch('single'),
  groupId: z.string().nullable().catch(null),
  markers: z.array(markerSchema).catch([]),
  favorite: z.boolean().catch(false),
  tagIds: z.array(z.string()).catch([]),
  folderId: z.string().nullable().catch(null),
  note: z.string().max(20000).catch(''),
  processing: z
    .object({
      noiseSuppression: z.boolean().catch(false),
      echoCancellation: z.boolean().catch(false),
      autoGainControl: z.boolean().catch(false),
      normalized: z.boolean().catch(false)
    })
    .catch({ noiseSuppression: false, echoCancellation: false, autoGainControl: false, normalized: false }),
  transcript: z
    .object({
      updatedAt: z.string(),
      language: z.string(),
      model: z.string(),
      remapped: z.boolean().catch(false)
    })
    .nullable()
    .catch(null),
  imported: z.object({ originalPath: z.string(), importedAt: z.string() }).nullable().catch(null),
  trash: z
    .object({ trashedAt: z.string(), originalPath: z.string(), trashPath: z.string() })
    .nullable()
    .catch(null),
  missing: z.boolean().catch(false)
})

const folderSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(80), createdAt: z.string() })
const tagSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(40), createdAt: z.string() })

export interface LibraryFile extends LibrarySnapshot {
  schemaVersion: number
}

export const LIBRARY_MIGRATIONS: Record<number, Migration> = {
  0: (data) => ({ ...data, folders: Array.isArray(data.folders) ? data.folders : [], tags: Array.isArray(data.tags) ? data.tags : [] })
}

/**
 * Parses the library file. Individual broken entries are dropped and reported instead of
 * discarding the whole archive.
 */
export function parseLibrary(raw: unknown): { library: LibraryFile; dropped: number; tooNew: boolean; migrated: boolean } {
  const outcome = runMigrations(raw, LIBRARY_SCHEMA_VERSION, LIBRARY_MIGRATIONS)
  const data = outcome.data
  let dropped = 0
  const recordings: Recording[] = []
  for (const item of Array.isArray(data.recordings) ? data.recordings : []) {
    const r = recordingSchema.safeParse(item)
    if (r.success) recordings.push(r.data)
    else dropped++
  }
  const folders: Folder[] = []
  for (const item of Array.isArray(data.folders) ? data.folders : []) {
    const r = folderSchema.safeParse(item)
    if (r.success) folders.push(r.data)
    else dropped++
  }
  const tags: Tag[] = []
  for (const item of Array.isArray(data.tags) ? data.tags : []) {
    const r = tagSchema.safeParse(item)
    if (r.success) tags.push(r.data)
    else dropped++
  }
  const folderIds = new Set(folders.map((f) => f.id))
  const tagIds = new Set(tags.map((t) => t.id))
  for (const r of recordings) {
    if (r.folderId && !folderIds.has(r.folderId)) r.folderId = null
    r.tagIds = r.tagIds.filter((id) => tagIds.has(id))
  }
  return {
    library: { schemaVersion: LIBRARY_SCHEMA_VERSION, recordings, folders, tags },
    dropped,
    tooNew: outcome.tooNew,
    migrated: outcome.migrated
  }
}

export const scheduleSchema = z.object({
  id: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
  startAt: z.string(),
  endAt: z.string(),
  status: z.enum(['upcoming', 'running', 'completed', 'missed', 'failed', 'cancelled']),
  reasonKey: z.string().nullable().catch(null)
})
