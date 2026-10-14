import type { RunState } from '../../../shared/types'
import type { MessageKey } from '../i18n'
import { useT } from '../i18n'
import { CircleAlert, CircleCheck, Clock, ICON_STROKE, Pause, RefreshCw, Timer } from './icons'

export const STATE_LABEL: Record<RunState, MessageKey> = {
  ready: 'state.ready',
  countdown: 'state.countdown',
  recording: 'state.recording',
  paused: 'state.paused',
  finalizing: 'state.finalizing',
  preview: 'state.preview',
  exporting: 'state.exporting',
  recoverable: 'state.recoverable',
  error: 'state.error'
}

const STATE_CLASS: Record<RunState, string> = {
  ready: '',
  countdown: 'is-busy',
  recording: 'is-recording',
  paused: 'is-paused',
  finalizing: 'is-busy',
  preview: 'is-busy',
  exporting: 'is-busy',
  recoverable: 'is-warning',
  error: 'is-error'
}

/** Run state shown with color, an icon or animated dot, and text — never color alone. */
export function StatePill({ state, extra }: { state: RunState; extra?: string }) {
  const t = useT()
  const Icon =
    state === 'paused'
      ? Pause
      : state === 'error'
        ? CircleAlert
        : state === 'countdown'
          ? Timer
          : state === 'finalizing' || state === 'exporting'
            ? RefreshCw
            : state === 'recoverable' || state === 'preview'
              ? Clock
              : null
  return (
    <span className={`status ${STATE_CLASS[state]}`}>
      {state === 'recording' || state === 'ready' ? (
        <span className="status-dot" aria-hidden="true" />
      ) : Icon ? (
        <Icon size={13} strokeWidth={2} aria-hidden="true" />
      ) : null}
      {t(STATE_LABEL[state])}
      {extra ? <span className="tnum"> · {extra}</span> : null}
    </span>
  )
}

export function OkPill({ children }: { children: string }) {
  return (
    <span className="status is-success">
      <CircleCheck size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
      {children}
    </span>
  )
}

export function WarnPill({ children }: { children: string }) {
  return (
    <span className="status is-warning">
      <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
      {children}
    </span>
  )
}
