import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Route } from '../../../shared/ipc'
import { on, platform, send } from '../api'
import { useApp } from '../stores/app'
import { useEngine } from '../stores/engine'
import { useLibrary } from '../stores/library'
import { useDynamicT, useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { Logo } from './controls'
import { StatePill } from './status'
import { formatClock } from '../util/format'
import {
  Archive,
  CircleAlert,
  CircleCheck,
  Download,
  Folder,
  ICON_STROKE,
  Info,
  Maximize2,
  Mic,
  Minus,
  Settings,
  Star,
  Trash2,
  TriangleAlert,
  X
} from './icons'
import type { LucideIcon } from './icons'

/** Custom title bar. Windows keeps native caption buttons (overlay), macOS keeps its traffic lights. */
export function TitleBar() {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  const selectedId = useEngine((s) => s.selectedId)
  const runtime = useEngine((s) => (selectedId ? s.sessions[selectedId] : undefined))
  const sessions = useApp((s) => s.settings?.sessions ?? [])
  const session = sessions.find((s) => s.id === selectedId)
  useEffect(() => on('window:state', (s) => setMaximized(s.maximized)), [])
  const active = runtime && (runtime.state === 'recording' || runtime.state === 'paused' || runtime.state === 'countdown')
  return (
    <header className={`titlebar platform-${platform}`}>
      <div className="titlebar-brand">
        <Logo size={22} />
        <span className="titlebar-name">Sonora</span>
      </div>
      <div className="titlebar-center">
        {active && session && runtime && (
          <div className="titlebar-target" aria-live="off">
            <span className="faint">{sessions.length > 1 ? t('titlebar.target', { session: session.name }) : session.name}</span>
            <StatePill state={runtime.state} extra={runtime.state === 'countdown' ? String(runtime.countdownLeft ?? '') : formatClock(runtime.elapsedMs, true)} />
          </div>
        )}
      </div>
      {platform === 'linux' && (
        <div className="window-controls">
          <button type="button" className="wc-btn" aria-label={t('window.minimize')} onClick={() => send('window:control', 'minimize')}>
            <Minus size={15} strokeWidth={ICON_STROKE} />
          </button>
          <button type="button" className="wc-btn" aria-label={maximized ? t('window.restore') : t('window.maximize')} onClick={() => send('window:control', 'maximize')}>
            <Maximize2 size={13} strokeWidth={ICON_STROKE} />
          </button>
          <button type="button" className="wc-btn close" aria-label={t('window.closeToTray')} onClick={() => send('window:control', 'close')}>
            <X size={16} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      )}
    </header>
  )
}

const NAV: Array<{ route: Route; icon: LucideIcon; key: MessageKey }> = [
  { route: 'record', icon: Mic, key: 'nav.record' },
  { route: 'archive', icon: Archive, key: 'nav.archive' },
  { route: 'favorites', icon: Star, key: 'nav.favorites' },
  { route: 'collections', icon: Folder, key: 'nav.collections' },
  { route: 'trash', icon: Trash2, key: 'nav.trash' }
]

export function Sidebar({ compact }: { compact: boolean }) {
  const t = useT()
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const update = useApp((s) => s.update)
  const setUpdateDialog = useApp((s) => s.setUpdateDialog)
  const recording = useEngine((s) => Object.values(s.sessions).some((x) => x.state === 'recording' || x.state === 'paused'))
  const trashCount = useLibrary((s) => s.recordings.filter((r) => r.trash).length)
  const current = route.name === 'editor' ? route.back : route.name
  const item = (r: Route, Icon: LucideIcon, key: MessageKey, badge?: ReactNode) => {
    const selected = current === r
    return (
      <li key={r}>
        <button
          type="button"
          className={`nav-item ${selected ? 'active' : ''}`}
          aria-current={selected ? 'page' : undefined}
          onClick={() => navigate(r)}
          title={compact ? t(key) : undefined}
          aria-label={compact ? t(key) : undefined}
        >
          {selected && <motion.span layoutId="nav-active" className="nav-active-bg" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} />}
          <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {!compact && <span className="nav-label">{t(key)}</span>}
          {badge}
        </button>
      </li>
    )
  }
  return (
    <nav className={`sidebar ${compact ? 'compact' : ''}`} aria-label={t('nav.label')}>
      <ul className="nav-list">
        {NAV.map((n) =>
          item(
            n.route,
            n.icon,
            n.key,
            n.route === 'record' && recording ? (
              <span className="nav-rec" aria-label={t('state.recording')} />
            ) : n.route === 'trash' && trashCount > 0 && !compact ? (
              <span className="nav-count tnum" aria-label={t('nav.trashCount', { count: trashCount })}>
                {trashCount}
              </span>
            ) : undefined
          )
        )}
      </ul>
      <div className="spacer" />
      {update && (update.phase === 'available' || update.phase === 'downloaded' || update.phase === 'waiting-for-idle') && (
        <button type="button" className="nav-update" onClick={() => setUpdateDialog(true)}>
          <Download size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          {!compact && <span className="truncate">{t('update.badge', { version: update.release?.version ?? '' })}</span>}
        </button>
      )}
      <ul className="nav-list">{item('settings', Settings, 'nav.settings')}</ul>
    </nav>
  )
}

/** Visually hidden live regions used for recording state announcements. */
export function LiveRegion() {
  const a = useApp((s) => s.announcement)
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  useEffect(() => {
    if (!a.text) return
    if (a.assertive) setAssertive(a.text)
    else setPolite(a.text)
    const timer = window.setTimeout(() => {
      setPolite('')
      setAssertive('')
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [a.seq, a.text, a.assertive])
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </>
  )
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  const tx = useDynamicT()
  const t = useT()
  useEffect(() => {
    const timers = toasts.map((x) => window.setTimeout(() => dismiss(x.id), x.kind === 'error' ? 10000 : 6000))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [toasts, dismiss])
  return (
    <div className="toast-stack" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((x) => {
          const Icon = x.kind === 'error' ? CircleAlert : x.kind === 'success' ? CircleCheck : x.kind === 'warning' ? TriangleAlert : Info
          return (
            <motion.div
              key={x.id}
              layout
              className={`toast ${x.kind}`}
              role={x.kind === 'error' ? 'alert' : 'status'}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="toast-icon">
                <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="toast-title">{tx(x.titleKey, x.params)}</div>
                {(x.bodyKey || x.detail) && (
                  <div className="toast-body">
                    {x.bodyKey ? tx(x.bodyKey, x.params) : ''}
                    {x.bodyKey && x.detail ? ' — ' : ''}
                    {x.detail}
                  </div>
                )}
              </div>
              <button type="button" className="icon-btn sm" aria-label={t('common.dismiss')} onClick={() => dismiss(x.id)}>
                <X size={14} strokeWidth={ICON_STROKE} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
