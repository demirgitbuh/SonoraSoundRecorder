import { RunMachine } from '../../../shared/state-machine'
import { resolveEncoding } from '../../../shared/formats'
import { shouldPlayCue } from '../../../shared/notify-policy'
import type { RunInit } from '../../../shared/ipc'
import type { Settings } from '../../../shared/settings'
import { dbToLinear, effectiveDeveloper } from '../../../shared/developer'
import type { EncodingOptions, Marker, MicProcessing, PlatformCapabilities, SessionConfig, ToastKind, TrackKind } from '../../../shared/types'
import { AppError, invoke, log, send } from '../api'
import type { CaptureInfo, SessionRuntime } from '../stores/engine'
import { useEngine } from '../stores/engine'
import { CaptureError, closeSource, openMicrophone, openSystemAudio } from './capture'
import type { OpenedSource } from './capture'
import { playStartCue, playStopCue } from './cues'
import { liveData } from './live'
import type { LiveData } from './live'

const WORKLET_URL = (): string => new URL('worklets/capture-processor.js', document.baseURI).href
const MIN_FREE_BYTES = 200 * 1024 * 1024

export interface ControllerHost {
  settings: () => Settings
  caps: () => PlatformCapabilities
  config: (id: string) => SessionConfig | undefined
  updateConfig: (id: string, patch: Partial<SessionConfig>) => void
  systemCaptureActiveElsewhere: (id: string) => boolean
  onStateChange: () => void
  notify: (kind: ToastKind, titleKey: string, opts?: { bodyKey?: string; params?: Record<string, string | number>; detail?: string }) => void
  announce: (key: string, params?: Record<string, string | number>, assertive?: boolean) => void
  openPreview: (runId: string, sessionId: string) => void
  askName: (runId: string, sessionId: string) => void
}

export function tracksFor(cfg: Pick<SessionConfig, 'source' | 'outputMode'>): TrackKind[] {
  if (cfg.source === 'mic') return ['mic']
  if (cfg.source === 'system') return ['system']
  if (cfg.outputMode === 'combined') return ['mix']
  if (cfg.outputMode === 'separate') return ['mic', 'system']
  return ['mix', 'mic', 'system']
}

/** Batches worklet chunks and ships them to the main process a few times per second. */
class ChunkSender {
  private pending = new Map<TrackKind, Float32Array[]>()
  private bytes = 0
  private readonly timer: number
  /** Totals for the developer page. */
  sentBytes = 0
  sentMessages = 0
  lastSentAt = 0

  constructor(
    private readonly runId: string,
    intervalMs: number
  ) {
    this.timer = window.setInterval(() => this.flush(), intervalMs)
  }

  push(track: TrackKind, data: Float32Array): void {
    let list = this.pending.get(track)
    if (!list) {
      list = []
      this.pending.set(track, list)
    }
    list.push(data)
    this.bytes += data.byteLength
    if (this.bytes > 1024 * 1024) this.flush()
  }

  flush(): void {
    for (const [track, list] of this.pending) {
      if (list.length === 0) continue
      const total = list.reduce((n, a) => n + a.length, 0)
      const merged = new Float32Array(total)
      let offset = 0
      for (const a of list) {
        merged.set(a, offset)
        offset += a.length
      }
      list.length = 0
      send('rec:chunk', this.runId, track, merged.buffer)
      this.sentBytes += merged.byteLength
      this.sentMessages++
      this.lastSentAt = Date.now()
    }
    this.bytes = 0
  }

  close(): void {
    window.clearInterval(this.timer)
    this.flush()
  }
}

/** Live technical state of one session, shown on the developer page. */
export interface SessionDiagnostics {
  id: string
  state: string
  runId: string | null
  context: { state: string; sampleRate: number; baseLatency: number | null; outputLatency: number | null } | null
  latencyHint: string | null
  chunkFrames: number | null
  tracks: TrackKind[]
  framesCaptured: number
  sentBytes: number
  sentMessages: number
  lastSentAt: number | null
  testMode: boolean
  sources: { mic: string | null; system: string | null }
}

