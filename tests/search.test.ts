import { describe, expect, it } from 'vitest'
import { activeFilterCount, emptyQuery, foldText, queryRecordings, textMatch, transcriptContains } from '../src/shared/search'
import type { ArchiveQuery, SearchContext } from '../src/shared/search'
import type { Tag } from '../src/shared/types'
import { makeRecording } from './helpers'

const tags: Tag[] = [
  { id: 't-int', name: 'Interview', createdAt: '' },
  { id: 't-idea', name: 'Idee', createdAt: '' }
]

const recs = [
  makeRecording({ id: 'a', name: 'Morning standup', createdAt: new Date(2026, 2, 1, 9).toISOString(), durationMs: 5 * 60_000, format: 'wav', sizeBytes: 50, tagIds: ['t-int'], folderId: 'f1' }),
  makeRecording({ id: 'b', name: 'Görüşme kaydı', createdAt: new Date(2026, 2, 5, 12).toISOString(), durationMs: 30 * 60_000, format: 'mp3', sizeBytes: 500, note: 'Budget discussion', favorite: true }),
  makeRecording({ id: 'c', name: 'Guitar idea', createdAt: new Date(2026, 2, 10, 18).toISOString(), durationMs: 45_000, format: 'flac', sizeBytes: 20, tagIds: ['t-idea'] }),
  makeRecording({ id: 'd', name: 'Deleted take', createdAt: new Date(2026, 2, 11).toISOString(), trash: { trashedAt: '', originalPath: '', trashPath: '' } })
]

const ctx = (matches: string[] = []): SearchContext => ({ tags, transcriptMatches: new Set(matches) })
const q = (patch: Partial<ArchiveQuery>): ArchiveQuery => ({ ...emptyQuery(), ...patch })
const ids = (query: ArchiveQuery, matches: string[] = []): string[] => queryRecordings(recs, query, ctx(matches)).map((r) => r.id)

describe('archive search and filters', () => {
  it('hides trashed recordings and sorts newest first by default', () => {
    expect(ids(q({}))).toEqual(['c', 'b', 'a'])
  })

  it('matches names, notes, tags and transcripts, ignoring case and accents', () => {
    expect(ids(q({ text: 'STANDUP' }))).toEqual(['a'])
    expect(ids(q({ text: 'gorusme' }))).toEqual(['b'])
    expect(ids(q({ text: 'budget' }))).toEqual(['b'])
    expect(ids(q({ text: 'interview' }))).toEqual(['a'])
    expect(ids(q({ text: 'quarterly' }), ['c'])).toEqual(['c'])
    expect(textMatch(recs[2]!, 'quarterly', ctx(['c']))).toBe('transcript')
  })

  it('folds Turkish dotted and dotless i', () => {
    expect(foldText('İSTANBUL ılık')).toBe('istanbul ilik')
    expect(transcriptContains('Istanbul’da hava ılık', 'ILIK')).toBe(true)
  })

  it('filters by date range, duration, format, tag, folder and favorites', () => {
    expect(ids(q({ dateFrom: '2026-03-02', dateTo: '2026-03-06' }))).toEqual(['b'])
    expect(ids(q({ minDurationSec: 60 }))).toEqual(['b', 'a'])
    expect(ids(q({ maxDurationSec: 60 }))).toEqual(['c'])
    expect(ids(q({ formats: ['mp3', 'flac'] }))).toEqual(['c', 'b'])
    expect(ids(q({ tagIds: ['t-idea'] }))).toEqual(['c'])
    expect(ids(q({ folderId: 'f1' }))).toEqual(['a'])
    expect(ids(q({ folderId: null }))).toEqual(['c', 'b'])
    expect(ids(q({ favoritesOnly: true }))).toEqual(['b'])
  })

  it('sorts by every supported key', () => {
    expect(ids(q({ sort: { key: 'name', dir: 'asc' } }))).toEqual(['b', 'c', 'a'])
    expect(ids(q({ sort: { key: 'duration', dir: 'desc' } }))).toEqual(['b', 'a', 'c'])
    expect(ids(q({ sort: { key: 'size', dir: 'asc' } }))).toEqual(['c', 'a', 'b'])
    expect(ids(q({ sort: { key: 'date', dir: 'asc' } }))).toEqual(['a', 'b', 'c'])
    expect(ids(q({ sort: { key: 'format', dir: 'asc' } }))).toEqual(['c', 'b', 'a'])
  })

  it('counts active filters for the clear-filters control', () => {
    expect(activeFilterCount(emptyQuery())).toBe(0)
    expect(activeFilterCount(q({ formats: ['wav'], favoritesOnly: true, dateFrom: '2026-01-01', folderId: null }))).toBe(4)
  })
})
