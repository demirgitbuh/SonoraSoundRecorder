/** WAV helpers without Electron dependencies (unit tested). */

/** 44 byte header of a 32-bit float WAV with `dataBytes` of audio. */
export function floatWavHeader(dataBytes: number, sampleRate: number, channels: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + dataBytes, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(3, 20) // IEEE float
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * channels * 4, 28)
  h.writeUInt16LE(channels * 4, 32)
  h.writeUInt16LE(32, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(dataBytes, 40)
  return h
}
