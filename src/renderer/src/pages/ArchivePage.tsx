import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { activeFilterCount, queryRecordings, textMatch } from '../../../shared/search'
import type { SortDir, SortKey } from '../../../shared/search'
import { AUDIO_FORMATS } from '../../../shared/types'
import type { AudioFormat, Recording } from '../../../shared/types'
import type { BulkAction } from '../../../shared/ipc'
import { FORMAT_INFO } from '../../../shared/formats'
import { AppError, getPathForFile, invoke } from '../api'
import { Button, IconButton, Notice } from '../components/controls'
import {
  CircleAlert,
  Download,
  FileText,
  Folder,
  ICON_STROKE,
  LayoutGrid,
  List,
  Mic,
  MonitorSpeaker,
  Search,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Upload,
  X
} from '../components/icons'
import { EmptyArchiveArt, EmptyFavoritesArt, EmptySearchArt } from '../components/illustrations'
import { MiniWave } from '../components/WaveformEditor'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useLibrary } from '../stores/library'
import { formatBytes, formatClock, formatDateTime } from '../util/format'
import { DetailPanel } from './DetailPanel'
import { ExportDialog } from './ExportDialog'
import { reportBulk } from './bulk'

const peakCache = new Map<string, Uint8Array | null>()

function usePeaks(rec: Recording, enabled: boolean): [Uint8Array | null, (el: Element | null) => void] {
  const key = `${rec.id}:${rec.updatedAt}`
  const [peaks, setPeaks] = useState<Uint8Array | null>(() => peakCache.get(key) ?? null)
  const [el, setEl] = useState<Element | null>(null)
  useEffect(() => {
    if (!enabled || !el || peakCache.has(key) || rec.missing) {
      if (peakCache.has(key)) setPeaks(peakCache.get(key) ?? null)
      return
    }
    let alive = true
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      invoke('library:peaks', rec.id)
        .then((p) => {
          const data = p ? new Uint8Array(p) : null
          peakCache.set(key, data)
          if (alive) setPeaks(data)
        })
        .catch(() => peakCache.set(key, null))
    })
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
    }
  }, [key, enabled, el, rec.id, rec.missing])
  return [peaks, setEl]
}

const SOURCE_KEY: Record<Recording['source'], MessageKey> = {
  mic: 'source.mic',
  system: 'source.system',
  mixed: 'source.both',
  imported: 'source.imported'
}

function SourceLabel({ rec }: { rec: Recording }) {
  const t = useT()
  const Icon = rec.source === 'system' ? MonitorSpeaker : rec.source === 'imported' ? Upload : Mic
  return (
    <span className="item-source">
      <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
      {t(SOURCE_KEY[rec.source])}
      {rec.part === 'mic' || rec.part === 'system' ? ` · ${t(rec.part === 'mic' ? 'archive.partMic' : 'archive.partSystem')}` : ''}
    </span>
  )
}