interface WorkletMeter {
  type: 'meter'
  frames: number
  recording: boolean
  seen: { mic: boolean; system: boolean }
  mic: { peak: number; rms: number; clip: boolean }
  system: { peak: number; rms: number; clip: boolean }
  mix: { peak: number; rms: number; clip: boolean }
  wave: number[]
}

/**
 * Drives one recording session: device acquisition, the Web Audio graph, the run on disk and
 * the run state machine. Every command goes through the state machine, and async steps run
 * exclusively, so repeated or conflicting commands cannot corrupt a recording.
 */
export class SessionController {
  readonly machine = new RunMachine('ready')
  private readonly live: LiveData
  private ctx: AudioContext | null = null
  private worklet: AudioWorkletNode | null = null
  private mic: OpenedSource | null = null
  private sys: OpenedSource | null = null
  private micSrc: MediaStreamAudioSourceNode | null = null
  private sysSrc: MediaStreamAudioSourceNode | null = null
  private micGain: GainNode | null = null
  private sysGain: GainNode | null = null
  private monitorGain: GainNode | null = null
  private sink: GainNode | null = null
  private tracks: TrackKind[] = []
  private encoding: EncodingOptions | null = null
  private sender: ChunkSender | null = null
  private runId: string | null = null
  private frames = 0
  private markers: Marker[] = []
  private lastUiSecond = -1
  private countdownCancel: (() => void) | null = null
  private flushWaiter: ((frames: number) => void) | null = null
  private dataWaiter: (() => void) | null = null
  private testMode = false
  private quitting = false
  private capture: CaptureInfo | null = null
  private graphOptions: { latencyHint: string; chunkFrames: number } | null = null

  constructor(
    readonly id: string,
    private readonly host: ControllerHost
  ) {
    this.live = liveData(id)
    this.machine.subscribe((state) => {
      if (state === 'ready' && !this.testMode) {
        this.frames = 0
        this.markers = []
        this.patch({ state, elapsedMs: 0, rawBytes: 0, markers: [], capture: null })
      } else {
        this.patch({ state })
      }
      host.onStateChange()
    })
  }

  get state(): SessionRuntime['state'] {
    return this.machine.state
  }

  get currentRunId(): string | null {
    return this.runId
  }

  get capturesSystem(): boolean {
    return this.sys !== null && (this.state === 'recording' || this.state === 'paused' || this.state === 'countdown')
  }

  get elapsedMs(): number {
    return this.encoding ? (this.frames / this.encoding.sampleRate) * 1000 : 0
  }

  private patch(p: Partial<SessionRuntime>): void {
    useEngine.getState().patch(this.id, p)
  }

  private config(): SessionConfig {
    const cfg = this.host.config(this.id)
    if (!cfg) throw new CaptureError('errors.sessionMissing')
    return cfg
  }

  private processingRequest(): MicProcessing {
    const a = this.host.settings().audio
    return { noiseSuppression: a.noiseSuppression, echoCancellation: a.echoCancellation, autoGainControl: a.autoGainControl }
  }

  // ---------------------------------------------------------------------------- graph

