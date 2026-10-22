import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryStore, TRASH_DIR_NAME } from '../src/main/services/library-store'
import { makeRecording, tempDir, testLogger } from './helpers'

describe('trash and restore', () => {
  let dir: string
  let cleanup: () => void
  let lib: LibraryStore
  let rec: string
  let root: string

  beforeEach(async () => {
    ;({ dir, cleanup } = tempDir())
    rec = join(dir, 'rec', 'day')
    root = join(dir, 'rec')
    mkdirSync(rec, { recursive: true })
    lib = new LibraryStore({ dataDir: join(dir, 'data'), platform: 'linux', logger: testLogger(dir), recordingsDir: () => root, layout: () => 'flat' })
    await lib.load()
  })
  afterEach(() => cleanup())

  function addFile(name: string, content = 'audio'): string {
    const p = join(rec, `${name}.wav`)
    writeFileSync(p, content)
    return lib.add(makeRecording({ id: name, name, filePath: p })).id
  }

  it('moves files into Sonora’s own trash and restores them', async () => {
    const id = addFile('Take1')
    const res = await lib.trash([id])
    expect(res.results[0]!.ok).toBe(true)
    const r = lib.get(id)
    expect(r.trash?.originalPath).toBe(join(rec, 'Take1.wav'))
    expect(r.filePath).toContain(TRASH_DIR_NAME)
    expect(existsSync(join(rec, 'Take1.wav'))).toBe(false)
    expect(existsSync(r.filePath)).toBe(true)

    const back = await lib.restore([id])
    expect(back.results[0]!.ok).toBe(true)
    expect(lib.get(id).trash).toBeNull()
    expect(readFileSync(join(rec, 'Take1.wav'), 'utf8')).toBe('audio')
    expect(existsSync(join(rec, TRASH_DIR_NAME))).toBe(false)
  })

  it('restores with a unique name when the original name is taken', async () => {
    const id = addFile('Take2', 'old')
    await lib.trash([id])
    writeFileSync(join(rec, 'Take2.wav'), 'new file with same name')
    const res = await lib.restore([id])
    expect(res.results[0]!.ok).toBe(true)
    expect(res.results[0]!.detail).toBe('renamed')
    expect(lib.get(id).name).toBe('Take2_2')
    expect(readFileSync(join(rec, 'Take2.wav'), 'utf8')).toBe('new file with same name')
    expect(readFileSync(join(rec, 'Take2_2.wav'), 'utf8')).toBe('old')
  })

  it('restores into the current recordings folder when the original folder is gone', async () => {
    const id = addFile('Take3')
    await lib.trash([id])
    const trashPath = lib.get(id).trash!.trashPath
    // The whole day folder disappears except the trash content, which we move out first.
    const safe = join(dir, 'safe.wav')
    writeFileSync(safe, readFileSync(trashPath))
    rmSync(rec, { recursive: true, force: true })
    mkdirSync(join(dir, 'other'), { recursive: true })
    lib.patch(id, { trash: { ...lib.get(id).trash!, trashPath: safe }, filePath: safe })
    const res = await lib.restore([id])
    expect(res.results[0]!.ok).toBe(true)
    expect(res.results[0]!.detail).toBe('relocated')
    expect(lib.get(id).filePath).toBe(join(root, 'Take3.wav'))
    expect(existsSync(join(root, 'Take3.wav'))).toBe(true)
  })

  it('deletes single items permanently and empties the trash', async () => {
    const a = addFile('A')
    const b = addFile('B')
    const c = addFile('C')
    await lib.trash([a, b, c])
    const one = await lib.deleteForever([a])
    expect(one.results[0]!.ok).toBe(true)
    expect(lib.find(a)).toBeUndefined()
    const rest = await lib.emptyTrash()
    expect(rest.results.map((r) => r.ok)).toEqual([true, true])
    expect(lib.all()).toHaveLength(0)
  })

  it('reports per item results for mixed bulk operations', async () => {
    const a = addFile('Keep')
    const res = await lib.trash([a, 'does-not-exist'])
    expect(res.results).toEqual([
      expect.objectContaining({ id: a, ok: true }),
      expect.objectContaining({ id: 'does-not-exist', ok: false, errorKey: 'errors.recordingNotFound' })
    ])
    const del = await lib.deleteForever([lib.get(a).id, 'nope'])
    expect(del.results.map((r) => r.ok)).toEqual([true, false])
  })

  it('refuses permanent deletion of recordings that are not in the trash', async () => {
    const a = addFile('Live')
    const res = await lib.deleteForever([a])
    expect(res.results[0]).toMatchObject({ ok: false, errorKey: 'errors.notInTrash' })
    expect(existsSync(join(rec, 'Live.wav'))).toBe(true)
  })

  it('persists trash state across restarts', async () => {
    const a = addFile('Persist')
    await lib.trash([a])
    await lib.flush()
    const again = new LibraryStore({ dataDir: join(dir, 'data'), platform: 'linux', logger: testLogger(dir), recordingsDir: () => root, layout: () => 'flat' })
    await again.load()
    expect(again.get(a).trash).not.toBeNull()
    expect(again.get(a).missing).toBe(false)
  })
})

describe('folders, tags and renaming', () => {
  let dir: string
  let cleanup: () => void
  beforeEach(() => {
    ;({ dir, cleanup } = tempDir())
  })
  afterEach(() => cleanup())

  it('deleting a folder or tag keeps the recordings', async () => {
    const lib = new LibraryStore({ dataDir: join(dir, 'data'), platform: 'linux', logger: testLogger(dir), recordingsDir: () => dir, layout: () => 'flat' })
    await lib.load()
    const snap = lib.createFolder('Podcast')
    const folderId = snap.folders[0]!.id
    const tagId = lib.createTag('Draft').tags[0]!.id
    lib.add(makeRecording({ id: 'r1', folderId, tagIds: [tagId] }))
    expect(() => lib.createFolder('podcast')).toThrow()
    const otherFolder = lib.createFolder('Interviews').folders.find((f) => f.name === 'Interviews')!.id
    expect(() => lib.renameFolder(otherFolder, 'PODCAST')).toThrow('errors.folderExists')
    expect(lib.renameFolder(folderId, 'podcast').folders.find((f) => f.id === folderId)!.name).toBe('podcast')
    const otherTag = lib.createTag('Final').tags.find((t) => t.name === 'Final')!.id
    expect(() => lib.renameTag(otherTag, 'draft')).toThrow('errors.tagExists')
    lib.deleteFolder(folderId)
    lib.deleteTag(tagId)
    expect(lib.get('r1').folderId).toBeNull()
    expect(lib.get('r1').tagIds).toEqual([])
  })

  it('renames the file on disk without overwriting other files', async () => {
    const lib = new LibraryStore({ dataDir: join(dir, 'data'), platform: 'linux', logger: testLogger(dir), recordingsDir: () => dir, layout: () => 'flat' })
    await lib.load()
    writeFileSync(join(dir, 'Old.wav'), 'a')
    writeFileSync(join(dir, 'Taken.wav'), 'b')
    lib.add(makeRecording({ id: 'r', name: 'Old', filePath: join(dir, 'Old.wav') }))
    await expect(lib.rename('r', 'Taken')).rejects.toThrow()
    const r = await lib.rename('r', 'New: name?')
    expect(r.name).toBe('New: name?')
    expect(readFileSync(join(dir, 'New: name?.wav'), 'utf8')).toBe('a')
    expect(readFileSync(join(dir, 'Taken.wav'), 'utf8')).toBe('b')
  })
})
