import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { AudioFormat } from '../../shared/types'
import { formatCommand } from '../../shared/developer'
import type { Logger } from './logger'

export interface ProbeStream {
  codecName: string
  codecType: string
  sampleRate: number
  channels: number
  bitsPerRawSample: number | null
  bitRate: number | null
  attachedPic: boolean
}

export interface ProbeResult {
  formatName: string
  durationMs: number
  bitRate: number | null
  sizeBytes: number | null
  audio: ProbeStream | null
  streams: ProbeStream[]
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    public readonly stderrTail: string
  ) {
    super(message)
  }
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

export interface RunOptions {
  /** Expected output duration, used to compute progress from `-progress` output. */
  totalMs?: number
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /** Receives raw stdout data (used for decoding PCM to a pipe). */
  onStdout?: (chunk: Buffer) => void
  /** Receives every stderr line (requires a log level that prints what you need). */
  onStderrLine?: (line: string) => void
  logLevel?: 'error' | 'info'
}

/** Wrapper around the bundled ffmpeg and ffprobe executables (or developer-selected ones). */
export class Ffmpeg {
  /** Writes every command line, exit code and duration to the log (developer option). */
  logCommands = false

  constructor(
    private ffmpegExe: string,
    private ffprobeExe: string,
    private readonly logger: Logger
  ) {}

  get ffmpegPath(): string {
    return this.ffmpegExe
  }

  get ffprobePath(): string {
    return this.ffprobeExe
  }

  /** Switches to other executables; used for developer binary overrides. */
  setPaths(ffmpegPath: string, ffprobePath: string): void {
    this.ffmpegExe = ffmpegPath
    this.ffprobeExe = ffprobePath
  }

  get available(): boolean {
    return existsSync(this.ffmpegPath) && existsSync(this.ffprobePath)
  }

  private logCommand(exe: string, args: string[]): number {
    if (this.logCommands) this.logger.info('ffmpeg-cmd', formatCommand(exe, args))
    return Date.now()
  }

  private logExit(exe: string, code: number | null, started: number): void {
    if (this.logCommands) this.logger.info('ffmpeg-cmd', `${basename(exe)} exited with ${code} after ${Date.now() - started} ms`)
  }

