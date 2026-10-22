import type { TrackKind } from './types'

export const NAME_PREFIX = 'Sonora'

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** `Sonora_YYYY-MM-DD_HH-mm-ss` in local time. */
export function timestampName(date: Date): string {
  return `${NAME_PREFIX}_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/** Sub folder used by the "by date" layout: `YYYY-MM-DD`. */
export function dateFolderName(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
const MAX_NAME_LENGTH = 180
/**
 * Linux and macOS limit a file name to 255 bytes of UTF-8, so 180 Cyrillic or Chinese characters
 * would not fit. The cap leaves room for suffixes such as `_edited_system_2.flac`.
 */
const MAX_NAME_BYTES = 200
const utf8 = new TextEncoder()

export type PlatformName = 'win32' | 'darwin' | 'linux'

/**
 * Turns a user supplied name into a safe file name (without extension) for the platform.
 * Returns an empty string when nothing usable remains.
 */
export function sanitizeFileName(input: string, platform: PlatformName): string {
  let name = input.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '')
  if (platform === 'win32') {
    name = name.replace(/[<>:"/\\|?*]/g, '_')
  } else if (platform === 'darwin') {
    name = name.replace(/[/:]/g, '_')
  } else {
    name = name.replace(/\//g, '_')
  }
  name = name.replace(/\s+/g, ' ').trim()
  // Leading dots would hide the file on macOS and Linux.
  name = name.replace(/^\.+/, '')
  if (platform === 'win32') {
    name = name.replace(/[. ]+$/, '')
    if (WINDOWS_RESERVED.test(name)) name = `${name}_`
  }
  const chars = Array.from(name)
  if (chars.length > MAX_NAME_LENGTH) name = chars.slice(0, MAX_NAME_LENGTH).join('').trim()
  if (utf8.encode(name).length > MAX_NAME_BYTES) {
    let bytes = 0
    let kept = ''
    for (const ch of Array.from(name)) {
      bytes += utf8.encode(ch).length
      if (bytes > MAX_NAME_BYTES) break
      kept += ch
    }
    name = kept.trim()
  }
  if (platform === 'win32') name = name.replace(/[. ]+$/, '')
  return name
}

export function trackSuffix(track: TrackKind, multiple: boolean): string {
  if (!multiple || track === 'mix') return ''
  return track === 'mic' ? '_mic' : '_system'
}

/**
 * Finds a base name for which every `base + suffix + .ext` is free.
 * Existing files are never overwritten: `_2`, `_3`, ... are appended instead.
 */
export function uniqueBaseName(
  base: string,
  suffixes: string[],
  ext: string,
  isTaken: (fileName: string) => boolean
): string {
  const list = suffixes.length > 0 ? suffixes : ['']
  const free = (candidate: string): boolean => list.every((s) => !isTaken(`${candidate}${s}.${ext}`))
  if (free(base)) return base
  for (let i = 2; i < 10000; i++) {
    const candidate = `${base}_${i}`
    if (free(candidate)) return candidate
  }
  return `${base}_${Date.now().toString(36)}`
}

/** Case-insensitive file name comparison key (Windows and default macOS volumes are case-insensitive). */
export function fileNameKey(fileName: string, platform: PlatformName): string {
  return platform === 'linux' ? fileName : fileName.toLowerCase()
}
