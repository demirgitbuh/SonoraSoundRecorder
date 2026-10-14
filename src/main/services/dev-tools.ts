import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BinaryKind, DevStorageEntry, TempCleanup } from '../../shared/developer'
import type { Ffmpeg } from './ffmpeg'

const CHECK_TIMEOUT_MS = 10_000
const MAX_OUTPUT_CHARS = 64 * 1024

/** Runs an executable with a few arguments and returns its exit code and output. */
function runCaptured(exe: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    let done = false
    const finish = (code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ code, output })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve({ code: null, output: '' })
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, CHECK_TIMEOUT_MS)
    const collect = (d: Buffer): void => {
      if (output.length < MAX_OUTPUT_CHARS) output += d.toString('utf8')
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', () => finish(null))
    child.on('close', (code) => finish(code))
  })
}

/**
 * Checks that a file is a working executable of the expected kind. FFmpeg and FFprobe must
 * report their own name in `-version`; whisper-cli must print its usage for `-h`.
 */
export async function checkBinary(kind: BinaryKind, path: string): Promise<{ ok: boolean; version: string | null }> {
  if (!existsSync(path)) return { ok: false, version: null }
  try {
    if (!(await stat(path)).isFile()) return { ok: false, version: null }
  } catch {
    return { ok: false, version: null }
  }
  if (kind === 'whisper') {
    const { code, output } = await runCaptured(path, ['-h'])
    return { ok: code === 0 && /--model/.test(output), version: null }
  }
  const { code, output } = await runCaptured(path, ['-version'])
  const m = new RegExp(`^${kind} version (\\S+)`, 'm').exec(output)
  return { ok: code === 0 && !!m, version: m ? m[1]! : null }
}

async function dirSize(dir: string, budget = { files: 20000 }): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { bytes, files }
  }
  for (const e of entries) {
    if (budget.files <= 0) break
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const sub = await dirSize(p, budget)
      bytes += sub.bytes
      files += sub.files
    } else if (e.isFile()) {
      budget.files--
      files++
      try {
        bytes += (await stat(p)).size
      } catch {
        /* removed meanwhile */
      }
    }
  }
  return { bytes, files }
}

/** Sizes of Sonora's own data files and folders (never the recordings themselves). */
export async function storageReport(items: Array<{ id: string; path: string }>): Promise<DevStorageEntry[]> {
  const out: DevStorageEntry[] = []
  for (const item of items) {
    try {
      const s = await stat(item.path)
      if (s.isDirectory()) {
        const size = await dirSize(item.path)
        out.push({ id: item.id, path: item.path, bytes: size.bytes, files: size.files, exists: true })
      } else {
        out.push({ id: item.id, path: item.path, bytes: s.size, files: 1, exists: true })
      }
    } catch {
      out.push({ id: item.id, path: item.path, bytes: 0, files: 0, exists: false })
    }
  }
  return out
}

const MAX_VIEW_BYTES = 2 * 1024 * 1024

/** Reads a JSON data file for the read-only viewer, pretty printed when possible. */
export async function readDataFile(path: string): Promise<string> {
  const s = await stat(path)
  if (s.size > MAX_VIEW_BYTES) {
    const text = await readFile(path, 'utf8')
    return `${text.slice(0, MAX_VIEW_BYTES)}\n…`
  }
  const text = await readFile(path, 'utf8')
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Creates a short sine tone file with the bundled FFmpeg, used to test the archive without a microphone. */
export async function generateTestTone(ffmpeg: Ffmpeg, dir: string, frequencyHz: number, seconds: number): Promise<string> {
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const file = join(dir, `Sonora_Test_${Math.round(frequencyHz)}Hz_${stamp}.wav`)
  await ffmpeg.run([
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${Math.round(frequencyHz)}:sample_rate=48000:duration=${seconds}`,
    '-af',
    'volume=0.5',
    '-ac',
    '2',
    '-c:a',
    'pcm_s24le',
    '-y',
    file
  ])
  return file
}

/** Removes Sonora's temporary files, skipping work folders of transcriptions still in progress. */
export async function clearTempDir(dir: string, keep: string[]): Promise<TempCleanup> {
  const result: TempCleanup = { removed: 0, bytes: 0, skipped: 0 }
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return result
  }
  const keepSet = new Set(keep.map((k) => k.toLowerCase()))
  for (const name of names) {
    const p = join(dir, name)
    if (keepSet.has(p.toLowerCase())) {
      result.skipped++
      continue
    }
    try {
      const s = await stat(p)
      const size = s.isDirectory() ? (await dirSize(p)).bytes : s.size
      await rm(p, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 })
      result.removed++
      result.bytes += size
    } catch {
      result.skipped++
    }
  }
  return result
}