  run(args: string[], opts: RunOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.available) {
        reject(new FfmpegError('ffmpeg binary not found', ''))
        return
      }
      const withProgress = opts.onProgress && opts.totalMs ? ['-progress', 'pipe:2', '-nostats'] : ['-nostats']
      const fullArgs = ['-hide_banner', '-loglevel', opts.logLevel ?? 'error', ...withProgress, ...args]
      const started = this.logCommand(this.ffmpegPath, fullArgs)
      const child = spawn(this.ffmpegPath, fullArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stderrTail = ''
      let settled = false
      const onAbort = (): void => {
        child.kill('SIGKILL')
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => opts.onStdout?.(chunk))
      child.stderr.setEncoding('utf8')
      let partial = ''
      child.stderr.on('data', (text: string) => {
        const lines = (partial + text).split(/\r?\n/)
        partial = lines.pop() ?? ''
        for (const line of lines) {
          opts.onStderrLine?.(line)
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
          if (m && opts.totalMs && opts.onProgress) {
            const us = Number(m[1])
            opts.onProgress(Math.min(1, us / 1000 / opts.totalMs))
            continue
          }
          if (/^(progress|out_time|total_size|bitrate|speed|frame|fps|stream_|dup_frames|drop_frames)/.test(line)) continue
          if (line.trim()) stderrTail = `${stderrTail}\n${line}`.slice(-2000)
        }
      })
      child.on('error', (err) => {
        if (settled) return
        settled = true
        opts.signal?.removeEventListener('abort', onAbort)
        reject(new FfmpegError(err.message, stderrTail))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        this.logExit(this.ffmpegPath, code, started)
        if (partial) {
          opts.onStderrLine?.(partial)
          stderrTail = `${stderrTail}\n${partial}`.slice(-2000)
        }
        opts.signal?.removeEventListener('abort', onAbort)
        if (opts.signal?.aborted) {
          reject(new CancelledError())
        } else if (code === 0) {
          opts.onProgress?.(1)
          resolve()
        } else {
          this.logger.warn('ffmpeg', `exit ${code}: ${stderrTail.trim().split('\n').slice(-3).join(' | ')}`)
          reject(new FfmpegError(`ffmpeg exited with code ${code}`, stderrTail))
        }
      })
    })
  }

  async probe(file: string): Promise<ProbeResult> {
    const out = await this.probeRaw(file)
    try {
      return parseProbe(JSON.parse(out))
    } catch (e) {
      throw new FfmpegError(`could not parse ffprobe output: ${(e as Error).message}`, '')
    }
  }

  /** Raw `ffprobe -show_format -show_streams` JSON text. */
  probeRaw(file: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]
      const started = this.logCommand(this.ffprobePath, args)
      const child = spawn(this.ffprobePath, args, { windowsHide: true })
      let out = ''
      let err = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (d: string) => {
        out += d
      })
      child.stderr.on('data', (d: string) => {
        err = `${err}${d}`.slice(-2000)
      })
      child.on('error', (e) => reject(new FfmpegError(e.message, err)))
      child.on('close', (code) => {
        this.logExit(this.ffprobePath, code, started)
        if (code !== 0) {
          reject(new FfmpegError(`ffprobe exited with code ${code}`, err))
          return
        }
        resolve(out)
      })
    })
  }

  /**
   * Decodes a file to mono 8 kHz float samples and reduces them to one peak byte per
   * 1/50 second. Returns the peaks and the decoded duration.
   */
  async decodePeaks(file: string, signal?: AbortSignal): Promise<{ peaks: Uint8Array; durationMs: number }> {
    const rate = 8000
    const bucket = rate / PEAKS_PER_SECOND
    const peaks: number[] = []
    let current = 0
    let inBucket = 0
    let samples = 0
    let carry = Buffer.alloc(0)
    await this.run(['-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', 'pipe:1'], {
      signal,
      onStdout: (chunk) => {
        const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
        const usable = buf.length - (buf.length % 4)
        for (let i = 0; i < usable; i += 4) {
          const v = Math.abs(buf.readFloatLE(i))
          if (v > current) current = v
          inBucket++
          samples++
          if (inBucket >= bucket) {
            peaks.push(Math.min(255, Math.round(Math.min(1, current) * 255)))
            current = 0
            inBucket = 0
          }
        }
        carry = Buffer.from(buf.subarray(usable))
      }
    })
    if (inBucket > 0) peaks.push(Math.min(255, Math.round(Math.min(1, current) * 255)))
    return { peaks: Uint8Array.from(peaks), durationMs: (samples / rate) * 1000 }
  }

  /** Highest sample level of a file in dBFS (ffmpeg volumedetect), or null for digital silence. */
  async maxVolumeDb(file: string, signal?: AbortSignal): Promise<number | null> {
    let max: number | null = null
    await this.run(['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], {
      signal,
      logLevel: 'info',
      onStderrLine: (line) => {
        const m = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(line)
        if (m) max = m[1] === '-inf' ? null : Number(m[1])
      }
    })
    return max
  }
}

export const PEAKS_PER_SECOND = 50

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

export function parseProbe(json: unknown): ProbeResult {
  const root = (json ?? {}) as { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> }
  const streams: ProbeStream[] = (root.streams ?? []).map((s) => ({
    codecName: String(s.codec_name ?? ''),
    codecType: String(s.codec_type ?? ''),
    sampleRate: num(s.sample_rate) ?? 0,
    channels: num(s.channels) ?? 0,
    bitsPerRawSample: num(s.bits_per_raw_sample) ?? (num(s.bits_per_sample) || null),
    bitRate: num(s.bit_rate),
    attachedPic: Boolean((s.disposition as Record<string, unknown> | undefined)?.attached_pic)
  }))
  const audio = streams.find((s) => s.codecType === 'audio') ?? null
  const fmt = root.format ?? {}
  const duration = num(fmt.duration)
  return {
    formatName: String(fmt.format_name ?? ''),
    durationMs: duration !== null ? duration * 1000 : 0,
    bitRate: num(fmt.bit_rate),
    sizeBytes: num(fmt.size),
    audio,
    streams
  }
}

/** Maps a probed file to one of the supported formats, or null when it is not supported. */
export function supportedFormatOf(probe: ProbeResult): AudioFormat | null {
  const a = probe.audio
  if (!a) return null
  const fmt = probe.formatName
  if (fmt.includes('wav') && a.codecName.startsWith('pcm_')) return 'wav'
  if (fmt.includes('mp3') && a.codecName === 'mp3') return 'mp3'
  if (fmt.includes('flac') && a.codecName === 'flac') return 'flac'
  if (fmt.includes('ogg') && a.codecName === 'opus') return 'opus'
  if ((fmt.includes('mp4') || fmt.includes('m4a') || fmt.includes('mov')) && a.codecName === 'aac') return 'aac'
  return null
}
