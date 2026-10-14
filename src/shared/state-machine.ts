import type { RunState } from './types'

/**
 * Lifecycle of a single recording run. Commands that do not appear in the table for the
 * current state are rejected, which makes repeated or out-of-order button presses harmless.
 */
export type RunEvent =
  | 'BEGIN_COUNTDOWN'
  | 'CAPTURE_STARTED'
  | 'COUNTDOWN_CANCELLED'
  | 'PAUSE'
  | 'RESUME'
  | 'DEVICE_LOST'
  | 'STOP'
  | 'FINALIZED_TO_PREVIEW'
  | 'FINALIZED_TO_SAVE'
  | 'FINALIZED_KEEP'
  | 'SAVE'
  | 'SAVED'
  | 'SAVE_FAILED'
  | 'DISCARD'
  | 'KEEP_FOR_LATER'
  | 'RECOVERY_FOUND'
  | 'OPEN_PREVIEW'
  | 'FAIL'
  | 'RESET'

const TABLE: Record<RunState, Partial<Record<RunEvent, RunState>>> = {
  ready: {
    BEGIN_COUNTDOWN: 'countdown',
    CAPTURE_STARTED: 'recording',
    RECOVERY_FOUND: 'recoverable',
    FAIL: 'error'
  },
  countdown: {
    CAPTURE_STARTED: 'recording',
    COUNTDOWN_CANCELLED: 'ready',
    FAIL: 'error'
  },
  recording: {
    PAUSE: 'paused',
    DEVICE_LOST: 'paused',
    STOP: 'finalizing',
    FAIL: 'error'
  },
  paused: {
    RESUME: 'recording',
    STOP: 'finalizing',
    DEVICE_LOST: 'paused',
    FAIL: 'error'
  },
  finalizing: {
    FINALIZED_TO_PREVIEW: 'preview',
    FINALIZED_TO_SAVE: 'exporting',
    FINALIZED_KEEP: 'ready',
    FAIL: 'error'
  },
  preview: {
    SAVE: 'exporting',
    DISCARD: 'ready',
    KEEP_FOR_LATER: 'ready'
  },
  exporting: {
    SAVED: 'ready',
    SAVE_FAILED: 'preview'
  },
  recoverable: {
    OPEN_PREVIEW: 'preview',
    SAVE: 'exporting',
    DISCARD: 'ready'
  },
  error: {
    RESET: 'ready'
  }
}

export function transition(state: RunState, event: RunEvent): RunState | null {
  return TABLE[state][event] ?? null
}

export function canAccept(state: RunState, event: RunEvent): boolean {
  return transition(state, event) !== null
}

/** The run holds open capture devices. */
export function isCapturing(state: RunState): boolean {
  return state === 'recording' || state === 'paused'
}

/** The run must not be interrupted by quitting or an update restart. */
export function isBusy(state: RunState): boolean {
  return (
    state === 'countdown' ||
    state === 'recording' ||
    state === 'paused' ||
    state === 'finalizing' ||
    state === 'exporting'
  )
}

/** Small finite state holder with a re-entrancy guard for async work. */
export class RunMachine {
  private current: RunState
  private pending = false
  private readonly listeners = new Set<(state: RunState, prev: RunState) => void>()

  constructor(initial: RunState = 'ready') {
    this.current = initial
  }

  get state(): RunState {
    return this.current
  }

  get isPending(): boolean {
    return this.pending
  }

  can(event: RunEvent): boolean {
    return !this.pending && canAccept(this.current, event)
  }

  /** Applies an event; returns false and leaves the state untouched when it is not allowed. */
  send(event: RunEvent): boolean {
    const next = transition(this.current, event)
    if (next === null) return false
    const prev = this.current
    this.current = next
    for (const listener of this.listeners) listener(next, prev)
    return true
  }

  /**
   * Runs an async step exclusively. While it runs every other `exclusive` call is rejected,
   * so a double click cannot start two captures or finalize twice.
   */
  async exclusive<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (this.pending) return undefined
    this.pending = true
    try {
      return await work()
    } finally {
      this.pending = false
    }
  }

  subscribe(listener: (state: RunState, prev: RunState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