function RecordingItem({ rec, view, matchSource }: { rec: Recording; view: 'list' | 'cards'; matchSource: string | null }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const showWaves = useApp((s) => s.settings?.archive.showWaveforms ?? true)
  const tags = useLibrary((s) => s.tags)
  const selected = useLibrary((s) => s.selection.has(rec.id))
  const active = useLibrary((s) => s.activeId === rec.id)
  const job = useLibrary((s) => s.jobs[rec.id])
  const toggleSelected = useLibrary((s) => s.toggleSelected)
  const setActive = useLibrary((s) => s.setActive)
  const openEditor = useApp((s) => s.openEditor)
  const [peaks, ref] = usePeaks(rec, showWaves)
  const recTags = tags.filter((x) => rec.tagIds.includes(x.id))
  const jobActive = job && !['done', 'error', 'cancelled'].includes(job.phase)

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={`rec-item ${view} ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${rec.missing ? 'missing' : ''}`}
      ref={ref}
    >
      <input
        type="checkbox"
        className="rec-check"
        checked={selected}
        aria-label={t('archive.selectItem', { name: rec.name })}
        onChange={() => toggleSelected(rec.id)}
      />
      <button
        type="button"
        className="rec-main"
        onClick={() => setActive(active ? null : rec.id)}
        onDoubleClick={() => openEditor({ kind: 'recording', recordingId: rec.id })}
        aria-expanded={active}
      >
        <span className="rec-title-row">
          <span className="rec-name truncate">{rec.name}</span>
          {rec.missing && (
            <span className="badge warn">
              <CircleAlert size={11} strokeWidth={2} aria-hidden="true" />
              {t('archive.missing')}
            </span>
          )}
          {rec.transcript && (
            <span className="badge" title={t('archive.hasTranscript')}>
              <FileText size={11} strokeWidth={2} aria-hidden="true" />
              {t('archive.transcriptBadge')}
            </span>
          )}
          {matchSource === 'transcript' && <span className="badge">{t('archive.matchTranscript')}</span>}
        </span>
        <span className="rec-meta tnum">
          <span>{formatDateTime(rec.createdAt, locale)}</span>
          <span>{formatClock(rec.durationMs)}</span>
          <span className="badge">{FORMAT_INFO[rec.format].label}</span>
          <span>{formatBytes(rec.sizeBytes, locale)}</span>
          <SourceLabel rec={rec} />
        </span>
        {recTags.length > 0 && (
          <span className="rec-tags">
            {recTags.map((tag) => (
              <span key={tag.id} className="chip">
                <Tag size={11} strokeWidth={ICON_STROKE} aria-hidden="true" />
                {tag.name}
              </span>
            ))}
          </span>
        )}
        {jobActive && (
          <span className="rec-job faint">
            {t('transcription.inProgress', { percent: job.percent })}
          </span>
        )}
      </button>
      {showWaves && (
        <span className="rec-wave" aria-hidden="true">
          <MiniWave peaks={peaks} bars={view === 'cards' ? 56 : 40} />
        </span>
      )}
      <button
        type="button"
        className={`fav-btn ${rec.favorite ? 'on' : ''}`}
        aria-pressed={rec.favorite}
        aria-label={rec.favorite ? t('archive.unfavorite', { name: rec.name }) : t('archive.favorite', { name: rec.name })}
        onClick={() => void invoke('library:update-meta', rec.id, { favorite: !rec.favorite })}
      >
        <Star size={17} strokeWidth={ICON_STROKE} fill={rec.favorite ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
    </motion.li>
  )
}

const SORTS: Array<{ id: string; key: SortKey; dir: SortDir; label: MessageKey }> = [
  { id: 'date-desc', key: 'date', dir: 'desc', label: 'sort.newest' },
  { id: 'date-asc', key: 'date', dir: 'asc', label: 'sort.oldest' },
  { id: 'name-asc', key: 'name', dir: 'asc', label: 'sort.nameAsc' },
  { id: 'name-desc', key: 'name', dir: 'desc', label: 'sort.nameDesc' },
  { id: 'duration-desc', key: 'duration', dir: 'desc', label: 'sort.longest' },
  { id: 'duration-asc', key: 'duration', dir: 'asc', label: 'sort.shortest' },
  { id: 'size-desc', key: 'size', dir: 'desc', label: 'sort.largest' },
  { id: 'size-asc', key: 'size', dir: 'asc', label: 'sort.smallest' },
  { id: 'format-asc', key: 'format', dir: 'asc', label: 'sort.format' }
]

