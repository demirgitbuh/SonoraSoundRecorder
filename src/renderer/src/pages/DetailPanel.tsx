import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Recording, Transcript } from '../../../shared/types'
import type { MetaPatch } from '../../../shared/ipc'
import { FORMAT_INFO } from '../../../shared/formats'
import { AppError, invoke } from '../api'
import { Button, IconButton, Notice, Progress } from '../components/controls'
import { Clipboard, Copy, Download, FileText, FolderOpen, ICON_STROKE, Pencil, Plus, Share2, Star, Tag, Trash2, X } from '../components/icons'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useLibrary } from '../stores/library'
import { formatBytes, formatClock, formatDateTime, formatKHz } from '../util/format'
import { ExportDialog } from './ExportDialog'

const PHASE_KEY: Record<string, MessageKey> = {
  queued: 'transcription.phase.queued',
  converting: 'transcription.phase.converting',
  transcribing: 'transcription.phase.transcribing',
  saving: 'transcription.phase.saving'
}

function TranscriptSection({ rec }: { rec: Recording }) {
  const t = useT()
  const caps = useApp((s) => s.caps)!
  const modelPath = useApp((s) => s.settings?.transcription.modelPath ?? null)
  const navigate = useApp((s) => s.navigate)
  const job = useLibrary((s) => s.jobs[rec.id])
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const running = job && !['done', 'error', 'cancelled'].includes(job.phase)

  useEffect(() => {
    let alive = true
    if (!rec.transcript) {
      setTranscript(null)
      return
    }
    invoke('transcript:get', rec.id)
      .then((tr) => alive && setTranscript(tr))
      .catch(() => alive && setTranscript(null))
    return () => {
      alive = false
    }
  }, [rec.id, rec.transcript?.updatedAt])

  const start = async (): Promise<void> => {
    try {
      await invoke('transcribe:start', rec.id)
    } catch (err) {
      useApp.getState().toast('error', 'transcription.failedToStart', { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected' })
    }
  }

  return (
    <section className="detail-section">
      <div className="row nowrap">
        <h3>{t('transcription.title')}</h3>
        <div className="spacer" />
        {!running && caps.whisper && modelPath && !rec.missing && (
          <Button size="sm" icon={FileText} onClick={() => void start()}>
            {rec.transcript ? t('transcription.again') : t('transcription.start')}
          </Button>
        )}
      </div>
      {!caps.whisper && <Notice kind="warning">{t('transcription.errorNoEngine')}</Notice>}
      {caps.whisper && !modelPath && (
        <Notice
          action={
            <Button size="sm" onClick={() => navigate('settings')}>
              {t('transcription.openSettings')}
            </Button>
          }
        >
          {t('transcription.noModelHint')}
        </Notice>
      )}
      {running && job && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row nowrap">
            <span className="muted">{t(PHASE_KEY[job.phase] ?? 'transcription.phase.transcribing')}</span>
            <span className="tnum faint">{job.percent}%</span>
            <div className="spacer" />
            <Button size="sm" variant="ghost" icon={X} onClick={() => void invoke('transcribe:cancel', job.jobId)}>
              {t('common.cancel')}
            </Button>
          </div>
          <Progress value={job.percent} label={t('transcription.progressLabel')} />
        </div>
      )}
      {job?.phase === 'error' && (
        <Notice kind="error">
          {t((job.errorKey ?? 'transcription.errorFailed') as MessageKey)}
          {job.detail ? <span className="faint"> ({job.detail})</span> : null}
        </Notice>
      )}
      {job?.phase === 'cancelled' && <p className="faint">{t('transcription.cancelled')}</p>}
      {rec.transcript?.remapped && <p className="field-desc">{t('transcription.remappedNote')}</p>}
      {transcript && (
        <div className="transcript">
          {transcript.segments.length === 0 ? (
            <p className="faint">{t('transcription.emptyResult')}</p>
          ) : (
            transcript.segments.map((s, i) => (
              <p key={i}>
                <span className="tnum faint">{formatClock(s.fromMs)}</span> {s.text}
              </p>
            ))
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <Button
              size="sm"
              variant="ghost"
              icon={Clipboard}
              onClick={() => void navigator.clipboard.writeText(transcript.segments.map((s) => s.text).join('\n'))}
            >
              {t('transcription.copyText')}
            </Button>
            <span className="faint">{t('transcription.modelUsed', { model: transcript.model, language: transcript.language })}</span>
          </div>
        </div>
      )}
    </section>
  )
}

export function DetailPanel({ rec }: { rec: Recording }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const caps = useApp((s) => s.caps)!
  const openEditor = useApp((s) => s.openEditor)
  const toast = useApp((s) => s.toast)
  const tags = useLibrary((s) => s.tags)
  const folders = useLibrary((s) => s.folders)
  const setActive = useLibrary((s) => s.setActive)
  const [note, setNote] = useState(rec.note)
  const [newTag, setNewTag] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  useEffect(() => setNote(rec.note), [rec.id, rec.note])

  const meta = async (patch: MetaPatch): Promise<void> => {
    try {
      await invoke('library:update-meta', rec.id, patch)
    } catch (err) {
      toast('error', 'errors.unexpected', { detail: err instanceof AppError ? err.key : undefined })
    }
  }
  const addTag = async (): Promise<void> => {
    const name = newTag.trim()
    if (!name) return
    let tag = tags.find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (!tag) {
      try {
        const snap = await invoke('library:tag-create', name)
        tag = snap.tags.find((x) => x.name.toLowerCase() === name.toLowerCase())
      } catch (err) {
        toast('error', 'errors.unexpected', { bodyKey: err instanceof AppError ? err.key : undefined })
        return
      }
    }
    if (tag && !rec.tagIds.includes(tag.id)) await meta({ tagIds: [...rec.tagIds, tag.id] })
    setNewTag('')
  }

  const rows: Array<[MessageKey, string]> = [
    ['detail.created', formatDateTime(rec.createdAt, locale)],
    ['detail.duration', formatClock(rec.durationMs, true)],
    ['detail.format', FORMAT_INFO[rec.format].label],
    ['detail.audio', `${formatKHz(rec.sampleRate, locale)} · ${rec.channels === 1 ? t('audio.mono') : rec.channels === 2 ? t('audio.stereo') : `${rec.channels} ch`}${rec.bitDepth ? ` · ${rec.bitDepth}-bit` : ''}${rec.bitrateKbps ? ` · ${rec.bitrateKbps} kbps` : ''}`],
    ['detail.size', formatBytes(rec.sizeBytes, locale)],
    ['detail.processing', processingSummary(t, rec)]
  ]

  return (
    <motion.aside
      className="detail-panel card"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      aria-label={t('detail.label', { name: rec.name })}
    >
      <div className="detail-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 className="truncate" title={rec.name}>
            {rec.name}
          </h2>
          <p className="faint truncate" title={rec.filePath}>
            {rec.filePath}
          </p>
        </div>
        <IconButton icon={X} label={t('common.close')} onClick={() => setActive(null)} />
      </div>

      {rec.missing && (
        <Notice
          kind="warning"
          title={t('archive.missingTitle')}
          action={
            <Button size="sm" onClick={() => void invoke('library:locate', rec.id).catch(() => toast('error', 'errors.unsupportedFile'))}>
              {t('archive.locate')}
            </Button>
          }
        >
          {t('archive.missingBody')}
        </Notice>
      )}

      <div className="detail-actions">
        <Button variant="primary" icon={Pencil} disabled={rec.missing} onClick={() => openEditor({ kind: 'recording', recordingId: rec.id })}>
          {t('detail.openEditor')}
        </Button>
        <IconButton
          icon={Star}
          label={rec.favorite ? t('archive.unfavorite', { name: rec.name }) : t('archive.favorite', { name: rec.name })}
          aria-pressed={rec.favorite}
          onClick={() => void meta({ favorite: !rec.favorite })}
        />
        <IconButton icon={Download} label={t('archive.export')} disabled={rec.missing} onClick={() => setExportOpen(true)} />
        <IconButton icon={FolderOpen} label={t('detail.showInFolder')} disabled={rec.missing} onClick={() => void invoke('files:show', rec.id)} />
        <IconButton
          icon={Copy}
          label={t('detail.copyPath')}
          onClick={() => void invoke('files:copy-path', rec.id).then(() => toast('success', 'detail.pathCopied'))}
        />
        {caps.nativeShare && <IconButton icon={Share2} label={t('detail.share')} disabled={rec.missing} onClick={() => void invoke('files:share', [rec.id])} />}
        <IconButton
          icon={Trash2}
          label={t('archive.moveToTrash')}
          onClick={async () => {
            const res = await invoke('library:bulk', [rec.id], { kind: 'trash' })
            if (res.results[0]?.ok) {
              toast('info', 'archive.movedToTrash', { params: { count: 1 } })
              setActive(null)
            } else toast('error', 'errors.moveFailed', { detail: res.results[0]?.detail })
          }}
        />
      </div>
      {!caps.nativeShare && <p className="field-desc">{t('detail.noNativeShare')}</p>}

      <dl className="meta-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{t(k)}</dt>
            <dd className="tnum">{v}</dd>
          </div>
        ))}
        {rec.imported && (
          <div>
            <dt>{t('detail.importedFrom')}</dt>
            <dd className="truncate" title={rec.imported.originalPath}>
              {rec.imported.originalPath}
            </dd>
          </div>
        )}
      </dl>

      <section className="detail-section">
        <h3>{t('detail.organize')}</h3>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{t('filters.folder')}</span>
          <select className="select" value={rec.folderId ?? ''} onChange={(e) => void meta({ folderId: e.target.value || null })}>
            <option value="">{t('filters.noFolder')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">{t('filters.tags')}</span>
          <div className="row">
            {tags
              .filter((x) => rec.tagIds.includes(x.id))
              .map((tag) => (
                <span key={tag.id} className="chip removable">
                  <Tag size={11} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  {tag.name}
                  <button type="button" aria-label={t('detail.removeTag', { tag: tag.name })} onClick={() => void meta({ tagIds: rec.tagIds.filter((id) => id !== tag.id) })}>
                    <X size={11} />
                  </button>
                </span>
              ))}
          </div>
          <div className="row nowrap">
            <input
              className="input"
              list={`tags-${rec.id}`}
              value={newTag}
              maxLength={40}
              placeholder={t('detail.addTagPlaceholder')}
              aria-label={t('detail.addTag')}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTag()
              }}
            />
            <datalist id={`tags-${rec.id}`}>
              {tags.map((x) => (
                <option key={x.id} value={x.name} />
              ))}
            </datalist>
            <IconButton icon={Plus} label={t('detail.addTag')} onClick={() => void addTag()} />
          </div>
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{t('detail.note')}</span>
          <textarea
            className="textarea"
            value={note}
            maxLength={20000}
            placeholder={t('detail.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== rec.note && void meta({ note })}
          />
        </label>
      </section>

      <TranscriptSection rec={rec} />
      <ExportDialog open={exportOpen} ids={[rec.id]} onClose={() => setExportOpen(false)} />
    </motion.aside>
  )
}

function processingSummary(t: ReturnType<typeof useT>, rec: Recording): string {
  const parts: string[] = []
  if (rec.processing.noiseSuppression) parts.push(t('processing.noiseSuppression'))
  if (rec.processing.echoCancellation) parts.push(t('processing.echoCancellation'))
  if (rec.processing.autoGainControl) parts.push(t('processing.autoGainControl'))
  if (rec.processing.normalized) parts.push(t('processing.normalized'))
  return parts.length ? parts.join(', ') : t('processing.none')
}
