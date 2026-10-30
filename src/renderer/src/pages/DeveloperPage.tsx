import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CHUNK_FRAME_SIZES, DEV_LOG_LEVELS, LATENCY_HINTS, formatCommand, parseFeatureList, whisperExtraArgs } from '../../../shared/developer'
import type {
  BinaryInfo,
  BinaryKind,
  BootFlagsState,
  ChunkFrames,
  DataFileName,
  DevDiagnostics,
  DevLogLevel,
  DevMetrics,
  DevPathId,
  DevStorageEntry,
  DeveloperSettings,
  LatencyHint,
  LogEntry,
  ProbeOutput
} from '../../../shared/developer'
import type { DeepPartial } from '../../../shared/settings'
import { acceleratorKeycaps, eventToAccelerator, normalizeAccelerator } from '../../../shared/shortcuts'
import { SHORTCUT_ACTIONS } from '../../../shared/types'
import type { RunState, ShortcutAction } from '../../../shared/types'
import { AppError, invoke, on, platform } from '../api'
import { engine } from '../audio/engine'
import type { SessionDiagnostics } from '../audio/session-controller'
import { Button, Field, IconButton, Keycaps, Modal, Notice, Segmented, Select, Slider, Switch } from '../components/controls'
import {
  Activity,
  AudioLines,
  Bomb,
  Braces,
  Copy,
  Cpu,
  Database,
  FlaskConical,
  FolderOpen,
  HardDrive,
  ICON_STROKE,
  Keyboard,
  Monitor,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Terminal,
  Trash2,
  Unplug,
  Wrench,
  Zap
} from '../components/icons'
import type { LucideIcon } from '../components/icons'
import { OkPill, StatePill, WarnPill } from '../components/status'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useEngine } from '../stores/engine'
import { useLibrary } from '../stores/library'
import { formatBytes, formatClock } from '../util/format'
import { reportBulk } from './bulk'

// ----------------------------------------------------------------------------- helpers

function toastError(err: unknown): void {
  const e = err instanceof AppError ? err : null
  useApp.getState().toast('error', e?.key ?? 'errors.unexpected', {
    detail: e?.detail ?? (e ? undefined : err instanceof Error ? err.message : undefined)
  })
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    useApp.getState().toast('success', 'dev.copied')
  } catch (err) {
    toastError(err)
  }
}

function clockTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** Current developer settings and a patch function. */
function useDev(): { d: DeveloperSettings; update: (patch: DeepPartial<DeveloperSettings>) => void } {
  const d = useApp((s) => s.settings!.developer)
  const updateSettings = useApp((s) => s.updateSettings)
  const update = useCallback(
    (patch: DeepPartial<DeveloperSettings>) => {
      void updateSettings({ developer: patch }).catch(toastError)
    },
    [updateSettings]
  )
  return { d, update }
}

/** Calls `fn` now and then every `ms` milliseconds while mounted. */
function usePoll(fn: () => Promise<void> | void, ms: number): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      if (alive) void Promise.resolve(ref.current()).catch(() => undefined)
    }
    tick()
    const id = window.setInterval(tick, ms)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [ms])
}

function DevCard({
  title,
  icon: Icon,
  description,
  actions,
  children
}: {
  title: string
  icon: LucideIcon
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card dev-card">
      <header className="dev-card-head">
        <span className="dev-card-icon" aria-hidden="true">
          <Icon size={16} strokeWidth={ICON_STROKE} />
        </span>
        <div className="dev-card-title">
          <h2>{title}</h2>
          {description && <p className="field-desc">{description}</p>}
        </div>
        {actions && <div className="dev-card-actions">{actions}</div>}
      </header>
      <div className="dev-card-body">{children}</div>
    </section>
  )
}

