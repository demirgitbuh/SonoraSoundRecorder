import { memo, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { RecordCard } from '../../../shared/settings'
import { FORMAT_INFO, resolveEncoding, sanitizeEncoding } from '../../../shared/formats'
import { AUDIO_FORMATS } from '../../../shared/types'
import type { AudioFormat, CustomEncoding, OutputMode, PlatformCapabilities, QualityProfile, Schedule, SessionConfig, SourceKind } from '../../../shared/types'
import { invoke } from '../api'
import { engine } from '../audio/engine'
import { Button, Field, IconButton, Modal, Notice, Segmented, Select, Slider, Switch } from '../components/controls'
import { CalendarClock, ChevronDown, ICON_STROKE, Mic, MonitorSpeaker, Plus, Sparkles, Trash2 } from '../components/icons'
import { OkPill, WarnPill } from '../components/status'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useDevices } from '../stores/devices'
import { useEngine } from '../stores/engine'
import type { CaptureInfo, ProcessingState, SessionRuntime } from '../stores/engine'
import { formatDateTime, formatKHz, toLocalInput } from '../util/format'

async function unlockDeviceLabels(): Promise<void> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
  } catch {
    // The permission UI explains the denial.
  }
  await useDevices.getState().refresh()
}

function processingText(t: ReturnType<typeof useT>, p: ProcessingState): { ok: boolean; text: string } {
  if (!p.requested) return { ok: true, text: t('processing.off') }
  if (!p.supported) return { ok: false, text: t('processing.unsupported') }
  if (p.applied === true) return { ok: true, text: t('processing.active') }
  return { ok: false, text: t('processing.notApplied') }
}

/**
 * Card of the record page's side panel. The heading toggles the card; a collapsed card unmounts
 * its content, so hidden meters and lists cost nothing. The state is kept in the settings.
 */
