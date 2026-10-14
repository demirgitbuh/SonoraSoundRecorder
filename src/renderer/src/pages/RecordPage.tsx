import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { estimateFinalSize, FORMAT_INFO, resolveEncoding } from '../../../shared/formats'
import { acceleratorKeycaps } from '../../../shared/shortcuts'
import type { SessionConfig } from '../../../shared/types'
import { invoke, platform } from '../api'
import { engine, MAX_SESSIONS } from '../audio/engine'
import { tracksFor } from '../audio/session-controller'
import { Button, IconButton, Keycaps, Notice } from '../components/controls'
import { Flag, HardDrive, ICON_STROKE, Pause, Pencil, PictureInPicture2, Play, Plus, Square, Timer, X } from '../components/icons'
import { LevelMeters, LiveWaveform } from '../components/live'
import { StatePill } from '../components/status'
import { useT } from '../i18n'
import { useApp } from '../stores/app'
import { useEngine } from '../stores/engine'
import { useDevices } from '../stores/devices'
import type { SessionRuntime } from '../stores/engine'
import { formatBytes, formatClock, formatKHz } from '../util/format'
import { OutputCard, PendingRunsBanner, ScheduleCard, SourceCard } from './RecordPanels'

function SessionTabs() {
  const t = useT()
  const sessions = useApp((s) => s.settings?.sessions ?? [])
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
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => void engine.addSession(t('record.sessionName', { n: sessions.length + 1 }))}>
          {t('record.addSession')}
        </Button>
      )}
    </div>
  )
}

function DiskFree({ recording }: { recording: boolean }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const dir = useApp((s) => s.settings?.files.recordingsDir ?? null)
  const [free, setFree] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void invoke('files:free-space', dir).then((v) => alive && setFree(v)).catch(() => undefined)
    }
    load()
    const id = window.setInterval(load, recording ? 5000 : 30000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [dir, recording])
  return (
    <span className="info-item" title={dir ?? ''}>
      <HardDrive size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
      {free === null ? t('record.diskUnknown') : t('record.diskFree', { size: formatBytes(free, locale) })}
    </span>
  )
}

