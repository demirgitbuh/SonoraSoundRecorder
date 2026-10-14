import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LOCALES, LOCALE_NATIVE_NAMES } from '../../../shared/types'
import type { FolderCheck, Locale, PermissionStatus, SourceKind } from '../../../shared/types'
import { acceleratorKeycaps } from '../../../shared/shortcuts'
import { AppError, invoke, platform } from '../api'
import { engine } from '../audio/engine'
import { Button, Keycaps, Logo, Notice, Segmented } from '../components/controls'
import { ArrowLeft, Check, FolderOpen, ICON_STROKE, Mic, MonitorSpeaker } from '../components/icons'
import { OkPill, WarnPill } from '../components/status'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useDevices } from '../stores/devices'
import { formatBytes } from '../util/format'
import { ShortcutEditor } from './ShortcutEditor'

const STEPS: MessageKey[] = [
  'onboarding.step.language',
  'onboarding.step.folder',
  'onboarding.step.permissions',
  'onboarding.step.source',
  'onboarding.step.shortcuts',
  'onboarding.step.summary'
]

function LanguageStep({ onDone }: { onDone: () => void }) {
  const t = useT()
  const boot = useApp((s) => s.boot)!
  const update = useApp((s) => s.updateSettings)
  const [chosen, setChosen] = useState<Locale | null>(null)
  const suggested = boot.installerLocale ?? boot.systemLocale
  const choose = async (l: Locale): Promise<void> => {
    setChosen(l)
    await update({ language: l })
  }
  return (
    <div className="onb-step">
      <h1>{t('onboarding.language.title')}</h1>
      <p className="muted">{t('onboarding.language.body')}</p>
      <div className="language-grid" role="radiogroup" aria-label={t('onboarding.language.title')}>
        {LOCALES.map((l) => (
          <button key={l} type="button" role="radio" aria-checked={chosen === l} lang={l} className={`language-option ${chosen === l ? 'selected' : ''}`} onClick={() => void choose(l)}>
            <span className="language-name">{LOCALE_NATIVE_NAMES[l]}</span>
            {l === suggested && !chosen && <span className="badge">{t('onboarding.language.suggested')}</span>}
            {chosen === l && <Check size={18} strokeWidth={2} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="onb-actions">
        <Button variant="primary" size="lg" disabled={!chosen} onClick={onDone}>
          {t('common.continue')}
        </Button>
      </div>
    </div>
  )
}

function FolderStep({ onDone }: { onDone: () => void }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const boot = useApp((s) => s.boot)!
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const [dir, setDir] = useState(settings.files.recordingsDir ?? boot.defaultRecordingsDir)
  const [check, setCheck] = useState<FolderCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void invoke('files:check-folder', dir).then(setCheck)
  }, [dir])
  const use = async (): Promise<void> => {
    try {
      await update({ files: { recordingsDir: dir } })
      onDone()
    } catch (err) {
      setError(err instanceof AppError ? err.key : 'errors.unexpected')
    }
  }
  return (
    <div className="onb-step">
      <h1>{t('onboarding.folder.title')}</h1>
      <p className="muted">{t('onboarding.folder.body')}</p>
      <div className="card card-pad folder-box">
        <FolderOpen size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="truncate strong" title={dir}>
            {dir}
          </div>
          <div className="faint">
            {check
              ? check.exists
                ? check.writable
                  ? t('onboarding.folder.ok', { free: check.freeBytes !== null ? formatBytes(check.freeBytes, locale) : '—' })
                  : t('settings.files.notWritable')
                : t('onboarding.folder.willCreate')
              : '…'}
          </div>
        </div>
        <Button
          onClick={async () => {
            const picked = await invoke('dialog:choose-folder', dir)
            if (picked) setDir(picked)
          }}
        >
          {t('onboarding.folder.choose')}
        </Button>
      </div>
      <p className="field-desc">{t('onboarding.folder.later')}</p>
      {error && <Notice kind="error">{t(error as MessageKey)}</Notice>}
      <div className="onb-actions">
        <Button variant="primary" size="lg" disabled={!!check && check.exists && !check.writable} onClick={() => void use()}>
          {t('onboarding.folder.use')}
        </Button>
      </div>
    </div>
  )
}

function PermissionsStep({ onDone }: { onDone: () => void }) {
  const t = useT()
  const caps = useApp((s) => s.caps)!
  const [perm, setPerm] = useState<PermissionStatus | null>(null)
  const [tested, setTested] = useState<'idle' | 'ok' | 'denied' | 'error'>('idle')
  useEffect(() => {
    void invoke('permissions:status').then(setPerm)
  }, [])
  const test = async (): Promise<void> => {
    if (caps.platform === 'darwin') setPerm(await invoke('permissions:request-mic'))
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((x) => x.stop())
      setTested('ok')
      await useDevices.getState().refresh()
    } catch (err) {
      setTested((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'error')
    }
    setPerm(await invoke('permissions:status'))
  }
  const micOk = tested === 'ok' || perm?.microphone === 'granted'
  return (
    <div className="onb-step">
      <h1>{t('onboarding.permissions.title')}</h1>
      <p className="muted">{t('onboarding.permissions.body')}</p>
      <div className="card card-pad stack">
        <div className="row nowrap">
          <Mic size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <strong>{t('permissions.microphone')}</strong>
          <div className="spacer" />
          {micOk ? <OkPill>{t('permissions.granted')}</OkPill> : tested === 'denied' || perm?.microphone === 'denied' ? <WarnPill>{t('permissions.denied')}</WarnPill> : null}
        </div>
        <p className="field-desc">{t(`permissions.desc.${caps.platform}` as MessageKey)}</p>
        <div className="row">
          <Button onClick={() => void test()}>{micOk ? t('permissions.testAgain') : t('permissions.allowMic')}</Button>
          {(tested === 'denied' || perm?.microphone === 'denied') && caps.platform !== 'linux' && (
            <Button variant="ghost" onClick={() => void invoke('permissions:open-settings', 'microphone')}>
              {t('permissions.openSettings')}
            </Button>
          )}
        </div>
        {tested === 'error' && <Notice kind="error">{t('capture.errorMicGeneric')}</Notice>}
      </div>
      <div className="card card-pad stack">
        <div className="row nowrap">
          <MonitorSpeaker size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <strong>{t('permissions.systemAudio')}</strong>
          <div className="spacer" />
          {caps.systemAudio.status === 'supported' ? (
            <OkPill>{t('platform.available')}</OkPill>
          ) : caps.systemAudio.status === 'needs-permission' ? (
            <WarnPill>{t('permissions.needed')}</WarnPill>
          ) : (
            <WarnPill>{t('platform.unavailable')}</WarnPill>
          )}
        </div>
        <p className="field-desc">{t(`platform.systemAudio.${caps.systemAudio.method}` as MessageKey)}</p>
        {caps.isWayland && <p className="field-desc">{t('platform.waylandPortal')}</p>}
        {caps.systemAudio.status === 'needs-permission' && (
          <div className="row">
            <Button onClick={() => void invoke('permissions:open-settings', 'screen')}>{t('permissions.openSettings')}</Button>
          </div>
        )}
      </div>
      <div className="onb-actions">
        <Button variant="primary" size="lg" onClick={onDone}>
          {t('common.continue')}
        </Button>
      </div>
    </div>
  )
}

/** Real input level from the chosen microphone via an AnalyserNode (no recording). */
function MicTest({ deviceId }: { deviceId: string | null }) {
  const t = useT()
  const bar = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'off' | 'on' | 'error'>('off')
  useEffect(() => {
    if (state !== 'on') return
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let raf = 0
    let alive = true
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        })
        if (!alive) return
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(stream).connect(analyser)
        const data = new Float32Array(analyser.fftSize)
        const tick = (): void => {
          analyser.getFloatTimeDomainData(data)
          let peak = 0
          for (const v of data) peak = Math.max(peak, Math.abs(v))
          const db = peak > 0 ? 20 * Math.log10(peak) : -60
          if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0, Math.min(1, (db + 60) / 60))})`
          raf = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        if (alive) setState('error')
      }
    })()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((x) => x.stop())
      void ctx?.close()
    }
  }, [state, deviceId])
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <Button size="sm" onClick={() => setState(state === 'on' ? 'off' : 'on')}>
          {state === 'on' ? t('onboarding.source.stopTest') : t('onboarding.source.test')}
        </Button>
        {state === 'on' && <span className="faint">{t('onboarding.source.speak')}</span>}
      </div>
      {state === 'on' && (
        <div className="meter-track" style={{ height: 10 }}>
          <div ref={bar} className="meter-fill" />
        </div>
      )}
      {state === 'error' && <Notice kind="error">{t('capture.errorMicGeneric')}</Notice>}
    </div>
  )
}

function SourceStep({ onDone }: { onDone: () => void }) {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const caps = useApp((s) => s.caps)!
  const update = useApp((s) => s.updateSettings)
  const inputs = useDevices((s) => s.inputs)
  const sysUnsupported = caps.systemAudio.status === 'unsupported'
  const source = settings.recording.defaultSource
  return (
    <div className="onb-step">
      <h1>{t('onboarding.source.title')}</h1>
      <p className="muted">{t('onboarding.source.body')}</p>
      <div className="card card-pad stack">
        <span className="eyebrow">{t('settings.recording.defaultSource')}</span>
        <Segmented<SourceKind>
          label={t('settings.recording.defaultSource')}
          value={source}
          onChange={(v) => void update({ recording: { defaultSource: v } })}
          options={[
            { value: 'mic', label: t('source.mic'), icon: Mic },
            { value: 'system', label: t('source.system'), icon: MonitorSpeaker, disabled: sysUnsupported },
            { value: 'both', label: t('source.both'), disabled: sysUnsupported }
          ]}
        />
        {source !== 'system' && (
          <>
            <label className="eyebrow" htmlFor="onb-mic">
              {t('record.micDevice')}
            </label>
            <select id="onb-mic" className="select" value={settings.audio.defaultMicDeviceId ?? ''} onChange={(e) => void update({ audio: { defaultMicDeviceId: e.target.value || null } })}>
              <option value="">{t('devices.systemDefault')}</option>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t('devices.unnamed')}
                </option>
              ))}
            </select>
            <MicTest deviceId={settings.audio.defaultMicDeviceId} />
          </>
        )}
      </div>
      <div className="onb-actions">
        <Button variant="primary" size="lg" onClick={onDone}>
          {t('common.continue')}
        </Button>
      </div>
    </div>
  )
}

function ShortcutsStep({ onDone }: { onDone: () => void }) {
  const t = useT()
  return (
    <div className="onb-step">
      <h1>{t('onboarding.shortcuts.title')}</h1>
      <p className="muted">{t('onboarding.shortcuts.body')}</p>
      <div className="card card-pad">
        <ShortcutEditor />
      </div>
      <div className="onb-actions">
        <Button variant="primary" size="lg" onClick={onDone}>
          {t('common.continue')}
        </Button>
      </div>
    </div>
  )
}

function SummaryStep() {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const inputs = useDevices((s) => s.inputs)
  const [busy, setBusy] = useState(false)
  const space = t('keys.space')
  const mic = inputs.find((d) => d.deviceId === settings.audio.defaultMicDeviceId)?.label || t('devices.systemDefault')
  const finish = async (): Promise<void> => {
    setBusy(true)
    const first = settings.sessions[0]
    const sessions = settings.sessions.map((s) =>
      s.id === first?.id ? { ...s, source: settings.recording.defaultSource, micDeviceId: settings.audio.defaultMicDeviceId } : s
    )
    await update({ onboardingCompleted: true, sessions })
    engine.start()
  }
  const rows: Array<[MessageKey, string]> = [
    ['settings.general.language', LOCALE_NATIVE_NAMES[settings.language ?? 'en']],
    ['settings.files.folder', settings.files.recordingsDir ?? '—'],
    ['settings.recording.defaultSource', t(settings.recording.defaultSource === 'mic' ? 'source.mic' : settings.recording.defaultSource === 'system' ? 'source.system' : 'source.both')],
    ['record.micDevice', mic],
    ['settings.recording.after', t('settings.recording.afterPreview')],
    ['onboarding.summary.format', 'WAV · 48 kHz · ' + t('audio.stereo') + ' · 24-bit'],
    ['shortcuts.scope', settings.shortcuts.scope === 'global' ? t('shortcuts.scopeGlobal') : t('shortcuts.scopeApp')]
  ]
  return (
    <div className="onb-step">
      <h1>{t('onboarding.summary.title')}</h1>
      <p className="muted">{t('onboarding.summary.body')}</p>
      <div className="card card-pad">
        <dl className="meta-list">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{t(k)}</dt>
              <dd className="truncate">{v}</dd>
            </div>
          ))}
          <div>
            <dt>{t('onboarding.summary.shortcuts')}</dt>
            <dd className="row">
              <Keycaps keys={acceleratorKeycaps(settings.shortcuts.bindings.toggleRecord, platform, space)} />
              <Keycaps keys={acceleratorKeycaps(settings.shortcuts.bindings.togglePause, platform, space)} />
              <Keycaps keys={acceleratorKeycaps(settings.shortcuts.bindings.addMarker, platform, space)} />
            </dd>
          </div>
        </dl>
      </div>
      <p className="field-desc">{t('onboarding.summary.later')}</p>
      <div className="onb-actions">
        <Button variant="primary" size="lg" disabled={busy} onClick={() => void finish()}>
          {t('onboarding.finish')}
        </Button>
      </div>
    </div>
  )
}

export function Onboarding() {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const go = (n: number): void => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }
  const languageChosen = settings.language !== null
  const steps = [
    <LanguageStep key="lang" onDone={() => go(1)} />,
    <FolderStep key="folder" onDone={() => go(2)} />,
    <PermissionsStep key="perm" onDone={() => go(3)} />,
    <SourceStep key="source" onDone={() => go(4)} />,
    <ShortcutsStep key="shortcuts" onDone={() => go(5)} />,
    <SummaryStep key="summary" />
  ]
  return (
    <div className="onboarding">
      <aside className="onb-rail">
        <div className="row nowrap onb-brand">
          <Logo size={36} />
          <div>
            <strong>Sonora</strong>
            <div className="faint">Sound Recorder</div>
          </div>
        </div>
        {languageChosen && (
          <ol className="onb-steps">
            {STEPS.map((k, i) => (
              <li key={k} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
                <span className="onb-step-dot">{i < step ? <Check size={12} strokeWidth={2.4} aria-hidden="true" /> : i + 1}</span>
                <span>{t(k)}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>
      <main className="onb-main" id="main">
        {step > 0 && (
          <Button size="sm" variant="ghost" icon={ArrowLeft} className="onb-back" onClick={() => go(step - 1)}>
            {t('common.back')}
          </Button>
        )}
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {steps[step]}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
