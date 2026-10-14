import { constants } from 'node:fs'
import { access, copyFile, link, mkdir, open, readFile, rename, rm, stat, statfs, unlink } from 'node:fs/promises'
import { basename, dirname, join, parse } from 'node:path'
import { randomUUID } from 'node:crypto'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Retries transient Windows errors caused by antivirus scanners or indexers holding a handle. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'EMFILE') throw err
      last = err
      await sleep(40 * (i + 1))
    }
  }
  throw last
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Writes a file so that readers only ever see the old or the complete new content:
 * temp file in the same directory, fsync, then rename over the target.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(file)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${basename(file)}.${randomUUID().slice(0, 8)}.tmp`)
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await withRetry(() => rename(tmp, file))
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
  if (process.platform !== 'win32') {
    try {
      const dh = await open(dir, 'r')
      await dh.sync()
      await dh.close()
    } catch {
      // Directory fsync is best effort.
    }
  }
}

export type JsonReadResult = { status: 'ok'; data: unknown } | { status: 'missing' } | { status: 'corrupt'; error: string }

export async function readJson(file: string): Promise<JsonReadResult> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    return { status: 'corrupt', error: (err as Error).message }
  }
  try {
    return { status: 'ok', data: JSON.parse(text) }
  } catch (err) {
    return { status: 'corrupt', error: (err as Error).message }
  }
}

export async function isWritableDir(dir: string): Promise<boolean> {
  try {
    const s = await stat(dir)
    if (!s.isDirectory()) return false
    const probe = join(dir, `.sonora-write-test-${randomUUID().slice(0, 8)}`)
    const fh = await open(probe, 'w')
    await fh.close()
    await unlink(probe)
    return true
  } catch {
    return false
  }
}

/** Free bytes on the volume holding `dir` (or its closest existing parent). */
export async function freeSpace(dir: string): Promise<number | null> {
  let current = dir
  for (let i = 0; i < 64; i++) {
    try {
      const s = await statfs(current)
      return Number(s.bavail) * Number(s.bsize)
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
  return null
}

export class NameConflictError extends Error {
  constructor(public readonly target: string) {
    super(`Target exists: ${target}`)
  }
}

/**
 * Moves `src` to `dest` without ever replacing an existing file. Uses a hard link where the
 * file system supports it (atomic no-clobber), and falls back to an existence check + rename.
 */
export async function renameNoClobber(src: string, dest: string): Promise<void> {
  try {
    await link(src, dest)
    await withRetry(() => unlink(src))
    return
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new NameConflictError(dest)
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'ENOSYS' && code !== 'EINVAL' && code !== 'EACCES') {
      throw err
    }
  }
  if (await pathExists(dest)) throw new NameConflictError(dest)
  await withRetry(() => rename(src, dest))
}

/** Moves a file, copying across volumes when a rename is impossible. Never overwrites. */
export async function moveFile(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await renameNoClobber(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    if (await pathExists(dest)) throw new NameConflictError(dest)
    await copyFile(src, dest, constants.COPYFILE_EXCL)
    const fh = await open(dest, 'r+')
    await fh.sync()
    await fh.close()
    await withRetry(() => unlink(src))
  }
}

/** Splits `name.ext` into its parts. */
export function splitName(fileName: string): { base: string; ext: string } {
  const p = parse(fileName)
  return { base: p.name, ext: p.ext.replace(/^\./, '') }
}
