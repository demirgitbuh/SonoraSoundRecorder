import { useEffect, useState } from 'react'
import { DEFAULT_BINDINGS, acceleratorKeycaps, eventToAccelerator, isModifierCode, normalizeAccelerator } from '../../../shared/shortcuts'
import { SHORTCUT_ACTIONS } from '../../../shared/types'
import type { ShortcutAction, ShortcutBindings, ShortcutScope } from '../../../shared/types'
import { invoke, platform } from '../api'
import { Button, Keycaps, Notice, Segmented } from '../components/controls'
import { CircleAlert, CircleCheck, ICON_STROKE, Info, Keyboard } from '../components/icons'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'

const ACTION_KEY: Record<ShortcutAction, MessageKey> = {
  toggleRecord: 'shortcuts.toggleRecord',
  togglePause: 'shortcuts.togglePause',
  addMarker: 'shortcuts.addMarker'
}

const ACTION_DESC: Record<ShortcutAction, MessageKey> = {
  toggleRecord: 'shortcuts.toggleRecordDesc',
  togglePause: 'shortcuts.togglePauseDesc',
  addMarker: 'shortcuts.addMarkerDesc'
}

/**
 * Shortcut list with a key recorder. While recording a new combination all shortcuts (global and
 * in-app) are suspended, so pressing keys here never starts or stops a recording.
 */
export function ShortcutEditor() {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const status = useApp((s) => s.shortcutStatus)
  const setStatus = useApp((s) => s.setShortcutStatus)
  const setCapture = useApp((s) => s.setShortcutCapture)
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bindings = settings.shortcuts.bindings as ShortcutBindings
  const scope = settings.shortcuts.scope as ShortcutScope
  const space = t('keys.space')

  const apply = async (next: ShortcutBindings, nextScope: ShortcutScope): Promise<void> => {
    const res = await invoke('shortcuts:apply', next, nextScope)
    setStatus(res)
  }

  const stopCapture = async (): Promise<void> => {
    setCapturing(null)
    setCapture(false)
    setStatus(await invoke('shortcuts:suspend', false))
  }

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        void stopCapture()
        return
      }
      if (isModifierCode(e.code)) return
      const acc = eventToAccelerator(e, platform)
      if (!acc) {
        setError('shortcuts.reason.unsupportedKey')
        return
      }
      const clash = SHORTCUT_ACTIONS.find((a) => a !== capturing && normalizeAccelerator(bindings[a]) === acc)
      if (clash) {
        setError('shortcuts.reason.duplicate')
        return
      }
      setError(null)
      const next = { ...bindings, [capturing]: acc }
      void (async () => {
        setCapturing(null)
        setCapture(false)
        await invoke('shortcuts:suspend', false)
        await apply(next, scope)
      })()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, bindings, scope])

  useEffect(
    () => () => {
      // Never leave shortcuts suspended when leaving the page mid-capture.
      if (useApp.getState().shortcutCapture) {
        useApp.getState().setShortcutCapture(false)
        void invoke('shortcuts:suspend', false)
      }
    },
    []
  )

  const begin = async (action: ShortcutAction): Promise<void> => {
    setError(null)
    setCapturing(action)
    setCapture(true)
    setStatus(await invoke('shortcuts:suspend', true))
  }

  const singleKeyGlobal = scope === 'global' && SHORTCUT_ACTIONS.some((a) => !normalizeAccelerator(bindings[a])?.includes('+'))

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <span className="eyebrow">{t('shortcuts.scope')}</span>
        <Segmented<ShortcutScope>
          label={t('shortcuts.scope')}
          value={scope}
          onChange={(v) => void apply(bindings, v)}
          options={[
            { value: 'global', label: t('shortcuts.scopeGlobal') },
            { value: 'app', label: t('shortcuts.scopeApp') }
          ]}
        />
        <p className="field-desc">{scope === 'global' ? t('shortcuts.scopeGlobalDesc') : t('shortcuts.scopeAppDesc')}</p>
      </div>
      {singleKeyGlobal && <Notice kind="warning">{t('shortcuts.singleKeyWarning')}</Notice>}
      <ul className="shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => {
          const st = status.find((s) => s.action === action)
          const ok = st && (st.state === 'registered' || st.state === 'in-app')
          return (
            <li key={action} className="shortcut-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="field-label">{t(ACTION_KEY[action])}</div>
                <div className="field-desc">{t(ACTION_DESC[action])}</div>
                {st && (
                  <div className={`shortcut-status ${ok ? 'ok' : 'bad'}`}>
                    {ok ? <CircleCheck size={13} strokeWidth={ICON_STROKE} aria-hidden="true" /> : st.state === 'suspended' ? <Info size={13} strokeWidth={ICON_STROKE} aria-hidden="true" /> : <CircleAlert size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />}
                    {t(`shortcuts.state.${st.state}` as MessageKey)}
                    {st.reasonKey ? ` — ${t(st.reasonKey as MessageKey)}` : ''}
                  </div>
                )}
              </div>
              <button
                type="button"
                className={`shortcut-capture ${capturing === action ? 'capturing' : ''}`}
                onClick={() => (capturing === action ? void stopCapture() : void begin(action))}
                aria-label={t('shortcuts.change', { action: t(ACTION_KEY[action]) })}
              >
                {capturing === action ? (
                  <span className="row nowrap">
                    <Keyboard size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                    {t('shortcuts.pressKeys')}
                  </span>
                ) : (
                  <Keycaps keys={acceleratorKeycaps(bindings[action], platform, space)} />
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {capturing && <p className="field-desc" role="status">{t('shortcuts.captureHint')}</p>}
      {error && <Notice kind="error">{t(error as MessageKey)}</Notice>}
      <div className="row">
        <Button size="sm" variant="ghost" onClick={() => void apply({ ...DEFAULT_BINDINGS }, scope)}>
          {t('shortcuts.restoreDefaults')}
        </Button>
      </div>
    </div>
  )
}
