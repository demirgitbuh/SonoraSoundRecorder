import type { Marker, TimeRange, TranscriptSegment } from './types'

/**
 * Non-destructive edit description on the original timeline. All values are milliseconds.
 * `trimStartMs`/`trimEndMs` bound the kept region; `cuts` are removed ranges inside it.
 */
export interface EditState {
  durationMs: number
  trimStartMs: number
  trimEndMs: number
  cuts: TimeRange[]
}

const EPSILON_MS = 0.5

export function createEditState(durationMs: number): EditState {
  const d = Math.max(0, durationMs)
  return { durationMs: d, trimStartMs: 0, trimEndMs: d, cuts: [] }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function normalizeRange(range: TimeRange, durationMs: number): TimeRange {
  const a = clamp(range.startMs, 0, durationMs)
  const b = clamp(range.endMs, 0, durationMs)
  return a <= b ? { startMs: a, endMs: b } : { startMs: b, endMs: a }
}

/** Sorts and merges overlapping or touching ranges. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => r.endMs - r.startMs > EPSILON_MS)
    .map((r) => ({ ...r }))
    .sort((a, b) => a.startMs - b.startMs)
  const out: TimeRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.startMs <= last.endMs + EPSILON_MS) {
      last.endMs = Math.max(last.endMs, r.endMs)
    } else {
      out.push(r)
    }
  }
  return out
}

export function setTrimStart(state: EditState, ms: number): EditState {
  const start = clamp(ms, 0, state.trimEndMs)
  return { ...state, trimStartMs: start }
}

export function setTrimEnd(state: EditState, ms: number): EditState {
  const end = clamp(ms, state.trimStartMs, state.durationMs)
  return { ...state, trimEndMs: end }
}

export function addCut(state: EditState, range: TimeRange): EditState {
  const r = normalizeRange(range, state.durationMs)
  if (r.endMs - r.startMs <= EPSILON_MS) return state
  return { ...state, cuts: mergeRanges([...state.cuts, r]) }
}

/** Ranges of the original timeline that survive the edit, in order. */
export function keepRanges(state: EditState): TimeRange[] {
  const start = clamp(state.trimStartMs, 0, state.durationMs)
  const end = clamp(state.trimEndMs, start, state.durationMs)
  const cuts = mergeRanges(state.cuts.map((c) => normalizeRange(c, state.durationMs)))
  const out: TimeRange[] = []
  let cursor = start
  for (const cut of cuts) {
    if (cut.endMs <= cursor) continue
    if (cut.startMs >= end) break
    if (cut.startMs > cursor) out.push({ startMs: cursor, endMs: Math.min(cut.startMs, end) })
    cursor = Math.max(cursor, cut.endMs)
    if (cursor >= end) break
  }
  if (cursor < end) out.push({ startMs: cursor, endMs: end })
  return out.filter((r) => r.endMs - r.startMs > EPSILON_MS)
}

export function hasEdits(state: EditState): boolean {
  const kept = keepRanges(state)
  if (kept.length !== 1) return true
  const only = kept[0]!
  return only.startMs > EPSILON_MS || state.durationMs - only.endMs > EPSILON_MS
}

export function totalDuration(ranges: TimeRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.endMs - r.startMs), 0)
}

export function editedDuration(state: EditState): number {
  return totalDuration(keepRanges(state))
}

/**
 * Maps a position on the original timeline to the edited timeline.
 * Returns null when the position falls into a removed region.
 */
export function mapTime(ms: number, kept: TimeRange[]): number | null {
  let offset = 0
  for (const r of kept) {
    if (ms >= r.startMs && ms < r.endMs) return offset + (ms - r.startMs)
    offset += r.endMs - r.startMs
  }
  const last = kept[kept.length - 1]
  if (last && Math.abs(ms - last.endMs) <= EPSILON_MS) return offset
  return null
}

/** Maps a position on the edited timeline back to the original timeline. */
export function unmapTime(editedMs: number, kept: TimeRange[]): number {
  let remaining = Math.max(0, editedMs)
  for (const r of kept) {
    const len = r.endMs - r.startMs
    if (remaining < len) return r.startMs + remaining
    remaining -= len
  }
  const last = kept[kept.length - 1]
  return last ? last.endMs : 0
}

/** Markers inside removed regions are dropped; the rest move to their edited position. */
export function mapMarkers(markers: Marker[], kept: TimeRange[]): Marker[] {
  const out: Marker[] = []
  for (const m of markers) {
    const t = mapTime(m.timeMs, kept)
    if (t !== null) out.push({ ...m, timeMs: Math.round(t) })
  }
  return out.sort((a, b) => a.timeMs - b.timeMs)
}

/** Segments are clipped to the kept ranges and re-timed; segments fully removed disappear. */
export function mapSegments(segments: TranscriptSegment[], kept: TimeRange[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  for (const s of segments) {
    let from: number | null = null
    let to: number | null = null
    let offset = 0
    for (const r of kept) {
      const a = Math.max(s.fromMs, r.startMs)
      const b = Math.min(s.toMs, r.endMs)
      if (b > a) {
        if (from === null) from = offset + (a - r.startMs)
        to = offset + (b - r.startMs)
      }
      offset += r.endMs - r.startMs
    }
    if (from !== null && to !== null && to > from) {
      out.push({ fromMs: Math.round(from), toMs: Math.round(to), text: s.text })
    }
  }
  return out
}

/** When previewing edits, returns where playback should continue from `ms`. */
export function nextPlayablePosition(ms: number, kept: TimeRange[]): number | null {
  for (const r of kept) {
    if (ms < r.startMs) return r.startMs
    if (ms >= r.startMs && ms < r.endMs) return ms
  }
  return null
}

/** Converts ranges in milliseconds to inclusive-exclusive sample ranges. */
export function toSampleRanges(kept: TimeRange[], sampleRate: number): { start: number; end: number }[] {
  return kept
    .map((r) => ({
      start: Math.round((r.startMs * sampleRate) / 1000),
      end: Math.round((r.endMs * sampleRate) / 1000)
    }))
    .filter((r) => r.end > r.start)
}