function InfoStrip({ cfg, rt }: { cfg: SessionConfig; rt: SessionRuntime }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const enc = resolveEncoding(cfg.format, cfg.qualityProfile, cfg.custom)
  const outputs = tracksFor(cfg).length
  const capturing = rt.state === 'recording' || rt.state === 'paused'
  const est = estimateFinalSize(enc, rt.elapsedMs)
  const info = FORMAT_INFO[enc.format]
  const quality = info.lossless ? `${enc.bitDepth === 32 ? '32-bit float' : `${enc.bitDepth}-bit`}` : `${enc.bitrateKbps} kbps`
  return (
    <div className="info-strip">
      <span className="info-item strong">
        {info.label} · {formatKHz(enc.sampleRate, locale)} · {enc.channels === 1 ? t('audio.mono') : t('audio.stereo')} · {quality}
      </span>
      {outputs > 1 && <span className="info-item">{t('record.outputFiles', { count: outputs })}</span>}
      <span className="info-item tnum">
        {capturing
          ? est.estimated
            ? t('record.sizeEstimated', { size: formatBytes(est.bytes * outputs, locale) })
            : t('record.sizeExact', { size: formatBytes(est.bytes * outputs, locale) })
          : t('record.sizeIdle')}
      </span>
      <DiskFree recording={capturing} />
      {rt.markers.length > 0 && (
        <span className="info-item">
          <Flag size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {t('record.markerCount', { count: rt.markers.length })}
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

export function RecordPage() {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const caps = useApp((s) => s.caps)!
  const selectedId = useEngine((s) => s.selectedId)
  const rt = useEngine((s) => (selectedId ? s.sessions[selectedId] : undefined))
  const cfg = settings.sessions.find((s) => s.id === selectedId)
  const [miniOpen, setMiniOpen] = useState(settings.miniPanel.open)
  useEffect(() => setMiniOpen(settings.miniPanel.open), [settings.miniPanel.open])
  if (!cfg || !rt || !selectedId) return null

  const ctrl = engine.controller(selectedId)
  const capturing = rt.state === 'recording' || rt.state === 'paused'
  const live = capturing || rt.state === 'countdown' || rt.inputTest
  const b = settings.shortcuts.bindings
  const space = t('keys.space')
  const keysText = (acc: string): string => acceleratorKeycaps(acc, platform, space).join('+')

  return (
    <div className="record-page">
      <div className="page-head">
        <div>
          <h1>{t('record.title')}</h1>
          <p className="muted">{t('record.subtitle')}</p>
        </div>
        <div className="row">
          <Button
            size="sm"
            variant="ghost"
            icon={PictureInPicture2}
            aria-pressed={miniOpen}
            onClick={async () => setMiniOpen(await invoke('window:mini', !miniOpen))}
          >
            {miniOpen ? t('record.hideMini') : t('record.showMini')}
          </Button>
        </div>
      </div>
      <SessionTabs />
      <PendingRunsBanner />
      <div className="record-grid">
        <section className={`card stage-card state-${rt.state}`} aria-label={t('record.stage')}>
          <div className="stage-head">
            <StatePill state={rt.state} />
            <span className="truncate muted">{cfg.name}</span>
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
          </div>
          <div className={`timer tnum ${rt.state === 'paused' ? 'paused' : ''}`} aria-live="off">
            {formatClock(rt.elapsedMs, true)}
          </div>
          <div className="stage">
            <LiveWaveform sessionId={selectedId} active={live} recording={rt.state === 'recording'} label={t('record.waveformLabel')} />
            <AnimatePresence>
              {rt.state === 'countdown' && rt.countdownLeft !== null && (
                <motion.div className="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Timer size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  <motion.span key={rt.countdownLeft} className="countdown-n tnum" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    {rt.countdownLeft}
                  </motion.span>
                  <Button size="sm" onClick={() => ctrl?.cancelCountdown()}>
                    {t('record.cancelCountdown')}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {!live && rt.state === 'ready' && <div className="stage-hint">{t('record.readyHint', { key: keysText(b.toggleRecord) })}</div>}
          </div>
          {rt.lostSource && (
            <DeviceLostPanel sessionId={selectedId} lost={rt.lostSource} />
          )}
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
              <button
                type="button"
                className="transport-btn"
                disabled={!capturing}
                onClick={() => ctrl?.addMarker()}
                aria-keyshortcuts={keysText(b.addMarker)}
              >
                <Flag size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <span>{t('record.marker')}</span>
                <Keycaps keys={acceleratorKeycaps(b.addMarker, platform, space)} />
              </button>
            </div>
            <RecordButton rt={rt} keys={keysText(b.toggleRecord)} onClick={() => void ctrl?.toggleRecord()} />
            <div className="transport-side">
              <button
                type="button"
                className="transport-btn"
                disabled={!capturing || !!rt.lostSource}
                onClick={() => void ctrl?.togglePause()}
                aria-keyshortcuts={keysText(b.togglePause)}
              >
                {rt.state === 'paused' ? <Play size={18} strokeWidth={ICON_STROKE} aria-hidden="true" /> : <Pause size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />}
                <span>{rt.state === 'paused' ? t('record.resume') : t('record.pause')}</span>
                <Keycaps keys={acceleratorKeycaps(b.togglePause, platform, space)} />
              </button>
            </div>
          </div>
          <div className="transport-keys faint">
            {t('record.startKeyHint')} <Keycaps keys={acceleratorKeycaps(b.toggleRecord, platform, space)} />
            {settings.sessions.length > 1 && <span> · {t('record.keysTargetSelected')}</span>}
          </div>
          <InfoStrip cfg={cfg} rt={rt} />
        </section>
        <aside className="side-col">
          <div className="card card-pad">
            <div className="card-head">
              <h2>{t('record.levels')}</h2>
              {live ? <span className="badge">{t('record.live')}</span> : null}
            </div>
            <LevelMeters sessionId={selectedId} mic={cfg.source !== 'system'} system={cfg.source !== 'mic'} active={live} />
          </div>
          <SourceCard cfg={cfg} rt={rt} caps={caps} />
          <OutputCard cfg={cfg} rt={rt} />
          <ScheduleCard />
        </aside>
      </div>
    </div>
  )
}

function DeviceLostPanel({ sessionId, lost }: { sessionId: string; lost: 'mic' | 'system' }) {
  const t = useT()
  const [device, setDevice] = useState<string>('')
  const inputs = useDevicesList(lost)
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

function useDevicesList(kind: 'mic' | 'system'): MediaDeviceInfo[] {
  const inputs = useDevices((s) => s.inputs)
  const monitors = useDevices((s) => s.monitors)
  return kind === 'mic' ? inputs : monitors
}
