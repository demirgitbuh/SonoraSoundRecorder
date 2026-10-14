import type { AudioFormat, CustomEncoding, EncodingOptions, QualityProfile } from './types'

export interface FormatInfo {
  ext: string
  lossless: boolean
  /** True when the final size is known exactly from the sample count. */
  exactSize: boolean
  sampleRates: number[]
  bitDepths: Array<16 | 24 | 32>
  bitrates: number[]
  mime: string
  label: string
}

export const FORMAT_INFO: Record<AudioFormat, FormatInfo> = {
  wav: {
    ext: 'wav',
    lossless: true,
    exactSize: true,
    sampleRates: [44100, 48000, 96000],
    bitDepths: [16, 24, 32],
    bitrates: [],
    mime: 'audio/wav',
    label: 'WAV'
  },
  flac: {
    ext: 'flac',
    lossless: true,
    exactSize: false,
    sampleRates: [44100, 48000, 96000],
    bitDepths: [16, 24],
    bitrates: [],
    mime: 'audio/flac',
    label: 'FLAC'
  },
  mp3: {
    ext: 'mp3',
    lossless: false,
    exactSize: false,
    sampleRates: [44100, 48000],
    bitDepths: [],
    bitrates: [96, 128, 160, 192, 256, 320],
    mime: 'audio/mpeg',
    label: 'MP3'
  },
  opus: {
    ext: 'ogg',
    lossless: false,
    exactSize: false,
    sampleRates: [48000],
    bitDepths: [],
    bitrates: [32, 48, 64, 96, 128, 160, 192, 256],
    mime: 'audio/ogg',
    label: 'OGG Opus'
  },
  aac: {
    ext: 'm4a',
    lossless: false,
    exactSize: false,
    sampleRates: [44100, 48000],
    bitDepths: [],
    bitrates: [64, 96, 128, 160, 192, 256, 320],
    mime: 'audio/mp4',
    label: 'M4A AAC'
  }
}

export const DEFAULT_FORMAT: AudioFormat = 'wav'
export const DEFAULT_PROFILE: QualityProfile = 'high'

export const DEFAULT_CUSTOM_ENCODING: CustomEncoding = {
  sampleRate: 48000,
  channels: 2,
  bitDepth: 24,
  bitrateKbps: 192,
  flacCompression: 5
}

type Preset = Omit<CustomEncoding, 'flacCompression'> & { flacCompression?: number }

const PRESETS: Record<Exclude<QualityProfile, 'custom'>, Record<AudioFormat, Preset>> = {
  high: {
    wav: { sampleRate: 48000, channels: 2, bitDepth: 24, bitrateKbps: 0 },
    flac: { sampleRate: 48000, channels: 2, bitDepth: 24, bitrateKbps: 0, flacCompression: 5 },
    mp3: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 320 },
    opus: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 160 },
    aac: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 256 }
  },
  standard: {
    wav: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 0 },
    flac: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 0, flacCompression: 5 },
    mp3: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 192 },
    opus: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 96 },
    aac: { sampleRate: 48000, channels: 2, bitDepth: 16, bitrateKbps: 160 }
  },
  compact: {
    wav: { sampleRate: 48000, channels: 1, bitDepth: 16, bitrateKbps: 0 },
    flac: { sampleRate: 48000, channels: 1, bitDepth: 16, bitrateKbps: 0, flacCompression: 8 },
    mp3: { sampleRate: 44100, channels: 1, bitDepth: 16, bitrateKbps: 96 },
    opus: { sampleRate: 48000, channels: 1, bitDepth: 16, bitrateKbps: 48 },
    aac: { sampleRate: 44100, channels: 1, bitDepth: 16, bitrateKbps: 96 }
  }
}

function nearest(values: number[], target: number): number {
  let best = values[0] ?? target
  for (const v of values) if (Math.abs(v - target) < Math.abs(best - target)) best = v
  return best
}

