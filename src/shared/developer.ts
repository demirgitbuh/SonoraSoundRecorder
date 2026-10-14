import { z } from 'zod'

/**
 * Developer settings. They only take effect while developer mode is enabled; turning developer
 * mode off restores the standard behavior without losing the configured values.
 */

export const DEV_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type DevLogLevel = (typeof DEV_LOG_LEVELS)[number]

export const LATENCY_HINTS = ['interactive', 'balanced', 'playback'] as const
export type LatencyHint = (typeof LATENCY_HINTS)[number]

export const CHUNK_FRAME_SIZES = [1024, 2048, 4096, 8192, 16384] as const
export type ChunkFrames = (typeof CHUNK_FRAME_SIZES)[number]

export const BINARY_KINDS = ['ffmpeg', 'ffprobe', 'whisper'] as const
export type BinaryKind = (typeof BINARY_KINDS)[number]

export const DEFAULT_DEVELOPER = {
  enabled: false,
  audio: {
    latencyHint: 'interactive' as LatencyHint,
    chunkFrames: 4096 as ChunkFrames,
    sendIntervalMs: 250,
    meterHz: 30,
    clipThresholdDb: -0.01,
    dataTimeoutMs: 4000
  },
  storage: {
    syncIntervalMs: 2000,
    keepTempFiles: false
  },
  logging: {
    level: 'info' as DevLogLevel,
    ipcTrace: false,
    commandLines: false
  },
  whisper: {
    /** 0 keeps the whisper.cpp default. */
    beamSize: 0,
    /** 0 keeps the whisper.cpp default. */
    bestOf: 0,
    temperature: 0,
    /** Maximum segment length in characters; 0 means no limit. */
    maxLen: 0,
    /** Maximum number of text context tokens; -1 keeps the default. */
    maxContext: -1,
    prompt: '',
    translate: false,
    splitOnWord: false,
    noFallback: false,
    suppressNonSpeech: false,
    useGpu: true,
    flashAttention: true
  },
  binaries: {
    ffmpeg: null as string | null,
    ffprobe: null as string | null,
    whisper: null as string | null
  },
  updates: {
    allowPrerelease: false
  },
  chromium: {
    hardwareAcceleration: true,
    /** Platform feature switches Sonora needs (system audio loopback, shortcut portal). */
    platformFlags: true,
    enableFeatures: '',
    disableFeatures: ''
  },
  ui: {
    perfOverlay: false,
    showInternalIds: false,
    devToolsShortcut: true
  }
}

const D = DEFAULT_DEVELOPER

const chunkFramesSchema = z.union([z.literal(1024), z.literal(2048), z.literal(4096), z.literal(8192), z.literal(16384)])
const binaryPath = z.string().min(1).max(4096).nullable().catch(null)

export const developerSchema = z
  .object({
    enabled: z.boolean().catch(false),
    audio: z
      .object({
        latencyHint: z.enum(LATENCY_HINTS).catch(D.audio.latencyHint),
        chunkFrames: chunkFramesSchema.catch(D.audio.chunkFrames),
        sendIntervalMs: z.number().int().min(50).max(2000).catch(D.audio.sendIntervalMs),
        meterHz: z.number().int().min(10).max(60).catch(D.audio.meterHz),
        clipThresholdDb: z.number().min(-12).max(0).catch(D.audio.clipThresholdDb),
        dataTimeoutMs: z.number().int().min(1000).max(30000).catch(D.audio.dataTimeoutMs)
      })
      .catch(() => ({ ...D.audio })),
    storage: z
      .object({
        syncIntervalMs: z.number().int().min(250).max(10000).catch(D.storage.syncIntervalMs),
        keepTempFiles: z.boolean().catch(D.storage.keepTempFiles)
      })
      .catch(() => ({ ...D.storage })),
    logging: z
      .object({
        level: z.enum(DEV_LOG_LEVELS).catch(D.logging.level),
        ipcTrace: z.boolean().catch(D.logging.ipcTrace),
        commandLines: z.boolean().catch(D.logging.commandLines)
      })
      .catch(() => ({ ...D.logging })),
    whisper: z
      .object({
        beamSize: z.number().int().min(0).max(16).catch(D.whisper.beamSize),
        bestOf: z.number().int().min(0).max(16).catch(D.whisper.bestOf),
        temperature: z.number().min(0).max(1).catch(D.whisper.temperature),
        maxLen: z.number().int().min(0).max(1000).catch(D.whisper.maxLen),
        maxContext: z.number().int().min(-1).max(224).catch(D.whisper.maxContext),
        prompt: z.string().max(1000).catch(D.whisper.prompt),
        translate: z.boolean().catch(D.whisper.translate),
        splitOnWord: z.boolean().catch(D.whisper.splitOnWord),
        noFallback: z.boolean().catch(D.whisper.noFallback),
        suppressNonSpeech: z.boolean().catch(D.whisper.suppressNonSpeech),
        useGpu: z.boolean().catch(D.whisper.useGpu),
        flashAttention: z.boolean().catch(D.whisper.flashAttention)
      })
      .catch(() => ({ ...D.whisper })),
    binaries: z
      .object({
        ffmpeg: binaryPath,
        ffprobe: binaryPath,
        whisper: binaryPath
      })
      .catch(() => ({ ...D.binaries })),
    updates: z
      .object({
        allowPrerelease: z.boolean().catch(D.updates.allowPrerelease)
      })
      .catch(() => ({ ...D.updates })),
    chromium: z
      .object({
        hardwareAcceleration: z.boolean().catch(D.chromium.hardwareAcceleration),
        platformFlags: z.boolean().catch(D.chromium.platformFlags),
        enableFeatures: z.string().max(1000).catch(D.chromium.enableFeatures),
        disableFeatures: z.string().max(1000).catch(D.chromium.disableFeatures)
      })
      .catch(() => ({ ...D.chromium })),
    ui: z
      .object({
        perfOverlay: z.boolean().catch(D.ui.perfOverlay),
        showInternalIds: z.boolean().catch(D.ui.showInternalIds),
        devToolsShortcut: z.boolean().catch(D.ui.devToolsShortcut)
      })
      .catch(() => ({ ...D.ui }))
  })
  .catch(() => structuredClone(DEFAULT_DEVELOPER))

