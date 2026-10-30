import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { estimateFinalSize, FORMAT_INFO, resolveEncoding } from '../../../shared/formats'
import { SIDE_PANEL_DEFAULT, SIDE_PANEL_MAX, SIDE_PANEL_MIN } from '../../../shared/settings'
import { defaultSessionName, nextSessionNumber } from '../../../shared/sessions'
import { acceleratorKeycaps } from '../../../shared/shortcuts'
import type { PlatformCapabilities, SessionConfig } from '../../../shared/types'
import { invoke, platform } from '../api'
import { engine, MAX_SESSIONS } from '../audio/engine'
import { tracksFor } from '../audio/session-controller'
import { SerifClock } from '../components/clock'
import { Button, IconButton, Keycaps, Notice } from '../components/controls'
import { Flag, HardDrive, ICON_STROKE, PanelRightClose, PanelRightOpen, Pause, Pencil, PictureInPicture2, Play, Plus, Square, Timer, X } from '../components/icons'
import { LevelMeters, LiveWaveform } from '../components/live'
import { StatePill } from '../components/status'
import { useT } from '../i18n'
import { useApp } from '../stores/app'
import { useEngine } from '../stores/engine'
import { useDevices } from '../stores/devices'
import type { CaptureInfo, SessionRuntime } from '../stores/engine'
import { formatBytes, formatClock, formatKHz } from '../util/format'
import { OutputCard, PendingRunsBanner, ScheduleCard, SideCard, SourceCard } from './RecordPanels'

