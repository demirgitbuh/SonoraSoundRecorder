import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { addCut, createEditState, editedDuration, hasEdits, keepRanges, nextPlayablePosition, setTrimEnd, setTrimStart } from '../../../shared/edit'
import type { EditState } from '../../../shared/edit'
import type { PendingRun, RunMedia } from '../../../shared/ipc'
import type { AudioFormat, CustomEncoding, Marker, QualityProfile, Recording, TimeRange, TrackKind } from '../../../shared/types'
import { resolveEncoding } from '../../../shared/formats'
import { AppError, invoke } from '../api'
import { engine } from '../audio/engine'
import { Button, IconButton, Modal, Notice, Segmented, Slider, Switch } from '../components/controls'
import {
  ArrowLeft,
  Download,
  Flag,
  ICON_STROKE,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  RotateCcw,
  Save,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Volume2,
  X,
  ZoomIn,
  ZoomOut
} from '../components/icons'
import { StatePill } from '../components/status'
import { WaveformEditor, clampView } from '../components/WaveformEditor'
import type { WaveView } from '../components/WaveformEditor'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import type { EditorSource } from '../stores/app'
import { useLibrary } from '../stores/library'
import { formatClock, formatDateTime, formatPrecise } from '../util/format'
import { ExportDialog } from './ExportDialog'
import { FormatEditor } from './RecordPanels'

const TRACK_LABEL: Record<TrackKind, MessageKey> = { mix: 'source.mix', mic: 'source.mic', system: 'source.system' }

interface History {
  past: EditState[]
  present: EditState
  future: EditState[]
}

