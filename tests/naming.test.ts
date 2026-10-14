import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dateFolderName, fileNameKey, sanitizeFileName, timestampName, trackSuffix, uniqueBaseName } from '../src/shared/naming'
import { LibraryStore } from '../src/main/services/library-store'
import { tempDir, testLogger } from './helpers'

describe('automatic file names', () => {
  it('uses Sonora_YYYY-MM-DD_HH-mm-ss in local time', () => {
    expect(timestampName(new Date(2026, 9, 14, 15, 30, 0))).toBe('Sonora_2026-10-14_15-30-00')
    expect(timestampName(new Date(2026, 0, 2, 3, 4, 5))).toBe('Sonora_2026-01-02_03-04-05')
    expect(dateFolderName(new Date(2026, 9, 14, 23, 59))).toBe('2026-10-14')
  })

  it('adds clear suffixes for separate source files', () => {
    expect(trackSuffix('mic', true)).toBe('_mic')
    expect(trackSuffix('system', true)).toBe('_system')
    expect(trackSuffix('mix', true)).toBe('')
    expect(trackSuffix('mic', false)).toBe('')
  })

  it('never reuses an existing name', () => {
    const taken = new Set(['Sonora_A.wav', 'Sonora_A_2.wav'])
    expect(uniqueBaseName('Sonora_A', [''], 'wav', (n) => taken.has(n))).toBe('Sonora_A_3')
    expect(uniqueBaseName('Sonora_B', [''], 'wav', (n) => taken.has(n))).toBe('Sonora_B')
  })

  it('finds one base that is free for every output file of a take', () => {
    const taken = new Set(['Take_mic.wav'])
    expect(uniqueBaseName('Take', ['', '_mic', '_system'], 'wav', (n) => taken.has(n))).toBe('Take_2')
  })

  it('removes characters that the OS does not allow', () => {
    expect(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j', 'win32')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeFileName('CON', 'win32')).toBe('CON_')
    expect(sanitizeFileName('name. ', 'win32')).toBe('name')
    expect(sanitizeFileName('a/b:c', 'darwin')).toBe('a_b_c')
    expect(sanitizeFileName('a/b:c', 'linux')).toBe('a_b:c')
    expect(sanitizeFileName('...hidden', 'linux')).toBe('hidden')
    expect(sanitizeFileName('tab\tand\u0000null', 'linux')).toBe('tabandnull')
    expect(sanitizeFileName('   ', 'win32')).toBe('')
    expect(sanitizeFileName('Görüşme — Ünite 3', 'win32')).toBe('Görüşme — Ünite 3')
    expect(Array.from(sanitizeFileName('x'.repeat(400), 'linux')).length).toBe(180)
  })

  it('compares names case-insensitively where the file system is case-insensitive', () => {
    expect(fileNameKey('Rec.WAV', 'win32')).toBe(fileNameKey('rec.wav', 'win32'))
    expect(fileNameKey('Rec.WAV', 'linux')).not.toBe(fileNameKey('rec.wav', 'linux'))
  })
})

describe('name reservation across sessions', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('two sessions finishing in the same second get different names', async () => {
    const lib = new LibraryStore({ dataDir: join(dir, 'data'), platform: 'linux', logger: testLogger(dir), recordingsDir: () => join(dir, 'rec'), layout: () => 'flat' })
    await lib.load()
    const target = join(dir, 'rec')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'Sonora_2026-10-14_15-30-00.wav'), 'x')
    const a = await lib.reserveName(target, 'Sonora_2026-10-14_15-30-00', [''], 'wav')
    const b = await lib.reserveName(target, 'Sonora_2026-10-14_15-30-00', [''], 'wav')
    expect(a.base).toBe('Sonora_2026-10-14_15-30-00_2')
    expect(b.base).toBe('Sonora_2026-10-14_15-30-00_3')
    a.release()
    const c = await lib.reserveName(target, 'Sonora_2026-10-14_15-30-00', [''], 'wav')
    expect(c.base).toBe('Sonora_2026-10-14_15-30-00_2')
  })

  it('uses date sub folders when that layout is selected', async () => {
    const lib = new LibraryStore({ dataDir: join(dir, 'data'), platform: 'linux', logger: testLogger(dir), recordingsDir: () => join(dir, 'rec'), layout: () => 'by-date' })
    expect(lib.targetDir('/rec', new Date(2026, 1, 3))).toBe(join('/rec', '2026-02-03'))
  })
})
