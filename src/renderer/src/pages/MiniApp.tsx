import { useEffect, useState } from 'react'
import type { EngineSnapshot } from '../../../shared/ipc'
import { invoke, on } from '../api'
import { Logo } from '../components/controls'
import { ICON_STROKE, Maximize2, Pause, Play, Square, X } from '../components/icons'
import { StatePill } from '../components/status'
import { useDocumentPrefs } from '../hooks'
import { useT } from '../i18n'
import { formatClock } from '../util/format'

/** Small always-on-top recording panel. It controls the selected session through the main window. */
export function MiniApp() {
  const t = useT()
  useDocumentPrefs()
  const [snap, setSnap] = useState<EngineSnapshot>({ sessions: [], selectedId: null, unsavedPreviews: 0 })
  useEffect(() => {
    void invoke('engine:snapshot').then(setSnap)
    return on('engine:snapshot', setSnap)
  }, [])
  const s = snap.sessions.find((x) => x.id === snap.selectedId) ?? snap.sessions[0]
  const state = s?.state ?? 'ready'
  const capturing = state === 'recording' || state === 'paused'
  const dispatch = (action: 'toggleRecord' | 'togglePause'): void => void invoke('engine:dispatch', { action, origin: 'mini' })
  return (
    <div className={`mini ${state}`}>
      <div className="mini-drag">
        <Logo size={18} />
        <span className="truncate mini-session">{s?.name ?? ''}</span>
        <div className="spacer" />
        <button type="button" className="icon-btn sm no-drag" aria-label={t('mini.openMain')} title={t('mini.openMain')} onClick={() => void invoke('window:show-main', 'record')}>
          <Maximize2 size={13} strokeWidth={ICON_STROKE} />
        </button>
        <button type="button" className="icon-btn sm no-drag" aria-label={t('mini.close')} title={t('mini.close')} onClick={() => void invoke('window:mini', false)}>
          <X size={14} strokeWidth={ICON_STROKE} />
        </button>
      </div>
      <div className="mini-body">
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <span className="mini-time tnum">{formatClock(s?.elapsedMs ?? 0, true)}</span>
          <StatePill state={state} />
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="mini-btn no-drag"
          disabled={!capturing}
          aria-label={state === 'paused' ? t('record.resume') : t('record.pause')}
          title={state === 'paused' ? t('record.resume') : t('record.pause')}
          onClick={() => dispatch('togglePause')}
        >
          {state === 'paused' ? <Play size={18} strokeWidth={ICON_STROKE} /> : <Pause size={18} strokeWidth={ICON_STROKE} />}
        </button>
        <button
          type="button"
          className={`mini-rec no-drag ${capturing ? 'on' : ''}`}
          aria-label={capturing ? t('record.stop') : t('record.start')}
          title={capturing ? t('record.stop') : t('record.start')}
          disabled={state === 'finalizing' || state === 'exporting' || state === 'preview'}
          onClick={() => dispatch('toggleRecord')}
        >
          {capturing ? <Square size={16} fill="currentColor" strokeWidth={0} /> : <span className="mini-rec-dot" />}
        </button>
      </div>
    </div>
  )
}
