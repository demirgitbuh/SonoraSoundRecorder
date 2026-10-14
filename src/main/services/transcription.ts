import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { basename, join } from 'node:path'
import type { TranscribeProgress } from '../../shared/ipc'
import type { ModelInfo, Transcript, TranscriptSegment } from '../../shared/types'
import type { Ffmpeg } from './ffmpeg'
import { LibraryError } from './library-store'
import type { LibraryStore } from './library-store'
import type { Logger } from './logger'

/** whisper.cpp GGML model magic: the uint32 0x67676d6c stored little endian ("lmgg"). */
const GGML_MAGIC = 0x67676d6c

const LAYERS_TO_FAMILY: Record<number, string> = { 4: 'tiny', 6: 'base', 12: 'small', 24: 'medium', 32: 'large' }

/**
 * Reads and validates the header of a whisper.cpp GGML model (`ggml-*.bin`). Nothing is
 * downloaded; the user picks the file.
 */
export async function inspectModel(path: string): Promise<ModelInfo> {
  const info: ModelInfo = {
    path,
    fileName: basename(path),
    sizeBytes: 0,
    valid: false,
    family: null,
    multilingual: null,
    reasonKey: null
  }
  try {
    const s = await stat(path)
    if (!s.isFile()) return { ...info, reasonKey: 'transcription.model.errorNotFile' }
    info.sizeBytes = s.size
    if (s.size < 1024 * 1024) return { ...info, reasonKey: 'transcription.model.errorTooSmall' }
    const fh = await open(path, 'r')
    const buf = Buffer.alloc(48)
    try {
      await fh.read(buf, 0, 48, 0)
    } finally {
      await fh.close()
    }
    const magic = buf.readUInt32LE(0)
    if (magic !== GGML_MAGIC) {
      const head = buf.subarray(0, 4).toString('latin1')
      return { ...info, reasonKey: head === 'GGUF' ? 'transcription.model.errorGguf' : 'transcription.model.errorBadMagic' }
    }
    const nVocab = buf.readInt32LE(4)
    const nAudioState = buf.readInt32LE(12)
    const nAudioLayer = buf.readInt32LE(20)
    const nMels = buf.readInt32LE(40)
    const sane =
      nVocab > 50000 &&
      nVocab < 60000 &&
      nAudioState >= 256 &&
      nAudioState <= 4096 &&
      nAudioLayer > 0 &&
      nAudioLayer <= 64 &&
      (nMels === 80 || nMels === 128)
    if (!sane) return { ...info, reasonKey: 'transcription.model.errorHeader' }
    return {
      ...info,
      valid: true,
      family: LAYERS_TO_FAMILY[nAudioLayer] ?? `${nAudioLayer}-layer`,
      multilingual: nVocab >= 51865
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ...info, reasonKey: code === 'ENOENT' ? 'transcription.model.errorMissing' : 'transcription.model.errorUnreadable' }
  }
}

/** Parses the JSON written by `whisper-cli -oj`. */
export function parseWhisperJson(text: string): TranscriptSegment[] {
  const data = JSON.parse(text) as { transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }> }
  const out: TranscriptSegment[] = []
  for (const item of data.transcription ?? []) {
    const t = (item.text ?? '').trim()
    if (!t) continue
    out.push({ fromMs: Number(item.offsets?.from ?? 0), toMs: Number(item.offsets?.to ?? 0), text: t })
  }
  return out
}

interface Job {
  id: string
  recordingId: string
  progress: TranscribeProgress
  child: ChildProcess | null
  abort: AbortController
  cancelled: boolean
}

interface Deps {
  whisperPath: string
  ffmpeg: Ffmpeg
  library: LibraryStore
  logger: Logger
  tmpDir: string
  modelPath: () => string | null
  language: () => string
  threads: () => number
  emit: (p: TranscribeProgress) => void
}

/**
 * Runs whisper.cpp in a child process, one job at a time, so the UI never blocks.
 * Transcript text is stored next to the archive metadata and is never written to the logs.
 */
export class TranscriptionService {
  private readonly jobs = new Map<string, Job>()
  private readonly queue: Job[] = []
  private running: Job | null = null

  constructor(private readonly deps: Deps) {}

  get available(): boolean {
    return existsSync(this.deps.whisperPath)
  }

  list(): TranscribeProgress[] {
    return [...this.jobs.values()].map((j) => j.progress)
  }

  private update(job: Job, patch: Partial<TranscribeProgress>): void {
    job.progress = { ...job.progress, ...patch }
    this.deps.emit(job.progress)
    if (['done', 'error', 'cancelled'].includes(job.progress.phase)) {
      setTimeout(() => this.jobs.delete(job.id), 30_000)
    }
  }

