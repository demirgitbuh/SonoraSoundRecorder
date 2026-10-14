import { describe, expect, it } from 'vitest'
import { RunMachine, canAccept, isBusy, isCapturing, transition } from '../src/shared/state-machine'
import { RUN_STATES } from '../src/shared/types'

describe('run state machine', () => {
  it('follows the normal recording lifecycle', () => {
    const m = new RunMachine()
    expect(m.state).toBe('ready')
    expect(m.send('BEGIN_COUNTDOWN')).toBe(true)
    expect(m.state).toBe('countdown')
    expect(m.send('CAPTURE_STARTED')).toBe(true)
    expect(m.state).toBe('recording')
    expect(m.send('PAUSE')).toBe(true)
    expect(m.state).toBe('paused')
    expect(m.send('RESUME')).toBe(true)
    expect(m.send('STOP')).toBe(true)
    expect(m.state).toBe('finalizing')
    expect(m.send('FINALIZED_TO_PREVIEW')).toBe(true)
    expect(m.state).toBe('preview')
    expect(m.send('SAVE')).toBe(true)
    expect(m.state).toBe('exporting')
    expect(m.send('SAVED')).toBe(true)
    expect(m.state).toBe('ready')
  })

  it('rejects invalid transitions without changing state', () => {
    const m = new RunMachine()
    expect(m.send('STOP')).toBe(false)
    expect(m.send('PAUSE')).toBe(false)
    expect(m.send('RESUME')).toBe(false)
    expect(m.send('SAVED')).toBe(false)
    expect(m.state).toBe('ready')
    m.send('CAPTURE_STARTED')
    expect(m.send('CAPTURE_STARTED')).toBe(false)
    expect(m.send('RESUME')).toBe(false)
    expect(m.state).toBe('recording')
  })

  it('a failed save returns to the preview so the temporary run is kept', () => {
    expect(transition('exporting', 'SAVE_FAILED')).toBe('preview')
  })

  it('recoverable runs can be previewed, saved or discarded', () => {
    expect(transition('ready', 'RECOVERY_FOUND')).toBe('recoverable')
    expect(transition('recoverable', 'OPEN_PREVIEW')).toBe('preview')
    expect(transition('recoverable', 'SAVE')).toBe('exporting')
    expect(transition('recoverable', 'DISCARD')).toBe('ready')
  })

  it('device loss pauses a recording', () => {
    expect(transition('recording', 'DEVICE_LOST')).toBe('paused')
    expect(transition('paused', 'DEVICE_LOST')).toBe('paused')
  })

  it('errors can only be left with RESET', () => {
    for (const s of RUN_STATES) {
      if (s === 'error' || s === 'exporting' || s === 'preview' || s === 'recoverable') continue
      expect(canAccept(s, 'FAIL')).toBe(true)
    }
    expect(transition('error', 'CAPTURE_STARTED')).toBeNull()
    expect(transition('error', 'RESET')).toBe('ready')
  })

  it('busy and capturing helpers match the states that must not be interrupted', () => {
    expect(isCapturing('recording')).toBe(true)
    expect(isCapturing('paused')).toBe(true)
    expect(isCapturing('preview')).toBe(false)
    for (const s of ['countdown', 'recording', 'paused', 'finalizing', 'exporting'] as const) expect(isBusy(s)).toBe(true)
    for (const s of ['ready', 'preview', 'recoverable', 'error'] as const) expect(isBusy(s)).toBe(false)
  })

  it('rapid repeated commands run only once while a step is pending', async () => {
    const m = new RunMachine()
    let starts = 0
    const start = (): Promise<unknown> =>
      m.exclusive(async () => {
        starts++
        await new Promise((r) => setTimeout(r, 20))
        m.send('CAPTURE_STARTED')
      })
    await Promise.all([start(), start(), start(), start()])
    expect(starts).toBe(1)
    expect(m.state).toBe('recording')
    expect(m.isPending).toBe(false)
    expect(m.can('STOP')).toBe(true)
  })

  it('notifies subscribers on every accepted transition only', () => {
    const m = new RunMachine()
    const seen: string[] = []
    m.subscribe((s, prev) => seen.push(`${prev}->${s}`))
    m.send('STOP')
    m.send('CAPTURE_STARTED')
    m.send('STOP')
    expect(seen).toEqual(['ready->recording', 'recording->finalizing'])
  })
})