export function SideCard({ id, title, badge, actions, children }: { id: RecordCard; title: string; badge?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const collapsed = useApp((s) => s.settings?.layout.collapsedCards.includes(id) ?? false)
  const toggle = (): void => {
    const list = useApp.getState().settings?.layout.collapsedCards ?? []
    const next = list.includes(id) ? list.filter((c) => c !== id) : [...list, id]
    void useApp.getState().updateSettings({ layout: { collapsedCards: next } })
  }
  const bodyId = `side-card-${id}`
  return (
    <section className={`card side-card ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="side-card-head">
        <h2 className="side-card-title">
          <button type="button" className="side-card-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>
            <span className="truncate">{title}</span>
            {badge}
            <ChevronDown className="side-chevron" size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>
        </h2>
        {actions && !collapsed ? <div className="side-card-actions">{actions}</div> : null}
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            id={bodyId}
            className="side-card-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="side-card-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

export const SourceCard = memo(function SourceCard({
  cfg,
  state,
  capture,
  caps
}: {
  cfg: SessionConfig
  state: SessionRuntime['state']
  capture: CaptureInfo | null
  caps: PlatformCapabilities
}) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const inputs = useDevices((s) => s.inputs)
  const monitors = useDevices((s) => s.monitors)
  const labelsAvailable = useDevices((s) => s.labelsAvailable)
  const locked = state !== 'ready' && state !== 'error'
  const update = (patch: Partial<SessionConfig>): void => void engine.updateSession(cfg.id, patch)
  const sysUnsupported = caps.systemAudio.status === 'unsupported'
  const usesMic = cfg.source !== 'system'
  const usesSystem = cfg.source !== 'mic'

  return (
    <SideCard id="source" title={t('record.source')}>
      <Segmented<SourceKind>
        label={t('record.source')}
        value={cfg.source}
        onChange={(v) => !locked && update({ source: v })}
        options={[
          { value: 'mic', label: t('source.mic'), icon: Mic, disabled: locked },
          { value: 'system', label: t('source.system'), icon: MonitorSpeaker, disabled: locked || sysUnsupported },
          { value: 'both', label: t('source.both'), disabled: locked || sysUnsupported }
        ]}
      />
      {sysUnsupported && <p className="field-desc">{t('platform.systemAudioUnsupported')}</p>}

      <div className="stack" style={{ marginTop: 14 }}>
        {usesMic && (
          <div className="stack" style={{ gap: 6 }}>
            <label className="eyebrow" htmlFor={`mic-${cfg.id}`}>
              {t('record.micDevice')}
            </label>
            <select
              id={`mic-${cfg.id}`}
              className="select"
              disabled={locked}
              value={cfg.micDeviceId ?? ''}
              onChange={(e) => update({ micDeviceId: e.target.value || null })}
            >
              <option value="">{t('devices.systemDefault')}</option>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t('devices.unnamed')}
                </option>
              ))}
              {cfg.micDeviceId && !inputs.some((d) => d.deviceId === cfg.micDeviceId) && (
                <option value={cfg.micDeviceId}>{t('devices.unavailable')}</option>
              )}
            </select>
            {!labelsAvailable && (
              <Button size="sm" variant="ghost" onClick={() => void unlockDeviceLabels()}>
                {t('devices.showNames')}
              </Button>
            )}
            <LevelSlider label={t('record.micLevel')} value={cfg.micLevel} onChange={(v) => update({ micLevel: v })} />
          </div>
        )}
        {usesSystem && (
          <div className="stack" style={{ gap: 6 }}>
            <label className="eyebrow" htmlFor={`sys-${cfg.id}`}>
              {t('record.systemDevice')}
            </label>
            {caps.platform === 'linux' && monitors.length > 0 ? (
              <select
                id={`sys-${cfg.id}`}
                className="select"
                disabled={locked}
                value={cfg.systemDeviceId ?? ''}
                onChange={(e) => update({ systemDeviceId: e.target.value || null })}
              >
                <option value="">{t('devices.loopback')}</option>
                {monitors.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="readonly-value" id={`sys-${cfg.id}`}>
                {t('devices.loopback')}
              </div>
            )}
            <LevelSlider label={t('record.systemLevel')} value={cfg.systemLevel} onChange={(v) => update({ systemLevel: v })} />
            {caps.systemAudio.status === 'needs-permission' && (
              <Notice
                kind="warning"
                action={
                  <Button size="sm" onClick={() => void invoke('permissions:open-settings', 'screen')}>
                    {t('permissions.openSettings')}
                  </Button>
                }
              >
                {t('platform.macScreenPermission')}
              </Notice>
            )}
            {caps.isWayland && !cfg.systemDeviceId && <p className="field-desc">{t('platform.waylandPortal')}</p>}
          </div>
        )}
        {usesMic && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row nowrap">
              <span className="field-label" id={`mon-${cfg.id}`}>
                {t('record.monitor')}
              </span>
              <div className="spacer" />
              <Switch checked={cfg.monitor} label={t('record.monitor')} onChange={(v) => update({ monitor: v })} />
            </div>
            {cfg.monitor && (
              <LevelSlider label={t('record.monitorLevel')} value={cfg.monitorLevel} max={1} onChange={(v) => update({ monitorLevel: v })} />
            )}
            {cfg.monitor && usesSystem && <Notice kind="warning">{t('record.monitorFeedback')}</Notice>}
          </div>
        )}
      </div>

      {capture && (
        <div className="capture-info">
          {capture.mic && (
            <div className="capture-line">
              <Mic size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <div className="stack" style={{ gap: 2 }}>
                <span className="truncate">{capture.mic.label || t('devices.systemDefault')}</span>
                <span className="faint">
                  {t('capture.nativeFormat', {
                    rate: capture.mic.nativeSampleRate ? formatKHz(capture.mic.nativeSampleRate, locale) : t('capture.unknown'),
                    channels: capture.mic.nativeChannels ?? '?'
                  })}
                  {capture.mic.nativeSampleRate && capture.mic.nativeSampleRate !== capture.sampleRate
                    ? ` · ${t('capture.resampled', { rate: formatKHz(capture.sampleRate, locale) })}`
                    : ''}
                  {capture.mic.nativeChannels === 1 && capture.channels === 2 ? ` · ${t('capture.monoDuplicated')}` : ''}
                </span>
              </div>
              {capture.mic.verified ? <OkPill>{t('capture.verified')}</OkPill> : <WarnPill>{t('capture.waiting')}</WarnPill>}
            </div>
          )}
          {capture.system && (
            <div className="capture-line">
              <MonitorSpeaker size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <div className="stack" style={{ gap: 2 }}>
                <span className="truncate">{capture.system.method === 'monitor-device' ? capture.system.label : t('devices.loopback')}</span>
                <span className="faint">
                  {capture.system.nativeSampleRate
                    ? t('capture.nativeFormat', { rate: formatKHz(capture.system.nativeSampleRate, locale), channels: capture.system.nativeChannels ?? '?' })
                    : t('capture.systemStream')}
                </span>
              </div>
              {capture.system.verified ? <OkPill>{t('capture.verified')}</OkPill> : <WarnPill>{t('capture.waiting')}</WarnPill>}
            </div>
          )}
          {capture.processing && (
            <div className="capture-line">
              <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <div className="processing-list">
                {(['noiseSuppression', 'echoCancellation', 'autoGainControl'] as const).map((k) => {
                  const p = processingText(t, capture.processing![k])
                  return (
                    <span key={k} className={p.ok ? '' : 'warn-text'}>
                      {t(`processing.${k}` as MessageKey)}: {p.text}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </SideCard>
  )
})

function LevelSlider({ label, value, onChange, max = 2 }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  const pct = Math.round(value * 100)
  return (
    <div className="level-slider">
      <span className="faint truncate">{label}</span>
      <Slider label={label} value={value} min={0} max={max} step={0.01} valueText={`${pct}%`} onChange={onChange} />
      <span className="tnum level-value">{pct}%</span>
    </div>
  )
}

const PROFILE_KEYS: Record<QualityProfile, MessageKey> = {
  high: 'quality.high',
  standard: 'quality.standard',
  compact: 'quality.compact',
  custom: 'quality.custom'
}

export function encodingSummary(t: ReturnType<typeof useT>, format: AudioFormat, profile: QualityProfile, custom: CustomEncoding, locale: Parameters<typeof formatKHz>[1]): string {
  const e = resolveEncoding(format, profile, custom)
  const info = FORMAT_INFO[format]
  const q = info.lossless ? (e.bitDepth === 32 ? '32-bit float' : `${e.bitDepth}-bit`) : `${e.bitrateKbps} kbps`
  return `${info.label} · ${formatKHz(e.sampleRate, locale)} · ${e.channels === 1 ? t('audio.mono') : t('audio.stereo')} · ${q}`
}

/** Format and quality editor shared by sessions, defaults in settings and exports. */
export function FormatEditor({
  format,
  profile,
  custom,
  onChange
}: {
  format: AudioFormat
  profile: QualityProfile
  custom: CustomEncoding
  onChange: (v: { format: AudioFormat; profile: QualityProfile; custom: CustomEncoding }) => void
}) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const info = FORMAT_INFO[format]
  const effective = resolveEncoding(format, profile, custom)
  const setCustom = (patch: Partial<CustomEncoding>): void => {
    const next = sanitizeEncoding({ format, ...custom, ...patch })
    onChange({ format, profile: 'custom', custom: { sampleRate: next.sampleRate, channels: next.channels, bitDepth: next.bitDepth, bitrateKbps: next.bitrateKbps, flacCompression: next.flacCompression } })
  }
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">{t('format.format')}</span>
        <Segmented<AudioFormat>
          label={t('format.format')}
          value={format}
          onChange={(v) => onChange({ format: v, profile, custom })}
          options={AUDIO_FORMATS.map((f) => ({ value: f, label: FORMAT_INFO[f].label }))}
        />
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">{t('format.quality')}</span>
        <Segmented<QualityProfile>
          label={t('format.quality')}
          value={profile}
          onChange={(v) => onChange({ format, profile: v, custom: v === 'custom' ? { ...effective } : custom })}
          options={(['high', 'standard', 'compact', 'custom'] as const).map((p) => ({ value: p, label: t(PROFILE_KEYS[p]) }))}
        />
      </div>
      <AnimatePresence initial={false}>
        {profile === 'custom' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="format-grid">
              <label className="stack" style={{ gap: 4 }}>
                <span className="eyebrow">{t('format.sampleRate')}</span>
                <select className="select" value={effective.sampleRate} onChange={(e) => setCustom({ sampleRate: Number(e.target.value) })}>
                  {info.sampleRates.map((r) => (
                    <option key={r} value={r}>
                      {formatKHz(r, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="stack" style={{ gap: 4 }}>
                <span className="eyebrow">{t('format.channels')}</span>
                <select className="select" value={effective.channels} onChange={(e) => setCustom({ channels: Number(e.target.value) === 1 ? 1 : 2 })}>
                  <option value={1}>{t('audio.mono')}</option>
                  <option value={2}>{t('audio.stereo')}</option>
                </select>
              </label>
              {info.bitDepths.length > 0 && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="eyebrow">{t('format.bitDepth')}</span>
                  <select className="select" value={effective.bitDepth} onChange={(e) => setCustom({ bitDepth: Number(e.target.value) as 16 | 24 | 32 })}>
                    {info.bitDepths.map((b) => (
                      <option key={b} value={b}>
                        {b === 32 ? t('format.float32') : `${b}-bit`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {info.bitrates.length > 0 && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="eyebrow">{t('format.bitrate')}</span>
                  <select className="select" value={effective.bitrateKbps} onChange={(e) => setCustom({ bitrateKbps: Number(e.target.value) })}>
                    {info.bitrates.map((b) => (
                      <option key={b} value={b}>
                        {b} kbps
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {format === 'flac' && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="eyebrow">{t('format.flacLevel')}</span>
                  <select className="select" value={effective.flacCompression} onChange={(e) => setCustom({ flacCompression: Number(e.target.value) })}>
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="field-desc">
        {encodingSummary(t, format, profile, custom, locale)}
        {format === 'opus' ? ` · ${t('format.opusNote')}` : ''}
      </p>
    </div>
  )
}

export const OutputCard = memo(function OutputCard({ cfg, state, nativeRate }: { cfg: SessionConfig; state: SessionRuntime['state']; nativeRate: number | null }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ format: cfg.format, profile: cfg.qualityProfile, custom: cfg.custom })
  const locked = state !== 'ready' && state !== 'error'
  const native = nativeRate
  const enc = resolveEncoding(cfg.format, cfg.qualityProfile, cfg.custom)
  return (
    <SideCard
      id="output"
      title={t('record.output')}
      actions={
        <Button
          size="sm"
          disabled={locked}
          onClick={() => {
            setDraft({ format: cfg.format, profile: cfg.qualityProfile, custom: cfg.custom })
            setOpen(true)
          }}
        >
          {t('common.change')}
        </Button>
      }
    >
      <p className="output-summary">{encodingSummary(t, cfg.format, cfg.qualityProfile, cfg.custom, locale)}</p>
      <p className="field-desc">{t(PROFILE_KEYS[cfg.qualityProfile])}</p>
      {native && native < enc.sampleRate && <p className="field-desc warn-text">{t('capture.upsampleNote', { device: formatKHz(native, locale), target: formatKHz(enc.sampleRate, locale) })}</p>}
      {cfg.source === 'both' && (
        <div className="stack" style={{ gap: 6, marginTop: 12 }}>
          <span className="eyebrow">{t('record.outputMode')}</span>
          <Segmented<OutputMode>
            label={t('record.outputMode')}
            value={cfg.outputMode}
            onChange={(v) => !locked && void engine.updateSession(cfg.id, { outputMode: v })}
            options={[
              { value: 'combined', label: t('output.combined'), disabled: locked },
              { value: 'separate', label: t('output.separate'), disabled: locked },
              { value: 'both', label: t('output.both'), disabled: locked }
            ]}
          />
        </div>
      )}
      <Modal
        open={open}
        title={t('record.formatTitle', { session: cfg.name })}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                void engine.updateSession(cfg.id, { format: draft.format, qualityProfile: draft.profile, custom: draft.custom })
                setOpen(false)
              }}
            >
              {t('common.apply')}
            </Button>
          </>
        }
      >
        <FormatEditor format={draft.format} profile={draft.profile} custom={draft.custom} onChange={(v) => setDraft(v)} />
      </Modal>
    </SideCard>
  )
})

const SCHEDULE_STATUS: Record<Schedule['status'], { key: MessageKey; cls: string }> = {
  upcoming: { key: 'schedule.upcoming', cls: 'is-busy' },
  running: { key: 'schedule.running', cls: 'is-recording' },
  completed: { key: 'schedule.completed', cls: 'is-success' },
  missed: { key: 'schedule.missed', cls: 'is-warning' },
  failed: { key: 'schedule.failed', cls: 'is-error' },
  cancelled: { key: 'schedule.cancelled', cls: '' }
}

export const ScheduleCard = memo(function ScheduleCard() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const sessions = useApp((s) => s.settings?.sessions ?? [])
  const schedules = useEngine((s) => s.schedules)
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() => [...schedules].sort((a, b) => b.startAt.localeCompare(a.startAt)).slice(0, 6), [schedules])
  const name = (id: string): string => sessions.find((s) => s.id === id)?.name ?? t('schedule.deletedSession')
  const save = (list: Schedule[]): void => void engine.saveSchedules(list)

  return (
    <SideCard
      id="schedule"
      title={t('schedule.title')}
      actions={
        <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>
          {t('schedule.new')}
        </Button>
      }
    >
      {sorted.length === 0 ? (
        <p className="faint">{t('schedule.empty')}</p>
      ) : (
        <ul className="schedule-list">
          <AnimatePresence initial={false}>
            {sorted.map((s) => (
              <motion.li key={s.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                <CalendarClock size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                <div className="stack" style={{ gap: 2, flex: 1 }}>
                  <span className="truncate">
                    {formatDateTime(s.startAt, locale)} → {formatDateTime(s.endAt, locale)}
                  </span>
                  <span className="faint truncate">
                    {name(s.sessionId)}
                    {s.reasonKey ? ` · ${t(s.reasonKey as MessageKey)}` : ''}
                  </span>
                </div>
                <span className={`status ${SCHEDULE_STATUS[s.status].cls}`}>{t(SCHEDULE_STATUS[s.status].key)}</span>
                {s.status === 'upcoming' ? (
                  <IconButton
                    icon={Trash2}
                    small
                    label={t('schedule.cancel')}
                    onClick={() => save(schedules.map((x) => (x.id === s.id ? { ...x, status: 'cancelled' as const } : x)))}
                  />
                ) : s.status !== 'running' ? (
                  <IconButton icon={Trash2} small label={t('schedule.remove')} onClick={() => save(schedules.filter((x) => x.id !== s.id))} />
                ) : null}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <ScheduleDialog open={open} onClose={() => setOpen(false)} />
    </SideCard>
  )
})

export function validateSchedule(
  draft: { sessionId: string; startAt: string; endAt: string },
  existing: Schedule[],
  sessions: SessionConfig[],
  now: number
): { errorKey: string | null; warningKey: string | null } {
  const start = Date.parse(draft.startAt)
  const end = Date.parse(draft.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { errorKey: 'schedule.errorInvalid', warningKey: null }
  if (start <= now + 5000) return { errorKey: 'schedule.errorPast', warningKey: null }
  if (end <= start) return { errorKey: 'schedule.errorOrder', warningKey: null }
  if (end - start < 5000) return { errorKey: 'schedule.errorTooShort', warningKey: null }
  const active = existing.filter((s) => s.status === 'upcoming' || s.status === 'running')
  const overlaps = active.filter((s) => Date.parse(s.startAt) < end && Date.parse(s.endAt) > start)
  if (overlaps.some((s) => s.sessionId === draft.sessionId)) return { errorKey: 'schedule.errorOverlap', warningKey: null }
  const me = sessions.find((s) => s.id === draft.sessionId)
  if (me) {
    const conflicts = overlaps.some((o) => {
      const other = sessions.find((s) => s.id === o.sessionId)
      if (!other) return false
      const sameMic = me.source !== 'system' && other.source !== 'system' && me.micDeviceId === other.micDeviceId
      const bothSystem = me.source !== 'mic' && other.source !== 'mic'
      return sameMic || bothSystem
    })
    if (conflicts) return { errorKey: null, warningKey: 'schedule.warnSharedSource' }
  }
  return { errorKey: null, warningKey: null }
}

function ScheduleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const sessions = useApp((s) => s.settings?.sessions ?? [])
  const selectedId = useEngine((s) => s.selectedId)
  const schedules = useEngine((s) => s.schedules)
  const [sessionId, setSessionId] = useState(selectedId ?? sessions[0]?.id ?? '')
  const [start, setStart] = useState(() => toLocalInput(new Date(Date.now() + 10 * 60000)))
  const [end, setEnd] = useState(() => toLocalInput(new Date(Date.now() + 40 * 60000)))
  const startIso = start ? new Date(start).toISOString() : ''
  const endIso = end ? new Date(end).toISOString() : ''
  const check = validateSchedule({ sessionId, startAt: startIso, endAt: endIso }, schedules, sessions, Date.now())
  const create = (): void => {
    if (check.errorKey) return
    void engine.saveSchedules([
      ...schedules,
      { id: crypto.randomUUID(), sessionId, startAt: startIso, endAt: endIso, status: 'upcoming', reasonKey: null }
    ])
    onClose()
  }
  return (
    <Modal
      open={open}
      title={t('schedule.new')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!!check.errorKey} onClick={create}>
            {t('schedule.create')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('schedule.session')} stacked>
          <Select label={t('schedule.session')} value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="format-grid">
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">{t('schedule.start')}</span>
            <input type="datetime-local" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">{t('schedule.end')}</span>
            <input type="datetime-local" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {check.errorKey && <Notice kind="error">{t(check.errorKey as MessageKey)}</Notice>}
        {check.warningKey && <Notice kind="warning">{t(check.warningKey as MessageKey)}</Notice>}
        <Notice>{t('schedule.onlyWhileOpenLong')}</Notice>
      </div>
    </Modal>
  )
}

export function PendingRunsBanner() {
  const t = useT()
  const runs = useApp((s) => s.pendingRuns)
  const sessions = useEngine((s) => s.sessions)
  const setRecovery = useApp((s) => s.setRecoveryDialog)
  // Runs currently open as a session preview are not "pending" from the user's point of view.
  const inPreview = new Set(Object.values(sessions).map((s) => s.previewRunId).filter(Boolean))
  const list = runs.filter((r) => !inPreview.has(r.runId))
  if (list.length === 0) return null
  const crashed = list.filter((r) => r.kind === 'crashed').length
  return (
    <Notice
      kind="warning"
      title={crashed > 0 ? t('recovery.bannerCrashed', { count: crashed }) : t('recovery.bannerUnsaved', { count: list.length })}
      action={
        <Button size="sm" onClick={() => setRecovery(true)}>
          {t('recovery.review')}
        </Button>
      }
    />
  )
}
