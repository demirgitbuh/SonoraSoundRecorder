/*
 * Sonora capture processor (AudioWorklet).
 *
 * Inputs:  0 = microphone (if present), 1 = system audio (if present). The node is created with
 *          channelCountMode "explicit", so every input arrives with exactly `channels` channels.
 * Output:  silent; it only exists so the graph is pulled by the destination.
 *
 * While recording, interleaved float32 frames are posted to the main thread in chunks for each
 * requested track (mic, system, mix). Meter values (peak, RMS, clipping) and waveform points are
 * always posted so levels can be checked before and during recording. Paused time is not counted.
 */
const CLIP_LEVEL = 0.999

class SonoraCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options.processorOptions || {}
    this.channels = o.channels === 1 ? 1 : 2
    this.hasMic = !!o.hasMic
    this.hasSystem = !!o.hasSystem
    this.emit = { mic: !!(o.emit && o.emit.mic), system: !!(o.emit && o.emit.system), mix: !!(o.emit && o.emit.mix) }
    this.chunkFrames = o.chunkFrames || 4096
    this.meterEvery = Math.max(128, Math.round(sampleRate / 30))
    this.waveEvery = Math.max(64, Math.round(sampleRate / 60))
    this.recording = false
    this.stopped = false
    this.frames = 0
    this.fill = 0
    this.buffers = {}
    for (const t of ['mic', 'system', 'mix']) {
      if (this.emit[t]) this.buffers[t] = new Float32Array(this.chunkFrames * this.channels)
    }
    this.resetMeters()
    this.waveCount = 0
    this.waveMax = 0
    this.wavePoints = []
    this.seen = { mic: false, system: false }
    this.port.onmessage = (event) => this.onMessage(event.data)
  }

  resetMeters() {
    this.meterCount = 0
    this.m = {
      mic: { peak: 0, sum: 0, clip: false },
      system: { peak: 0, sum: 0, clip: false },
      mix: { peak: 0, sum: 0, clip: false }
    }
  }

  onMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return
    if (msg.type === 'record') {
      this.recording = true
    } else if (msg.type === 'pause') {
      this.recording = false
      this.flush()
      this.port.postMessage({ type: 'paused', frames: this.frames })
    } else if (msg.type === 'stop') {
      this.recording = false
      this.flush()
      this.stopped = true
      this.port.postMessage({ type: 'flushed', frames: this.frames })
    }
  }

  flush() {
    if (this.fill === 0) return
    const out = { type: 'data', frames: this.fill }
    const transfer = []
    for (const t of ['mic', 'system', 'mix']) {
      const buf = this.buffers[t]
      if (!buf) continue
      const copy = buf.slice(0, this.fill * this.channels)
      out[t] = copy
      transfer.push(copy.buffer)
    }
    this.fill = 0
    this.port.postMessage(out, transfer)
  }

  process(inputs) {
    if (this.stopped) return false
    const ch = this.channels
    const micIn = this.hasMic ? inputs[0] : null
    const sysIn = this.hasSystem ? inputs[this.hasMic ? 1 : 0] : null
    const micOk = !!(micIn && micIn.length > 0)
    const sysOk = !!(sysIn && sysIn.length > 0)
    if (micOk) this.seen.mic = true
    if (sysOk) this.seen.system = true
    const n = (micOk && micIn[0].length) || (sysOk && sysIn[0].length) || 128
    const m = this.m

    for (let f = 0; f < n; f++) {
      let frameMax = 0
      for (let c = 0; c < ch; c++) {
        const a = micOk ? (micIn[c] || micIn[0])[f] : 0
        const b = sysOk ? (sysIn[c] || sysIn[0])[f] : 0
        const x = a + b
        const aa = a < 0 ? -a : a
        const bb = b < 0 ? -b : b
        const xx = x < 0 ? -x : x
        if (aa > m.mic.peak) m.mic.peak = aa
        if (bb > m.system.peak) m.system.peak = bb
        if (xx > m.mix.peak) m.mix.peak = xx
        if (aa >= CLIP_LEVEL) m.mic.clip = true
        if (bb >= CLIP_LEVEL) m.system.clip = true
        if (xx >= CLIP_LEVEL) m.mix.clip = true
        m.mic.sum += a * a
        m.system.sum += b * b
        m.mix.sum += x * x
        if (xx > frameMax) frameMax = xx
        if (this.recording) {
          const idx = this.fill * ch + c
          if (this.buffers.mic) this.buffers.mic[idx] = a
          if (this.buffers.system) this.buffers.system[idx] = b
          if (this.buffers.mix) this.buffers.mix[idx] = x
        }
      }
      if (this.recording) {
        this.fill++
        this.frames++
        if (this.fill >= this.chunkFrames) this.flush()
      }
      if (frameMax > this.waveMax) this.waveMax = frameMax
      this.waveCount++
      if (this.waveCount >= this.waveEvery) {
        this.wavePoints.push(this.waveMax)
        this.waveCount = 0
        this.waveMax = 0
      }
    }

    this.meterCount += n
    if (this.meterCount >= this.meterEvery) {
      const denom = this.meterCount * ch
      this.port.postMessage({
        type: 'meter',
        frames: this.frames,
        recording: this.recording,
        seen: { mic: this.seen.mic, system: this.seen.system },
        mic: { peak: m.mic.peak, rms: Math.sqrt(m.mic.sum / denom), clip: m.mic.clip },
        system: { peak: m.system.peak, rms: Math.sqrt(m.system.sum / denom), clip: m.system.clip },
        mix: { peak: m.mix.peak, rms: Math.sqrt(m.mix.sum / denom), clip: m.mix.clip },
        wave: this.wavePoints
      })
      this.wavePoints = []
      this.resetMeters()
    }
    return true
  }
}

registerProcessor('sonora-capture', SonoraCaptureProcessor)