  private async buildGraph(cfg: SessionConfig): Promise<void> {
    const encoding = resolveEncoding(cfg.format, cfg.qualityProfile, cfg.custom)
    const wantMic = cfg.source !== 'system'
    const wantSys = cfg.source !== 'mic'
    if (wantSys && this.host.caps().systemAudio.status === 'unsupported') throw new CaptureError('capture.errorSystemUnsupportedOs')
    this.encoding = encoding
    this.tracks = tracksFor(cfg)
    // Developer options apply to the next graph (next recording or input check).
    const dev = effectiveDeveloper(this.host.settings().developer).audio
    try {
      if (wantMic) this.mic = await openMicrophone(cfg.micDeviceId, encoding.sampleRate, this.processingRequest())
      if (wantSys) this.sys = await openSystemAudio(cfg.systemDeviceId)
      const ctx = new AudioContext({ sampleRate: encoding.sampleRate, latencyHint: dev.latencyHint })
      this.graphOptions = { latencyHint: dev.latencyHint, chunkFrames: dev.chunkFrames }
      this.ctx = ctx
      await ctx.audioWorklet.addModule(WORKLET_URL())
      const worklet = new AudioWorkletNode(ctx, 'sonora-capture', {
        numberOfInputs: (wantMic ? 1 : 0) + (wantSys ? 1 : 0),
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: encoding.channels,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: {
          channels: encoding.channels,
          hasMic: wantMic,
          hasSystem: wantSys,
          emit: { mic: this.tracks.includes('mic'), system: this.tracks.includes('system'), mix: this.tracks.includes('mix') },
          chunkFrames: dev.chunkFrames,
          meterHz: dev.meterHz,
          clipLevel: dbToLinear(dev.clipThresholdDb)
        }
      })
      this.worklet = worklet
      worklet.port.onmessage = (e: MessageEvent) => this.onWorkletMessage(e.data)
      if (this.mic) this.connectMic(this.mic, cfg)
      if (this.sys) this.connectSystem(this.sys, cfg, wantMic ? 1 : 0)
      this.sink = ctx.createGain()
      this.sink.gain.value = 0
      worklet.connect(this.sink).connect(ctx.destination)
      if (ctx.state === 'suspended') await ctx.resume()
      this.capture = {
        sampleRate: encoding.sampleRate,
        channels: encoding.channels,
        mic: this.mic ? { ...this.mic.info } : null,
        system: this.sys ? { ...this.sys.info } : null,
        processing: this.mic?.processing ?? null
      }
      this.patch({ capture: this.capture })
    } catch (err) {
      this.teardown()
      throw err
    }
  }

  private connectMic(src: OpenedSource, cfg: SessionConfig): void {
    const ctx = this.ctx!
    this.micSrc = ctx.createMediaStreamSource(src.stream)
    if (!this.micGain) {
      this.micGain = ctx.createGain()
      this.micGain.gain.value = cfg.micLevel
      this.micGain.connect(this.worklet!, 0, 0)
    }
    if (!this.monitorGain) {
      this.monitorGain = ctx.createGain()
      this.monitorGain.gain.value = cfg.monitor ? cfg.monitorLevel : 0
      this.monitorGain.connect(ctx.destination)
    }
    this.micSrc.connect(this.micGain)
    this.micSrc.connect(this.monitorGain)
    src.track.addEventListener('ended', () => this.onSourceEnded('mic', src))
  }

  private connectSystem(src: OpenedSource, cfg: SessionConfig, input: number): void {
    const ctx = this.ctx!
    this.sysSrc = ctx.createMediaStreamSource(src.stream)
    if (!this.sysGain) {
      this.sysGain = ctx.createGain()
      this.sysGain.gain.value = cfg.systemLevel
      this.sysGain.connect(this.worklet!, 0, input)
    }
    this.sysSrc.connect(this.sysGain)
    src.track.addEventListener('ended', () => this.onSourceEnded('system', src))
  }

  private teardown(): void {
    try {
      if (this.worklet) this.worklet.port.onmessage = null
      this.micSrc?.disconnect()
      this.sysSrc?.disconnect()
      this.micGain?.disconnect()
      this.sysGain?.disconnect()
      this.monitorGain?.disconnect()
      this.worklet?.disconnect()
      this.sink?.disconnect()
    } catch {
      // Nodes may already be disconnected.
    }
    closeSource(this.mic)
    closeSource(this.sys)
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close()
    this.ctx = null
    this.worklet = null
    this.mic = null
    this.sys = null
    this.micSrc = null
    this.sysSrc = null
    this.micGain = null
    this.sysGain = null
    this.monitorGain = null
    this.sink = null
    this.graphOptions = null
    this.live.decay()
  }

