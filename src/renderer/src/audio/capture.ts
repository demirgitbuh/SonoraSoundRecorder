import type { MicProcessing } from '../../../shared/types'
import type { ProcessingState, SourceInfo } from '../stores/engine'

export class CaptureError extends Error {
  constructor(
    public readonly key: string,
    detail?: string
  ) {
    super(detail ?? key)
  }
}

function mapMicError(err: unknown): CaptureError {
  const name = (err as DOMException)?.name
  const msg = (err as Error)?.message
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CaptureError('capture.errorMicDenied', msg)
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CaptureError('capture.errorMicNotFound', msg)
    case 'NotReadableError':
    case 'AbortError':
      return new CaptureError('capture.errorMicBusy', msg)
    default:
      return new CaptureError('capture.errorMicGeneric', msg)
  }
}

function mapSystemError(err: unknown): CaptureError {
  const name = (err as DOMException)?.name
  const msg = (err as Error)?.message
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CaptureError('capture.errorSystemDenied', msg)
    case 'NotSupportedError':
    case 'TypeError':
      return new CaptureError('capture.errorSystemUnsupported', msg)
    case 'NotReadableError':
    case 'AbortError':
      return new CaptureError('capture.errorSystemBusy', msg)
    default:
      return new CaptureError('capture.errorSystemGeneric', msg)
  }
}

export interface OpenedSource {
  stream: MediaStream
  track: MediaStreamTrack
  info: SourceInfo
  processing: { noiseSuppression: ProcessingState; echoCancellation: ProcessingState; autoGainControl: ProcessingState } | null
}

function stopStream(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop()
}

function appliedFlag(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v !== 'none' && v !== 'false'
  return null
}

/**
 * Opens the microphone. Processing features are always passed explicitly, because Chromium
 * enables echo cancellation, noise suppression and AGC by default. The applied values reported
 * by the track are shown to the user; a requested feature that the device does not apply is
 * never presented as active.
 */
export async function openMicrophone(deviceId: string | null, sampleRate: number, processing: MicProcessing): Promise<OpenedSource> {
  const supported = navigator.mediaDevices.getSupportedConstraints()
  const constraints: MediaTrackConstraints = {
    channelCount: { ideal: 2 },
    sampleRate: { ideal: sampleRate },
    echoCancellation: processing.echoCancellation,
    noiseSuppression: processing.noiseSuppression,
    autoGainControl: processing.autoGainControl
  }
  if (deviceId) constraints.deviceId = { exact: deviceId }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false })
  } catch (err) {
    throw mapMicError(err)
  }
  const track = stream.getAudioTracks()[0]
  if (!track || track.readyState !== 'live') {
    stopStream(stream)
    throw new CaptureError('capture.errorMicNoTrack')
  }
  const s = track.getSettings() as MediaTrackSettings & Record<string, unknown>
  const state = (key: 'noiseSuppression' | 'echoCancellation' | 'autoGainControl'): ProcessingState => ({
    requested: processing[key],
    applied: appliedFlag(s[key]),
    supported: !!supported[key]
  })
  return {
    stream,
    track,
    info: {
      label: track.label || '',
      deviceId: typeof s.deviceId === 'string' ? s.deviceId : deviceId,
      nativeSampleRate: typeof s.sampleRate === 'number' ? s.sampleRate : null,
      nativeChannels: typeof s.channelCount === 'number' ? s.channelCount : null,
      method: 'device',
      verified: false
    },
    processing: {
      noiseSuppression: state('noiseSuppression'),
      echoCancellation: state('echoCancellation'),
      autoGainControl: state('autoGainControl')
    }
  }
}

/**
 * Opens system audio. With no device id the platform loopback is requested through
 * getDisplayMedia (the main process answers with the loopback device); the video track that
 * Chromium requires is stopped immediately. On Linux a PulseAudio/PipeWire monitor input can be
 * used instead. If no audio track is delivered, capture fails instead of recording silence.
 */
export async function openSystemAudio(deviceId: string | null): Promise<OpenedSource> {
  let stream: MediaStream
  let method: SourceInfo['method']
  try {
    if (deviceId) {
      method = 'monitor-device'
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          channelCount: { ideal: 2 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      })
    } else {
      method = 'loopback'
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { max: 320 }, height: { max: 240 }, frameRate: { max: 1 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      })
    }
  } catch (err) {
    throw mapSystemError(err)
  }
  for (const v of stream.getVideoTracks()) {
    v.stop()
    stream.removeTrack(v)
  }
  const track = stream.getAudioTracks()[0]
  if (!track || track.readyState !== 'live') {
    stopStream(stream)
    throw new CaptureError('capture.errorSystemNoAudio')
  }
  const s = track.getSettings()
  return {
    stream,
    track,
    info: {
      label: track.label || '',
      deviceId,
      nativeSampleRate: typeof s.sampleRate === 'number' ? s.sampleRate : null,
      nativeChannels: typeof s.channelCount === 'number' ? s.channelCount : null,
      method,
      verified: false
    },
    processing: null
  }
}

export function closeSource(src: OpenedSource | null): void {
  if (src) stopStream(src.stream)
}

export interface AudioDevices {
  inputs: MediaDeviceInfo[]
  /** Linux PulseAudio/PipeWire monitor sources that capture an output device. */
  monitors: MediaDeviceInfo[]
  labelsAvailable: boolean
}

export async function listDevices(platform: string): Promise<AudioDevices> {
  const all = await navigator.mediaDevices.enumerateDevices()
  const inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
  const labelsAvailable = inputs.some((d) => d.label !== '')
  const isMonitor = (d: MediaDeviceInfo): boolean => platform === 'linux' && /monitor/i.test(d.label)
  return {
    inputs: inputs.filter((d) => !isMonitor(d)),
    monitors: inputs.filter(isMonitor),
    labelsAvailable
  }
}