export function EditorPage({ source }: { source: EditorSource }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const settings = useApp((s) => s.settings)!
  const closeEditor = useApp((s) => s.closeEditor)
  const toast = useApp((s) => s.toast)
  const pendingRuns = useApp((s) => s.pendingRuns)
  const recordings = useLibrary((s) => s.recordings)
  const run: PendingRun | undefined = source.kind === 'run' ? pendingRuns.find((r) => r.runId === source.runId) : undefined
  const rec: Recording | undefined = source.kind === 'recording' ? recordings.find((r) => r.id === source.recordingId) : undefined

  const [media, setMedia] = useState<RunMedia[]>([])
  const [track, setTrack] = useState<TrackKind | null>(null)
  const [peaks, setPeaks] = useState<Uint8Array | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(run?.durationMs ?? rec?.durationMs ?? 0)
  const [history, setHistory] = useState<History>(() => ({ past: [], present: createEditState(run?.durationMs ?? rec?.durationMs ?? 0), future: [] }))
  const [markers, setMarkers] = useState<Marker[]>(run?.markers ?? rec?.markers ?? [])
  const [selection, setSelection] = useState<TimeRange | null>(null)
  const [view, setView] = useState<WaveView>({ startMs: 0, endMs: Math.max(1000, durationMs) })
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [volume, setVolume] = useState(1)
  const [loop, setLoop] = useState(false)
  const [previewEdits, setPreviewEdits] = useState(true)
  const [clock, setClock] = useState(0)
  const [name, setName] = useState(run?.suggestedName ?? rec?.name ?? '')
  const [busy, setBusy] = useState<null | 'saving' | 'applying' | 'discarding'>(null)
  const [choice, setChoice] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [format, setFormat] = useState<{ format: AudioFormat; profile: QualityProfile; custom: CustomEncoding }>(() => ({
    format: run?.encoding.format ?? 'wav',
    profile: 'custom',
    custom: run
      ? { sampleRate: run.encoding.sampleRate, channels: run.encoding.channels, bitDepth: run.encoding.bitDepth, bitrateKbps: run.encoding.bitrateKbps, flacCompression: run.encoding.flacCompression }
      : { sampleRate: 48000, channels: 2, bitDepth: 24, bitrateKbps: 192, flacCompression: 5 }
  }))
  const [normalize, setNormalize] = useState(settings.export.normalize)
  const audioRef = useRef<HTMLAudioElement>(null)
  const playSelection = useRef<TimeRange | null>(null)

  const edit = history.present
  const kept = useMemo(() => keepRanges(edit), [edit])
  const edited = hasEdits(edit)
  const markersChanged = JSON.stringify(markers) !== JSON.stringify(run?.markers ?? rec?.markers ?? [])
  const removed = useMemo(() => {
    const out: TimeRange[] = []
    let cursor = 0
    for (const r of kept) {
      if (r.startMs > cursor) out.push({ startMs: cursor, endMs: r.startMs })
      cursor = r.endMs
    }
    if (cursor < edit.durationMs) out.push({ startMs: cursor, endMs: edit.durationMs })
    return out
  }, [kept, edit.durationMs])

  const sessionId = source.kind === 'run' ? source.sessionId : null
  const controller = sessionId ? engine.controller(sessionId) : undefined

  // Load media and peaks.
  useEffect(() => {
    let alive = true
    setLoadError(null)
    const load = async (): Promise<void> => {
      try {
        if (source.kind === 'run') {
          const m = await invoke('runs:media', source.runId)
          if (!alive) return
          setMedia(m)
          setTrack((cur) => cur ?? m[0]?.track ?? null)
        } else {
          const url = await invoke('library:media-url', source.recordingId)
          if (!alive) return
          setMedia([{ track: 'mix', url }])
          setTrack('mix')
        }
      } catch (err) {
        if (alive) setLoadError(err instanceof AppError ? err.key : 'errors.unexpected')
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [source])

  useEffect(() => {
    let alive = true
    if (!track) return
    const p: Promise<Uint8Array | null> = source.kind === 'run' ? invoke('runs:peaks', source.runId, track) : invoke('library:peaks', source.recordingId)
    p.then((data) => alive && setPeaks(data ? new Uint8Array(data) : null)).catch(() => alive && setPeaks(null))
    return () => {
      alive = false
    }
  }, [source, track])

  const getPosition = useCallback((): number => (audioRef.current ? audioRef.current.currentTime * 1000 : 0), [])

  // Playback supervisor: edit preview skips removed parts, selection playback stops or loops.
  useEffect(() => {
    let raf = 0
    let lastClock = 0
    const tick = (): void => {
      const a = audioRef.current
      if (a) {
        const ms = a.currentTime * 1000
        if (!a.paused) {
          const sel = playSelection.current
          if (sel && ms >= sel.endMs) {
            if (loop) a.currentTime = sel.startMs / 1000
            else {
              a.pause()
              playSelection.current = null
            }
          } else if (!sel && previewEdits && edited) {
            const next = nextPlayablePosition(ms, kept)
            if (next === null) {
              if (loop && kept[0]) a.currentTime = kept[0].startMs / 1000
              else a.pause()
            } else if (next > ms + 25) a.currentTime = next / 1000
          }
        }
        if (Math.abs(ms - lastClock) > 90) {
          lastClock = ms
          setClock(ms)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [kept, previewEdits, edited, loop])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate])
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])
  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = loop && !edited && !playSelection.current
  }, [loop, edited])

  const commit = (next: EditState): void => setHistory((h) => ({ past: [...h.past, h.present].slice(-100), present: next, future: [] }))
  const undo = (): void => setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] } : h))
  const redo = (): void => setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) } : h))

  const seek = (ms: number): void => {
    const a = audioRef.current
    if (!a) return
    playSelection.current = null
    a.currentTime = Math.max(0, Math.min(durationMs, ms)) / 1000
    setClock(a.currentTime * 1000)
  }
  const togglePlay = (): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      playSelection.current = null
      void a.play().catch(() => undefined)
    } else a.pause()
  }
  const playSel = (): void => {
    const a = audioRef.current
    if (!a || !selection) return
    playSelection.current = selection
    a.currentTime = selection.startMs / 1000
    void a.play().catch(() => undefined)
  }
  const pos = clock

  const addMarkerHere = (): void => {
    const ms = Math.round(getPosition())
    if (markers.some((m) => Math.abs(m.timeMs - ms) < 300)) return
    setMarkers([...markers, { id: crypto.randomUUID(), timeMs: ms }].sort((a, b) => a.timeMs - b.timeMs))
  }
  const jumpMarker = (dir: 1 | -1): void => {
    const p = getPosition()
    const list = dir === 1 ? markers.filter((m) => m.timeMs > p + 50) : markers.filter((m) => m.timeMs < p - 50).reverse()
    if (list[0]) seek(list[0].timeMs)
  }

  // ---------------------------------------------------------------- run actions
  const releaseAudio = async (): Promise<void> => {
    const a = audioRef.current
    if (!a) return
    a.pause()
    a.removeAttribute('src')
    a.load()
    await new Promise((r) => setTimeout(r, 50))
  }

  const saveRun = async (mode: 'edited-only' | 'original-and-edited'): Promise<void> => {
    if (!run || busy) return
    setChoice(false)
    setBusy('saving')
    controller?.resolvePreview('saving')
    try {
      // The temporary run is removed after saving; release the media stream first (Windows file locks).
      await releaseAudio()
      const recs = await invoke('runs:save', run.runId, {
        name: name.trim() || null,
        encoding: resolveEncoding(format.format, format.profile, format.custom),
        keep: edited ? kept : null,
        saveMode: mode,
        markers,
        normalize
      })
      controller?.resolvePreview('saved')
      toast('success', 'notify.saved', { params: { name: recs[0]?.name ?? '' } })
      closeEditor()
    } catch (err) {
      const current = media.find((m) => m.track === track)?.url
      if (audioRef.current && current) audioRef.current.src = current
      controller?.resolvePreview('save-failed')
      toast('error', 'notify.saveFailed', { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected', detail: err instanceof AppError ? (err.detail ?? undefined) : undefined })
    } finally {
      setBusy(null)
    }
  }

  const discardRun = async (): Promise<void> => {
    if (!run) return
    setConfirmDiscard(false)
    setBusy('discarding')
    try {
      await releaseAudio()
      await invoke('runs:discard', run.runId)
      controller?.resolvePreview('discarded')
      toast('info', 'preview.discarded')
      closeEditor()
    } catch (err) {
      toast('error', 'errors.deleteFailed', { detail: err instanceof AppError ? (err.detail ?? undefined) : undefined })
    } finally {
      setBusy(null)
    }
  }

  const keepForLater = (): void => {
    controller?.resolvePreview('kept')
    closeEditor()
  }

  // ---------------------------------------------------------------- recording actions
  const renameRecording = async (): Promise<void> => {
    if (!rec || !name.trim() || name.trim() === rec.name) return
    try {
      await releaseAudio()
      const r = await invoke('library:rename', rec.id, name.trim())
      setName(r.name)
    } catch (err) {
      toast('error', 'errors.renameFailed', { bodyKey: err instanceof AppError ? err.key : undefined })
      setName(rec.name)
    }
  }

  const applyRecordingEdit = async (mode: 'copy' | 'replace'): Promise<void> => {
    if (!rec || busy) return
    setChoice(false)
    setBusy('applying')
    try {
      if (mode === 'replace') await releaseAudio()
      const r = await invoke('library:apply-edit', rec.id, { keep: kept, mode, markers })
      toast('success', mode === 'copy' ? 'edit.copyCreated' : 'edit.replaced', { params: { name: r.name } })
      if (mode === 'copy') useApp.getState().openEditor({ kind: 'recording', recordingId: r.id })
      else {
        setHistory({ past: [], present: createEditState(r.durationMs), future: [] })
        setDurationMs(r.durationMs)
        setMarkers(r.markers)
        setView({ startMs: 0, endMs: Math.max(1000, r.durationMs) })
        setSelection(null)
      }
    } catch (err) {
      toast('error', 'edit.failed', { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected', detail: err instanceof AppError ? (err.detail ?? undefined) : undefined })
    } finally {
      setBusy(null)
    }
  }

  const saveMarkersOnly = async (): Promise<void> => {
    if (!rec) return
    try {
      await invoke('library:update-meta', rec.id, { markers })
      toast('success', 'edit.markersSaved')
    } catch (err) {
      toast('error', 'errors.unexpected', { detail: err instanceof Error ? err.message : undefined })
    }
  }

  const trashRecording = async (): Promise<void> => {
    if (!rec) return
    await releaseAudio()
    const res = await invoke('library:bulk', [rec.id], { kind: 'trash' })
    if (res.results[0]?.ok) {
      toast('info', 'archive.movedToTrash', { params: { count: 1 } })
      closeEditor()
    } else toast('error', 'errors.moveFailed', { detail: res.results[0]?.detail })
  }

  const leave = (): void => {
    if ((edited || (rec && markersChanged)) && !busy) setConfirmLeave(true)
    else if (run) keepForLater()
    else closeEditor()
  }

  const missing = source.kind === 'run' ? !run : !rec
  useEffect(() => {
    if (missing && !busy) {
      const timer = window.setTimeout(() => closeEditor(), 1500)
      return () => window.clearTimeout(timer)
    }
  }, [missing, busy, closeEditor])
  if (missing) {
    return (
      <div className="editor-page">
        <Notice kind="warning">{t('editor.notFound')}</Notice>
      </div>
    )
  }

  const url = media.find((m) => m.track === track)?.url
  const zoom = (factor: number): void => {
    const center = getPosition()
    const span = (view.endMs - view.startMs) * factor
    setView(clampView({ startMs: center - span / 2, endMs: center + span / 2 }, durationMs))
  }

  return (
    <div className="editor-page">
      <div className="page-head">
        <div className="row nowrap" style={{ minWidth: 0, flex: 1 }}>
          <IconButton icon={ArrowLeft} label={t('common.back')} onClick={leave} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row nowrap">
              <span className="eyebrow">{run ? (run.kind === 'crashed' ? t('editor.recoveredTitle') : t('editor.previewTitle')) : t('editor.editTitle')}</span>
              {run && <StatePill state={busy === 'saving' ? 'exporting' : run.kind === 'crashed' && !sessionId ? 'recoverable' : 'preview'} />}
            </div>
            <input
              className="title-input"
              value={name}
              maxLength={180}
              aria-label={t('editor.name')}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void renameRecording()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
            <div className="faint editor-meta">
              {formatDateTime(run?.startedAt ?? rec!.createdAt, locale)} · {formatClock(durationMs, true)}
              {edited && <> · {t('editor.editedLength', { length: formatClock(editedDuration(edit), true) })}</>}
            </div>
          </div>
        </div>
      </div>

      {loadError && <Notice kind="error">{t(loadError as MessageKey)}</Notice>}
      {run && run.kind === 'crashed' && <Notice kind="warning">{t('editor.recoveredNote')}</Notice>}

      <section className="card editor-card">
        {media.length > 1 && (
          <div className="row" style={{ marginBottom: 10 }}>
            <Segmented<TrackKind>
              label={t('editor.track')}
              value={track ?? media[0]!.track}
              onChange={(v) => {
                audioRef.current?.pause()
                setTrack(v)
              }}
              options={media.map((m) => ({ value: m.track, label: t(TRACK_LABEL[m.track]) }))}
            />
            <span className="faint">{t('editor.trackNote')}</span>
          </div>
        )}
        <div className="wave-wrap">
          <WaveformEditor
            peaks={peaks}
            durationMs={durationMs}
            getPosition={getPosition}
            selection={selection}
            removed={removed}
            markers={markers}
            view={view}
            onSeek={seek}
            onSelect={setSelection}
            onViewChange={setView}
            onTogglePlay={togglePlay}
            label={t('editor.waveformLabel')}
            valueText={(ms) => t('editor.positionText', { position: formatPrecise(ms), total: formatClock(durationMs) })}
          />
        </div>
        <div className="editor-transport">
          <div className="row nowrap">
            <IconButton icon={SkipBack} label={t('player.back5')} onClick={() => seek(getPosition() - 5000)} />
            <button type="button" className="play-btn" onClick={togglePlay} aria-label={playing ? t('player.pause') : t('player.play')} disabled={!url}>
              {playing ? <Pause size={20} strokeWidth={ICON_STROKE} /> : <Play size={20} strokeWidth={ICON_STROKE} />}
            </button>
            <IconButton icon={SkipForward} label={t('player.forward5')} onClick={() => seek(getPosition() + 5000)} />
            <span className="tnum player-time">
              {formatPrecise(pos)} <span className="faint">/ {formatClock(durationMs)}</span>
            </span>
          </div>
          <div className="row">
            <IconButton icon={Repeat} label={t('player.loop')} aria-pressed={loop} onClick={() => setLoop(!loop)} />
            <label className="row nowrap player-rate">
              <span className="sr-only">{t('player.speed')}</span>
              <select className="select" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label={t('player.speed')}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
            <div className="row nowrap player-volume">
              <Volume2 size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <Slider label={t('player.volume')} value={volume} min={0} max={1} step={0.01} valueText={`${Math.round(volume * 100)}%`} onChange={setVolume} />
            </div>
            <IconButton icon={ZoomOut} label={t('editor.zoomOut')} onClick={() => zoom(1.5)} />
            <IconButton icon={ZoomIn} label={t('editor.zoomIn')} onClick={() => zoom(0.66)} />
          </div>
        </div>
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            const d = (e.currentTarget.duration || 0) * 1000
            if (Number.isFinite(d) && d > 0 && Math.abs(d - durationMs) > 30 && !edited) {
              setDurationMs(d)
              setHistory({ past: [], present: createEditState(d), future: [] })
              setView({ startMs: 0, endMs: d })
            }
          }}
          onError={() => url && setLoadError('editor.playbackError')}
        />
      </section>

      <div className="editor-grid">
        <section className="card card-pad">
          <div className="card-head">
            <h2>{t('editor.tools')}</h2>
            <div className="row nowrap">
              <IconButton icon={Undo2} label={t('editor.undo')} disabled={history.past.length === 0} onClick={undo} />
              <IconButton icon={Redo2} label={t('editor.redo')} disabled={history.future.length === 0} onClick={redo} />
              <IconButton icon={RotateCcw} label={t('editor.resetEdits')} disabled={!edited} onClick={() => commit(createEditState(durationMs))} />
            </div>
          </div>
          <div className="tool-grid">
            <Button icon={Scissors} onClick={() => commit(setTrimStart(edit, selection ? selection.startMs : getPosition()))}>
              {t('editor.trimStart')}
            </Button>
            <Button icon={Scissors} onClick={() => commit(setTrimEnd(edit, selection ? selection.endMs : getPosition()))}>
              {t('editor.trimEnd')}
            </Button>
            <Button
              icon={Scissors}
              disabled={!selection}
              onClick={() => {
                if (selection) {
                  commit(addCut(edit, selection))
                  setSelection(null)
                }
              }}
            >
              {t('editor.cutSelection')}
            </Button>
            <Button icon={Play} disabled={!selection} onClick={playSel}>
              {t('editor.playSelection')}
            </Button>
          </div>
          {selection && (
            <p className="field-desc tnum" style={{ marginTop: 10 }}>
              {t('editor.selectionInfo', { start: formatPrecise(selection.startMs), end: formatPrecise(selection.endMs), length: formatPrecise(selection.endMs - selection.startMs) })}
            </p>
          )}
          <div className="row nowrap" style={{ marginTop: 12 }}>
            <Switch checked={previewEdits} label={t('editor.previewEdits')} onChange={setPreviewEdits} />
            <span>{t('editor.previewEdits')}</span>
          </div>
          <p className="field-desc">{t('editor.previewEditsDesc')}</p>
        </section>

        <section className="card card-pad">
          <div className="card-head">
            <h2>{t('editor.markers')}</h2>
            <div className="row nowrap">
              <IconButton icon={SkipBack} label={t('editor.prevMarker')} disabled={markers.length === 0} onClick={() => jumpMarker(-1)} />
              <IconButton icon={SkipForward} label={t('editor.nextMarker')} disabled={markers.length === 0} onClick={() => jumpMarker(1)} />
              <IconButton icon={Plus} label={t('editor.addMarker')} onClick={addMarkerHere} />
            </div>
          </div>
          {markers.length === 0 ? (
            <p className="faint">{t('editor.noMarkers')}</p>
          ) : (
            <ul className="marker-list">
              <AnimatePresence initial={false}>
                {markers.map((m, i) => (
                  <motion.li key={m.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}>
                    <button type="button" className="marker-jump" onClick={() => seek(m.timeMs)}>
                      <Flag size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      <span>{t('editor.markerN', { n: i + 1 })}</span>
                      <span className="tnum faint">{formatPrecise(m.timeMs)}</span>
                    </button>
                    <IconButton icon={X} small label={t('editor.removeMarker', { n: i + 1 })} onClick={() => setMarkers(markers.filter((x) => x.id !== m.id))} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>

        <section className="card card-pad">
          <div className="card-head">
            <h2>{run ? t('editor.saveTitle') : t('editor.actions')}</h2>
          </div>
          {run ? (
            <div className="stack">
              <FormatEditor format={format.format} profile={format.profile} custom={format.custom} onChange={setFormat} />
              <label className="checkbox">
                <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
                {t('editor.normalize')}
              </label>
              <div className="row">
                <Button variant="primary" icon={Save} disabled={!!busy || !url} onClick={() => (edited ? setChoice(true) : void saveRun('edited-only'))}>
                  {busy === 'saving' ? t('editor.saving') : t('editor.save')}
                </Button>
                <Button onClick={keepForLater} disabled={!!busy}>
                  {t('editor.keepForLater')}
                </Button>
                <Button variant="danger" icon={Trash2} disabled={!!busy} onClick={() => setConfirmDiscard(true)}>
                  {t('editor.discard')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="row">
                <Button
                  variant="primary"
                  icon={Save}
                  disabled={!!busy || (!edited && !markersChanged)}
                  onClick={() => (edited ? setChoice(true) : void saveMarkersOnly())}
                >
                  {busy === 'applying' ? t('editor.applying') : t('editor.saveEdits')}
                </Button>
                <Button icon={Download} onClick={() => setExportOpen(true)}>
                  {t('archive.export')}
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => void trashRecording()}>
                  {t('archive.moveToTrash')}
                </Button>
              </div>
              {edited && rec && rec.format !== 'wav' && rec.format !== 'flac' && <p className="field-desc warn-text">{t('editor.lossyNote')}</p>}
            </div>
          )}
        </section>
      </div>

      <Modal
        open={choice}
        title={t('editor.choiceTitle')}
        onClose={() => setChoice(false)}
        footer={
          <>
            <Button onClick={() => setChoice(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => (run ? void saveRun('original-and-edited') : void applyRecordingEdit('copy'))}>{t('editor.choiceCopy')}</Button>
            <Button variant="primary" onClick={() => (run ? void saveRun('edited-only') : void applyRecordingEdit('replace'))}>
              {t('editor.choiceReplace')}
            </Button>
          </>
        }
      >
        <p>{run ? t('editor.choiceBodyRun') : t('editor.choiceBodyRecording')}</p>
        <ul className="choice-list">
          <li>
            <strong>{t('editor.choiceCopy')}</strong> — {run ? t('editor.choiceCopyRunDesc') : t('editor.choiceCopyDesc')}
          </li>
          <li>
            <strong>{t('editor.choiceReplace')}</strong> — {run ? t('editor.choiceReplaceRunDesc') : t('editor.choiceReplaceDesc')}
          </li>
        </ul>
      </Modal>

      <Modal
        open={confirmDiscard}
        title={t('editor.discardTitle')}
        onClose={() => setConfirmDiscard(false)}
        footer={
          <>
            <Button onClick={() => setConfirmDiscard(false)}>{t('common.cancel')}</Button>
            <Button variant="danger-solid" onClick={() => void discardRun()}>
              {t('editor.discard')}
            </Button>
          </>
        }
      >
        <p>{t('editor.discardBody')}</p>
      </Modal>

      <Modal
        open={confirmLeave}
        title={t('editor.leaveTitle')}
        onClose={() => setConfirmLeave(false)}
        footer={
          <>
            <Button onClick={() => setConfirmLeave(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmLeave(false)
                if (run) keepForLater()
                else closeEditor()
              }}
            >
              {t('editor.leaveDiscardEdits')}
            </Button>
          </>
        }
      >
        <p>{run ? t('editor.leaveBodyRun') : t('editor.leaveBody')}</p>
      </Modal>

      {rec && <ExportDialog open={exportOpen} ids={[rec.id]} onClose={() => setExportOpen(false)} />}
    </div>
  )
}