function FilterPanel({ favoritesMode }: { favoritesMode: boolean }) {
  const t = useT()
  const q = useLibrary((s) => s.query)
  const setQuery = useLibrary((s) => s.setQuery)
  const reset = useLibrary((s) => s.resetFilters)
  const folders = useLibrary((s) => s.folders)
  const tags = useLibrary((s) => s.tags)
  const toggleFormat = (f: AudioFormat): void => setQuery({ formats: q.formats.includes(f) ? q.formats.filter((x) => x !== f) : [...q.formats, f] })
  const toggleTag = (id: string): void => setQuery({ tagIds: q.tagIds.includes(id) ? q.tagIds.filter((x) => x !== id) : [...q.tagIds, id] })
  const minutes = (v: string): number | null => (v === '' ? null : Math.max(0, Number(v)) * 60)
  return (
    <div className="filter-panel">
      <div className="filter-grid">
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{t('filters.from')}</span>
          <input type="date" className="input" value={q.dateFrom ?? ''} onChange={(e) => setQuery({ dateFrom: e.target.value || null })} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{t('filters.to')}</span>
          <input type="date" className="input" value={q.dateTo ?? ''} onChange={(e) => setQuery({ dateTo: e.target.value || null })} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{t('filters.minDuration')}</span>
          <input
            type="number"
            min={0}
            className="input"
            value={q.minDurationSec === null ? '' : q.minDurationSec / 60}
            onChange={(e) => setQuery({ minDurationSec: minutes(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{t('filters.maxDuration')}</span>
          <input
            type="number"
            min={0}
            className="input"
            value={q.maxDurationSec === null ? '' : q.maxDurationSec / 60}
            onChange={(e) => setQuery({ maxDurationSec: minutes(e.target.value) })}
          />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">{t('filters.folder')}</span>
          <select
            className="select"
            value={q.folderId === undefined ? '__any' : q.folderId === null ? '__none' : q.folderId}
            onChange={(e) => setQuery({ folderId: e.target.value === '__any' ? undefined : e.target.value === '__none' ? null : e.target.value })}
          >
            <option value="__any">{t('filters.anyFolder')}</option>
            <option value="__none">{t('filters.noFolder')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">{t('filters.formats')}</span>
        <div className="row">
          {AUDIO_FORMATS.map((f) => (
            <button key={f} type="button" className={`chip toggle ${q.formats.includes(f) ? 'on' : ''}`} aria-pressed={q.formats.includes(f)} onClick={() => toggleFormat(f)}>
              {FORMAT_INFO[f].label}
            </button>
          ))}
        </div>
      </div>
      {tags.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">{t('filters.tags')}</span>
          <div className="row">
            {tags.map((tag) => (
              <button key={tag.id} type="button" className={`chip toggle ${q.tagIds.includes(tag.id) ? 'on' : ''}`} aria-pressed={q.tagIds.includes(tag.id)} onClick={() => toggleTag(tag.id)}>
                <Tag size={11} strokeWidth={ICON_STROKE} aria-hidden="true" />
                {tag.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="row">
        {!favoritesMode && (
          <label className="checkbox">
            <input type="checkbox" checked={q.favoritesOnly} onChange={(e) => setQuery({ favoritesOnly: e.target.checked })} />
            {t('filters.favoritesOnly')}
          </label>
        )}
        <div className="spacer" />
        <Button size="sm" variant="ghost" icon={X} onClick={reset}>
          {t('filters.clear')}
        </Button>
      </div>
    </div>
  )
}

function BulkBar({ visibleIds }: { visibleIds: string[] }) {
  const t = useT()
  const selection = useLibrary((s) => s.selection)
  const clear = useLibrary((s) => s.clearSelection)
  const setSelection = useLibrary((s) => s.setSelection)
  const folders = useLibrary((s) => s.folders)
  const tags = useLibrary((s) => s.tags)
  const [exportOpen, setExportOpen] = useState(false)
  const ids = [...selection]
  const bulk = async (action: BulkAction, okKey: string, failKey: string): Promise<void> => {
    try {
      const res = await invoke('library:bulk', ids, action)
      reportBulk(res, okKey, failKey)
      if (action.kind === 'trash') clear()
    } catch (err) {
      useApp.getState().toast('error', failKey, { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected', params: { count: ids.length } })
    }
  }
  return (
    <motion.div className="bulk-bar" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} role="toolbar" aria-label={t('bulk.label')}>
      <strong className="tnum">{t('bulk.selected', { count: ids.length })}</strong>
      <Button size="sm" variant="ghost" onClick={() => setSelection(visibleIds)}>
        {t('bulk.selectAll')}
      </Button>
      <div className="spacer" />
      <select
        className="select bulk-select"
        aria-label={t('bulk.move')}
        value=""
        onChange={(e) => {
          const v = e.target.value
          if (v) void bulk({ kind: 'move', folderId: v === '__none' ? null : v }, 'bulk.moved', 'bulk.moveFailed')
        }}
      >
        <option value="">{t('bulk.move')}</option>
        <option value="__none">{t('filters.noFolder')}</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      {tags.length > 0 && (
        <select
          className="select bulk-select"
          aria-label={t('bulk.tag')}
          value=""
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            const [mode, id] = v.split(':') as ['add' | 'remove', string]
            void bulk({ kind: 'tag', tagId: id, add: mode === 'add' }, 'bulk.tagged', 'bulk.tagFailed')
          }}
        >
          <option value="">{t('bulk.tag')}</option>
          <optgroup label={t('bulk.addTag')}>
            {tags.map((tag) => (
              <option key={`a${tag.id}`} value={`add:${tag.id}`}>
                + {tag.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('bulk.removeTag')}>
            {tags.map((tag) => (
              <option key={`r${tag.id}`} value={`remove:${tag.id}`}>
                − {tag.name}
              </option>
            ))}
          </optgroup>
        </select>
      )}
      <IconButton icon={Star} label={t('bulk.favorite')} onClick={() => void bulk({ kind: 'favorite', value: true }, 'bulk.favorited', 'bulk.favoriteFailed')} />
      <IconButton icon={Download} label={t('bulk.export')} onClick={() => setExportOpen(true)} />
      <IconButton icon={Trash2} label={t('bulk.delete')} onClick={() => void bulk({ kind: 'trash' }, 'archive.movedToTrash', 'bulk.deleteFailed')} />
      <IconButton icon={X} label={t('bulk.clear')} onClick={clear} />
      <ExportDialog open={exportOpen} ids={ids} onClose={() => setExportOpen(false)} />
    </motion.div>
  )
}

export function ArchivePage({ mode }: { mode: 'all' | 'favorites' }) {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const preset = useApp((s) => s.archivePreset)
  const recordings = useLibrary((s) => s.recordings)
  const tags = useLibrary((s) => s.tags)
  const folders = useLibrary((s) => s.folders)
  const q = useLibrary((s) => s.query)
  const setQuery = useLibrary((s) => s.setQuery)
  const transcriptMatches = useLibrary((s) => s.transcriptMatches)
  const setTranscriptMatches = useLibrary((s) => s.setTranscriptMatches)
  const selection = useLibrary((s) => s.selection)
  const activeId = useLibrary((s) => s.activeId)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const view = settings.archive.view

  useEffect(() => {
    if (!preset) return
    setQuery({ folderId: preset.folderId, tagIds: preset.tagId ? [preset.tagId] : [] })
    setFiltersOpen(true)
  }, [preset, setQuery])

  useEffect(() => {
    const text = q.text.trim()
    if (!text) {
      setTranscriptMatches([])
      return
    }
    const timer = window.setTimeout(() => {
      invoke('library:search-transcripts', text)
        .then(setTranscriptMatches)
        .catch(() => setTranscriptMatches([]))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [q.text, setTranscriptMatches])

  const effective = useMemo(() => (mode === 'favorites' ? { ...q, favoritesOnly: true } : q), [mode, q])
  const ctx = useMemo(() => ({ tags, transcriptMatches }), [tags, transcriptMatches])
  const list = useMemo(() => queryRecordings(recordings, effective, ctx), [recordings, effective, ctx])
  const total = recordings.filter((r) => !r.trash && (mode === 'all' || r.favorite)).length
  const filters = activeFilterCount(effective) - (mode === 'favorites' ? 1 : 0)
  const sortId = `${q.sort.key}-${q.sort.dir}`
  const activeRec = recordings.find((r) => r.id === activeId && !r.trash)

  const importPaths = async (paths: string[] | null): Promise<void> => {
    try {
      const res = await invoke('library:import', paths)
      if (res) reportBulk(res, 'archive.imported', 'archive.importFailed')
    } catch (err) {
      useApp.getState().toast('error', 'archive.importFailed', { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected', params: { count: paths?.length ?? 1 } })
    }
  }

  return (
    <div
      className={`archive-page ${activeRec ? 'with-detail' : ''}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        const paths = [...e.dataTransfer.files].map((f) => getPathForFile(f)).filter(Boolean)
        if (paths.length) void importPaths(paths)
      }}
    >
      <div className="archive-main">
        <div className="page-head">
          <div>
            <h1>{mode === 'favorites' ? t('nav.favorites') : t('nav.archive')}</h1>
            <p className="muted tnum">{t('archive.count', { shown: list.length, total })}</p>
          </div>
          <div className="row">
            <Button icon={Upload} onClick={() => void importPaths(null)}>
              {t('archive.import')}
            </Button>
          </div>
        </div>

        <div className="archive-toolbar">
          <div className="input-with-icon search">
            <Search size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <input
              type="search"
              className="input"
              placeholder={t('archive.searchPlaceholder')}
              aria-label={t('archive.search')}
              value={q.text}
              onChange={(e) => setQuery({ text: e.target.value })}
            />
          </div>
          <Button icon={SlidersHorizontal} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            {t('archive.filters')}
            {filters > 0 && <span className="count-dot tnum">{filters}</span>}
          </Button>
          <select
            className="select sort-select"
            aria-label={t('archive.sort')}
            value={sortId}
            onChange={(e) => {
              const s = SORTS.find((x) => x.id === e.target.value)
              if (s) setQuery({ sort: { key: s.key, dir: s.dir } })
            }}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {t(s.label)}
              </option>
            ))}
          </select>
          <div className="segmented" role="radiogroup" aria-label={t('archive.view')}>
            <button type="button" role="radio" aria-checked={view === 'list'} className="segmented-item" onClick={() => void updateSettings({ archive: { view: 'list' } })}>
              <List size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <span className="sr-only">{t('archive.listView')}</span>
            </button>
            <button type="button" role="radio" aria-checked={view === 'cards'} className="segmented-item" onClick={() => void updateSettings({ archive: { view: 'cards' } })}>
              <LayoutGrid size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <span className="sr-only">{t('archive.cardView')}</span>
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {filtersOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
              <FilterPanel favoritesMode={mode === 'favorites'} />
            </motion.div>
          )}
        </AnimatePresence>

        {q.folderId && (
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="chip removable">
              <Folder size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
              {folders.find((f) => f.id === q.folderId)?.name}
              <button type="button" aria-label={t('filters.clear')} onClick={() => setQuery({ folderId: undefined })}>
                <X size={12} />
              </button>
            </span>
          </div>
        )}

        {total === 0 ? (
          <div className="empty">
            {mode === 'favorites' ? <EmptyFavoritesArt /> : <EmptyArchiveArt />}
            <h3>{mode === 'favorites' ? t('archive.emptyFavoritesTitle') : t('archive.emptyTitle')}</h3>
            <p>{mode === 'favorites' ? t('archive.emptyFavoritesBody') : t('archive.emptyBody')}</p>
          </div>
        ) : list.length === 0 ? (
          <div className="empty">
            <EmptySearchArt />
            <h3>{t('archive.noMatchTitle')}</h3>
            <p>{t('archive.noMatchBody')}</p>
          </div>
        ) : (
          <ul className={`rec-list ${view}`} aria-label={t('archive.listLabel')}>
            <AnimatePresence initial={false}>
              {list.map((rec) => (
                <RecordingItem key={rec.id} rec={rec} view={view} matchSource={q.text ? textMatch(rec, q.text, ctx) : null} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        <AnimatePresence>{selection.size > 0 && <BulkBar visibleIds={list.map((r) => r.id)} />}</AnimatePresence>
      </div>
      <AnimatePresence>{activeRec && <DetailPanel key={activeRec.id} rec={activeRec} />}</AnimatePresence>
      <AnimatePresence>
        {dragging && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="drop-card">
              <Upload size={28} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <strong>{t('archive.dropTitle')}</strong>
              <span className="muted">{t('archive.dropBody')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {settings.files.recordingsDir === null && <Notice kind="warning">{t('errors.noRecordingsFolder')}</Notice>}
    </div>
  )
}
