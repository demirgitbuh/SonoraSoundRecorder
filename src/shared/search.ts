import type { AudioFormat, Recording, Tag } from './types'

export type SortKey = 'date' | 'name' | 'duration' | 'size' | 'format'
export type SortDir = 'asc' | 'desc'

export interface ArchiveQuery {
  text: string
  /** `undefined`: any folder. `null`: recordings without a folder. */
  folderId?: string | null
  tagIds: string[]
  formats: AudioFormat[]
  /** Inclusive local dates as `YYYY-MM-DD`. */
  dateFrom: string | null
  dateTo: string | null
  minDurationSec: number | null
  maxDurationSec: number | null
  favoritesOnly: boolean
  sort: { key: SortKey; dir: SortDir }
}

export function emptyQuery(): ArchiveQuery {
  return {
    text: '',
    folderId: undefined,
    tagIds: [],
    formats: [],
    dateFrom: null,
    dateTo: null,
    minDurationSec: null,
    maxDurationSec: null,
    favoritesOnly: false,
    sort: { key: 'date', dir: 'desc' }
  }
}

/** Number of active filters, excluding text and sort. Used for the "clear filters" control. */
export function activeFilterCount(q: ArchiveQuery): number {
  let n = 0
  if (q.folderId !== undefined) n++
  if (q.tagIds.length > 0) n++
  if (q.formats.length > 0) n++
  if (q.dateFrom || q.dateTo) n++
  if (q.minDurationSec !== null || q.maxDurationSec !== null) n++
  if (q.favoritesOnly) n++
  return n
}

/** Case and accent insensitive folding, including Turkish dotless/dotted i. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .toLowerCase()
}

function localDateKey(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export type MatchSource = 'name' | 'note' | 'tag' | 'transcript'

export interface SearchContext {
  tags: Tag[]
  /** Ids of recordings whose transcript contains the query text. */
  transcriptMatches: ReadonlySet<string>
}

export function textMatch(rec: Recording, text: string, ctx: SearchContext): MatchSource | null {
  const needle = foldText(text.trim())
  if (!needle) return 'name'
  if (foldText(rec.name).includes(needle)) return 'name'
  if (rec.note && foldText(rec.note).includes(needle)) return 'note'
  const tagNames = ctx.tags.filter((t) => rec.tagIds.includes(t.id)).map((t) => foldText(t.name))
  if (tagNames.some((n) => n.includes(needle))) return 'tag'
  if (ctx.transcriptMatches.has(rec.id)) return 'transcript'
  return null
}

export function matchesQuery(rec: Recording, q: ArchiveQuery, ctx: SearchContext): boolean {
  if (rec.trash) return false
  if (q.favoritesOnly && !rec.favorite) return false
  if (q.folderId !== undefined && rec.folderId !== q.folderId) return false
  if (q.tagIds.length > 0 && !q.tagIds.every((id) => rec.tagIds.includes(id))) return false
  if (q.formats.length > 0 && !q.formats.includes(rec.format)) return false
  if (q.dateFrom || q.dateTo) {
    const key = localDateKey(rec.createdAt)
    if (q.dateFrom && key < q.dateFrom) return false
    if (q.dateTo && key > q.dateTo) return false
  }
  const sec = rec.durationMs / 1000
  if (q.minDurationSec !== null && sec < q.minDurationSec) return false
  if (q.maxDurationSec !== null && sec > q.maxDurationSec) return false
  if (q.text.trim() && textMatch(rec, q.text, ctx) === null) return false
  return true
}

export function sortRecordings(list: Recording[], sort: ArchiveQuery['sort']): Recording[] {
  const dir = sort.dir === 'asc' ? 1 : -1
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  return [...list].sort((a, b) => {
    let d = 0
    switch (sort.key) {
      case 'date':
        d = a.createdAt.localeCompare(b.createdAt)
        break
      case 'name':
        d = collator.compare(a.name, b.name)
        break
      case 'duration':
        d = a.durationMs - b.durationMs
        break
      case 'size':
        d = a.sizeBytes - b.sizeBytes
        break
      case 'format':
        d = a.format.localeCompare(b.format)
        break
    }
    if (d === 0) d = a.createdAt.localeCompare(b.createdAt)
    return d * dir
  })
}

export function queryRecordings(recordings: Recording[], q: ArchiveQuery, ctx: SearchContext): Recording[] {
  return sortRecordings(
    recordings.filter((r) => matchesQuery(r, q, ctx)),
    q.sort
  )
}

/** Full-text check used by the main process against stored transcripts. */
export function transcriptContains(transcriptText: string, query: string): boolean {
  const needle = foldText(query.trim())
  if (!needle) return false
  return foldText(transcriptText).includes(needle)
}
