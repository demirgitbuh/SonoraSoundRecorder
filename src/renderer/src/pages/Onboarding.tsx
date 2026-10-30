import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import { LEGAL_VERSION, legalDoc } from '../../../shared/legal'
import type { LegalDocId } from '../../../shared/legal'
import { LOCALES, LOCALE_NATIVE_NAMES } from '../../../shared/types'
import type { FolderCheck, Locale, PermissionStatus, SourceKind } from '../../../shared/types'
import { acceleratorKeycaps } from '../../../shared/shortcuts'
import { AppError, invoke, platform } from '../api'
import { engine } from '../audio/engine'
import { Button, Keycaps, Logo, Notice, Segmented } from '../components/controls'
import { ArrowLeft, ArrowRight, Check, FolderOpen, ICON_STROKE, Mic, MonitorSpeaker } from '../components/icons'
import { OkPill, WarnPill } from '../components/status'
import { WaveArt } from '../components/wave-art'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useDevices } from '../stores/devices'
import { formatBytes } from '../util/format'
import { LegalModal } from './Legal'
import { ShortcutEditor } from './ShortcutEditor'

const STEPS: MessageKey[] = [
  'onboarding.step.language',
  'onboarding.step.folder',
  'onboarding.step.permissions',
  'onboarding.step.source',
  'onboarding.step.shortcuts',
  'onboarding.step.summary'
]

const EASE = [0.22, 1, 0.36, 1] as const

/** Children of a step enter one after another. */
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } }
}
const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } }
}

function Step({ index, title, children, actions }: { index: number; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <motion.div className="onb-step" variants={stagger} initial="hidden" animate="show">
      <motion.span className="onb-count tnum" variants={rise}>
        {String(index + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
      </motion.span>
      <motion.h1 variants={rise}>{title}</motion.h1>
      {children}
      <motion.div className="onb-actions" variants={rise}>
        {actions}
      </motion.div>
    </motion.div>
  )
}

function Rise({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={rise} className={className}>
      {children}
    </motion.div>
  )
}

function NextButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <Button variant="primary" size="lg" className="onb-next" disabled={disabled} onClick={onClick}>
      {label}
      <ArrowRight size={17} strokeWidth={ICON_STROKE} aria-hidden="true" />
    </Button>
  )
}

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
    <Step index={0} title={t('onboarding.language.title')} actions={<NextButton disabled={!chosen} onClick={onDone} label={t('common.continue')} />}>
      <motion.div className="language-grid" role="radiogroup" aria-label={t('onboarding.language.title')} variants={stagger}>
        {LOCALES.map((l) => (
          <motion.button
            key={l}
            type="button"
            role="radio"
            aria-checked={chosen === l}
            lang={l}
            className={`language-option ${chosen === l ? 'selected' : ''}`}
            onClick={() => void choose(l)}
            variants={rise}
          >
            <span className="language-name">{LOCALE_NATIVE_NAMES[l]}</span>
            {l === suggested && !chosen && <span className="badge">{t('onboarding.language.suggested')}</span>}
            {chosen === l && <Check size={18} strokeWidth={2} aria-hidden="true" />}
          </motion.button>
        ))}
      </motion.div>
    </Step>
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
    let alive = true
    void invoke('files:check-folder', dir).then((c) => alive && setCheck(c))
    return () => {
      alive = false
    }
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
    <Step
      index={1}
      title={t('onboarding.folder.title')}
      actions={<NextButton disabled={!!check && check.exists && !check.writable} onClick={() => void use()} label={t('onboarding.folder.use')} />}
    >
      <Rise className="card card-pad folder-box">
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
      </Rise>
      {error && <Notice kind="error">{t(error as MessageKey)}</Notice>}
    </Step>
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
  const micDenied = tested === 'denied' || perm?.microphone === 'denied'
  return (
    <Step index={2} title={t('onboarding.permissions.title')} actions={<NextButton onClick={onDone} label={t('common.continue')} />}>
      <Rise className="card card-pad onb-perm">
        <span className="onb-perm-icon">
          <Mic size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </span>
        <strong className="onb-perm-name">{t('permissions.microphone')}</strong>
        <div className="onb-perm-state">
          {micOk ? <OkPill>{t('permissions.granted')}</OkPill> : micDenied ? <WarnPill>{t('permissions.denied')}</WarnPill> : null}
        </div>
        <div className="row onb-perm-actions">
          <Button size="sm" onClick={() => void test()}>
            {micOk ? t('permissions.testAgain') : t('permissions.allowMic')}
          </Button>
          {micDenied && caps.platform !== 'linux' && (
            <Button size="sm" variant="ghost" onClick={() => void invoke('permissions:open-settings', 'microphone')}>
              {t('permissions.openSettings')}
            </Button>
          )}
        </div>
      </Rise>
      {tested === 'error' && <Notice kind="error">{t('capture.errorMicGeneric')}</Notice>}
      <Rise className="card card-pad onb-perm">
        <span className="onb-perm-icon">
          <MonitorSpeaker size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </span>
        <strong className="onb-perm-name">{t('permissions.systemAudio')}</strong>
        <div className="onb-perm-state">
          {caps.systemAudio.status === 'supported' ? (
            <OkPill>{t('platform.available')}</OkPill>
          ) : caps.systemAudio.status === 'needs-permission' ? (
            <WarnPill>{t('permissions.needed')}</WarnPill>
          ) : (
            <WarnPill>{t('platform.unavailable')}</WarnPill>
          )}
        </div>
        {caps.systemAudio.status === 'needs-permission' && (
          <div className="row onb-perm-actions">
            <Button size="sm" onClick={() => void invoke('permissions:open-settings', 'screen')}>
              {t('permissions.openSettings')}
            </Button>
          </div>
        )}
      </Rise>
    </Step>
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
    <Step index={3} title={t('onboarding.source.title')} actions={<NextButton onClick={onDone} label={t('common.continue')} />}>
      <Rise className="card card-pad stack">
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
      </Rise>
    </Step>
  )
}