function SessionTabs() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const sessions = useApp((s) => s.settings!.sessions)
  const selectedId = useEngine((s) => s.selectedId)
  const runtimes = useEngine((s) => s.sessions)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const commitRename = async (id: string): Promise<void> => {
    const name = draft.trim().slice(0, 60)
    setRenaming(null)
    if (name) await engine.updateSession(id, { name })
  }
  const onKey = (e: ReactKeyboardEvent, index: number): void => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = sessions[(index + (e.key === 'ArrowRight' ? 1 : -1) + sessions.length) % sessions.length]
    if (next) {
      void engine.select(next.id)
      refs.current[next.id]?.focus()
    }
  }

  return (
    <div className="session-bar">
      <div className="session-tabs" role="tablist" aria-label={t('record.sessions')}>
        <AnimatePresence initial={false}>
          {sessions.map((s, i) => {
            const rt = runtimes[s.id]
            const selected = s.id === selectedId
            const active = rt && (rt.state === 'recording' || rt.state === 'paused' || rt.state === 'countdown')
            return (
              <motion.div
                key={s.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18 }}
                className={`session-tab ${selected ? 'selected' : ''} ${rt?.state ?? 'ready'}`}
              >
                {renaming === s.id ? (
                  <input
                    className="input session-rename"
                    value={draft}
                    autoFocus
                    maxLength={60}
                    aria-label={t('record.renameSession')}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(s.id)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <button
                    ref={(el) => {
                      refs.current[s.id] = el
                    }}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    className="session-tab-btn"
                    onClick={() => void engine.select(s.id)}
                    onDoubleClick={() => {
                      setDraft(s.name)
                      setRenaming(s.id)
                    }}
                    onKeyDown={(e) => onKey(e, i)}
                  >
                    <span className={`session-dot ${rt?.state ?? 'ready'}`} aria-hidden="true" />
                    <span className="truncate">{s.name}</span>
                    {active && rt && <span className="session-time tnum">{rt.state === 'countdown' ? rt.countdownLeft : formatClock(rt.elapsedMs)}</span>}
                    <span className="sr-only">{t(`state.${rt?.state ?? 'ready'}` as 'state.ready')}</span>
                  </button>
                )}
                {selected && renaming !== s.id && (
                  <IconButton
                    icon={Pencil}
                    small
                    size={13}
                    label={t('record.renameSession')}
                    onClick={() => {
                      setDraft(s.name)
                      setRenaming(s.id)
                    }}
                  />
                )}
                {sessions.length > 1 && (rt?.state ?? 'ready') === 'ready' && (
                  <IconButton icon={X} small size={13} label={t('record.removeSession', { session: s.name })} onClick={() => void engine.removeSession(s.id)} />
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      {sessions.length < MAX_SESSIONS && (
        <IconButton
          icon={Plus}
          small
          className="session-add"
          label={t('record.addSession')}
          onClick={() => void engine.addSession(defaultSessionName(locale, nextSessionNumber(sessions.map((s) => s.name))))}
        />
      )}
    </div>
  )
}

function useFreeSpace(recording: boolean): number | null {
  const dir = useApp((s) => s.settings?.files.recordingsDir ?? null)
  const [free, setFree] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void invoke('files:free-space', dir)
        .then((v) => alive && setFree(v))
        .catch(() => undefined)
    }
    load()
    const id = window.setInterval(load, recording ? 5000 : 30000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [dir, recording])
  return free
}

/** Format, size and free space in one quiet line under the record button. */
function RecMeta({ cfg, rt }: { cfg: SessionConfig; rt: SessionRuntime }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const capturing = rt.state === 'recording' || rt.state === 'paused'
  const free = useFreeSpace(capturing)
  const enc = resolveEncoding(cfg.format, cfg.qualityProfile, cfg.custom)
  const outputs = tracksFor(cfg).length
  const info = FORMAT_INFO[enc.format]
  const quality = info.lossless ? (enc.bitDepth === 32 ? '32-bit float' : `${enc.bitDepth}-bit`) : `${enc.bitrateKbps} kbps`
  const est = capturing ? estimateFinalSize(enc, rt.elapsedMs) : null
  return (
    <div className="take-meta tnum">
      <span>
        {info.label} · {formatKHz(enc.sampleRate, locale)} · {enc.channels === 1 ? t('audio.mono') : t('audio.stereo')} · {quality}
        {outputs > 1 ? ` · ×${outputs}` : ''}
      </span>
      {est && (
        <span className="take-meta-size">
          {est.estimated
            ? t('record.sizeEstimated', { size: formatBytes(est.bytes * outputs, locale) })
            : t('record.sizeExact', { size: formatBytes(est.bytes * outputs, locale) })}
        </span>
      )}
      {rt.markers.length > 0 && (
        <span>
          <Flag size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {rt.markers.length}
        </span>
      )}
      {free !== null && (
        <span title={t('record.diskFree', { size: formatBytes(free, locale) })}>
          <HardDrive size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {formatBytes(free, locale)}
        </span>
      )}
    </div>
  )
}

function RecordButton({ rt, onClick, keys }: { rt: SessionRuntime; onClick: () => void; keys: string }) {
  const t = useT()
  const capturing = rt.state === 'recording' || rt.state === 'paused'
  const busy = rt.state === 'finalizing' || rt.state === 'exporting' || rt.state === 'preview'
  const label = rt.state === 'countdown' ? t('record.cancelCountdown') : capturing ? t('record.stop') : t('record.start')
  return (
    <button
      type="button"
      className={`record-btn ${capturing ? 'is-capturing' : ''} ${rt.state === 'recording' ? 'is-live' : ''}`}
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      aria-keyshortcuts={keys}
      title={label}
    >
      <span className="record-ring" aria-hidden="true" />
      <span className="record-core" aria-hidden="true">
        {capturing ? <Square size={22} fill="currentColor" strokeWidth={0} /> : rt.state === 'countdown' ? <X size={24} strokeWidth={2} /> : null}
      </span>
    </button>
  )
}

/** Side panel of the record page. Re-renders only when its own inputs change, not with the clock. */
const SidePanel = memo(function SidePanel({
  cfg,
  sessionId,
  state,
  capture,
  live,
  caps
}: {
  cfg: SessionConfig
  sessionId: string
  state: SessionRuntime['state']
  capture: CaptureInfo | null
  live: boolean
  caps: PlatformCapabilities
}) {
  const t = useT()
  return (
    <>
      <SideCard id="levels" title={t('record.levels')} badge={live ? <span className="badge live-badge">{t('record.live')}</span> : undefined}>
        <LevelMeters sessionId={sessionId} mic={cfg.source !== 'system'} system={cfg.source !== 'mic'} active={live} />
      </SideCard>
      <SourceCard cfg={cfg} state={state} capture={capture} caps={caps} />
      <OutputCard cfg={cfg} state={state} />
      <ScheduleCard />
    </>
  )
})

function clampWidth(w: number): number {
  return Math.round(Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, w)))
}

/**
 * Drag handle between the stage and the side panel. While dragging, the width is written to a
 * CSS variable directly (no React render per pointer move) and stored when the drag ends.
 */
function PanelResizer({ gridRef, width }: { gridRef: RefObject<HTMLDivElement | null>; width: number }) {
  const t = useT()
  const drag = useRef<{ x: number; w: number; current: number } | null>(null)
  const commit = (w: number): void => {
    void useApp.getState().updateSettings({ layout: { sidePanelWidth: clampWidth(w) } })
  }
  const apply = (w: number): void => {
    gridRef.current?.style.setProperty('--side-w', `${clampWidth(w)}px`)
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width, current: width }
    gridRef.current?.classList.add('is-resizing')
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    d.current = clampWidth(d.w + (d.x - e.clientX))
    apply(d.current)
  }
  const end = (): void => {
    const d = drag.current
    drag.current = null
    gridRef.current?.classList.remove('is-resizing')
    if (d && d.current !== width) commit(d.current)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 64 : 16
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = width + step
    else if (e.key === 'ArrowRight') next = width - step
    else if (e.key === 'Home') next = SIDE_PANEL_MAX
    else if (e.key === 'End') next = SIDE_PANEL_MIN
    if (next === null) return
    e.preventDefault()
    apply(next)
    commit(next)
  }
  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('record.panelResize')}
      aria-valuemin={SIDE_PANEL_MIN}
      aria-valuemax={SIDE_PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => {
        apply(SIDE_PANEL_DEFAULT)
        commit(SIDE_PANEL_DEFAULT)
      }}
      onKeyDown={onKeyDown}
    >
      <span className="panel-resizer-line" aria-hidden="true" />
    </div>
  )
}