/** Forces options into the set of values that the chosen format really supports. */
export function sanitizeEncoding(opts: EncodingOptions): EncodingOptions {
  const info = FORMAT_INFO[opts.format]
  const sampleRate = info.sampleRates.includes(opts.sampleRate) ? opts.sampleRate : nearest(info.sampleRates, opts.sampleRate)
  const channels: 1 | 2 = opts.channels === 1 ? 1 : 2
  let bitDepth: 16 | 24 | 32 = 16
  if (info.bitDepths.length > 0) {
    bitDepth = info.bitDepths.includes(opts.bitDepth) ? opts.bitDepth : (nearest(info.bitDepths, opts.bitDepth) as 16 | 24 | 32)
  }
  const bitrateKbps = info.bitrates.length > 0 ? nearest(info.bitrates, opts.bitrateKbps || 192) : 0
  const flacCompression = Math.min(8, Math.max(0, Math.round(opts.flacCompression)))
  return { format: opts.format, sampleRate, channels, bitDepth, bitrateKbps, flacCompression }
}

export function resolveEncoding(format: AudioFormat, profile: QualityProfile, custom: CustomEncoding): EncodingOptions {
  if (profile === 'custom') return sanitizeEncoding({ format, ...custom })
  const p = PRESETS[profile][format]
  return sanitizeEncoding({
    format,
    sampleRate: p.sampleRate,
    channels: p.channels,
    bitDepth: p.bitDepth,
    bitrateKbps: p.bitrateKbps,
    flacCompression: p.flacCompression ?? 5
  })
}

/** Average output bytes per second; exact for WAV, an estimate for everything else. */
export function bytesPerSecond(opts: EncodingOptions): number {
  switch (opts.format) {
    case 'wav':
      return opts.sampleRate * opts.channels * (opts.bitDepth / 8)
    case 'flac':
      // Typical lossless compression ratio for speech and mixed content.
      return opts.sampleRate * opts.channels * (opts.bitDepth / 8) * 0.6
    default:
      return (opts.bitrateKbps * 1000) / 8
  }
}

export function estimateFinalSize(opts: EncodingOptions, durationMs: number): { bytes: number; estimated: boolean } {
  const header = opts.format === 'wav' ? 44 : 0
  const bytes = Math.round((bytesPerSecond(opts) * durationMs) / 1000) + header
  return { bytes, estimated: !FORMAT_INFO[opts.format].exactSize }
}

/** FFmpeg encoder and container arguments for an encoding. */
export function ffmpegOutputArgs(opts: EncodingOptions): string[] {
  const o = sanitizeEncoding(opts)
  const common = ['-ar', String(o.sampleRate), '-ac', String(o.channels)]
  switch (o.format) {
    case 'wav': {
      const codec = o.bitDepth === 16 ? 'pcm_s16le' : o.bitDepth === 24 ? 'pcm_s24le' : 'pcm_f32le'
      return [...common, '-c:a', codec, '-rf64', 'auto', '-f', 'wav']
    }
    case 'flac':
      return [
        ...common,
        '-c:a',
        'flac',
        '-compression_level',
        String(o.flacCompression),
        '-sample_fmt',
        o.bitDepth === 16 ? 's16' : 's32',
        ...(o.bitDepth === 24 ? ['-bits_per_raw_sample', '24'] : []),
        '-f',
        'flac'
      ]
    case 'mp3':
      return [...common, '-c:a', 'libmp3lame', '-b:a', `${o.bitrateKbps}k`, '-f', 'mp3']
    case 'opus':
      return [...common, '-c:a', 'libopus', '-b:a', `${o.bitrateKbps}k`, '-vbr', 'on', '-application', 'audio', '-f', 'ogg']
    case 'aac':
      return [...common, '-c:a', 'aac', '-b:a', `${o.bitrateKbps}k`, '-movflags', '+faststart', '-f', 'ipod']
  }
}

export function formatFromExtension(ext: string): AudioFormat | null {
  const e = ext.toLowerCase().replace(/^\./, '')
  switch (e) {
    case 'wav':
      return 'wav'
    case 'mp3':
      return 'mp3'
    case 'flac':
      return 'flac'
    case 'ogg':
    case 'opus':
      return 'opus'
    case 'm4a':
    case 'aac':
    case 'mp4':
      return 'aac'
    default:
      return null
  }
}
