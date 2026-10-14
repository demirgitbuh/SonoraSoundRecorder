import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import type { TrackKind } from '../shared/types'
import type { LibraryStore } from './services/library-store'
import { RUN_ID_PATTERN } from './services/run-store'
import { floatWavHeader } from './services/wav'
import type { RunStore } from './services/run-store'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = 'app://sonora'
export const MEDIA_SCHEME = 'sonora-media'

/** Must run before the app is ready. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon'
}

const AUDIO_MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/mp4'
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `media-src 'self' ${MEDIA_SCHEME}: blob:`,
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Serves the built renderer from app://sonora/ with a strict CSP. */
export function registerAppProtocol(rendererDir: string): void {
  const root = normalize(rendererDir)
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const file = normalize(join(root, pathname))
    if (!file.startsWith(root + sep) && file !== root) return new Response('Forbidden', { status: 403 })
    try {
      const s = await stat(file)
      if (!s.isFile()) return new Response('Not found', { status: 404 })
      const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream
      return new Response(stream, {
        headers: {
          'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': String(s.size),
          'Content-Security-Policy': CONTENT_SECURITY_POLICY,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

interface Range {
  start: number
  end: number
}

function parseRange(header: string | null, size: number): Range | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return 'invalid'
  let start: number
  let end: number
  if (m[1] === '' && m[2] !== '') {
    const suffix = Number(m[2])
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  if (!Number.isFinite(start) || start >= size || end < start) return 'invalid'
  return { start, end }
}

/** Largest raw track that still fits in a classic WAV header. */
export const MAX_VIRTUAL_WAV_DATA = 0xffffffff - 64

function fileResponse(path: string, size: number, mime: string, rangeHeader: string | null): Response {
  const range = parseRange(rangeHeader, size)
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  const r = range ?? { start: 0, end: size - 1 }
  const stream = Readable.toWeb(createReadStream(path, { start: r.start, end: r.end })) as unknown as ReadableStream
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(r.end - r.start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }
  if (range) headers['Content-Range'] = `bytes ${r.start}-${r.end}/${size}`
  return new Response(stream, { status: range ? 206 : 200, headers })
}

/**
 * Serves raw float data of a run as a virtual WAV: a generated header followed by bytes read
 * directly from the raw track, with HTTP range support for seeking. Nothing is copied.
 */
function virtualWavResponse(rawPath: string, dataBytes: number, sampleRate: number, channels: number, rangeHeader: string | null): Response {
  const header = floatWavHeader(dataBytes, sampleRate, channels)
  const size = header.length + dataBytes
  const range = parseRange(rangeHeader, size)
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  const r = range ?? { start: 0, end: size - 1 }
  async function* generate(): AsyncGenerator<Uint8Array> {
    if (r.start < header.length) yield header.subarray(r.start, Math.min(header.length, r.end + 1))
    const dataStart = Math.max(0, r.start - header.length)
    const dataEnd = r.end - header.length
    if (dataEnd >= dataStart && dataEnd >= 0) {
      for await (const chunk of createReadStream(rawPath, { start: dataStart, end: dataEnd })) yield chunk as Buffer
    }
  }
  const stream = Readable.toWeb(Readable.from(generate())) as unknown as ReadableStream
  const headers: Record<string, string> = {
    'Content-Type': 'audio/wav',
    'Content-Length': String(r.end - r.start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }
  if (range) headers['Content-Range'] = `bytes ${r.start}-${r.end}/${size}`
  return new Response(stream, { status: range ? 206 : 200, headers })
}

/**
 * sonora-media://rec/<recordingId>        archived recording
 * sonora-media://run/<runId>/<track>      unsaved run, served as virtual WAV
 * Only files known to the archive or the run store can be served.
 */
export function registerMediaProtocol(library: LibraryStore, runs: RunStore): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)
      const range = request.headers.get('range')
      if (url.hostname === 'rec' && parts.length === 1) {
        const rec = library.find(parts[0]!)
        if (!rec) return new Response('Not found', { status: 404 })
        const s = await stat(rec.filePath)
        return fileResponse(rec.filePath, s.size, AUDIO_MIME[extname(rec.filePath).toLowerCase()] ?? 'application/octet-stream', range)
      }
      if (url.hostname === 'run' && parts.length === 2 && RUN_ID_PATTERN.test(parts[0]!)) {
        const runId = parts[0]!
        const track = parts[1] as TrackKind
        if (!['mic', 'system', 'mix'].includes(track) || runs.isActive(runId)) return new Response('Not found', { status: 404 })
        const m = await runs.readManifest(runId)
        if (!m || !m.tracks.includes(track)) return new Response('Not found', { status: 404 })
        const frames = await runs.trackFrames(runId, track, m.channels)
        const dataBytes = frames * 4 * m.channels
        if (dataBytes > MAX_VIRTUAL_WAV_DATA) {
          // Very long runs do not fit in a WAV header; a compressed preview proxy is served instead.
          const proxy = runs.proxyPath(runId, track)
          const s = await stat(proxy).catch(() => null)
          if (!s) return new Response('Not ready', { status: 404 })
          return fileResponse(proxy, s.size, 'audio/ogg', range)
        }
        return virtualWavResponse(runs.trackPath(runId, track), dataBytes, m.sampleRate, m.channels, range)
      }
      return new Response('Not found', { status: 404 })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