function ShortcutsStep({ onDone }: { onDone: () => void }) {
  const t = useT()
  return (
    <Step index={4} title={t('onboarding.shortcuts.title')} actions={<NextButton onClick={onDone} label={t('common.continue')} />}>
      <Rise className="card card-pad">
        <ShortcutEditor />
      </Rise>
    </Step>
  )
}

function SummaryStep() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const settings = useApp((s) => s.settings)!
  const update = useApp((s) => s.updateSettings)
  const inputs = useDevices((s) => s.inputs)
  const [busy, setBusy] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [legal, setLegal] = useState<LegalDocId | null>(null)
  const space = t('keys.space')
  const mic = inputs.find((d) => d.deviceId === settings.audio.defaultMicDeviceId)?.label || t('devices.systemDefault')
  const finish = async (): Promise<void> => {
    setBusy(true)
    try {
      const first = settings.sessions[0]
      const sessions = settings.sessions.map((s) =>
        s.id === first?.id ? { ...s, source: settings.recording.defaultSource, micDeviceId: settings.audio.defaultMicDeviceId } : s
      )
      await update({ onboardingCompleted: true, sessions, legal: { acceptedVersion: LEGAL_VERSION, acceptedAt: new Date().toISOString() } })
      engine.start()
    } finally {
      setBusy(false)
    }
  }
  const rows: Array<[MessageKey, string]> = [
    ['settings.general.language', LOCALE_NATIVE_NAMES[settings.language ?? 'en']],
    ['settings.files.folder', settings.files.recordingsDir ?? '—'],
    ['settings.recording.defaultSource', t(settings.recording.defaultSource === 'mic' ? 'source.mic' : settings.recording.defaultSource === 'system' ? 'source.system' : 'source.both')],
    ['record.micDevice', mic],
    ['onboarding.summary.format', 'WAV · 48 kHz · ' + t('audio.stereo') + ' · 24-bit'],
    ['shortcuts.scope', settings.shortcuts.scope === 'global' ? t('shortcuts.scopeGlobal') : t('shortcuts.scopeApp')]
  ]
  return (
    <Step
      index={5}
      title={t('onboarding.summary.title')}
      actions={<NextButton disabled={busy || !agreed} onClick={() => void finish()} label={t('onboarding.finish')} />}
    >
      <Rise className="card card-pad">
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
      </Rise>
      <Rise className="onb-legal">
        <label className="checkbox">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>{t('legal.agree')}</span>
        </label>
        <div className="onb-legal-links">
          <button type="button" className="link-btn" onClick={() => setLegal('terms')}>
            {legalDoc(locale, 'terms').title}
          </button>
          <button type="button" className="link-btn" onClick={() => setLegal('privacy')}>
            {legalDoc(locale, 'privacy').title}
          </button>
        </div>
      </Rise>
      <LegalModal open={legal !== null} initial={legal ?? 'terms'} onClose={() => setLegal(null)} />
    </Step>
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
        <div className="onb-brand">
          <Logo size={40} />
          <div className="onb-wordmark">
            <span className="display">Sonora</span>
            <span className="onb-wordmark-sub">Sound Recorder</span>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {languageChosen && (
            <motion.ol className="onb-steps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              {STEPS.map((k, i) => (
                <li key={k} className={i === step ? 'current' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
                  <span className="onb-step-dot">{i < step ? <Check size={12} strokeWidth={2.4} aria-hidden="true" /> : i + 1}</span>
                  <span>{t(k)}</span>
                  {i === step && <motion.span layoutId="onb-current" className="onb-step-bg" transition={{ duration: 0.22, ease: EASE }} />}
                </li>
              ))}
            </motion.ol>
          )}
        </AnimatePresence>
        <div className="onb-art">
          <WaveArt />
        </div>
      </aside>
      <main className="onb-main" id="main">
        <div className="onb-progress" aria-hidden="true">
          <motion.span animate={{ scaleX: (step + 1) / STEPS.length }} transition={{ duration: 0.3, ease: EASE }} />
        </div>
        {step > 0 && (
          <Button size="sm" variant="ghost" icon={ArrowLeft} className="onb-back" onClick={() => go(step - 1)}>
            {t('common.back')}
          </Button>
        )}
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -18 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {steps[step]}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
