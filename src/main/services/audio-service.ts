import { constants } from 'node:fs'
import { copyFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import type { EditRequest, ExportRequest, SaveRunRequest } from '../../shared/ipc'
import type { AudioFormat, BulkResult, EncodingOptions, ItemResult, Marker, Recording, TimeRange, TrackKind } from '../../shared/types'
import { FORMAT_INFO, ffmpegOutputArgs, resolveEncoding, sanitizeEncoding } from '../../shared/formats'
import { mapMarkers, mapSegments, toSampleRanges, totalDuration } from '../../shared/edit'
import { trackSuffix } from '../../shared/naming'
import { CancelledError, Ffmpeg, FfmpegError, supportedFormatOf } from './ffmpeg'
import type { ProbeResult } from './ffmpeg'
import { NameConflictError, isWritableDir, moveFile, pathExists, renameNoClobber, splitName, withRetry } from './fs-utils'
import { LibraryError } from './library-store'
import type { LibraryStore } from './library-store'
import type { Logger } from './logger'
import { rawPeak } from './run-store'
import type { RunManifest, RunStore } from './run-store'

export type ProgressFn = (fraction: number) => void

/** Small counting semaphore so heavy encodes never pile up. */
class Limiter {
  private running = 0
  private readonly queue: Array<() => void> = []
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) await new Promise<void>((r) => this.queue.push(r))
    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      this.queue.shift()?.()
    }
  }
}

export function outputTracksFor(m: Pick<RunManifest, 'source' | 'outputMode' | 'tracks'>): TrackKind[] {
  if (m.source === 'mic') return ['mic']
  if (m.source === 'system') return ['system']
  switch (m.outputMode) {
    case 'combined':
      return ['mix']
    case 'separate':
      return ['mic', 'system']
    case 'both':
      return ['mix', 'mic', 'system']
  }
}

/** Builds an ffmpeg filter graph that keeps the given sample ranges and applies an optional gain. */
export function buildKeepFilter(ranges: Array<{ start: number; end: number }> | null, gainDb: number | null): string | null {
  const gain = gainDb !== null && Math.abs(gainDb) > 0.01 ? `volume=${gainDb.toFixed(2)}dB` : null
  if (!ranges) return gain ? `[0:a]${gain}[out]` : null
  if (ranges.length === 0) throw new LibraryError('errors.editEmpty')
  const tail = gain ? `,${gain}` : ''
  if (ranges.length === 1) {
    const r = ranges[0]!
    return `[0:a]atrim=start_sample=${r.start}:end_sample=${r.end},asetpts=PTS-STARTPTS${tail}[out]`
  }
  const parts = ranges.map((r, i) => `[0:a]atrim=start_sample=${r.start}:end_sample=${r.end},asetpts=PTS-STARTPTS[s${i}]`)
  const labels = ranges.map((_, i) => `[s${i}]`).join('')
  return `${parts.join(';')};${labels}concat=n=${ranges.length}:v=0:a=1${tail}[out]`
}

export function encodingFromRecording(rec: Recording): EncodingOptions {
  const info = FORMAT_INFO[rec.format]
  return sanitizeEncoding({
    format: rec.format,
    sampleRate: rec.sampleRate || info.sampleRates[0]!,
    channels: rec.channels === 1 ? 1 : 2,
    bitDepth: rec.bitDepth === 24 ? 24 : rec.bitDepth === 32 ? 32 : 16,
    bitrateKbps: rec.bitrateKbps ? Math.round(rec.bitrateKbps) : 192,
    flacCompression: 5
  })
}

interface ServiceDeps {
  ffmpeg: Ffmpeg
  library: LibraryStore
  runs: RunStore
  logger: Logger
  recordingsDir: () => string | null
}

/** Encoding, editing, importing and exporting of audio files. */
export class AudioService {
  private readonly limiter = new Limiter(2)
  private readonly saving = new Set<string>()

  constructor(private readonly deps: ServiceDeps) {}

  private async requireRoot(): Promise<string> {
    const root = this.deps.recordingsDir()
    if (!root) throw new LibraryError('errors.noRecordingsFolder')
    await mkdir(root, { recursive: true }).catch(() => undefined)
    if (!(await isWritableDir(root))) throw new LibraryError('errors.folderNotWritable', root)
    return root
  }

  private tempPath(dir: string, ext: string): string {
    return join(dir, `.${randomUUID().slice(0, 8)}.sonora-partial.${ext}`)
  }