  /** Applies level and monitor changes to a running graph. */
  applyLevels(cfg: SessionConfig): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    this.micGain?.gain.setTargetAtTime(cfg.micLevel, t, 0.02)
    this.sysGain?.gain.setTargetAtTime(cfg.systemLevel, t, 0.02)
    this.monitorGain?.gain.setTargetAtTime(cfg.monitor ? cfg.monitorLevel : 0, t, 0.02)
  }

  private onWorkletMessage(msg: { type: string } & Record<string, unknown>): void {
    if (msg.type === 'meter') {
      const m = msg as unknown as WorkletMeter
      const now = performance.now()
      this.live.setMeter(this.live.mic, m.mic.peak, m.mic.rms, m.mic.clip, now)
      this.live.setMeter(this.live.system, m.system.peak, m.system.rms, m.system.clip, now)
      this.live.setMeter(this.live.mix, m.mix.peak, m.mix.rms, m.mix.clip, now)
      this.live.pushWave(m.wave)
      if (this.runId) this.frames = m.frames
      if (this.capture) {
        let changed = false
        if (this.capture.mic && m.seen.mic && !this.capture.mic.verified) {
          this.capture = { ...this.capture, mic: { ...this.capture.mic, verified: true } }
          changed = true
        }
        if (this.capture.system && m.seen.system && !this.capture.system.verified) {
          this.capture = { ...this.capture, system: { ...this.capture.system, verified: true } }
          changed = true
        }
        if (changed) this.patch({ capture: this.capture })
      }
      if (this.dataWaiter && m.recording && m.frames > 0) {
        const micOk = !this.mic || m.seen.mic
        const sysOk = !this.sys || m.seen.system
        if (micOk && sysOk) {
          const w = this.dataWaiter
          this.dataWaiter = null
          w()
        }
      }
      // The clock shows whole seconds, so the interface is only updated when the second changes.
      if (this.encoding && (this.state === 'recording' || this.state === 'paused')) {
        const second = Math.floor(this.elapsedMs / 1000)
        if (second !== this.lastUiSecond) {
          this.lastUiSecond = second
          this.patch({ elapsedMs: this.elapsedMs, rawBytes: this.frames * 4 * this.encoding.channels * this.tracks.length })
        }
      }
    } else if (msg.type === 'data') {
      if (!this.sender) return
      for (const t of this.tracks) {
        const data = msg[t]
        if (data instanceof Float32Array) this.sender.push(t, data)
      }
    } else if (msg.type === 'flushed') {
      const w = this.flushWaiter
      this.flushWaiter = null
      w?.(Number(msg.frames) || 0)
    }
  }

  // ---------------------------------------------------------------------------- commands

  async toggleRecord(origin: 'user' | 'schedule' = 'user'): Promise<void> {
    const s = this.state
    if (s === 'countdown') this.cancelCountdown()
    else if (s === 'recording' || s === 'paused') await this.stop()
    else if (s === 'ready' || s === 'error') await this.start(origin)
    else this.host.notify('info', 'record.finishPreviewFirst')
  }

  async start(origin: 'user' | 'schedule' = 'user'): Promise<boolean> {
    if (this.machine.isPending) return false
    if (this.state === 'error') this.machine.send('RESET')
    if (this.state !== 'ready') return false
    let started = false
    await this.machine.exclusive(async () => {
      let runBegun = false
      try {
        const settings = this.host.settings()
        if (!settings.files.recordingsDir) throw new CaptureError('errors.noRecordingsFolder')
        const free = await invoke('files:free-space', null).catch(() => null)
        if (free !== null && free < MIN_FREE_BYTES) throw new CaptureError('capture.errorLowDisk')
        const cfg = this.config()
        if (!this.ctx) await this.buildGraph(cfg)
        this.testMode = false
        this.patch({ inputTest: false, errorKey: null, errorDetail: null, lostSource: null, pauseReason: null })

        const countdown = origin === 'schedule' ? 0 : settings.recording.countdownSeconds
        if (countdown > 0) {
          this.machine.send('BEGIN_COUNTDOWN')
          const ok = await this.runCountdown(countdown)
          if (!ok) {
            this.teardown()
            this.machine.send('COUNTDOWN_CANCELLED')
            this.host.announce('announce.countdownCancelled')
            return
          }
        }
        if (shouldPlayCue(settings.notifications, this.host.systemCaptureActiveElsewhere(this.id))) {
          await playStartCue().catch(() => undefined)
        }

        const encoding = this.encoding!
        const runId = crypto.randomUUID()
        const processing = this.capture?.processing
        const init: RunInit = {
          runId,
          sessionId: this.id,
          sessionName: cfg.name,
          sampleRate: encoding.sampleRate,
          channels: encoding.channels,
          source: cfg.source,
          outputMode: cfg.outputMode,
          tracks: this.tracks,
          encoding,
          processing: {
            noiseSuppression: processing?.noiseSuppression.applied === true,
            echoCancellation: processing?.echoCancellation.applied === true,
            autoGainControl: processing?.autoGainControl.applied === true
          },
          devices: {
            mic: this.mic ? { label: this.mic.info.label, nativeSampleRate: this.mic.info.nativeSampleRate, nativeChannels: this.mic.info.nativeChannels } : null,
            system: this.sys ? { label: this.sys.info.label, nativeSampleRate: this.sys.info.nativeSampleRate, nativeChannels: this.sys.info.nativeChannels } : null
          },
          startedAt: new Date().toISOString()
        }
        await invoke('rec:begin', init)
        runBegun = true
        this.runId = runId
        const dev = effectiveDeveloper(settings.developer).audio
        this.sender = new ChunkSender(runId, dev.sendIntervalMs)
        this.frames = 0
        this.lastUiSecond = -1
        this.markers = []
        this.live.reset()
        const dataArrived = new Promise<boolean>((resolve) => {
          const timer = window.setTimeout(() => {
            this.dataWaiter = null
            resolve(false)
          }, dev.dataTimeoutMs)
          this.dataWaiter = () => {
            window.clearTimeout(timer)
            resolve(true)
          }
        })
        this.worklet!.port.postMessage({ type: 'record' })
        if (!(await dataArrived)) throw new CaptureError('capture.errorNoData')
        this.machine.send('CAPTURE_STARTED')
        this.patch({ runId, markers: [], elapsedMs: 0, rawBytes: 0, countdownLeft: null })
        this.host.announce('announce.recordingStarted', { session: cfg.name })
        this.host.notify('info', 'notify.recordingStarted', { params: { session: cfg.name } })
        log('info', 'session', `recording started (${cfg.source}, ${encoding.format} ${encoding.sampleRate} Hz ${encoding.channels} ch)`)
        started = true
      } catch (err) {
        await this.failStart(err, runBegun)
      }
    })
    return started
  }

  private async failStart(err: unknown, runBegun: boolean): Promise<void> {
    this.worklet?.port.postMessage({ type: 'stop' })
    this.sender?.close()
    this.sender = null
    this.teardown()
    if (runBegun && this.runId) {
      const id = this.runId
      await invoke('rec:end', id).catch(() => undefined)
      await invoke('runs:discard', id).catch(() => undefined)
    }
    this.runId = null
    const key = err instanceof CaptureError ? err.key : err instanceof AppError ? err.key : 'capture.errorGeneric'
    const detail = err instanceof Error && err.message !== key ? err.message : null
    if (this.state === 'countdown' || this.state === 'ready') this.machine.send('FAIL')
    this.patch({ errorKey: key, errorDetail: detail, countdownLeft: null, inputTest: false })
    this.host.notify('error', 'notify.recordingFailed', { bodyKey: key, detail: detail ?? undefined })
    this.host.announce('announce.recordingFailed', undefined, true)
    log('warn', 'session', `start failed: ${key}`)
  }

  private runCountdown(seconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      let left = seconds
      this.patch({ countdownLeft: left })
      this.host.announce('announce.countdown', { seconds: left })
      const timer = window.setInterval(() => {
        left--
        if (left <= 0) {
          window.clearInterval(timer)
          this.countdownCancel = null
          this.patch({ countdownLeft: null })
          resolve(true)
        } else {
          this.patch({ countdownLeft: left })
          this.host.announce('announce.countdownTick', { seconds: left })
        }
      }, 1000)
      this.countdownCancel = () => {
        window.clearInterval(timer)
        this.countdownCancel = null
        this.patch({ countdownLeft: null })
        resolve(false)
      }
    })
  }

  cancelCountdown(): void {
    this.countdownCancel?.()
  }

  async togglePause(): Promise<void> {
    if (this.state === 'recording') await this.pause('user')
    else if (this.state === 'paused') await this.resume()
  }

  async pause(reason: 'user' | 'device-lost'): Promise<void> {
    const event = reason === 'device-lost' ? 'DEVICE_LOST' : 'PAUSE'
    if (!this.machine.can(event) || !this.runId) return
    await this.machine.exclusive(async () => {
      this.worklet?.port.postMessage({ type: 'pause' })
      this.sender?.flush()
      this.machine.send(event)
      this.patch({ pauseReason: reason, elapsedMs: this.elapsedMs })
      await invoke('rec:update', this.runId!, { state: 'paused', pauseReason: reason }).catch(() => undefined)
      this.host.announce(reason === 'device-lost' ? 'announce.deviceLost' : 'announce.paused', undefined, reason === 'device-lost')
    })
  }

  async resume(): Promise<void> {
    if (!this.machine.can('RESUME') || !this.runId) return
    if (useEngine.getState().sessions[this.id]?.lostSource) {
      this.host.notify('warning', 'record.reconnectFirst')
      return
    }
    await this.machine.exclusive(async () => {
      this.worklet?.port.postMessage({ type: 'record' })
      this.machine.send('RESUME')
      this.patch({ pauseReason: null })
      await invoke('rec:update', this.runId!, { state: 'recording', pauseReason: null }).catch(() => undefined)
      this.host.announce('announce.resumed')
    })
  }

  addMarker(): void {
    if ((this.state !== 'recording' && this.state !== 'paused') || !this.runId || !this.encoding) return
    const timeMs = Math.round(this.elapsedMs)
    if (this.markers.some((m) => Math.abs(m.timeMs - timeMs) < 300)) return
    this.markers = [...this.markers, { id: crypto.randomUUID(), timeMs }]
    this.patch({ markers: this.markers })
    void invoke('rec:update', this.runId, { markers: this.markers }).catch(() => undefined)
    this.host.announce('announce.markerAdded', { time: formatAnnounce(timeMs) })
  }

  async stop(): Promise<void> {
    if (this.state === 'countdown') {
      this.cancelCountdown()
      return
    }
    if (!this.machine.can('STOP') || !this.runId) return
    await this.machine.exclusive(async () => {
      const runId = this.runId!
      const cfg = this.host.config(this.id)
      this.machine.send('STOP')
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(() => {
          this.flushWaiter = null
          resolve()
        }, 2500)
        this.flushWaiter = () => {
          window.clearTimeout(timer)
          resolve()
        }
        this.worklet?.port.postMessage({ type: 'stop' })
      })
      this.sender?.close()
      this.sender = null
      this.teardown()
      let durationMs = 0
      try {
        durationMs = (await invoke('rec:end', runId)).durationMs
      } catch (err) {
        log('error', 'session', `rec:end failed: ${(err as Error).message}`)
      }
      this.runId = null
      this.patch({ elapsedMs: durationMs, pauseReason: null, lostSource: null })
      const settings = this.host.settings()
      // This session's capture is already closed, so the cue cannot leak into its own files.
      if (shouldPlayCue(settings.notifications, this.host.systemCaptureActiveElsewhere(this.id))) await playStopCue().catch(() => undefined)
      this.host.announce('announce.recordingStopped', { session: cfg?.name ?? '' })
      log('info', 'session', `recording stopped after ${Math.round(durationMs)} ms`)

      if (durationMs < 250) {
        await invoke('runs:discard', runId).catch(() => undefined)
        this.machine.send('FINALIZED_KEEP')
        this.host.notify('warning', 'record.tooShort')
        return
      }
      if (this.quitting) {
        // Kept on disk and offered as an unsaved recording on the next launch.
        this.machine.send('FINALIZED_KEEP')
        return
      }
      const post = settings.recording.postAction
      if (post === 'autosave') {
        this.machine.send('FINALIZED_TO_SAVE')
        await this.autoSave(runId)
      } else {
        this.machine.send('FINALIZED_TO_PREVIEW')
        this.patch({ previewRunId: runId })
        if (post === 'ask-name') this.host.askName(runId, this.id)
        else this.host.openPreview(runId, this.id)
      }
    })
  }

  private async autoSave(runId: string): Promise<void> {
    const settings = this.host.settings()
    const cfg = this.host.config(this.id)
    const encoding = this.encoding ?? (cfg ? resolveEncoding(cfg.format, cfg.qualityProfile, cfg.custom) : null)
    try {
      if (!encoding) throw new CaptureError('errors.sessionMissing')
      const recs = await invoke('runs:save', runId, {
        name: null,
        encoding,
        keep: null,
        saveMode: 'edited-only',
        markers: this.markers,
        normalize: settings.export.normalize
      })
      this.machine.send('SAVED')
      this.host.notify('success', 'notify.saved', { params: { name: recs[0]?.name ?? '' } })
    } catch (err) {
      const key = err instanceof AppError ? err.key : 'errors.unexpected'
      this.machine.send('SAVE_FAILED')
      this.patch({ previewRunId: runId })
      this.host.notify('error', 'notify.saveFailed', { bodyKey: key })
      this.host.openPreview(runId, this.id)
    }
  }

  /** Called by the preview workspace as the user decides what happens to the run. */
  resolvePreview(outcome: 'saving' | 'saved' | 'save-failed' | 'discarded' | 'kept'): void {
    switch (outcome) {
      case 'saving':
        this.machine.send('SAVE')
        break
      case 'saved':
        this.machine.send('SAVED')
        this.patch({ previewRunId: null })
        break
      case 'save-failed':
        this.machine.send('SAVE_FAILED')
        break
      case 'discarded':
        this.machine.send('DISCARD')
        this.patch({ previewRunId: null })
        break
      case 'kept':
        this.machine.send('KEEP_FOR_LATER')
        this.patch({ previewRunId: null })
        break
    }
  }

  /** Lets the user continue after an error without restarting the app. */
  resetError(): void {
    if (this.state === 'error') {
      this.machine.send('RESET')
      this.patch({ errorKey: null, errorDetail: null })
    }
  }

  // ---------------------------------------------------------------------------- devices

  private onSourceEnded(which: 'mic' | 'system', src: OpenedSource): void {
    // Ignore tracks we closed ourselves or that were already replaced.
    if ((which === 'mic' && this.mic !== src) || (which === 'system' && this.sys !== src)) return
    if (this.testMode) {
      this.stopInputTest()
      this.patch({ errorKey: which === 'mic' ? 'capture.micDisconnected' : 'capture.systemDisconnected' })
      return
    }
    if (this.state === 'countdown') {
      this.cancelCountdown()
      return
    }
    if (this.state !== 'recording' && this.state !== 'paused') return
    this.patch({ lostSource: which })
    if (this.state === 'recording') void this.pause('device-lost')
    else this.patch({ pauseReason: 'device-lost' })
    this.host.notify('error', which === 'mic' ? 'notify.micLost' : 'notify.systemLost')
    log('warn', 'session', `${which} source ended during recording`)
  }

  /** Re-opens the lost source (same or another device) and resumes into the same recording. */
  async reconnect(deviceId: string | null): Promise<void> {
    const lost = useEngine.getState().sessions[this.id]?.lostSource
    if (!lost || this.state !== 'paused' || !this.ctx) return
    await this.machine.exclusive(async () => {
      try {
        const cfg = this.config()
        if (lost === 'mic') {
          const next = await openMicrophone(deviceId, this.encoding!.sampleRate, this.processingRequest())
          this.micSrc?.disconnect()
          closeSource(this.mic)
          this.mic = next
          this.connectMic(next, cfg)
          this.host.updateConfig(this.id, { micDeviceId: deviceId })
        } else {
          const next = await openSystemAudio(deviceId)
          this.sysSrc?.disconnect()
          closeSource(this.sys)
          this.sys = next
          this.connectSystem(next, cfg, this.mic ? 1 : 0)
          this.host.updateConfig(this.id, { systemDeviceId: deviceId })
        }
        this.capture = {
          ...this.capture!,
          mic: this.mic ? { ...this.mic.info } : null,
          system: this.sys ? { ...this.sys.info } : null,
          processing: this.mic?.processing ?? null
        }
        this.patch({ lostSource: null, capture: this.capture })
        this.worklet?.port.postMessage({ type: 'record' })
        this.machine.send('RESUME')
        this.patch({ pauseReason: null })
        await invoke('rec:update', this.runId!, { state: 'recording', pauseReason: null }).catch(() => undefined)
        this.host.announce('announce.resumed')
      } catch (err) {
        const key = err instanceof CaptureError ? err.key : 'capture.errorGeneric'
        this.host.notify('error', 'notify.reconnectFailed', { bodyKey: key })
      }
    })
  }

  /**
   * Developer tool: behaves exactly as if the device had been unplugged, so the pause and
   * reconnect path can be tested without touching hardware. Returns false when not applicable.
   */
  simulateSourceLoss(which: 'mic' | 'system'): boolean {
    const src = which === 'mic' ? this.mic : this.sys
    if (!src || (this.state !== 'recording' && this.state !== 'paused')) return false
    log('warn', 'session', `simulated ${which} disconnect (developer tool)`)
    this.onSourceEnded(which, src)
    return true
  }

  diagnostics(): SessionDiagnostics {
    const ctx = this.ctx
    return {
      id: this.id,
      state: this.state,
      runId: this.runId,
      context: ctx
        ? {
            state: ctx.state,
            sampleRate: ctx.sampleRate,
            baseLatency: Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : null,
            outputLatency: Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : null
          }
        : null,
      latencyHint: this.graphOptions?.latencyHint ?? null,
      chunkFrames: this.graphOptions?.chunkFrames ?? null,
      tracks: [...this.tracks],
      framesCaptured: this.frames,
      sentBytes: this.sender?.sentBytes ?? 0,
      sentMessages: this.sender?.sentMessages ?? 0,
      lastSentAt: this.sender?.lastSentAt || null,
      testMode: this.testMode,
      sources: { mic: this.mic?.info.label ?? null, system: this.sys?.info.label ?? null }
    }
  }

  /** Called when the main process could not write the run to disk (disk full...). */
  onWriteFailed(errorKey: string): void {
    if (this.state === 'recording') void this.pause('user')
    this.patch({ errorKey })
  }

  // ---------------------------------------------------------------------------- input check

  async startInputTest(): Promise<void> {
    if (this.state !== 'ready' || this.ctx || this.machine.isPending) return
    await this.machine.exclusive(async () => {
      try {
        this.live.reset()
        await this.buildGraph(this.config())
        this.testMode = true
        this.patch({ inputTest: true, errorKey: null, errorDetail: null })
      } catch (err) {
        const key = err instanceof CaptureError ? err.key : 'capture.errorGeneric'
        this.patch({ inputTest: false, errorKey: key, errorDetail: err instanceof Error ? err.message : null })
      }
    })
  }

  stopInputTest(): void {
    if (!this.testMode) return
    this.testMode = false
    this.teardown()
    this.patch({ inputTest: false, capture: null })
  }

  /** Stops capture for an application quit; the audio is kept as an unsaved recording. */
  async stopForQuit(): Promise<void> {
    this.quitting = true
    if (this.state === 'countdown') this.cancelCountdown()
    if (this.testMode) this.stopInputTest()
    // Wait for any running step (start, save) to complete.
    for (let i = 0; i < 100 && this.machine.isPending; i++) await new Promise((r) => setTimeout(r, 100))
    if (this.state === 'recording' || this.state === 'paused') await this.stop()
  }

  dispose(): void {
    this.cancelCountdown()
    this.teardown()
  }
}

function formatAnnounce(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