  async start(recordingId: string): Promise<string> {
    if (!this.available) throw new LibraryError('transcription.errorNoEngine')
    const rec = this.deps.library.get(recordingId)
    if (rec.trash) throw new LibraryError('errors.recordingInTrash')
    const modelPath = this.deps.modelPath()
    if (!modelPath) throw new LibraryError('transcription.errorNoModel')
    const model = await inspectModel(modelPath)
    if (!model.valid) throw new LibraryError(model.reasonKey ?? 'transcription.model.errorHeader')
    for (const j of this.jobs.values()) {
      if (j.recordingId === recordingId && !['done', 'error', 'cancelled'].includes(j.progress.phase)) return j.id
    }
    const job: Job = {
      id: randomUUID(),
      recordingId,
      child: null,
      abort: new AbortController(),
      cancelled: false,
      progress: { jobId: '', recordingId, phase: 'queued', percent: 0, errorKey: null, detail: null }
    }
    job.progress.jobId = job.id
    this.jobs.set(job.id, job)
    this.queue.push(job)
    this.deps.emit(job.progress)
    void this.pump()
    return job.id
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.cancelled = true
    job.abort.abort()
    job.child?.kill('SIGKILL')
    const idx = this.queue.indexOf(job)
    if (idx >= 0) {
      this.queue.splice(idx, 1)
      this.update(job, { phase: 'cancelled' })
    }
  }

  cancelAll(): void {
    for (const id of [...this.jobs.keys()]) this.cancel(id)
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const job = this.queue.shift()
    if (!job) return
    this.running = job
    try {
      await this.execute(job)
    } finally {
      this.running = null
      void this.pump()
    }
  }

  private async execute(job: Job): Promise<void> {
    const { library, ffmpeg, logger } = this.deps
    const workDir = join(this.deps.tmpDir, `transcribe-${job.id}`)
    const started = Date.now()
    try {
      const rec = library.get(job.recordingId)
      const modelPath = this.deps.modelPath()
      if (!modelPath) throw new LibraryError('transcription.errorNoModel')
      await mkdir(workDir, { recursive: true })
      const wav = join(workDir, 'input.wav')
      this.update(job, { phase: 'converting', percent: 0 })
      await ffmpeg.run(['-i', rec.filePath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', '-y', wav], {
        totalMs: rec.durationMs,
        signal: job.abort.signal,
        onProgress: (f) => this.update(job, { percent: Math.round(f * 10) })
      })
      if (job.cancelled) throw new LibraryError('errors.cancelled')
      this.update(job, { phase: 'transcribing', percent: 10 })
      const outBase = join(workDir, 'result')
      const threads = this.deps.threads() || Math.max(1, Math.min(8, availableParallelism() - 1))
      const args = ['-m', modelPath, '-f', wav, '-l', this.deps.language() || 'auto', '-t', String(threads), '-oj', '-of', outBase, '-pp']
      await this.runWhisper(job, args)
      if (job.cancelled) throw new LibraryError('errors.cancelled')
      this.update(job, { phase: 'saving', percent: 98 })
      const segments = parseWhisperJson(await readFile(`${outBase}.json`, 'utf8'))
      const model = await inspectModel(modelPath)
      const transcript: Transcript = {
        recordingId: rec.id,
        model: model.fileName,
        language: this.deps.language() || 'auto',
        createdAt: new Date().toISOString(),
        segments
      }
      await library.writeTranscript(transcript)
      library.patch(rec.id, {
        transcript: { updatedAt: transcript.createdAt, language: transcript.language, model: transcript.model, remapped: false }
      })
      await library.flush()
      this.update(job, { phase: 'done', percent: 100 })
      // Only metadata is logged, never the transcript text.
      logger.info('transcribe', `job ${job.id} done: ${segments.length} segment(s) in ${Math.round((Date.now() - started) / 1000)}s`)
    } catch (err) {
      if (job.cancelled) {
        this.update(job, { phase: 'cancelled' })
        logger.info('transcribe', `job ${job.id} cancelled`)
      } else {
        const key = err instanceof LibraryError ? err.reasonKey : 'transcription.errorFailed'
        const message = (err as Error).message ?? ''
        const detail = err instanceof LibraryError && message === err.reasonKey ? null : message.slice(0, 300)
        this.update(job, { phase: 'error', errorKey: key, detail })
        logger.error('transcribe', `job ${job.id} failed (${key})`, detail ?? undefined)
      }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private runWhisper(job: Job, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.deps.whisperPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      job.child = child
      let errorLines: string[] = []
      let partial = ''
      child.stderr!.setEncoding('utf8')
      child.stderr!.on('data', (text: string) => {
        const lines = (partial + text).split(/\r?\n/)
        partial = lines.pop() ?? ''
        for (const line of lines) {
          const m = /progress\s*=\s*(\d+)%/.exec(line)
          if (m) {
            this.update(job, { percent: 10 + Math.round(Number(m[1]) * 0.87) })
          } else if (/error|failed|invalid/i.test(line) && !line.startsWith('[')) {
            // Diagnostic lines only; transcribed text is printed to stdout, which is ignored.
            errorLines = [...errorLines, line.slice(0, 200)].slice(-3)
          }
        }
      })
      child.on('error', (err) => reject(new LibraryError('transcription.errorEngineStart', err.message)))
      child.on('close', (code) => {
        job.child = null
        if (job.cancelled) reject(new LibraryError('errors.cancelled'))
        else if (code === 0) resolve()
        else reject(new LibraryError('transcription.errorFailed', errorLines.join(' | ') || `exit code ${code}`))
      })
    })
  }
}