  private async describe(file: string): Promise<ProbeResult> {
    const probe = await this.deps.ffmpeg.probe(file)
    if (!probe.audio) throw new LibraryError('errors.noAudioStream')
    return probe
  }

  private recordingFromProbe(
    base: Omit<Recording, 'durationMs' | 'sizeBytes' | 'sampleRate' | 'channels' | 'bitDepth' | 'bitrateKbps'>,
    probe: ProbeResult,
    sizeBytes: number,
    format: AudioFormat,
    decodedMs: number | null
  ): Recording {
    const a = probe.audio!
    const lossy = !FORMAT_INFO[format].lossless
    return {
      ...base,
      durationMs: Math.round(decodedMs ?? probe.durationMs),
      sizeBytes,
      sampleRate: a.sampleRate,
      channels: a.channels,
      bitDepth: lossy ? null : (a.bitsPerRawSample ?? (format === 'wav' ? 16 : null)),
      bitrateKbps: lossy ? Math.round((a.bitRate ?? probe.bitRate ?? 0) / 1000) || null : null
    }
  }

  // ---------------------------------------------------------------------------
  // Saving a recorded run
  // ---------------------------------------------------------------------------

  async saveRun(runId: string, req: SaveRunRequest, onProgress?: ProgressFn): Promise<Recording[]> {
    const { runs, library, ffmpeg, logger } = this.deps
    if (runs.isActive(runId)) throw new LibraryError('errors.runActive')
    if (this.saving.has(runId)) throw new LibraryError('errors.alreadySaving')
    const m = await runs.readManifest(runId)
    if (!m) throw new LibraryError('errors.runNotFound')
    const root = await this.requireRoot()
    this.saving.add(runId)
    const createdFiles: string[] = []
    const createdRecordings: Recording[] = []
    const peaksToWrite: Array<{ id: string; peaks: Uint8Array }> = []
    try {
      await runs.setPhase(runId, 'saving')
      const encoding = sanitizeEncoding(req.encoding)
      const ext = FORMAT_INFO[encoding.format].ext
      const tracks = outputTracksFor(m)
      const multi = tracks.length > 1
      let frames = Number.POSITIVE_INFINITY
      for (const t of tracks) frames = Math.min(frames, await runs.trackFrames(runId, t, m.channels, true))
      if (!Number.isFinite(frames) || frames <= 0) throw new LibraryError('errors.runEmpty')
      const fullMs = (frames / m.sampleRate) * 1000

      const variants: Array<{ keep: TimeRange[] | null; suffix: string; markers: Marker[] }> = []
      if (!req.keep) {
        variants.push({ keep: null, suffix: '', markers: req.markers })
      } else if (req.saveMode === 'original-and-edited') {
        variants.push({ keep: null, suffix: '', markers: req.markers })
        variants.push({ keep: req.keep, suffix: '_edited', markers: mapMarkers(req.markers, req.keep) })
      } else {
        variants.push({ keep: req.keep, suffix: '', markers: mapMarkers(req.markers, req.keep) })
      }

      const baseName = library.sanitize(req.name ?? '') || m.suggestedName
      const dir = library.targetDir(root, new Date(m.startedAt))
      const jobs = variants.length * tracks.length
      let done = 0

      for (const v of variants) {
        const suffixes = tracks.map((t) => `${v.suffix}${trackSuffix(t, multi)}`)
        const reservation = await library.reserveName(dir, baseName, suffixes, ext)
        const groupId = multi ? randomUUID() : null
        try {
          for (const t of tracks) {
            const target = join(dir, `${reservation.base}${v.suffix}${trackSuffix(t, multi)}.${ext}`)
            const tmp = this.tempPath(dir, ext)
            const sampleRanges = v.keep ? toSampleRanges(v.keep, m.sampleRate) : null
            let gainDb: number | null = null
            if (req.normalize) {
              const peak = await rawPeak(runs.trackPath(runId, t), m.channels, sampleRanges)
              if (peak > 0) gainDb = -1 - 20 * Math.log10(peak)
            }
            const filter = buildKeepFilter(sampleRanges, gainDb)
            const expectedMs = v.keep ? totalDuration(v.keep) : fullMs
            const args = [
              '-f',
              'f32le',
              '-ar',
              String(m.sampleRate),
              '-ac',
              String(m.channels),
              '-i',
              runs.trackPath(runId, t),
              ...(filter ? ['-filter_complex', filter, '-map', '[out]'] : []),
              ...ffmpegOutputArgs(encoding),
              '-y',
              tmp
            ]
            await this.limiter.run(() =>
              ffmpeg.run(args, {
                totalMs: expectedMs,
                onProgress: (f) => onProgress?.((done + f) / jobs)
              })
            )
            createdFiles.push(tmp)
            const probe = await this.describe(tmp)
            const { peaks, durationMs } = await ffmpeg.decodePeaks(tmp)
            await renameNoClobber(tmp, target)
            createdFiles[createdFiles.length - 1] = target
            const sizeBytes = (await stat(target)).size
            const now = new Date().toISOString()
            const rec = this.recordingFromProbe(
              {
                id: randomUUID(),
                name: splitName(basename(target)).base,
                filePath: target,
                format: encoding.format,
                createdAt: m.startedAt,
                updatedAt: now,
                source: t === 'mix' ? 'mixed' : t,
                part: !multi ? 'single' : t === 'mix' ? 'combined' : t,
                groupId,
                markers: v.markers,
                favorite: false,
                tagIds: [],
                folderId: null,
                note: '',
                processing: {
                  ...(t === 'system' ? { noiseSuppression: false, echoCancellation: false, autoGainControl: false } : m.processing),
                  normalized: gainDb !== null
                },
                transcript: null,
                imported: null,
                trash: null,
                missing: false
              },
              probe,
              sizeBytes,
              encoding.format,
              durationMs
            )
            createdRecordings.push(rec)
            peaksToWrite.push({ id: rec.id, peaks })
            done++
            onProgress?.(done / jobs)
          }
        } finally {
          reservation.release()
        }
      }

      for (const rec of createdRecordings) library.add(rec)
      for (const p of peaksToWrite) await library.writePeaks(p.id, p.peaks).catch(() => undefined)
      await library.flush()
      await runs.setPhase(runId, 'saved')
      await runs.discard(runId)
      logger.info('save', `saved run ${runId} as ${createdRecordings.length} file(s)`)
      return createdRecordings
    } catch (err) {
      for (const f of createdFiles) await rm(f, { force: true }).catch(() => undefined)
      await runs.setPhase(runId, 'stopped').catch(() => undefined)
      logger.error('save', `saving run ${runId} failed`, err)
      throw toLibraryError(err)
    } finally {
      this.saving.delete(runId)
    }
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  async exportRecordings(ids: string[], req: ExportRequest, targetDir: string, onProgress?: ProgressFn): Promise<BulkResult> {
    const { library, ffmpeg } = this.deps
    const results: ItemResult[] = []
    if (!(await isWritableDir(targetDir))) {
      return { results: ids.map((id) => ({ id, name: library.find(id)?.name ?? id, ok: false, errorKey: 'errors.folderNotWritable' })) }
    }
    let index = 0
    for (const id of ids) {
      const rec = library.find(id)
      const step = (f: number): void => onProgress?.((index + f) / ids.length)
      if (!rec) {
        results.push({ id, name: id, ok: false, errorKey: 'errors.recordingNotFound' })
        index++
        continue
      }
      try {
        if (rec.trash) throw new LibraryError('errors.recordingInTrash')
        if (!(await pathExists(rec.filePath))) throw new LibraryError('errors.fileMissing')
        const keepOriginal = req.format === 'original'
        const encoding = keepOriginal ? encodingFromRecording(rec) : resolveEncoding(req.format as AudioFormat, req.profile, req.custom)
        const ext = keepOriginal ? splitName(basename(rec.filePath)).ext : FORMAT_INFO[encoding.format].ext
        const reservation = await library.reserveName(targetDir, rec.name, [''], ext)
        const target = join(targetDir, `${reservation.base}.${ext}`)
        try {
          if (keepOriginal && !req.normalize) {
            const tmp = this.tempPath(targetDir, ext)
            await copyFile(rec.filePath, tmp, constants.COPYFILE_EXCL)
            await renameNoClobber(tmp, target)
          } else {
            let gainDb: number | null = null
            if (req.normalize) {
              const max = await ffmpeg.maxVolumeDb(rec.filePath)
              if (max !== null) gainDb = -1 - max
            }
            const tmp = this.tempPath(targetDir, ext)
            const filter = gainDb !== null && Math.abs(gainDb) > 0.01 ? ['-af', `volume=${gainDb.toFixed(2)}dB`] : []
            try {
              await this.limiter.run(() =>
                ffmpeg.run(['-i', rec.filePath, '-vn', ...filter, ...ffmpegOutputArgs(encoding), '-y', tmp], {
                  totalMs: rec.durationMs,
                  onProgress: step
                })
              )
              await renameNoClobber(tmp, target)
            } catch (err) {
              await rm(tmp, { force: true })
              throw err
            }
          }
        } finally {
          reservation.release()
        }
        results.push({ id, name: rec.name, ok: true, outputPath: target })
      } catch (err) {
        const e = toLibraryError(err)
        results.push({ id, name: rec.name, ok: false, errorKey: e.reasonKey, detail: e.message })
      }
      index++
      step(0)
    }
    return { results }
  }

  // ---------------------------------------------------------------------------
  // Editing recordings in the archive
  // ---------------------------------------------------------------------------

  async applyEdit(id: string, req: EditRequest, onProgress?: ProgressFn): Promise<Recording> {
    const { library, ffmpeg, logger } = this.deps
    const rec = library.get(id)
    if (rec.trash) throw new LibraryError('errors.recordingInTrash')
    if (!(await pathExists(rec.filePath))) throw new LibraryError('errors.fileMissing')
    if (req.keep.length === 0 || totalDuration(req.keep) < 10) throw new LibraryError('errors.editEmpty')
    const encoding = encodingFromRecording(rec)
    const dir = dirname(rec.filePath)
    const { ext } = splitName(basename(rec.filePath))
    const sampleRate = rec.sampleRate || encoding.sampleRate
    const filter = buildKeepFilter(toSampleRanges(req.keep, sampleRate), null)!
    const tmp = this.tempPath(dir, ext)
    try {
      await this.limiter.run(() =>
        ffmpeg.run(['-i', rec.filePath, '-vn', '-filter_complex', filter, '-map', '[out]', ...ffmpegOutputArgs(encoding), '-y', tmp], {
          totalMs: totalDuration(req.keep),
          onProgress
        })
      )
      const probe = await this.describe(tmp)
      const { peaks, durationMs } = await ffmpeg.decodePeaks(tmp)
      const expected = totalDuration(req.keep)
      if (Math.abs(durationMs - expected) > Math.max(250, expected * 0.01)) {
        throw new LibraryError('errors.editVerifyFailed', `expected ${Math.round(expected)}ms, got ${Math.round(durationMs)}ms`)
      }
      const markers = mapMarkers(req.markers, req.keep)
      const transcript = rec.transcript ? await library.readTranscript(rec.id) : null
      const now = new Date().toISOString()

      if (req.mode === 'copy') {
        const reservation = await library.reserveName(dir, `${rec.name}_edited`, [''], ext)
        const target = join(dir, `${reservation.base}.${ext}`)
        try {
          await renameNoClobber(tmp, target)
        } finally {
          reservation.release()
        }
        const copy = this.recordingFromProbe(
          {
            ...rec,
            id: randomUUID(),
            name: reservation.base,
            filePath: target,
            createdAt: now,
            updatedAt: now,
            groupId: null,
            part: 'single',
            markers,
            transcript: rec.transcript ? { ...rec.transcript, remapped: true } : null,
            missing: false
          },
          probe,
          (await stat(target)).size,
          rec.format,
          durationMs
        )
        library.add(copy)
        await library.writePeaks(copy.id, peaks)
        if (transcript) {
          await library.writeTranscript({ ...transcript, recordingId: copy.id, segments: mapSegments(transcript.segments, req.keep) })
        }
        await library.flush()
        logger.info('edit', `created edited copy of ${rec.id}`)
        return copy
      }

      // Replace the original without ever leaving a half-written file in its place.
      const backup = join(dir, `.${basename(rec.filePath)}.${randomUUID().slice(0, 8)}.sonora-backup`)
      await withRetry(() => rename(rec.filePath, backup))
      try {
        await withRetry(() => rename(tmp, rec.filePath))
      } catch (err) {
        await withRetry(() => rename(backup, rec.filePath))
        throw err
      }
      await rm(backup, { force: true })
      const updated = this.recordingFromProbe(
        { ...rec, markers, updatedAt: now, transcript: rec.transcript ? { ...rec.transcript, remapped: true } : null },
        probe,
        (await stat(rec.filePath)).size,
        rec.format,
        durationMs
      )
      library.patch(id, updated)
      await library.writePeaks(id, peaks)
      if (transcript) await library.writeTranscript({ ...transcript, segments: mapSegments(transcript.segments, req.keep) })
      await library.flush()
      logger.info('edit', `replaced ${rec.id} with edited version`)
      return library.get(id)
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw toLibraryError(err)
    }
  }

  /**
   * Undoes an interrupted "replace original": if a recording's file is missing but the backup
   * created during the replace still exists next to it, the backup is moved back.
   */
  async recoverInterruptedReplaces(): Promise<number> {
    let restored = 0
    for (const rec of this.deps.library.all()) {
      if (rec.trash || (await pathExists(rec.filePath))) continue
      const dir = dirname(rec.filePath)
      const prefix = `.${basename(rec.filePath)}.`
      let names: string[] = []
      try {
        names = await readdir(dir)
      } catch {
        continue
      }
      const backup = names.find((n) => n.startsWith(prefix) && n.endsWith('.sonora-backup'))
      if (!backup) continue
      try {
        await rename(join(dir, backup), rec.filePath)
        restored++
        this.deps.logger.warn('edit', `restored ${rec.id} from an interrupted replace`)
      } catch (err) {
        this.deps.logger.error('edit', 'could not restore backup', err)
      }
    }
    if (restored > 0) await this.deps.library.checkMissing()
    return restored
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  async importFiles(paths: string[], onProgress?: ProgressFn): Promise<BulkResult> {
    const { library, ffmpeg, logger } = this.deps
    const results: ItemResult[] = []
    let root: string
    try {
      root = await this.requireRoot()
    } catch (err) {
      const e = toLibraryError(err)
      return { results: paths.map((p) => ({ id: p, name: basename(p), ok: false, errorKey: e.reasonKey })) }
    }
    let index = 0
    for (const src of paths) {
      const name = basename(src)
      try {
        const s = await stat(src)
        if (!s.isFile()) throw new LibraryError('errors.notAFile')
        if (s.size < 64) throw new LibraryError('errors.unsupportedFile')
        const sniffed = await sniffFormat(src)
        if (!sniffed) throw new LibraryError('errors.unsupportedFile')
        const probe = await this.describe(src)
        const format = supportedFormatOf(probe)
        if (!format || !sniffedMatches(sniffed, format)) throw new LibraryError('errors.unsupportedFile')
        const now = new Date()
        const dir = library.targetDir(root, now)
        const ext = FORMAT_INFO[format].ext
        const base = library.sanitize(splitName(name).base) || 'Imported'
        const reservation = await library.reserveName(dir, base, [''], ext)
        const target = join(dir, `${reservation.base}.${ext}`)
        const tmp = this.tempPath(dir, ext)
        try {
          await copyFile(src, tmp, constants.COPYFILE_EXCL)
          const fh = await open(tmp, 'r+')
          await fh.sync()
          await fh.close()
          await renameNoClobber(tmp, target)
        } catch (err) {
          await rm(tmp, { force: true })
          throw err
        } finally {
          reservation.release()
        }
        let decoded: { peaks: Uint8Array; durationMs: number }
        try {
          decoded = await ffmpeg.decodePeaks(target)
        } catch (err) {
          await rm(target, { force: true })
          throw new LibraryError('errors.unsupportedFile', (err as Error).message)
        }
        const rec = this.recordingFromProbe(
          {
            id: randomUUID(),
            name: reservation.base,
            filePath: target,
            format,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            source: 'imported',
            part: 'single',
            groupId: null,
            markers: [],
            favorite: false,
            tagIds: [],
            folderId: null,
            note: '',
            processing: { noiseSuppression: false, echoCancellation: false, autoGainControl: false, normalized: false },
            transcript: null,
            imported: { originalPath: src, importedAt: now.toISOString() },
            trash: null,
            missing: false
          },
          probe,
          (await stat(target)).size,
          format,
          decoded.durationMs
        )
        library.add(rec)
        await library.writePeaks(rec.id, decoded.peaks)
        results.push({ id: rec.id, name, ok: true, outputPath: target })
      } catch (err) {
        const e = toLibraryError(err)
        results.push({ id: src, name, ok: false, errorKey: e.reasonKey, detail: e.message })
      }
      index++
      onProgress?.(index / paths.length)
    }
    await library.flush()
    logger.info('import', `imported ${results.filter((r) => r.ok).length}/${paths.length} file(s)`)
    return { results }
  }

  // ---------------------------------------------------------------------------
  // Moving the recordings folder
  // ---------------------------------------------------------------------------

  /** Moves every archived (non-trashed) recording into `targetRoot`. Separate, explicit operation. */
  async moveRecordings(targetRoot: string, onProgress?: ProgressFn): Promise<BulkResult> {
    const { library } = this.deps
    const results: ItemResult[] = []
    if (!(await isWritableDir(targetRoot))) throw new LibraryError('errors.folderNotWritable', targetRoot)
    const list = library.all().filter((r) => !r.trash)
    let index = 0
    for (const rec of list) {
      try {
        if (!(await pathExists(rec.filePath))) throw new LibraryError('errors.fileMissing')
        const dir = library.targetDir(targetRoot, new Date(rec.createdAt))
        if (dirname(rec.filePath) === dir) {
          results.push({ id: rec.id, name: rec.name, ok: true, outputPath: rec.filePath })
        } else {
          const { base, ext } = splitName(basename(rec.filePath))
          const reservation = await library.reserveName(dir, base, [''], ext)
          const target = join(dir, `${reservation.base}.${ext}`)
          try {
            await moveFile(rec.filePath, target)
          } finally {
            reservation.release()
          }
          library.patch(rec.id, { filePath: target, name: reservation.base, missing: false })
          results.push({ id: rec.id, name: rec.name, ok: true, outputPath: target })
        }
      } catch (err) {
        const e = toLibraryError(err)
        results.push({ id: rec.id, name: rec.name, ok: false, errorKey: e.reasonKey, detail: e.message })
      }
      index++
      onProgress?.(index / Math.max(1, list.length))
    }
    await library.flush()
    return { results }
  }
}

export function toLibraryError(err: unknown): LibraryError {
  if (err instanceof LibraryError) return err
  if (err instanceof CancelledError) return new LibraryError('errors.cancelled')
  if (err instanceof NameConflictError) return new LibraryError('errors.nameTaken', err.target)
  if (err instanceof FfmpegError) return new LibraryError('errors.ffmpegFailed', err.stderrTail.trim().split('\n').slice(-2).join(' ') || err.message)
  const code = (err as NodeJS.ErrnoException)?.code
  if (code === 'ENOSPC') return new LibraryError('errors.diskFull')
  if (code === 'EACCES' || code === 'EPERM') return new LibraryError('errors.permissionDenied', (err as Error).message)
  if (code === 'ENOENT') return new LibraryError('errors.fileMissing', (err as Error).message)
  return new LibraryError('errors.unexpected', err instanceof Error ? err.message : String(err))
}

type Sniffed = 'wav' | 'mp3' | 'flac' | 'ogg' | 'mp4' | 'id3'

/** Detects the container from the file's first bytes; the extension is never trusted. */
export async function sniffFormat(file: string): Promise<Sniffed | null> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(16)
    const { bytesRead } = await fh.read(buf, 0, 16, 0)
    if (bytesRead < 12) return null
    return sniffBytes(buf)
  } finally {
    await fh.close()
  }
}

export function sniffBytes(buf: Uint8Array): Sniffed | null {
  const ascii = (start: number, len: number): string => String.fromCharCode(...buf.slice(start, start + len))
  if ((ascii(0, 4) === 'RIFF' || ascii(0, 4) === 'RF64') && ascii(8, 4) === 'WAVE') return 'wav'
  if (ascii(0, 4) === 'fLaC') return 'flac'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (ascii(4, 4) === 'ftyp') return 'mp4'
  // ID3v2 tags can precede MP3 frames and (rarely) FLAC streams.
  if (ascii(0, 3) === 'ID3') return 'id3'
  if (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0) return 'mp3'
  return null
}

function sniffedMatches(sniffed: Sniffed, format: AudioFormat): boolean {
  switch (format) {
    case 'wav':
      return sniffed === 'wav'
    case 'flac':
      return sniffed === 'flac' || sniffed === 'id3'
    case 'opus':
      return sniffed === 'ogg'
    case 'aac':
      return sniffed === 'mp4'
    case 'mp3':
      return sniffed === 'mp3' || sniffed === 'id3'
  }
}

export function extensionOf(file: string): string {
  return extname(file).replace(/^\./, '').toLowerCase()
}
