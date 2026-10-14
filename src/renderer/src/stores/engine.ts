import { create } from 'zustand'
import type { PauseReason } from '../../../shared/ipc'
import type { Marker, RunState, Schedule } from '../../../shared/types'

export interface ProcessingState {
  requested: boolean
  /** null: the browser/device does not report the setting, so it is treated as not applied. */
  applied: boolean | null
  supported: boolean
}

export interface SourceInfo {
  label: string
  deviceId: string | null
  nativeSampleRate: number | null
  nativeChannels: number | null
  method: 'device' | 'loopback' | 'monitor-device'
  /** True once real audio frames from this source reached the recorder. */
  verified: boolean
}

export interface CaptureInfo {
  sampleRate: number
  channels: 1 | 2
  mic: SourceInfo | null
  system: SourceInfo | null
  processing: { noiseSuppression: ProcessingState; echoCancellation: ProcessingState; autoGainControl: ProcessingState } | null
}

export interface SessionRuntime {
  id: string
  state: RunState
  busy: boolean
  elapsedMs: number
  countdownLeft: number | null
  runId: string | null
  pauseReason: PauseReason
  lostSource: 'mic' | 'system' | null
  errorKey: string | null
  errorDetail: string | null
  capture: CaptureInfo | null
  markers: Marker[]
  rawBytes: number
  inputTest: boolean
  /** Run waiting in the preview workspace for this session. */
  previewRunId: string | null
}

export function emptyRuntime(id: string): SessionRuntime {
  return {
    id,
    state: 'ready',
    busy: false,
    elapsedMs: 0,
    countdownLeft: null,
    runId: null,
    pauseReason: null,
    lostSource: null,
    errorKey: null,
    errorDetail: null,
    capture: null,
    markers: [],
    rawBytes: 0,
    inputTest: false,
    previewRunId: null
  }
}

interface EngineState {
  sessions: Record<string, SessionRuntime>
  selectedId: string | null
  schedules: Schedule[]
  patch: (id: string, patch: Partial<SessionRuntime>) => void
  remove: (id: string) => void
  select: (id: string) => void
  setSchedules: (s: Schedule[]) => void
}

export const useEngine = create<EngineState>((set) => ({
  sessions: {},
  selectedId: null,
  schedules: [],
  patch: (id, patch) =>
    set((st) => ({ sessions: { ...st.sessions, [id]: { ...(st.sessions[id] ?? emptyRuntime(id)), ...patch } } })),
  remove: (id) =>
    set((st) => {
      const next = { ...st.sessions }
      delete next[id]
      return { sessions: next }
    }),
  select: (id) => set({ selectedId: id }),
  setSchedules: (s) => set({ schedules: s })
}))
