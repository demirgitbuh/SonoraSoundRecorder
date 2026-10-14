import { describe, expect, it } from 'vitest'
import {
  addCut,
  createEditState,
  editedDuration,
  hasEdits,
  keepRanges,
  mapMarkers,
  mapSegments,
  mapTime,
  mergeRanges,
  nextPlayablePosition,
  setTrimEnd,
  setTrimStart,
  toSampleRanges,
  unmapTime
} from '../src/shared/edit'
import { buildKeepFilter } from '../src/main/services/audio-service'

describe('trim and cut calculations', () => {
  it('an untouched state keeps everything and has no edits', () => {
    const s = createEditState(10_000)
    expect(keepRanges(s)).toEqual([{ startMs: 0, endMs: 10_000 }])
    expect(hasEdits(s)).toBe(false)
    expect(editedDuration(s)).toBe(10_000)
  })

  it('trims start and end', () => {
    let s = createEditState(10_000)
    s = setTrimStart(s, 1_000)
    s = setTrimEnd(s, 9_000)
    expect(keepRanges(s)).toEqual([{ startMs: 1_000, endMs: 9_000 }])
    expect(editedDuration(s)).toBe(8_000)
    expect(hasEdits(s)).toBe(true)
  })

  it('clamps trims so start never passes end', () => {
    let s = createEditState(10_000)
    s = setTrimEnd(s, 4_000)
    s = setTrimStart(s, 6_000)
    expect(s.trimStartMs).toBe(4_000)
    expect(editedDuration(s)).toBe(0)
  })

  it('cuts a middle section and merges overlapping cuts', () => {
    let s = createEditState(10_000)
    s = addCut(s, { startMs: 3_000, endMs: 4_000 })
    s = addCut(s, { startMs: 3_500, endMs: 5_000 })
    s = addCut(s, { startMs: 8_000, endMs: 7_000 })
    expect(s.cuts).toEqual([
      { startMs: 3_000, endMs: 5_000 },
      { startMs: 7_000, endMs: 8_000 }
    ])
    expect(keepRanges(s)).toEqual([
      { startMs: 0, endMs: 3_000 },
      { startMs: 5_000, endMs: 7_000 },
      { startMs: 8_000, endMs: 10_000 }
    ])
    expect(editedDuration(s)).toBe(7_000)
  })

  it('combines trims with cuts that overlap the trimmed area', () => {
    let s = createEditState(10_000)
    s = setTrimStart(s, 2_000)
    s = setTrimEnd(s, 8_000)
    s = addCut(s, { startMs: 1_000, endMs: 3_000 })
    s = addCut(s, { startMs: 7_500, endMs: 9_500 })
    expect(keepRanges(s)).toEqual([{ startMs: 3_000, endMs: 7_500 }])
  })

  it('maps positions between the original and the edited timeline', () => {
    const kept = [
      { startMs: 0, endMs: 3_000 },
      { startMs: 5_000, endMs: 10_000 }
    ]
    expect(mapTime(1_000, kept)).toBe(1_000)
    expect(mapTime(4_000, kept)).toBeNull()
    expect(mapTime(6_000, kept)).toBe(4_000)
    expect(mapTime(10_000, kept)).toBe(8_000)
    expect(unmapTime(4_000, kept)).toBe(6_000)
    expect(unmapTime(99_000, kept)).toBe(10_000)
  })

  it('preview playback jumps over removed regions', () => {
    const kept = [
      { startMs: 1_000, endMs: 2_000 },
      { startMs: 4_000, endMs: 6_000 }
    ]
    expect(nextPlayablePosition(0, kept)).toBe(1_000)
    expect(nextPlayablePosition(1_500, kept)).toBe(1_500)
    expect(nextPlayablePosition(2_500, kept)).toBe(4_000)
    expect(nextPlayablePosition(6_500, kept)).toBeNull()
  })

  it('converts kept ranges to sample ranges', () => {
    expect(toSampleRanges([{ startMs: 500, endMs: 1_500 }], 48_000)).toEqual([{ start: 24_000, end: 72_000 }])
    expect(toSampleRanges([{ startMs: 0, endMs: 0.001 }], 48_000)).toEqual([])
  })

  it('mergeRanges drops empty ranges and merges touching ones', () => {
    expect(
      mergeRanges([
        { startMs: 5, endMs: 5 },
        { startMs: 10, endMs: 20 },
        { startMs: 20, endMs: 30 }
      ])
    ).toEqual([{ startMs: 10, endMs: 30 }])
  })
})

describe('markers and transcript segments after editing', () => {
  const kept = [
    { startMs: 0, endMs: 3_000 },
    { startMs: 5_000, endMs: 10_000 }
  ]

  it('drops markers inside removed regions and shifts later markers', () => {
    const out = mapMarkers(
      [
        { id: 'a', timeMs: 1_000 },
        { id: 'b', timeMs: 4_000 },
        { id: 'c', timeMs: 7_000 }
      ],
      kept
    )
    expect(out).toEqual([
      { id: 'a', timeMs: 1_000 },
      { id: 'c', timeMs: 5_000 }
    ])
  })

  it('keeps marker order sorted by time', () => {
    const out = mapMarkers(
      [
        { id: 'z', timeMs: 9_000 },
        { id: 'y', timeMs: 500 }
      ],
      kept
    )
    expect(out.map((m) => m.id)).toEqual(['y', 'z'])
  })

  it('clips segments spanning a cut and removes segments fully cut', () => {
    const out = mapSegments(
      [
        { fromMs: 2_000, toMs: 6_000, text: 'spans' },
        { fromMs: 3_200, toMs: 4_800, text: 'removed' },
        { fromMs: 8_000, toMs: 9_000, text: 'late' }
      ],
      kept
    )
    expect(out).toEqual([
      { fromMs: 2_000, toMs: 4_000, text: 'spans' },
      { fromMs: 6_000, toMs: 7_000, text: 'late' }
    ])
  })
})

describe('ffmpeg keep filter', () => {
  it('is null without edits or gain', () => {
    expect(buildKeepFilter(null, null)).toBeNull()
  })

  it('builds a single atrim for one range', () => {
    expect(buildKeepFilter([{ start: 100, end: 200 }], null)).toBe('[0:a]atrim=start_sample=100:end_sample=200,asetpts=PTS-STARTPTS[out]')
  })

  it('concatenates several ranges and appends gain at the end', () => {
    const f = buildKeepFilter(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 }
      ],
      -3
    )
    expect(f).toBe(
      '[0:a]atrim=start_sample=0:end_sample=10,asetpts=PTS-STARTPTS[s0];[0:a]atrim=start_sample=20:end_sample=30,asetpts=PTS-STARTPTS[s1];[s0][s1]concat=n=2:v=0:a=1,volume=-3.00dB[out]'
    )
  })

  it('applies gain alone when there are no edits', () => {
    expect(buildKeepFilter(null, 2.5)).toBe('[0:a]volume=2.50dB[out]')
  })

  it('refuses an edit that keeps nothing', () => {
    expect(() => buildKeepFilter([], null)).toThrow()
  })
})