export type DeveloperSettings = z.infer<typeof developerSchema>

export function defaultDeveloper(): DeveloperSettings {
  return developerSchema.parse({})
}

/** The values in effect: the configured ones in developer mode, the defaults otherwise. */
export function effectiveDeveloper(d: DeveloperSettings): DeveloperSettings {
  return d.enabled ? d : defaultDeveloper()
}

/** Linear sample level for a threshold in dBFS. */
export function dbToLinear(db: number): number {
  return Math.min(1, Math.pow(10, db / 20))
}

const FEATURE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/
const MAX_FEATURES = 40

/** Splits a comma or space separated list of Chromium feature names into valid and invalid entries. */
export function parseFeatureList(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  for (const raw of text.split(/[\s,]+/)) {
    const name = raw.trim()
    if (!name) continue
    if (!FEATURE_NAME.test(name)) invalid.push(name)
    else if (!valid.includes(name) && valid.length < MAX_FEATURES) valid.push(name)
  }
  return { valid, invalid }
}

export interface ChromiumBootFlags {
  hardwareAcceleration: boolean
  enableFeatures: string[]
  disableFeatures: string[]
}

/** Chromium switches applied at startup for the given settings and platform feature list. */
export function chromiumBootFlags(d: DeveloperSettings, platformFeatures: string[]): ChromiumBootFlags {
  const e = effectiveDeveloper(d)
  const disable = parseFeatureList(e.chromium.disableFeatures).valid
  const enable = [...(e.chromium.platformFlags ? platformFeatures : []), ...parseFeatureList(e.chromium.enableFeatures).valid].filter(
    (name, i, all) => all.indexOf(name) === i && !disable.includes(name)
  )
  return { hardwareAcceleration: e.chromium.hardwareAcceleration, enableFeatures: enable, disableFeatures: disable }
}

/** Extra whisper-cli arguments for the advanced transcription options (only non-default values). */
export function whisperExtraArgs(w: DeveloperSettings['whisper']): string[] {
  const args: string[] = []
  if (w.beamSize > 0) args.push('-bs', String(w.beamSize))
  if (w.bestOf > 0) args.push('-bo', String(w.bestOf))
  if (w.temperature > 0) args.push('-tp', String(Math.round(w.temperature * 100) / 100))
  if (w.maxLen > 0) args.push('-ml', String(w.maxLen))
  if (w.maxContext >= 0) args.push('-mc', String(w.maxContext))
  const prompt = w.prompt.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (prompt) args.push('--prompt', prompt)
  if (w.translate) args.push('-tr')
  if (w.splitOnWord) args.push('-sow')
  if (w.noFallback) args.push('-nf')
  if (w.suppressNonSpeech) args.push('-sns')
  if (!w.useGpu) args.push('-ng')
  if (!w.flashAttention) args.push('-nfa')
  return args
}

/** Formats a command line for display and logs; arguments with spaces are quoted. */
export function formatCommand(exe: string, args: string[]): string {
  const quote = (a: string): string => (a === '' ? '""' : /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)
  return [exe, ...args].map(quote).join(' ')
}

// ---------------------------------------------------------------------------
// Diagnostics shared between the main process and the developer page
// ---------------------------------------------------------------------------

export interface LogEntry {
  seq: number
  time: string
  level: DevLogLevel
  scope: string
  message: string
}

export interface BinaryInfo {
  kind: BinaryKind
  path: string
  source: 'bundled' | 'custom'
  available: boolean
  version: string | null
}

export interface ProcessMetric {
  pid: number
  type: string
  name: string | null
  cpuPercent: number
  memoryKB: number
}

export interface DevMetrics {
  processes: ProcessMetric[]
  systemMemory: { totalKB: number; freeKB: number } | null
  uptimeSec: number
}

export interface BootFlagsState {
  /** Switches applied when the running process started. */
  applied: ChromiumBootFlags
  /** Switches the current settings would apply at the next start. */
  configured: ChromiumBootFlags
  restartRequired: boolean
}

export interface DevDiagnostics {
  app: { name: string; version: string; packaged: boolean; installKind: string; locale: string; uptimeSec: number }
  versions: { electron: string; chrome: string; node: string; v8: string }
  os: { platform: string; release: string; arch: string; wayland: boolean; cpus: number; cpuModel: string; totalMemoryKB: number }
  paths: Array<{ id: string; path: string }>
  binaries: BinaryInfo[]
  gpu: Record<string, string>
  boot: BootFlagsState
  runs: { active: number; pending: number }
  transcriptionJobs: number
}

export interface DevStorageEntry {
  id: string
  path: string
  bytes: number
  files: number
  exists: boolean
}

export const DATA_FILES = ['settings', 'library', 'schedules', 'profiles'] as const
export type DataFileName = (typeof DATA_FILES)[number]

export const DEV_PATHS = ['data', 'logs', 'sessions', 'temp'] as const
export type DevPathId = (typeof DEV_PATHS)[number]

export interface ProbeOutput {
  path: string
  json: string
}

export interface TempCleanup {
  removed: number
  bytes: number
  skipped: number
}