export function RecordPage() {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const caps = useApp((s) => s.caps)!
  const selectedId = useEngine((s) => s.selectedId)
  const rt = useEngine((s) => (selectedId ? s.sessions[selectedId] : undefined))
  const cfg = settings.sessions.find((s) => s.id === selectedId)
  const gridRef = useRef<HTMLDivElement>(null)
  const [miniOpen, setMiniOpen] = useState(settings.miniPanel.open)
  useEffect(() => setMiniOpen(settings.miniPanel.open), [settings.miniPanel.open])
  if (!cfg || !rt || !selectedId) return null

  const ctrl = engine.controller(selectedId)
  const capturing = rt.state === 'recording' || rt.state === 'paused'
  const live = capturing || rt.state === 'countdown' || rt.inputTest
  const b = settings.shortcuts.bindings
  const space = t('keys.space')
  const keysText = (acc: string): string => acceleratorKeycaps(acc, platform, space).join('+')
  const { sidePanelWidth, sidePanelCollapsed } = settings.layout
  const toggleSide = (): void => void useApp.getState().updateSettings({ layout: { sidePanelCollapsed: !sidePanelCollapsed } })

  return (
    <div className="record-page">
      <div className="page-head">
        <h1>{t('record.title')}</h1>
        <Button size="sm" variant="ghost" icon={PictureInPicture2} aria-pressed={miniOpen} onClick={async () => setMiniOpen(await invoke('window:mini', !miniOpen))}>
          {miniOpen ? t('record.hideMini') : t('record.showMini')}
        </Button>
      </div>
      <SessionTabs />
      <PendingRunsBanner />
      <div ref={gridRef} className={`record-grid ${sidePanelCollapsed ? 'side-collapsed' : ''}`} style={{ '--side-w': `${sidePanelWidth}px` } as CSSProperties}>
        <section className={`card stage-card state-${rt.state}`} aria-label={t('record.stage')}>
          <div className="stage-head">
            <StatePill state={rt.state} />
            <div className="spacer" />
            {rt.state === 'ready' && !rt.inputTest && (
              <Button size="sm" variant="ghost" onClick={() => void ctrl?.startInputTest()}>
                {t('record.checkInput')}
              </Button>
            )}
            {rt.inputTest && (
              <Button size="sm" variant="ghost" onClick={() => ctrl?.stopInputTest()}>
                {t('record.stopCheck')}
              </Button>
            )}
            <IconButton
              icon={sidePanelCollapsed ? PanelRightOpen : PanelRightClose}
              small
              label={sidePanelCollapsed ? t('record.panelShow') : t('record.panelHide')}
              aria-expanded={!sidePanelCollapsed}
              onClick={toggleSide}
            />
          </div>
          <div className={`timer ${rt.state === 'paused' ? 'paused' : ''}`}>
            <SerifClock ms={rt.elapsedMs} />
          </div>
          <div className="stage">
            <LiveWaveform sessionId={selectedId} active={live} recording={rt.state === 'recording'} label={t('record.waveformLabel')} />
            <AnimatePresence>
              {rt.state === 'countdown' && rt.countdownLeft !== null && (
                <motion.div className="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Timer size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <motion.span key={rt.countdownLeft} className="countdown-n" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    {rt.countdownLeft}
                  </motion.span>
                  <Button size="sm" onClick={() => ctrl?.cancelCountdown()}>
                    {t('record.cancelCountdown')}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {rt.lostSource && <DeviceLostPanel sessionId={selectedId} lost={rt.lostSource} />}
          {rt.errorKey && !rt.lostSource && (
            <Notice
              kind="error"
              title={t('record.errorTitle')}
              action={
                <Button size="sm" onClick={() => ctrl?.resetError()}>
                  {t('common.dismiss')}
                </Button>
              }
            >
              {t(rt.errorKey as 'errors.unexpected')}
              {rt.errorDetail ? <span className="faint"> ({rt.errorDetail})</span> : null}
            </Notice>
          )}
          <div className="transport" role="toolbar" aria-label={t('record.transport')}>
            <div className="transport-side">
              <button type="button" className="transport-btn" disabled={!capturing} onClick={() => ctrl?.addMarker()} aria-keyshortcuts={keysText(b.addMarker)}>
                <Flag size={17} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <span>{t('record.marker')}</span>
                <Keycaps keys={acceleratorKeycaps(b.addMarker, platform, space)} />
              </button>
            </div>
            <div className="transport-center">
              <RecordButton rt={rt} keys={keysText(b.toggleRecord)} onClick={() => void ctrl?.toggleRecord()} />
              <Keycaps keys={acceleratorKeycaps(b.toggleRecord, platform, space)} />
            </div>
            <div className="transport-side">
              <button
                type="button"
                className="transport-btn"
                disabled={!capturing || !!rt.lostSource}
                onClick={() => void ctrl?.togglePause()}
                aria-keyshortcuts={keysText(b.togglePause)}
              >
                {rt.state === 'paused' ? <Play size={17} strokeWidth={ICON_STROKE} aria-hidden="true" /> : <Pause size={17} strokeWidth={ICON_STROKE} aria-hidden="true" />}
                <span>{rt.state === 'paused' ? t('record.resume') : t('record.pause')}</span>
                <Keycaps keys={acceleratorKeycaps(b.togglePause, platform, space)} />
              </button>
            </div>
          </div>
          <RecMeta cfg={cfg} rt={rt} />
        </section>
        <PanelResizer gridRef={gridRef} width={sidePanelWidth} />
        <aside className="side-col" inert={sidePanelCollapsed} aria-hidden={sidePanelCollapsed || undefined}>
          <SidePanel cfg={cfg} sessionId={selectedId} state={rt.state} capture={rt.capture} live={live} caps={caps} />
        </aside>
      </div>
    </div>
  )
}

function DeviceLostPanel({ sessionId, lost }: { sessionId: string; lost: 'mic' | 'system' }) {
  const t = useT()
  const [device, setDevice] = useState<string>('')
  const inputs = useDevices((s) => (lost === 'mic' ? s.inputs : s.monitors))
  return (
    <Notice kind="error" title={lost === 'mic' ? t('record.micLostTitle') : t('record.systemLostTitle')}>
      <p>{t('record.deviceLostBody')}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <select className="select" style={{ maxWidth: 320 }} value={device} aria-label={t('record.chooseDevice')} onChange={(e) => setDevice(e.target.value)}>
          <option value="">{lost === 'mic' ? t('devices.systemDefault') : t('devices.loopback')}</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('devices.unnamed')}
            </option>
          ))}
        </select>
        <Button variant="primary" size="sm" onClick={() => void engine.controller(sessionId)?.reconnect(device || null)}>
          {t('record.reconnectResume')}
        </Button>
      </div>
    </Notice>
  )
}
