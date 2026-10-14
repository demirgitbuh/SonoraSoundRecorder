/**
 * Short synthesized start/stop cues. They are played *outside* the capture window: the start cue
 * finishes before samples are written and the stop cue plays after capture has closed. The engine
 * skips them entirely while any session captures system audio.
 */
let ctx: AudioContext | null = null

function context(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext({ latencyHint: 'interactive' })
  return ctx
}

async function play(freqs: number[], step = 0.09): Promise<void> {
  const c = context()
  if (c.state === 'suspended') await c.resume()
  const start = c.currentTime + 0.02
  for (let i = 0; i < freqs.length; i++) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freqs[i]!
    const t0 = start + i * step
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(0.18, t0 + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step * 0.95)
    osc.connect(gain).connect(c.destination)
    osc.start(t0)
    osc.stop(t0 + step)
  }
  const totalMs = (0.02 + freqs.length * step) * 1000 + 120
  await new Promise((r) => setTimeout(r, totalMs))
}

export function playStartCue(): Promise<void> {
  return play([660, 990])
}

export function playStopCue(): Promise<void> {
  return play([990, 660])
}