function KeyValues({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="dev-kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Number field that commits on blur or Enter and keeps the value inside its range. */
function NumberInput({
  value,
  min,
  max,
  step = 1,
  label,
  onCommit
}: {
  value: number
  min: number
  max: number
  step?: number
  label: string
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Number(text.replace(',', '.'))
    if (text.trim() === '' || !Number.isFinite(n)) {
      setText(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, step >= 1 ? Math.round(n) : n))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <input
      className="input dev-number tnum"
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/** Text field (or area) that commits on blur, or on Enter for single lines. */
function CommitText({
  value,
  label,
  placeholder,
  multiline,
  maxLength,
  onCommit
}: {
  value: string
  label: string
  placeholder?: string
  multiline?: boolean
  maxLength: number
  onCommit: (v: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = (): void => {
    if (text !== value) onCommit(text)
  }
  return multiline ? (
    <textarea
      className="textarea dev-textarea"
      value={text}
      rows={3}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
    />
  ) : (
    <input
      className="input dev-mono"
      value={text}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/** Slider whose value is committed shortly after the user stops moving it. */
function RangeField({
  label,
  description,
  value,
  min,
  max,
  step,
  format,
  onCommit
}: {
  label: string
  description?: ReactNode
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onCommit: (v: number) => void
}) {
  const [v, setV] = useState(value)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useEffect(() => setV(value), [value])
  useEffect(() => {
    if (v === value) return
    const timer = window.setTimeout(() => commitRef.current(v), 280)
    return () => window.clearTimeout(timer)
  }, [v, value])
  return (
    <Field label={label} description={description}>
      <div className="dev-range">
        <Slider value={v} min={min} max={max} step={step} label={label} valueText={format(v)} onChange={setV} />
        <span className="dev-range-value tnum">{format(v)}</span>
      </div>
    </Field>
  )
}

function SwitchField({ label, description, checked, onChange }: { label: string; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field label={label} description={description}>
      <Switch checked={checked} label={label} onChange={onChange} />
    </Field>
  )
}

function FlagChips({ names, empty }: { names: string[]; empty: string }) {
  if (names.length === 0) return <span className="faint">{empty}</span>
  return (
    <span className="dev-chips">
      {names.map((n) => (
        <code key={n} className="dev-chip">
          {n}
        </code>
      ))}
    </span>
  )
}

const BINARY_NAME: Record<BinaryKind, string> = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', whisper: 'whisper-cli' }

function BinaryList({ items, onChoose, onReset }: { items: BinaryInfo[]; onChoose?: (k: BinaryKind) => void; onReset?: (k: BinaryKind) => void }) {
  const t = useT()
  return (
    <ul className="dev-binaries">
      {items.map((b) => (
        <li key={b.kind}>
          <div className="dev-binary-head">
            <strong className="dev-mono">{BINARY_NAME[b.kind]}</strong>
            <span className={`badge ${b.source === 'custom' ? 'warn' : ''}`}>{b.source === 'custom' ? t('dev.binaries.custom') : t('dev.binaries.bundled')}</span>
            {b.available ? <OkPill>{t('dev.binaries.ok')}</OkPill> : <WarnPill>{t('dev.binaries.missing')}</WarnPill>}
            {b.version && <code className="code-chip">{b.version}</code>}
            <div className="spacer" />
            {onChoose && (
              <Button size="sm" onClick={() => onChoose(b.kind)}>
                {t('dev.binaries.choose')}
              </Button>
            )}
            {onReset && (
              <Button size="sm" variant="ghost" disabled={b.source === 'bundled'} onClick={() => onReset(b.kind)}>
                {t('dev.binaries.useBundled')}
              </Button>
            )}
          </div>
          <code className="code-chip truncate dev-path" title={b.path}>
            {b.path}
          </code>
        </li>
      ))}
    </ul>
  )
}

// ----------------------------------------------------------------------------- overview

const PATH_LABEL: Record<string, MessageKey> = {
  data: 'dev.path.data',
  logs: 'dev.path.logs',
  sessions: 'dev.path.sessions',
  temp: 'dev.path.temp',
  recordings: 'dev.path.recordings',
  binaries: 'dev.path.binaries',
  executable: 'dev.path.executable',
  resources: 'dev.path.resources'
}
const OPENABLE_PATHS = new Set<string>(['data', 'logs', 'sessions', 'temp'])

function OverviewPanel() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const [diag, setDiag] = useState<DevDiagnostics | null>(null)
  const [metrics, setMetrics] = useState<DevMetrics | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setDiag(await invoke('dev:diagnostics'))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  usePoll(async () => setMetrics(await invoke('dev:metrics')), 2000)

  if (!diag) return <p className="muted dev-loading">{t('dev.loading')}</p>
  const procs = metrics?.processes ?? []
  const maxMem = Math.max(1, ...procs.map((p) => p.memoryKB))
  const totalMem = procs.reduce((n, p) => n + p.memoryKB, 0)
  const totalCpu = procs.reduce((n, p) => n + p.cpuPercent, 0)
  const uptime = metrics?.uptimeSec ?? diag.app.uptimeSec
  const runtimeRows: Array<[string, ReactNode]> = [
    [t('dev.overview.version'), `${diag.app.version}${diag.app.packaged ? '' : ' (dev)'}`],
    ['Electron', diag.versions.electron],
    ['Chromium', diag.versions.chrome],
    ['Node.js', diag.versions.node],
    ['V8', diag.versions.v8],
    [t('dev.overview.os'), `${diag.os.platform} ${diag.os.release} · ${diag.os.arch}${diag.os.wayland ? ' · Wayland' : ''}`],
    [t('dev.overview.installKind'), t(`update.kindLabel.${diag.app.installKind}` as MessageKey)],
    [t('dev.overview.cpu'), `${diag.os.cpuModel || '—'} × ${diag.os.cpus}`],
    [t('dev.overview.memory'), formatBytes(diag.os.totalMemoryKB * 1024, locale)],
    [t('dev.overview.locale'), diag.app.locale],
    [t('dev.overview.uptime'), formatClock(uptime * 1000, true)],
    [t('dev.overview.runs'), t('dev.overview.runsValue', { active: diag.runs.active, pending: diag.runs.pending, jobs: diag.transcriptionJobs })]
  ]

  return (
    <div className="dev-grid">
      <DevCard
        title={t('dev.overview.runtime')}
        icon={Activity}
        actions={
          <>
            <Button size="sm" icon={RefreshCw} disabled={busy} onClick={() => void refresh()}>
              {t('dev.refresh')}
            </Button>
            <Button
              size="sm"
              icon={Copy}
              onClick={() =>
                void copyText(JSON.stringify({ generatedAt: new Date().toISOString(), diagnostics: diag, metrics, engine: engine.diagnostics() }, null, 2))
              }
            >
              {t('dev.overview.copy')}
            </Button>
          </>
        }
      >
        <KeyValues rows={runtimeRows} />
      </DevCard>

      <DevCard title={t('dev.overview.processes')} icon={Cpu}>
        <div className="dev-table-wrap">
          <table className="dev-table">
            <thead>
              <tr>
                <th>{t('dev.overview.procType')}</th>
                <th>PID</th>
                <th className="num">CPU</th>
                <th className="num">{t('dev.overview.procMemory')}</th>
              </tr>
            </thead>
            <tbody>
              {procs.map((p) => (
                <tr key={p.pid}>
                  <td className="truncate">{p.name ? `${p.type} · ${p.name}` : p.type}</td>
                  <td className="tnum">{p.pid}</td>
                  <td className="num tnum">{p.cpuPercent.toFixed(1)} %</td>
                  <td className="num tnum">
                    <span className="dev-bar" style={{ '--w': `${(p.memoryKB / maxMem) * 100}%` } as CSSProperties} aria-hidden="true" />
                    {formatBytes(p.memoryKB * 1024, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t('dev.overview.total')}</td>
                <td />
                <td className="num tnum">{totalCpu.toFixed(1)} %</td>
                <td className="num tnum">{formatBytes(totalMem * 1024, locale)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {metrics?.systemMemory && (
          <p className="field-desc">
            {t('dev.overview.systemMemory', {
              free: formatBytes(metrics.systemMemory.freeKB * 1024, locale),
              total: formatBytes(metrics.systemMemory.totalKB * 1024, locale)
            })}
          </p>
        )}
      </DevCard>

      <DevCard title={t('dev.overview.binaries')} icon={Terminal}>
        <BinaryList items={diag.binaries} />
      </DevCard>

      <DevCard title={t('dev.overview.paths')} icon={HardDrive}>
        <ul className="dev-paths">
          {diag.paths.map((p) => (
            <li key={p.id}>
              <span className="dev-path-label">{t(PATH_LABEL[p.id] ?? 'dev.path.data')}</span>
              <code className="code-chip truncate dev-path" title={p.path}>
                {p.path || '—'}
              </code>
              {OPENABLE_PATHS.has(p.id) && (
                <IconButton icon={FolderOpen} small label={t('dev.openFolder')} onClick={() => void invoke('dev:open-path', p.id as DevPathId).catch(toastError)} />
              )}
            </li>
          ))}
        </ul>
      </DevCard>

      <DevCard title={t('dev.overview.chromium')} icon={Zap}>
        {diag.boot.restartRequired && <Notice kind="warning">{t('dev.chromium.restartRequired')}</Notice>}
        <KeyValues
          rows={[
            [t('dev.chromium.hardwareAcceleration'), diag.boot.applied.hardwareAcceleration ? t('dev.on') : t('dev.off')],
            ['--enable-features', <FlagChips key="e" names={diag.boot.applied.enableFeatures} empty={t('dev.none')} />],
            ['--disable-features', <FlagChips key="d" names={diag.boot.applied.disableFeatures} empty={t('dev.none')} />]
          ]}
        />
        <details className="dev-details">
          <summary>{t('dev.overview.gpu')}</summary>
          <ul className="dev-gpu">
            {Object.entries(diag.gpu).map(([k, v]) => (
              <li key={k}>
                <span className="dev-mono">{k}</span>
                <span className={`badge ${/enabled/.test(v) ? '' : 'warn'}`}>{v}</span>
              </li>
            ))}
          </ul>
        </details>
      </DevCard>
    </div>
  )
}

// ----------------------------------------------------------------------------- logs

const MAX_LOG_ENTRIES = 3000
const LEVEL_LABEL: Record<DevLogLevel, MessageKey> = {
  debug: 'dev.logs.level.debug',
  info: 'dev.logs.level.info',
  warn: 'dev.logs.level.warn',
  error: 'dev.logs.level.error'
}

function LogsPanel() {
  const t = useT()
  const { d, update } = useDev()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  const pending = useRef<LogEntry[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [level, setLevel] = useState<'all' | DevLogLevel>('all')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('')
  const [clearedAt, setClearedAt] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    let alive = true
    void invoke('dev:logs')
      .then((list) => {
        if (!alive) return
        const seen = new Set(list.map((e) => e.seq))
        setEntries((prev) => [...list, ...prev.filter((e) => !seen.has(e.seq))].slice(-MAX_LOG_ENTRIES))
      })
      .catch(toastError)
    const off = on('dev:log', (entry) => {
      if (pausedRef.current) {
        pending.current.push(entry)
        setPendingCount(pending.current.length)
        return
      }
      setEntries((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const togglePause = (): void => {
    const next = !paused
    pausedRef.current = next
    setPaused(next)
    if (!next && pending.current.length > 0) {
      const add = pending.current
      pending.current = []
      setPendingCount(0)
      setEntries((prev) => [...prev, ...add].slice(-MAX_LOG_ENTRIES))
    }
  }

  const scopes = useMemo(() => [...new Set(entries.map((e) => e.scope))].sort(), [entries])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries
      .filter(
        (e) =>
          e.seq > clearedAt &&
          (level === 'all' || e.level === level) &&
          (!scope || e.scope === scope) &&
          (!q || e.message.toLowerCase().includes(q) || e.scope.toLowerCase().includes(q))
      )
      .slice(-800)
  }, [entries, clearedAt, level, scope, query])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [visible])

  const lastSeq = entries.length > 0 ? entries[entries.length - 1]!.seq : 0

  return (
    <div className="dev-stack">
      <DevCard title={t('dev.logs.settings')} icon={ScrollText}>
        <Field label={t('dev.logs.minLevel')}>
          <Select label={t('dev.logs.minLevel')} value={d.logging.level} onChange={(e) => update({ logging: { level: e.target.value as DevLogLevel } })}>
            {DEV_LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(LEVEL_LABEL[l])}
              </option>
            ))}
          </Select>
        </Field>
        <SwitchField label={t('dev.logs.ipcTrace')} checked={d.logging.ipcTrace} onChange={(v) => update({ logging: { ipcTrace: v } })} />
        <SwitchField
          label={t('dev.logs.commandLines')}
          checked={d.logging.commandLines}
          onChange={(v) => update({ logging: { commandLines: v } })}
        />
      </DevCard>

      <DevCard
        title={t('dev.logs.live')}
        icon={Activity}
        actions={
          <>
            <Button size="sm" icon={paused ? Play : Pause} onClick={togglePause} aria-pressed={paused}>
              {paused ? (pendingCount > 0 ? t('dev.logs.resumeCount', { count: pendingCount }) : t('dev.logs.resume')) : t('dev.logs.pause')}
            </Button>
            <Button size="sm" icon={Trash2} variant="ghost" onClick={() => setClearedAt(lastSeq)}>
              {t('dev.logs.clear')}
            </Button>
            <Button
              size="sm"
              icon={Copy}
              variant="ghost"
              disabled={visible.length === 0}
              onClick={() => void copyText(visible.map((e) => `${e.time} [${e.level.toUpperCase()}] [${e.scope}] ${e.message}`).join('\n'))}
            >
              {t('dev.logs.copy')}
            </Button>
            <IconButton icon={FolderOpen} small label={t('dev.openFolder')} onClick={() => void invoke('dev:open-path', 'logs').catch(toastError)} />
          </>
        }
      >
        <div className="dev-log-toolbar">
          <Segmented
            value={level}
            label={t('dev.logs.filterLevel')}
            options={[
              { value: 'all' as const, label: t('dev.logs.all') },
              ...DEV_LOG_LEVELS.map((l) => ({ value: l, label: l.toUpperCase() }))
            ]}
            onChange={setLevel}
          />
          <Select label={t('dev.logs.scope')} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">{t('dev.logs.allScopes')}</option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <input className="input dev-log-search" value={query} placeholder={t('dev.logs.search')} aria-label={t('dev.logs.search')} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div
          ref={listRef}
          className="dev-log"
          role="log"
          aria-live="off"
          aria-label={t('dev.logs.live')}
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          {visible.length === 0 ? (
            <p className="faint dev-log-empty">{t('dev.logs.empty')}</p>
          ) : (
            visible.map((e) => (
              <div key={e.seq} className={`dev-log-row lv-${e.level}`}>
                <span className="dev-log-time tnum">{clockTime(e.time)}</span>
                <span className="dev-log-level">{e.level.toUpperCase()}</span>
                <span className="dev-log-scope">{e.scope}</span>
                <span className="dev-log-msg">{e.message}</span>
              </div>
            ))
          )}
        </div>
        <p className="field-desc">{t('dev.logs.footer', { shown: visible.length, total: entries.length })}</p>
      </DevCard>
    </div>
  )
}

// ----------------------------------------------------------------------------- audio engine

const LATENCY_LABEL: Record<LatencyHint, MessageKey> = {
  interactive: 'dev.audio.latency.interactive',
  balanced: 'dev.audio.latency.balanced',
  playback: 'dev.audio.latency.playback'
}

function ms(v: number): string {
  return `${v} ms`
}

function AudioPanel() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const sessions = useApp((s) => s.settings!.sessions)
  const recording = useEngine((s) => Object.values(s.sessions).some((x) => x.state === 'recording' || x.state === 'paused'))
  const { d, update } = useDev()
  const a = d.audio
  const [diags, setDiags] = useState<SessionDiagnostics[]>([])
  usePoll(() => setDiags(engine.diagnostics()), 500)
  const simulate = (which: 'mic' | 'system'): void => {
    if (!engine.simulateSourceLoss(which)) useApp.getState().toast('info', 'dev.audio.simulateUnavailable')
  }

  return (
    <div className="dev-stack">
      <Notice kind="info">{t('dev.audio.appliesNext')}</Notice>
      <div className="dev-grid">
        <DevCard title={t('dev.audio.graph')} icon={AudioLines}>
          <Field label={t('dev.audio.latencyLabel')} stacked>
            <Segmented
              value={a.latencyHint}
              label={t('dev.audio.latencyLabel')}
              options={LATENCY_HINTS.map((h) => ({ value: h, label: t(LATENCY_LABEL[h]) }))}
              onChange={(v) => update({ audio: { latencyHint: v } })}
            />
          </Field>
          <Field label={t('dev.audio.chunk')}>
            <Select label={t('dev.audio.chunk')} value={a.chunkFrames} onChange={(e) => update({ audio: { chunkFrames: Number(e.target.value) as ChunkFrames } })}>
              {CHUNK_FRAME_SIZES.map((n) => (
                <option key={n} value={n}>
                  {t('dev.audio.chunkOption', { frames: n, ms: (n / 48).toFixed(1) })}
                </option>
              ))}
            </Select>
          </Field>
          <RangeField
            label={t('dev.audio.meterRate')}
            value={a.meterHz}
            min={10}
            max={60}
            step={1}
            format={(v) => `${v} Hz`}
            onCommit={(v) => update({ audio: { meterHz: v } })}
          />
          <RangeField
            label={t('dev.audio.clip')}
            value={a.clipThresholdDb}
            min={-12}
            max={0}
            step={0.01}
            format={(v) => `${v.toFixed(2)} dBFS`}
            onCommit={(v) => update({ audio: { clipThresholdDb: Math.round(v * 100) / 100 } })}
          />
        </DevCard>

        <DevCard title={t('dev.audio.delivery')} icon={Database}>
          <RangeField
            label={t('dev.audio.sendInterval')}
            value={a.sendIntervalMs}
            min={50}
            max={2000}
            step={50}
            format={ms}
            onCommit={(v) => update({ audio: { sendIntervalMs: v } })}
          />
          <RangeField
            label={t('dev.audio.sync')}
            value={d.storage.syncIntervalMs}
            min={250}
            max={10000}
            step={250}
            format={ms}
            onCommit={(v) => update({ storage: { syncIntervalMs: v } })}
          />
          <RangeField
            label={t('dev.audio.dataTimeout')}
            value={a.dataTimeoutMs}
            min={1000}
            max={30000}
            step={500}
            format={(v) => `${(v / 1000).toFixed(1)} s`}
            onCommit={(v) => update({ audio: { dataTimeoutMs: v } })}
          />
        </DevCard>
      </div>

      <DevCard title={t('dev.audio.live')} icon={Activity}>
        <div className="dev-engine-list">
          {diags.map((g) => {
            const name = sessions.find((s) => s.id === g.id)?.name ?? g.id
            const rate = g.context?.sampleRate ?? 0
            return (
              <div key={g.id} className="dev-engine">
                <div className="dev-engine-head">
                  <strong className="truncate">{name}</strong>
                  <StatePill state={g.state as RunState} />
                  {g.testMode && <span className="badge">{t('dev.audio.inputTest')}</span>}
                </div>
                <KeyValues
                  rows={[
                    [
                      t('dev.audio.context'),
                      g.context ? `${g.context.state} · ${g.context.sampleRate} Hz` : t('dev.audio.contextClosed')
                    ],
                    [
                      t('dev.audio.latencies'),
                      g.context
                        ? `${g.context.baseLatency !== null ? (g.context.baseLatency * 1000).toFixed(1) : '—'} / ${g.context.outputLatency !== null ? (g.context.outputLatency * 1000).toFixed(1) : '—'} ms`
                        : '—'
                    ],
                    [t('dev.audio.latencyLabel'), g.latencyHint ?? '—'],
                    [t('dev.audio.chunk'), g.chunkFrames ? `${g.chunkFrames}${rate ? ` · ${((g.chunkFrames / rate) * 1000).toFixed(1)} ms` : ''}` : '—'],
                    [t('dev.audio.tracks'), g.tracks.length > 0 ? g.tracks.join(', ') : '—'],
                    [t('dev.audio.frames'), rate ? `${g.framesCaptured} · ${formatClock((g.framesCaptured / rate) * 1000, true)}` : String(g.framesCaptured)],
                    [t('dev.audio.sent'), t('dev.audio.sentValue', { size: formatBytes(g.sentBytes, locale), count: g.sentMessages })],
                    [t('dev.audio.lastSent'), g.lastSentAt ? t('dev.audio.ago', { ms: Math.max(0, Date.now() - g.lastSentAt) }) : '—'],
                    [t('dev.audio.sources'), [g.sources.mic, g.sources.system].filter(Boolean).join(' + ') || '—'],
                    [t('dev.audio.runId'), g.runId ? <code className="dev-mono">{g.runId}</code> : '—']
                  ]}
                />
              </div>
            )
          })}
        </div>
      </DevCard>

      <DevCard title={t('dev.audio.faults')} icon={Unplug}>
        <div className="row">
          <Button size="sm" icon={Unplug} disabled={!recording} onClick={() => simulate('mic')}>
            {t('dev.audio.simulateMic')}
          </Button>
          <Button size="sm" icon={Unplug} disabled={!recording} onClick={() => simulate('system')}>
            {t('dev.audio.simulateSystem')}
          </Button>
        </div>
      </DevCard>
    </div>
  )
}

// ----------------------------------------------------------------------------- ffmpeg & whisper

function ProcessingPanel() {
  const t = useT()
  const { d, update } = useDev()
  const transcription = useApp((s) => s.settings!.transcription)
  const allRecordings = useLibrary((s) => s.recordings)
  const recordings = useMemo(() => allRecordings.filter((r) => !r.trash && !r.missing).slice(0, 500), [allRecordings])
  const [binaries, setBinaries] = useState<BinaryInfo[] | null>(null)
  const [probeId, setProbeId] = useState('')
  const [probe, setProbe] = useState<ProbeOutput | null>(null)
  const [probing, setProbing] = useState(false)
  const w = d.whisper

  useEffect(() => {
    void invoke('dev:diagnostics')
      .then((dg) => setBinaries(dg.binaries))
      .catch(toastError)
  }, [])

  const setBinary = async (kind: BinaryKind, choose: boolean): Promise<void> => {
    try {
      const info = await invoke('dev:set-binary', kind, choose)
      if (!info) return
      setBinaries((list) => (list ?? []).map((b) => (b.kind === kind ? info : b)))
      useApp.getState().toast('success', choose ? 'dev.binaries.changed' : 'dev.binaries.reset', { params: { name: BINARY_NAME[kind] } })
    } catch (err) {
      toastError(err)
    }
  }

  const runProbe = async (source: { kind: 'file' } | { kind: 'recording'; id: string }): Promise<void> => {
    setProbing(true)
    try {
      const res = await invoke('dev:probe', source)
      if (res) setProbe(res)
    } catch (err) {
      toastError(err)
    } finally {
      setProbing(false)
    }
  }

  const preview = formatCommand('whisper-cli', [
    '-m',
    transcription.modelPath ?? '<model>',
    '-f',
    '<audio.wav>',
    '-l',
    transcription.language,
    '-t',
    transcription.threads > 0 ? String(transcription.threads) : '<auto>',
    '-oj',
    '-of',
    '<output>',
    '-pp',
    ...whisperExtraArgs(w)
  ])
  const def = t('dev.whisper.default')

  return (
    <div className="dev-stack">
      <DevCard title={t('dev.binaries.title')} icon={Terminal} description={t('dev.binaries.desc')}>
        {binaries ? (
          <BinaryList items={binaries} onChoose={(k) => void setBinary(k, true)} onReset={(k) => void setBinary(k, false)} />
        ) : (
          <p className="muted">{t('dev.loading')}</p>
        )}
      </DevCard>

      <DevCard title={t('dev.whisper.title')} icon={Braces}>
        <div className="dev-fields-2">
          <Field label={t('dev.whisper.beamSize')} description={t('dev.whisper.zeroDefault')}>
            <NumberInput value={w.beamSize} min={0} max={16} label={t('dev.whisper.beamSize')} onCommit={(v) => update({ whisper: { beamSize: v } })} />
          </Field>
          <Field label={t('dev.whisper.bestOf')} description={t('dev.whisper.zeroDefault')}>
            <NumberInput value={w.bestOf} min={0} max={16} label={t('dev.whisper.bestOf')} onCommit={(v) => update({ whisper: { bestOf: v } })} />
          </Field>
          <Field label={t('dev.whisper.maxLen')} description={t('dev.whisper.maxLenDesc')}>
            <NumberInput value={w.maxLen} min={0} max={1000} label={t('dev.whisper.maxLen')} onCommit={(v) => update({ whisper: { maxLen: v } })} />
          </Field>
          <Field label={t('dev.whisper.maxContext')} description={t('dev.whisper.maxContextDesc')}>
            <NumberInput value={w.maxContext} min={-1} max={224} label={t('dev.whisper.maxContext')} onCommit={(v) => update({ whisper: { maxContext: v } })} />
          </Field>
        </div>
        <RangeField
          label={t('dev.whisper.temperature')}
          value={w.temperature}
          min={0}
          max={1}
          step={0.05}
          format={(v) => (v === 0 ? def : v.toFixed(2))}
          onCommit={(v) => update({ whisper: { temperature: Math.round(v * 100) / 100 } })}
        />
        <Field label={t('dev.whisper.prompt')} stacked>
          <CommitText multiline value={w.prompt} maxLength={1000} label={t('dev.whisper.prompt')} placeholder={t('dev.whisper.promptPlaceholder')} onCommit={(v) => update({ whisper: { prompt: v } })} />
        </Field>
        <SwitchField label={t('dev.whisper.translate')} checked={w.translate} onChange={(v) => update({ whisper: { translate: v } })} />
        <SwitchField label={t('dev.whisper.splitOnWord')} checked={w.splitOnWord} onChange={(v) => update({ whisper: { splitOnWord: v } })} />
        <SwitchField label={t('dev.whisper.noFallback')} checked={w.noFallback} onChange={(v) => update({ whisper: { noFallback: v } })} />
        <SwitchField
          label={t('dev.whisper.suppressNonSpeech')}
          checked={w.suppressNonSpeech}
          onChange={(v) => update({ whisper: { suppressNonSpeech: v } })}
        />
        <SwitchField label={t('dev.whisper.useGpu')} checked={w.useGpu} onChange={(v) => update({ whisper: { useGpu: v } })} />
        <SwitchField
          label={t('dev.whisper.flashAttention')}
          checked={w.flashAttention}
          onChange={(v) => update({ whisper: { flashAttention: v } })}
        />
        <div className="dev-command">
          <div className="row nowrap">
            <span className="eyebrow">{t('dev.whisper.command')}</span>
            <div className="spacer" />
            <IconButton icon={Copy} small label={t('dev.copy')} onClick={() => void copyText(preview)} />
          </div>
          <pre className="dev-pre">{preview}</pre>
        </div>
      </DevCard>

      <DevCard
        title={t('dev.temp.title')}
        icon={HardDrive}
        actions={<IconButton icon={FolderOpen} small label={t('dev.openFolder')} onClick={() => void invoke('dev:open-path', 'temp').catch(toastError)} />}
      >
        <SwitchField label={t('dev.temp.keep')} checked={d.storage.keepTempFiles} onChange={(v) => update({ storage: { keepTempFiles: v } })} />
      </DevCard>

      <DevCard title={t('dev.probe.title')} icon={FlaskConical}>
        <div className="row">
          <Select label={t('dev.probe.recording')} value={probeId} onChange={(e) => setProbeId(e.target.value)}>
            <option value="">{t('dev.probe.pickRecording')}</option>
            {recordings.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!probeId || probing} onClick={() => void runProbe({ kind: 'recording', id: probeId })}>
            {t('dev.probe.inspect')}
          </Button>
          <Button size="sm" variant="ghost" disabled={probing} onClick={() => void runProbe({ kind: 'file' })}>
            {t('dev.probe.chooseFile')}
          </Button>
        </div>
        {probe && (
          <div className="dev-command">
            <div className="row nowrap">
              <code className="code-chip truncate dev-path" title={probe.path}>
                {probe.path}
              </code>
              <div className="spacer" />
              <IconButton icon={Copy} small label={t('dev.copy')} onClick={() => void copyText(probe.json)} />
            </div>
            <pre className="dev-pre dev-json">{probe.json}</pre>
          </div>
        )}
      </DevCard>
    </div>
  )
}

// ----------------------------------------------------------------------------- system

function SystemPanel() {
  const t = useT()
  const { d, update } = useDev()
  const miniOpen = useApp((s) => s.settings!.miniPanel.open)
  const [boot, setBoot] = useState<BootFlagsState | null>(null)
  const chromiumKey = JSON.stringify(d.chromium)
  useEffect(() => {
    void invoke('dev:boot-flags').then(setBoot).catch(toastError)
  }, [chromiumKey])
  const enable = parseFeatureList(d.chromium.enableFeatures)
  const disable = parseFeatureList(d.chromium.disableFeatures)
  const invalid = [...enable.invalid, ...disable.invalid]
  const devToolsKeys = platform === 'darwin' ? 'F12 · ⌥⌘I' : 'F12 · Ctrl+Shift+I'

  return (
    <div className="dev-stack">
      <DevCard
        title={t('dev.chromium.title')}
        icon={Zap}
        description={t('dev.chromium.desc')}
        actions={
          <Button size="sm" icon={Power} variant={boot?.restartRequired ? 'primary' : 'secondary'} onClick={() => void invoke('dev:relaunch').catch(toastError)}>
            {t('dev.restart')}
          </Button>
        }
      >
        {boot?.restartRequired && <Notice kind="warning">{t('dev.chromium.restartRequired')}</Notice>}
        <SwitchField
          label={t('dev.chromium.hardwareAcceleration')}
          checked={d.chromium.hardwareAcceleration}
          onChange={(v) => update({ chromium: { hardwareAcceleration: v } })}
        />
        <SwitchField
          label={t('dev.chromium.platformFlags')}
          checked={d.chromium.platformFlags}
          onChange={(v) => update({ chromium: { platformFlags: v } })}
        />
        <Field label={t('dev.chromium.enableFeatures')} description={t('dev.chromium.featuresDesc')} stacked>
          <CommitText value={d.chromium.enableFeatures} maxLength={1000} label={t('dev.chromium.enableFeatures')} placeholder="FeatureA, FeatureB" onCommit={(v) => update({ chromium: { enableFeatures: v } })} />
          <FlagChips names={enable.valid} empty={t('dev.none')} />
        </Field>
        <Field label={t('dev.chromium.disableFeatures')} description={t('dev.chromium.featuresDesc')} stacked>
          <CommitText value={d.chromium.disableFeatures} maxLength={1000} label={t('dev.chromium.disableFeatures')} placeholder="FeatureC" onCommit={(v) => update({ chromium: { disableFeatures: v } })} />
          <FlagChips names={disable.valid} empty={t('dev.none')} />
        </Field>
        {invalid.length > 0 && <Notice kind="warning">{t('dev.chromium.invalid', { names: invalid.join(', ') })}</Notice>}
        {boot && (
          <KeyValues
            rows={[
              [t('dev.chromium.applied'), <FlagChips key="a" names={boot.applied.enableFeatures} empty={t('dev.none')} />],
              [t('dev.chromium.next'), <FlagChips key="n" names={boot.configured.enableFeatures} empty={t('dev.none')} />]
            ]}
          />
        )}
      </DevCard>

      <div className="dev-grid">
        <DevCard title={t('dev.ui.title')} icon={Monitor}>
          <SwitchField label={t('dev.ui.perfOverlay')} checked={d.ui.perfOverlay} onChange={(v) => update({ ui: { perfOverlay: v } })} />
          <SwitchField label={t('dev.ui.showIds')} checked={d.ui.showInternalIds} onChange={(v) => update({ ui: { showInternalIds: v } })} />
          <SwitchField
            label={t('dev.ui.devToolsShortcut')}
            description={t('dev.ui.devToolsShortcutDesc', { keys: devToolsKeys })}
            checked={d.ui.devToolsShortcut}
            onChange={(v) => update({ ui: { devToolsShortcut: v } })}
          />
        </DevCard>

        <DevCard title={t('dev.updates.title')} icon={RefreshCw}>
          <SwitchField
            label={t('dev.updates.prerelease')}
            checked={d.updates.allowPrerelease}
            onChange={(v) => update({ updates: { allowPrerelease: v } })}
          />
        </DevCard>
      </div>

      <DevCard title={t('dev.windows.title')} icon={Terminal}>
        <div className="row">
          <Button size="sm" onClick={() => void invoke('dev:open-devtools', 'main').catch(toastError)}>
            {t('dev.windows.devtoolsMain')}
          </Button>
          <Button size="sm" disabled={!miniOpen} onClick={() => void invoke('dev:open-devtools', 'mini').catch(toastError)}>
            {t('dev.windows.devtoolsMini')}
          </Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void invoke('dev:reload').catch(toastError)}>
            {t('dev.windows.reload')}
          </Button>
        </div>
      </DevCard>
    </div>
  )
}

// ----------------------------------------------------------------------------- tools

const ACTION_LABEL: Record<ShortcutAction, MessageKey> = {
  toggleRecord: 'shortcuts.toggleRecord',
  togglePause: 'shortcuts.togglePause',
  addMarker: 'shortcuts.addMarker'
}

interface KeySample {
  key: string
  code: string
  mods: string[]
  accelerator: string | null
  repeat: boolean
}

function KeyTester() {
  const t = useT()
  const bindings = useApp((s) => s.settings!.shortcuts.bindings)
  const status = useApp((s) => s.shortcutStatus)
  const [last, setLast] = useState<KeySample | null>(null)
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Tab') return
    e.preventDefault()
    e.stopPropagation()
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && (platform === 'darwin' ? 'Cmd' : 'Meta')].filter(
      (m): m is string => typeof m === 'string'
    )
    setLast({ key: e.key, code: e.code, mods, accelerator: eventToAccelerator(e, platform), repeat: e.repeat })
  }
  const accelerator = last?.accelerator ?? null
  const matches = accelerator ? SHORTCUT_ACTIONS.filter((a) => normalizeAccelerator(bindings[a]) === accelerator) : []
  const space = t('keys.space')
  return (
    <DevCard title={t('dev.keys.title')} icon={Keyboard}>
      <div className="dev-keypad" tabIndex={0} role="textbox" aria-label={t('dev.keys.area')} data-shortcut-scope="local" onKeyDown={onKeyDown}>
        {last ? (
          <KeyValues
            rows={[
              ['key', <code key="k">{last.key === ' ' ? '␣' : last.key}</code>],
              ['code', <code key="c">{last.code}</code>],
              [t('dev.keys.modifiers'), last.mods.length > 0 ? last.mods.join(' + ') : t('dev.none')],
              [t('dev.keys.accelerator'), accelerator ? <Keycaps key="a" keys={acceleratorKeycaps(accelerator, platform, space)} /> : t('dev.keys.unsupported')],
              [t('dev.keys.matches'), matches.length > 0 ? matches.map((a) => t(ACTION_LABEL[a])).join(', ') : t('dev.none')],
              [t('dev.keys.repeat'), last.repeat ? t('dev.on') : t('dev.off')]
            ]}
          />
        ) : (
          <p className="faint">{t('dev.keys.prompt')}</p>
        )}
      </div>
      <div className="dev-table-wrap">
        <table className="dev-table">
          <thead>
            <tr>
              <th>{t('dev.keys.action')}</th>
              <th>{t('dev.keys.binding')}</th>
              <th>{t('dev.keys.state')}</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUT_ACTIONS.map((a) => {
              const st = status.find((x) => x.action === a)
              return (
                <tr key={a}>
                  <td>{t(ACTION_LABEL[a])}</td>
                  <td>
                    <Keycaps keys={acceleratorKeycaps(bindings[a], platform, space)} />
                  </td>
                  <td>
                    {st ? t(`shortcuts.state.${st.state}` as MessageKey) : '—'}
                    {st?.reasonKey ? <span className="faint"> · {t(st.reasonKey as MessageKey)}</span> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </DevCard>
  )
}

const STORAGE_LABEL: Record<string, MessageKey> = {
  settings: 'dev.storage.settings',
  library: 'dev.storage.library',
  schedules: 'dev.storage.schedules',
  profiles: 'dev.storage.profiles',
  sessions: 'dev.storage.sessions',
  transcripts: 'dev.storage.transcripts',
  peaks: 'dev.storage.peaks',
  logs: 'dev.storage.logs',
  temp: 'dev.storage.temp'
}
const VIEWABLE = new Set<string>(['settings', 'library', 'schedules', 'profiles'])

function ToolsPanel() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const [freq, setFreq] = useState(440)
  const [secs, setSecs] = useState(5)
  const [toneBusy, setToneBusy] = useState(false)
  const [items, setItems] = useState<DevStorageEntry[] | null>(null)
  const [viewer, setViewer] = useState<{ name: DataFileName; text: string } | null>(null)
  const [confirm, setConfirm] = useState<'onboarding' | 'crash' | null>(null)
  const load = useCallback(() => {
    void invoke('dev:storage').then(setItems).catch(toastError)
  }, [])
  useEffect(() => load(), [load])

  const createTone = async (): Promise<void> => {
    setToneBusy(true)
    try {
      const res = await invoke('dev:test-tone', freq, secs)
      reportBulk(res, 'dev.tools.toneCreated', 'dev.tools.toneFailed')
    } catch (err) {
      toastError(err)
    } finally {
      setToneBusy(false)
    }
  }

  const clearTemp = async (): Promise<void> => {
    try {
      const res = await invoke('dev:clear-temp')
      useApp.getState().toast('success', 'dev.storage.cleared', { params: { count: res.removed, size: formatBytes(res.bytes, locale), kept: res.skipped } })
      load()
    } catch (err) {
      toastError(err)
    }
  }

  const view = async (name: DataFileName): Promise<void> => {
    try {
      setViewer({ name, text: await invoke('dev:read-data', name) })
    } catch (err) {
      toastError(err)
    }
  }

  return (
    <div className="dev-stack">
      <KeyTester />

      <div className="dev-grid">
        <DevCard title={t('dev.tools.toneTitle')} icon={AudioLines}>
          <Field label={t('dev.tools.frequency')}>
            <NumberInput value={freq} min={20} max={20000} label={t('dev.tools.frequency')} onCommit={setFreq} />
          </Field>
          <Field label={t('dev.tools.duration')}>
            <NumberInput value={secs} min={1} max={600} label={t('dev.tools.duration')} onCommit={setSecs} />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end', paddingTop: 8 }}>
            <Button size="sm" variant="primary" icon={FlaskConical} disabled={toneBusy} onClick={() => void createTone()}>
              {t('dev.tools.createTone')}
            </Button>
          </div>
        </DevCard>

        <DevCard title={t('dev.stability.title')} icon={Bomb}>
          <div className="stack" style={{ gap: 8 }}>
            <Button size="sm" icon={RotateCcw} onClick={() => setConfirm('onboarding')}>
              {t('dev.stability.onboarding')}
            </Button>
            <Button size="sm" icon={Bomb} variant="danger" onClick={() => setConfirm('crash')}>
              {t('dev.stability.crash')}
            </Button>
            <Button size="sm" icon={Power} onClick={() => void invoke('dev:relaunch').catch(toastError)}>
              {t('dev.restart')}
            </Button>
          </div>
        </DevCard>
      </div>

      <DevCard
        title={t('dev.storage.title')}
        icon={Database}
        actions={
          <>
            <IconButton icon={RefreshCw} small label={t('dev.refresh')} onClick={load} />
            <Button size="sm" icon={Trash2} variant="ghost" onClick={() => void clearTemp()}>
              {t('dev.storage.clearTemp')}
            </Button>
          </>
        }
      >
        <div className="dev-table-wrap">
          <table className="dev-table">
            <thead>
              <tr>
                <th>{t('dev.storage.item')}</th>
                <th className="num">{t('dev.storage.size')}</th>
                <th className="num">{t('dev.storage.files')}</th>
                <th>{t('dev.storage.path')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it) => (
                <tr key={it.id}>
                  <td>{t(STORAGE_LABEL[it.id] ?? 'dev.storage.settings')}</td>
                  <td className="num tnum">{it.exists ? formatBytes(it.bytes, locale) : '—'}</td>
                  <td className="num tnum">{it.exists ? it.files : '—'}</td>
                  <td className="dev-path-cell">
                    <code className="code-chip truncate dev-path" title={it.path}>
                      {it.path}
                    </code>
                  </td>
                  <td>
                    {VIEWABLE.has(it.id) && it.exists && (
                      <Button size="sm" variant="ghost" onClick={() => void view(it.id as DataFileName)}>
                        {t('dev.storage.view')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DevCard>

      <Modal
        open={viewer !== null}
        wide
        title={viewer ? t('dev.storage.viewerTitle', { name: `${viewer.name}.json` }) : ''}
        onClose={() => setViewer(null)}
        footer={
          <>
            <Button icon={Copy} onClick={() => viewer && void copyText(viewer.text)}>
              {t('dev.copy')}
            </Button>
            <Button variant="primary" onClick={() => setViewer(null)}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        <p className="field-desc">{t('dev.storage.readOnly')}</p>
        <pre className="dev-pre dev-json">{viewer?.text ?? ''}</pre>
      </Modal>

      <Modal
        open={confirm !== null}
        title={confirm === 'crash' ? t('dev.stability.crashTitle') : t('dev.stability.onboardingTitle')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger-solid"
              onClick={() => {
                const what = confirm
                setConfirm(null)
                if (what === 'crash') void invoke('dev:crash-renderer').catch(toastError)
                else void useApp.getState().updateSettings({ onboardingCompleted: false }).catch(toastError)
              }}
            >
              {t('common.continue')}
            </Button>
          </>
        }
      >
        <p>{confirm === 'crash' ? t('dev.stability.crashBody') : t('dev.stability.onboardingBody')}</p>
      </Modal>
    </div>
  )
}

// ----------------------------------------------------------------------------- page

type Tab = 'overview' | 'logs' | 'audio' | 'processing' | 'system' | 'tools'

const TABS: Array<{ id: Tab; icon: LucideIcon; key: MessageKey }> = [
  { id: 'overview', icon: Activity, key: 'dev.tab.overview' },
  { id: 'logs', icon: ScrollText, key: 'dev.tab.logs' },
  { id: 'audio', icon: AudioLines, key: 'dev.tab.audio' },
  { id: 'processing', icon: Cpu, key: 'dev.tab.processing' },
  { id: 'system', icon: Monitor, key: 'dev.tab.system' },
  { id: 'tools', icon: Wrench, key: 'dev.tab.tools' }
]

/** The tab survives navigation to other pages during the session. */
let lastTab: Tab = 'overview'

export function DeveloperPage() {
  const t = useT()
  const enabled = useApp((s) => s.settings?.developer.enabled ?? false)
  const navigate = useApp((s) => s.navigate)
  const [tab, setTabState] = useState<Tab>(lastTab)
  const [confirmReset, setConfirmReset] = useState(false)
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => {
    if (!enabled) navigate('settings')
  }, [enabled, navigate])
  if (!enabled) return null

  const setTab = (next: Tab): void => {
    lastTab = next
    setTabState(next)
  }
  const onTabKey = (e: ReactKeyboardEvent, index: number): void => {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    setTab(TABS[next]!.id)
    refs.current[next]?.focus()
  }
  const panels: Record<Tab, ReactNode> = {
    overview: <OverviewPanel />,
    logs: <LogsPanel />,
    audio: <AudioPanel />,
    processing: <ProcessingPanel />,
    system: <SystemPanel />,
    tools: <ToolsPanel />
  }

  return (
    <div className="dev-page">
      <div className="page-head">
        <div>
          <h1 className="dev-title">
            {t('dev.title')}
            <span className="dev-title-badge">
              <Terminal size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
              {t('dev.badge')}
            </span>
          </h1>
        </div>
        <div className="row">
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)}>
            {t('dev.resetAll')}
          </Button>
          <Button size="sm" icon={Power} onClick={() => void useApp.getState().updateSettings({ developer: { enabled: false } }).catch(toastError)}>
            {t('dev.disable')}
          </Button>
        </div>
      </div>

      <div className="dev-tabs" role="tablist" aria-label={t('dev.tabs')}>
        {TABS.map((x, i) => (
          <button
            key={x.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`dev-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls={`dev-panel-${x.id}`}
            tabIndex={tab === x.id ? 0 : -1}
            className={`dev-tab ${tab === x.id ? 'active' : ''}`}
            onClick={() => setTab(x.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {tab === x.id && <motion.span layoutId="dev-tab-active" className="dev-tab-active" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} />}
            <x.icon size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span>{t(x.key)}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          role="tabpanel"
          id={`dev-panel-${tab}`}
          aria-labelledby={`dev-tab-${tab}`}
          className="dev-panel"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
          {panels[tab]}
        </motion.div>
      </AnimatePresence>

      <Modal
        open={confirmReset}
        title={t('dev.resetAll')}
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger-solid"
              onClick={async () => {
                setConfirmReset(false)
                try {
                  const s = await invoke('settings:reset', 'developer')
                  useApp.getState().setSettings(s)
                  useApp.getState().toast('success', 'settings.resetDone')
                } catch (err) {
                  toastError(err)
                }
              }}
            >
              {t('settings.reset')}
            </Button>
          </>
        }
      >
        <p>{t('dev.resetAllBody')}</p>
      </Modal>
    </div>
  )
}

// ----------------------------------------------------------------------------- performance overlay

interface PerfStats {
  fps: number
  worstMs: number
  heap: number | null
  heapLimit: number | null
  longTasks: number
  nodes: number
}

type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }

/** Small always-visible readout of rendering performance (developer option). */
export function PerfOverlay() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const active = useEngine((s) => Object.values(s.sessions).filter((x) => x.state === 'recording' || x.state === 'paused').length)
  const [stats, setStats] = useState<PerfStats>({ fps: 0, worstMs: 0, heap: null, heapLimit: null, longTasks: 0, nodes: 0 })
  useEffect(() => {
    let frames = 0
    let worst = 0
    let last = performance.now()
    let windowStart = last
    let raf = 0
    let longTasks: number[] = []
    const loop = (now: number): void => {
      frames++
      worst = Math.max(worst, now - last)
      last = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        const now = performance.now()
        list.getEntries().forEach(() => longTasks.push(now))
      })
      observer.observe({ type: 'longtask', buffered: false })
    } catch {
      observer = null
    }
    const id = window.setInterval(() => {
      const now = performance.now()
      const elapsed = Math.max(0.001, (now - windowStart) / 1000)
      const mem = (performance as PerformanceWithMemory).memory
      longTasks = longTasks.filter((ts) => now - ts < 10_000)
      setStats({
        fps: Math.round(frames / elapsed),
        worstMs: Math.round(worst),
        heap: mem ? mem.usedJSHeapSize : null,
        heapLimit: mem ? mem.jsHeapSizeLimit : null,
        longTasks: longTasks.length,
        nodes: document.getElementsByTagName('*').length
      })
      frames = 0
      worst = 0
      windowStart = now
    }, 500)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(id)
      observer?.disconnect()
    }
  }, [])
  const level = stats.fps >= 50 ? 'ok' : stats.fps >= 30 ? 'warn' : 'bad'
  return (
    <div className="perf-overlay" aria-hidden="true">
      <div className={`perf-fps ${level}`}>
        <span className="tnum">{stats.fps}</span> FPS
      </div>
      <dl>
        <div>
          <dt>{t('dev.perf.frame')}</dt>
          <dd className="tnum">{stats.worstMs} ms</dd>
        </div>
        {stats.heap !== null && (
          <div>
            <dt>{t('dev.perf.heap')}</dt>
            <dd className="tnum">{formatBytes(stats.heap, locale)}</dd>
          </div>
        )}
        <div>
          <dt>{t('dev.perf.longTasks')}</dt>
          <dd className="tnum">{stats.longTasks}</dd>
        </div>
        <div>
          <dt>DOM</dt>
          <dd className="tnum">{stats.nodes}</dd>
        </div>
        <div>
          <dt>{t('dev.perf.recording')}</dt>
          <dd className="tnum">{active}</dd>
        </div>
      </dl>
    </div>
  )
}
