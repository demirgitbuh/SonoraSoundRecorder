import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '../src/main/services/logger'
import type { Recording } from '../src/shared/types'

export function tempDir(prefix = 'sonora-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) }
}

export function testLogger(dir: string): Logger {
  return new Logger(join(dir, 'logs'))
}

export function makeRecording(patch: Partial<Recording> = {}): Recording {
  const now = new Date('2026-03-01T10:00:00Z').toISOString()
  return {
    id: patch.id ?? `rec-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Sonora_2026-03-01_10-00-00',
    filePath: '/tmp/none.wav',
    format: 'wav',
    durationMs: 60_000,
    sizeBytes: 1000,
    sampleRate: 48000,
    channels: 2,
    bitDepth: 24,
    bitrateKbps: null,
    createdAt: now,
    updatedAt: now,
    source: 'mic',
    part: 'single',
    groupId: null,
    markers: [],
    favorite: false,
    tagIds: [],
    folderId: null,
    note: '',
    processing: { noiseSuppression: false, echoCancellation: false, autoGainControl: false, normalized: false },
    transcript: null,
    imported: null,
    trash: null,
    missing: false,
    ...patch
  }
}

/** Interleaved float32 sine wave. */
export function sine(frames: number, channels: number, sampleRate: number, freq = 440, amp = 0.5): Float32Array {
  const out = new Float32Array(frames * channels)
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp
    for (let c = 0; c < channels; c++) out[i * channels + c] = v
  }
  return out
}

export const RUN_A = '11111111-1111-4111-8111-111111111111'
export const RUN_B = '22222222-2222-4222-8222-222222222222'
export const RUN_C = '33333333-3333-4333-8333-333333333333'
