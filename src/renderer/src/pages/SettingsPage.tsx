import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { MachineFieldKey, SettingsCategory, SettingsProfile } from '../../../shared/settings'
import { LOCALES, LOCALE_NATIVE_NAMES } from '../../../shared/types'
import type { AudioFormat, CustomEncoding, FolderCheck, ModelInfo, PermissionStatus, QualityProfile } from '../../../shared/types'
import type { AutostartStatus, SettingsImportPreview } from '../../../shared/ipc'
import { timestampName } from '../../../shared/naming'
import { AppError, invoke } from '../api'
import { Button, Field, Modal, Notice, Segmented, Select, Switch } from '../components/controls'
import { defaultDeveloper } from '../../../shared/developer'
import {
  Accessibility,
  Bell,
  Cpu,
  FileAudio,
  FileText,
  FolderOpen,
  Keyboard,
  Mic,
  RefreshCw,
  RotateCcw,
  Settings,
  Terminal,
  Wrench
} from '../components/icons'
import type { LucideIcon } from '../components/icons'
import { OkPill, WarnPill } from '../components/status'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useDevices } from '../stores/devices'
import { formatBytes, formatDateTime } from '../util/format'
import { FormatEditor } from './RecordPanels'
import { ShortcutEditor } from './ShortcutEditor'
import { reportBulk } from './bulk'

/** Developer settings have their own page, so they are not a category here. */
type PageCategory = Exclude<SettingsCategory, 'developer'>

const CATEGORIES: Array<{ id: PageCategory; icon: LucideIcon; key: MessageKey }> = [
  { id: 'general', icon: Settings, key: 'settings.cat.general' },
  { id: 'recording', icon: Mic, key: 'settings.cat.recording' },
  { id: 'audio', icon: Cpu, key: 'settings.cat.audio' },
  { id: 'files', icon: FileAudio, key: 'settings.cat.files' },
  { id: 'shortcuts', icon: Keyboard, key: 'settings.cat.shortcuts' },
  { id: 'appearance', icon: Accessibility, key: 'settings.cat.appearance' },
  { id: 'notifications', icon: Bell, key: 'settings.cat.notifications' },
  { id: 'transcription', icon: FileText, key: 'settings.cat.transcription' },
  { id: 'updates', icon: RefreshCw, key: 'settings.cat.updates' },
  { id: 'advanced', icon: Wrench, key: 'settings.cat.advanced' }
]

const WHISPER_LANGUAGES: Array<[string, string]> = [
  ['en', 'English'],
  ['tr', 'Türkçe'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['zh', '中文'],
  ['ru', 'Русский'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['uk', 'Українська'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['ar', 'العربية'],
  ['hi', 'हिन्दी'],
  ['sv', 'Svenska']
]

function Section({ title, children, category }: { title: string; children: ReactNode; category: SettingsCategory }) {
  const t = useT()
  const [confirm, setConfirm] = useState(false)
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="card card-pad settings-card">{children}</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setConfirm(true)}>
          {t('settings.resetCategory')}
        </Button>
      </div>
      <Modal
        open={confirm}
        title={t('settings.resetCategoryTitle', { category: title })}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger-solid"
              onClick={async () => {
                const s = await invoke('settings:reset', category)
                useApp.getState().setSettings(s)
                setConfirm(false)
                useApp.getState().toast('success', 'settings.resetDone')
              }}
            >
              {t('settings.reset')}
            </Button>
          </>
        }
      >
        <p>{t('settings.resetCategoryBody')}</p>
      </Modal>
    </section>
  )
}

function GeneralSection() {
  const t = useT()
  const s = useApp((st) => st.settings)!
  const update = useApp((st) => st.updateSettings)
  const [autostart, setAutostart] = useState<AutostartStatus | null>(null)
  useEffect(() => {
    void invoke('autostart:status').then(setAutostart)
  }, [s.launchAtLogin])
  return (
    <Section title={t('settings.cat.general')} category="general">
      <Field label={t('settings.general.language')} description={t('settings.general.languageDesc')}>
        <Select label={t('settings.general.language')} value={s.language ?? 'en'} onChange={(e) => void update({ language: e.target.value as (typeof LOCALES)[number] })}>
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LOCALE_NATIVE_NAMES[l]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label={t('settings.general.launchAtLogin')}
        description={
          <>
            {t('settings.general.launchAtLoginDesc')}
            {autostart?.noteKey ? ` ${t(autostart.noteKey as MessageKey)}` : ''}
            {autostart && !autostart.supported ? ` ${t('settings.general.autostartUnsupported')}` : ''}
          </>
        }
      >
        <Switch
          checked={s.launchAtLogin}
          disabled={autostart ? !autostart.supported : false}
          label={t('settings.general.launchAtLogin')}
          onChange={(v) => void update({ launchAtLogin: v })}
        />
      </Field>
      <Field label={t('settings.general.startHidden')} description={t('settings.general.startHiddenDesc')}>
        <Switch checked={s.startHiddenAtLogin} disabled={!s.launchAtLogin} label={t('settings.general.startHidden')} onChange={(v) => void update({ startHiddenAtLogin: v })} />
      </Field>
      <Field label={t('settings.general.closeBehavior')} description={t('settings.general.closeBehaviorDesc')}>
        <span className="faint">{t('settings.general.toTray')}</span>
      </Field>
    </Section>
  )
}

function RecordingSection() {
  const t = useT()
  const s = useApp((st) => st.settings)!
  const update = useApp((st) => st.updateSettings)
  const r = s.recording
  return (
    <Section title={t('settings.cat.recording')} category="recording">
      <Field label={t('settings.recording.countdown')} description={t('settings.recording.countdownDesc')}>
        <Segmented<number>
          label={t('settings.recording.countdown')}
          value={r.countdownSeconds}
          onChange={(v) => void update({ recording: { countdownSeconds: v as 0 | 3 | 5 | 10 } })}
          options={[
            { value: 0, label: t('common.off') },
            { value: 3, label: '3 s' },
            { value: 5, label: '5 s' },
            { value: 10, label: '10 s' }
          ]}
        />
      </Field>
      <Field label={t('settings.recording.after')} description={t('settings.recording.afterDesc')} stacked>
        <Segmented<'autosave' | 'ask-name' | 'preview'>
          label={t('settings.recording.after')}
          value={r.postAction}
          onChange={(v) => void update({ recording: { postAction: v } })}
          options={[
            { value: 'preview', label: t('settings.recording.afterPreview') },
            { value: 'ask-name', label: t('settings.recording.afterAsk') },
            { value: 'autosave', label: t('settings.recording.afterAuto') }
          ]}
        />
      </Field>
      <Field label={t('settings.recording.defaultSource')} description={t('settings.recording.defaultSourceDesc')}>
        <Segmented<'mic' | 'system' | 'both'>
          label={t('settings.recording.defaultSource')}
          value={r.defaultSource}
          onChange={(v) => void update({ recording: { defaultSource: v } })}
          options={[
            { value: 'mic', label: t('source.mic') },
            { value: 'system', label: t('source.system') },
            { value: 'both', label: t('source.both') }
          ]}
        />
      </Field>
      <Field label={t('settings.recording.defaultOutput')} description={t('settings.recording.defaultOutputDesc')}>
        <Segmented<'combined' | 'separate' | 'both'>
          label={t('settings.recording.defaultOutput')}
          value={r.defaultOutputMode}
          onChange={(v) => void update({ recording: { defaultOutputMode: v } })}
          options={[
            { value: 'combined', label: t('output.combined') },
            { value: 'separate', label: t('output.separate') },
            { value: 'both', label: t('output.both') }
          ]}
        />
      </Field>
      <Field label={t('settings.recording.defaultFormat')} description={t('settings.recording.defaultFormatDesc')} stacked>
        <FormatEditor
          format={r.defaultFormat}
          profile={r.defaultProfile}
          custom={r.defaultCustom as CustomEncoding}
          onChange={(v: { format: AudioFormat; profile: QualityProfile; custom: CustomEncoding }) =>
            void update({ recording: { defaultFormat: v.format, defaultProfile: v.profile, defaultCustom: v.custom } })
          }
        />
      </Field>
      <Field label={t('settings.recording.normalize')} description={t('settings.recording.normalizeDesc')}>
        <Switch checked={s.export.normalize} label={t('settings.recording.normalize')} onChange={(v) => void update({ export: { normalize: v } })} />
      </Field>
    </Section>
  )
}

function AudioSection() {
  const t = useT()
  const s = useApp((st) => st.settings)!
  const caps = useApp((st) => st.caps)!
  const update = useApp((st) => st.updateSettings)
  const inputs = useDevices((st) => st.inputs)
  const [perm, setPerm] = useState<PermissionStatus | null>(null)
  useEffect(() => {
    void invoke('permissions:status').then(setPerm)
  }, [])
  const a = s.audio
  const supported = navigator.mediaDevices.getSupportedConstraints()
  const enh: Array<{ key: 'noiseSuppression' | 'echoCancellation' | 'autoGainControl'; label: MessageKey; desc: MessageKey }> = [
    { key: 'noiseSuppression', label: 'processing.noiseSuppression', desc: 'settings.audio.noiseDesc' },
    { key: 'echoCancellation', label: 'processing.echoCancellation', desc: 'settings.audio.echoDesc' },
    { key: 'autoGainControl', label: 'processing.autoGainControl', desc: 'settings.audio.agcDesc' }
  ]
  return (
    <Section title={t('settings.cat.audio')} category="audio">
      <Field label={t('settings.audio.defaultMic')} description={t('settings.audio.defaultMicDesc')}>
        <Select label={t('settings.audio.defaultMic')} value={a.defaultMicDeviceId ?? ''} onChange={(e) => void update({ audio: { defaultMicDeviceId: e.target.value || null } })}>
          <option value="">{t('devices.systemDefault')}</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('devices.unnamed')}
            </option>
          ))}
        </Select>
      </Field>
      {enh.map((e) => (
        <Field
          key={e.key}
          label={t(e.label)}
          description={
            <>
              {t(e.desc)} {!supported[e.key] ? <strong className="warn-text">{t('processing.unsupported')}</strong> : null}
            </>
          }
        >
          <Switch checked={a[e.key]} disabled={!supported[e.key]} label={t(e.label)} onChange={(v) => void update({ audio: e.key === 'noiseSuppression' ? { noiseSuppression: v } : e.key === 'echoCancellation' ? { echoCancellation: v } : { autoGainControl: v } })} />
        </Field>
      ))}
      <p className="field-desc" style={{ padding: '10px 0' }}>
        {t('settings.audio.processingNote')}
      </p>
      <Field label={t('permissions.microphone')} description={t(`permissions.desc.${caps.platform}` as MessageKey)}>
        {perm?.microphone === 'granted' ? (
          <OkPill>{t('permissions.granted')}</OkPill>
        ) : perm?.microphone === 'denied' || perm?.microphone === 'restricted' ? (
          <Button size="sm" onClick={() => void invoke('permissions:open-settings', 'microphone')}>
            {t('permissions.openSettings')}
          </Button>
        ) : (
          <Button size="sm" onClick={async () => setPerm(await invoke('permissions:request-mic'))}>
            {t('permissions.request')}
          </Button>
        )}
      </Field>
      <Field label={t('permissions.systemAudio')} description={t(`platform.systemAudio.${caps.systemAudio.method}` as MessageKey)}>
        {caps.systemAudio.status === 'supported' ? (
          <OkPill>{t('platform.available')}</OkPill>
        ) : caps.systemAudio.status === 'needs-permission' ? (
          <Button size="sm" onClick={() => void invoke('permissions:open-settings', 'screen')}>
            {t('permissions.openSettings')}
          </Button>
        ) : (
          <WarnPill>{t('platform.unavailable')}</WarnPill>
        )}
      </Field>
    </Section>
  )
}

function FilesSection() {
  const t = useT()
  const locale = useApp((st) => st.locale)
  const s = useApp((st) => st.settings)!
  const update = useApp((st) => st.updateSettings)
  const [check, setCheck] = useState<FolderCheck | null>(null)
  const [pendingMove, setPendingMove] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const dir = s.files.recordingsDir
  useEffect(() => {
    if (dir) void invoke('files:check-folder', dir).then(setCheck)
  }, [dir])
  const choose = async (): Promise<void> => {
    const picked = await invoke('dialog:choose-folder', dir)
    if (!picked || picked === dir) return
    try {
      const previous = dir
      await update({ files: { recordingsDir: picked } })
      useApp.getState().toast('success', 'settings.files.changed')
      if (previous) setPendingMove(picked)
    } catch (err) {
      useApp.getState().toast('error', 'errors.folderNotWritable', { detail: err instanceof AppError ? (err.detail ?? undefined) : undefined })
    }
  }
  return (
    <Section title={t('settings.cat.files')} category="files">
      <Field label={t('settings.files.folder')} description={dir ?? t('settings.files.noFolder')} stacked>
        <div className="row">
          <Button size="sm" icon={FolderOpen} onClick={() => void choose()}>
            {t('settings.files.change')}
          </Button>
          <Button size="sm" variant="ghost" disabled={!dir} onClick={() => void invoke('files:open-recordings-folder')}>
            {t('settings.files.open')}
          </Button>
          {check &&
            (check.writable ? (
              <OkPill>{t('settings.files.writable', { free: check.freeBytes !== null ? formatBytes(check.freeBytes, locale) : '—' })}</OkPill>
            ) : (
              <WarnPill>{t('settings.files.notWritable')}</WarnPill>
            ))}
        </div>
      </Field>
      <Field label={t('settings.files.move')} description={t('settings.files.moveDesc')}>
        <Button size="sm" disabled={!dir} onClick={() => dir && setPendingMove(dir)}>
          {t('settings.files.moveButton')}
        </Button>
      </Field>
      <Field label={t('settings.files.layout')} description={t('settings.files.layoutDesc')}>
        <Segmented<'flat' | 'by-date'>
          label={t('settings.files.layout')}
          value={s.files.layout}
          onChange={(v) => void update({ files: { layout: v } })}
          options={[
            { value: 'flat', label: t('settings.files.flat') },
            { value: 'by-date', label: t('settings.files.byDate') }
          ]}
        />
      </Field>
      <Field label={t('settings.files.naming')} description={t('settings.files.namingDesc')}>
        <code className="code-chip">{timestampName(new Date())}.wav</code>
      </Field>
      <Modal
        open={!!pendingMove}
        title={t('settings.files.moveTitle')}
        onClose={() => setPendingMove(null)}
        footer={
          <>
            <Button onClick={() => setPendingMove(null)}>{t('settings.files.keepWhereTheyAre')}</Button>
            <Button
              variant="primary"
              disabled={moving}
              onClick={async () => {
                if (!pendingMove) return
                setMoving(true)
                try {
                  reportBulk(await invoke('files:move-recordings', pendingMove), 'settings.files.moved', 'settings.files.moveFailed')
                } catch (err) {
                  useApp.getState().toast('error', 'settings.files.moveFailed', { bodyKey: err instanceof AppError ? err.key : undefined, params: { count: 0 } })
                } finally {
                  setMoving(false)
                  setPendingMove(null)
                }
              }}
            >
              {moving ? t('settings.files.moving') : t('settings.files.moveNow')}
            </Button>
          </>
        }
      >
        <p>{t('settings.files.moveBody', { path: pendingMove ?? '' })}</p>
      </Modal>
    </Section>
  )
}

function AppearanceSection() {
  const t = useT()
  const s = useApp((st) => st.settings)!
  const update = useApp((st) => st.updateSettings)
  return (
    <Section title={t('settings.cat.appearance')} category="appearance">
      <Field label={t('settings.appearance.theme')} description={t('settings.appearance.themeDesc')}>
        <Segmented<'light' | 'dark'>
          label={t('settings.appearance.theme')}
          value={s.theme}
          onChange={(v) => void update({ theme: v })}
          options={[
            { value: 'light', label: t('settings.appearance.light') },
            { value: 'dark', label: t('settings.appearance.dark') }
          ]}
        />
      </Field>
      <Field label={t('settings.appearance.scale')} description={t('settings.appearance.scaleDesc')}>
        <Select label={t('settings.appearance.scale')} value={s.uiScale} onChange={(e) => void update({ uiScale: Number(e.target.value) })}>
          {[0.9, 1, 1.1, 1.25, 1.5, 1.75].map((v) => (
            <option key={v} value={v}>
              {Math.round(v * 100)}%
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('settings.appearance.contrast')} description={t('settings.appearance.contrastDesc')}>
        <Switch checked={s.highContrast} label={t('settings.appearance.contrast')} onChange={(v) => void update({ highContrast: v })} />
      </Field>
      <Field label={t('settings.appearance.motion')} description={t('settings.appearance.motionDesc')}>
        <Segmented<'system' | 'on' | 'off'>
          label={t('settings.appearance.motion')}
          value={s.reduceMotion}
          onChange={(v) => void update({ reduceMotion: v })}
          options={[
            { value: 'system', label: t('settings.appearance.motionSystem') },
            { value: 'on', label: t('settings.appearance.motionReduce') },
            { value: 'off', label: t('settings.appearance.motionFull') }
          ]}
        />
      </Field>
      <Field label={t('settings.appearance.waveforms')} description={t('settings.appearance.waveformsDesc')}>
        <Switch checked={s.archive.showWaveforms} label={t('settings.appearance.waveforms')} onChange={(v) => void update({ archive: { showWaveforms: v } })} />
      </Field>
    </Section>
  )
}

function NotificationsSection() {
  const t = useT()
  const s = useApp((st) => st.settings)!
  const update = useApp((st) => st.updateSettings)
  const n = s.notifications
  return (
    <Section title={t('settings.cat.notifications')} category="notifications">
      <Field label={t('settings.notifications.scope')} description={t('settings.notifications.scopeDesc')}>
        <Segmented<'all' | 'errors'>
          label={t('settings.notifications.scope')}
          value={n.scope}
          onChange={(v) => void update({ notifications: { scope: v } })}
          options={[
            { value: 'all', label: t('settings.notifications.all') },
            { value: 'errors', label: t('settings.notifications.errorsOnly') }
          ]}
        />
      </Field>
      <Field label={t('settings.notifications.desktop')} description={t('settings.notifications.desktopDesc')}>
        <Switch checked={n.desktop} label={t('settings.notifications.desktop')} onChange={(v) => void update({ notifications: { desktop: v } })} />
      </Field>
      <Field label={t('settings.notifications.inApp')} description={t('settings.notifications.inAppDesc')}>
        <Switch checked={n.inApp} label={t('settings.notifications.inApp')} onChange={(v) => void update({ notifications: { inApp: v } })} />
      </Field>
      <Field label={t('settings.notifications.sounds')} description={t('settings.notifications.soundsDesc')}>
        <Switch checked={n.sounds} label={t('settings.notifications.sounds')} onChange={(v) => void update({ notifications: { sounds: v } })} />
      </Field>
    </Section>
  )
}

function TranscriptionSection() {
  const t = useT()
  const locale = useApp((st) => st.locale)
  const s = useApp((st) => st.settings)!
  const caps = useApp((st) => st.caps)!
  const update = useApp((st) => st.updateSettings)
  const [model, setModel] = useState<ModelInfo | null>(null)
  useEffect(() => {
    void invoke('transcribe:model-info').then(setModel)
  }, [s.transcription.modelPath])
  const choose = async (): Promise<void> => {
    const info = await invoke('transcribe:choose-model')
    if (info) setModel(info)
  }
  return (
    <Section title={t('settings.cat.transcription')} category="transcription">
      <Notice title={t('settings.transcription.privacyTitle')}>{t('settings.transcription.privacy')}</Notice>
      <Field label={t('settings.transcription.engine')} description={t('settings.transcription.engineDesc')}>
        {caps.whisper ? <OkPill>{t('platform.available')}</OkPill> : <WarnPill>{t('platform.unavailable')}</WarnPill>}
      </Field>
      <Field label={t('settings.transcription.model')} description={t('settings.transcription.modelFormat')} stacked>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row">
            <Button size="sm" icon={FolderOpen} onClick={() => void choose()}>
              {s.transcription.modelPath ? t('settings.transcription.changeModel') : t('settings.transcription.chooseModel')}
            </Button>
            {model && (model.valid ? <OkPill>{t('settings.transcription.modelValid', { family: model.family ?? '?' })}</OkPill> : <WarnPill>{t((model.reasonKey ?? 'transcription.model.errorHeader') as MessageKey)}</WarnPill>)}
          </div>
          {model && (
            <span className="faint truncate" title={model.path}>
              {model.fileName} · {formatBytes(model.sizeBytes, locale)}
              {model.multilingual === false ? ` · ${t('settings.transcription.englishOnly')}` : ''}
            </span>
          )}
          <p className="field-desc">{t('settings.transcription.modelHelp')}</p>
          <div className="row">
            <Button size="sm" variant="ghost" onClick={() => void invoke('app:open-external', 'https://huggingface.co/ggerganov/whisper.cpp/tree/main')}>
              {t('settings.transcription.whereToGet')}
            </Button>
          </div>
        </div>
      </Field>
      <Field label={t('settings.transcription.language')} description={t('settings.transcription.languageDesc')}>
        <Select label={t('settings.transcription.language')} value={s.transcription.language} onChange={(e) => void update({ transcription: { language: e.target.value } })}>
          <option value="auto">{t('settings.transcription.auto')}</option>
          {WHISPER_LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('settings.transcription.threads')} description={t('settings.transcription.threadsDesc')}>
        <Select label={t('settings.transcription.threads')} value={s.transcription.threads} onChange={(e) => void update({ transcription: { threads: Number(e.target.value) } })}>
          <option value={0}>{t('settings.transcription.threadsAuto')}</option>
          {[1, 2, 4, 6, 8, 12, 16].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
    </Section>
  )
}

function UpdatesSection() {
  const t = useT()
  const locale = useApp((st) => st.locale)
  const s = useApp((st) => st.settings)!
  const boot = useApp((st) => st.boot)!
  const update = useApp((st) => st.updateSettings)
  const status = useApp((st) => st.update)
  const setDialog = useApp((st) => st.setUpdateDialog)
  return (
    <Section title={t('settings.cat.updates')} category="updates">
      <Field label={t('settings.updates.version')} description={t(`update.kindLabel.${boot.capabilities.installKind}` as MessageKey)}>
        <code className="code-chip">{boot.version}</code>
      </Field>
      <Field label={t('settings.updates.onStartup')} description={t('settings.updates.onStartupDesc')}>
        <Switch checked={s.updates.checkOnStartup} label={t('settings.updates.onStartup')} onChange={(v) => void update({ updates: { checkOnStartup: v } })} />
      </Field>
      <Field
        label={t('settings.updates.check')}
        description={
          status?.checkedAt
            ? t('settings.updates.lastChecked', { date: formatDateTime(status.checkedAt, locale) })
            : t('settings.updates.never')
        }
      >
        <Button
          size="sm"
          icon={RefreshCw}
          disabled={status?.phase === 'checking' || status?.phase === 'downloading'}
          onClick={async () => {
            const res = await invoke('update:check')
            useApp.getState().setUpdate(res)
            setDialog(true)
          }}
        >
          {status?.phase === 'checking' ? t('update.checking') : t('settings.updates.checkNow')}
        </Button>
      </Field>
      <p className="field-desc" style={{ padding: '10px 0' }}>
        {t('update.dataSafe')}
      </p>
    </Section>
  )
}

function ImportDialog({ preview, onClose }: { preview: SettingsImportPreview; onClose: () => void }) {
  const t = useT()
  const inputs = useDevices((s) => s.inputs)
  const monitors = useDevices((s) => s.monitors)
  const known = new Set([...inputs, ...monitors].map((d) => d.deviceId))
  const fields = preview.machineFields.map((f) => {
    if (f.valid !== null || f.value === null) return f
    const ids = f.value.split(', ')
    const ok = ids.every((id) => known.has(id))
    return { ...f, valid: ok, reasonKey: ok ? null : 'settings.import.deviceUnavailable' }
  })
  const [accepted, setAccepted] = useState<MachineFieldKey[]>([])
  const labels: Record<MachineFieldKey, MessageKey> = {
    'files.recordingsDir': 'settings.import.fieldFolder',
    'transcription.modelPath': 'settings.import.fieldModel',
    'audio.defaultMicDeviceId': 'settings.import.fieldMic',
    'sessions.devices': 'settings.import.fieldSessionDevices'
  }
  return (
    <Modal
      open
      title={t('settings.import.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                const s = await invoke('settings:import-apply', preview.token, accepted)
                useApp.getState().setSettings(s)
                useApp.getState().toast('success', 'settings.import.done')
                onClose()
              } catch (err) {
                useApp.getState().toast('error', 'settings.import.failed', { bodyKey: err instanceof AppError ? err.key : undefined })
              }
            }}
          >
            {t('settings.import.apply')}
          </Button>
        </>
      }
    >
      <p className="muted">{t('settings.import.body')}</p>
      <ul className="machine-fields">
        {fields
          .filter((f) => f.value !== null)
          .map((f) => (
            <li key={f.key}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={f.valid !== true}
                  checked={accepted.includes(f.key)}
                  onChange={(e) => setAccepted(e.target.checked ? [...accepted, f.key] : accepted.filter((k) => k !== f.key))}
                />
                <span>
                  <strong>{t(labels[f.key])}</strong>
                  <span className="faint truncate" style={{ display: 'block' }}>
                    {f.value}
                  </span>
                  {f.valid === true ? <span className="ok-text">{t('settings.import.valid')}</span> : <span className="warn-text">{t((f.reasonKey ?? 'settings.import.unverified') as MessageKey)}</span>}
                </span>
              </label>
            </li>
          ))}
      </ul>
      <p className="field-desc">{t('settings.import.keepLocal')}</p>
    </Modal>
  )
}

function DeveloperModeField() {
  const t = useT()
  const s = useApp((st) => st.settings)!
  const update = useApp((st) => st.updateSettings)
  const navigate = useApp((st) => st.navigate)
  const [confirm, setConfirm] = useState(false)
  // Values configured earlier are kept while developer mode is off.
  const customized = JSON.stringify({ ...s.developer, enabled: false }) !== JSON.stringify(defaultDeveloper())
  return (
    <>
      <Field
        label={
          <span className="row nowrap" style={{ gap: 8 }}>
            <Terminal size={15} strokeWidth={1.6} aria-hidden="true" />
            {t('settings.advanced.developerMode')}
          </span>
        }
        description={
          <>
            {t('settings.advanced.developerModeDesc')}
            {!s.developer.enabled && customized ? ` ${t('settings.advanced.developerModeKept')}` : ''}
          </>
        }
      >
        {s.developer.enabled && (
          <Button size="sm" onClick={() => navigate('developer')}>
            {t('settings.advanced.openDeveloper')}
          </Button>
        )}
        <Switch
          checked={s.developer.enabled}
          label={t('settings.advanced.developerMode')}
          onChange={(v) => {
            if (v) setConfirm(true)
            else void update({ developer: { enabled: false } })
          }}
        />
      </Field>
      <Modal
        open={confirm}
        title={t('settings.advanced.developerModeTitle')}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={async () => {
                setConfirm(false)
                await update({ developer: { enabled: true } })
                navigate('developer')
              }}
            >
              {t('settings.advanced.developerModeEnable')}
            </Button>
          </>
        }
      >
        <p>{t('settings.advanced.developerModeBody')}</p>
      </Modal>
    </>
  )
}

function AdvancedSection() {
  const t = useT()
  const boot = useApp((st) => st.boot)!
  const [profiles, setProfiles] = useState<SettingsProfile[]>([])
  const [profileName, setProfileName] = useState('')
  const [preview, setPreview] = useState<SettingsImportPreview | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  useEffect(() => {
    void invoke('profiles:list').then(setProfiles)
  }, [])
  const toastError = (err: unknown): void => useApp.getState().toast('error', (err instanceof AppError ? err.key : 'errors.unexpected') as string)
  return (
    <section className="settings-section">
      <h2>{t('settings.cat.advanced')}</h2>
      <div className="card card-pad settings-card">
        <Field label={t('settings.advanced.export')} description={t('settings.advanced.exportDesc')}>
          <Button
            size="sm"
            onClick={async () => {
              try {
                const p = await invoke('settings:export')
                if (p) useApp.getState().toast('success', 'settings.advanced.exported', { detail: p })
              } catch (err) {
                toastError(err)
              }
            }}
          >
            {t('settings.advanced.exportButton')}
          </Button>
        </Field>
        <Field label={t('settings.advanced.import')} description={t('settings.advanced.importDesc')}>
          <Button
            size="sm"
            onClick={async () => {
              try {
                const p = await invoke('settings:import-preview')
                if (p) setPreview(p)
              } catch (err) {
                toastError(err)
              }
            }}
          >
            {t('settings.advanced.importButton')}
          </Button>
        </Field>
        <Field label={t('settings.advanced.profiles')} description={t('settings.advanced.profilesDesc')} stacked>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row nowrap">
              <input className="input" value={profileName} maxLength={60} placeholder={t('settings.advanced.profileName')} aria-label={t('settings.advanced.profileName')} onChange={(e) => setProfileName(e.target.value)} />
              <Button
                size="sm"
                disabled={!profileName.trim()}
                onClick={async () => {
                  setProfiles(await invoke('profiles:save', profileName.trim()))
                  setProfileName('')
                  useApp.getState().toast('success', 'settings.advanced.profileSaved')
                }}
              >
                {t('common.save')}
              </Button>
            </div>
            <ul className="profile-list">
              <AnimatePresence initial={false}>
                {profiles.map((p) => (
                  <motion.li key={p.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
                    <span className="truncate">{p.name}</span>
                    <div className="spacer" />
                    <Button
                      size="sm"
                      onClick={async () => {
                        const s = await invoke('profiles:apply', p.id)
                        useApp.getState().setSettings(s)
                        useApp.getState().toast('success', 'settings.advanced.profileApplied', { params: { name: p.name } })
                      }}
                    >
                      {t('common.apply')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => setProfiles(await invoke('profiles:delete', p.id))}>
                      {t('common.delete')}
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        </Field>
        <Field label={t('settings.advanced.logs')} description={t('settings.advanced.logsDesc')}>
          <Button
            size="sm"
            onClick={async () => {
              const p = await invoke('logs:export')
              if (p) useApp.getState().toast('success', 'settings.advanced.logsExported', { detail: p })
            }}
          >
            {t('settings.advanced.exportLogs')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void invoke('logs:open-folder')}>
            {t('settings.advanced.openLogs')}
          </Button>
        </Field>
        <DeveloperModeField />
        <Field label={t('settings.advanced.dataLocation')} description={t('settings.advanced.dataLocationDesc')}>
          <code className="code-chip truncate" title={boot.dataDir}>
            {boot.dataDir}
          </code>
        </Field>
        <Field label={t('settings.advanced.resetAll')} description={t('settings.advanced.resetAllDesc')}>
          <Button size="sm" variant="danger" onClick={() => setConfirmAll(true)}>
            {t('settings.advanced.resetAllButton')}
          </Button>
        </Field>
      </div>
      {preview && <ImportDialog preview={preview} onClose={() => setPreview(null)} />}
      <Modal
        open={confirmAll}
        title={t('settings.advanced.resetAll')}
        onClose={() => setConfirmAll(false)}
        footer={
          <>
            <Button onClick={() => setConfirmAll(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger-solid"
              onClick={async () => {
                const s = await invoke('settings:reset', 'all')
                useApp.getState().setSettings(s)
                setConfirmAll(false)
                useApp.getState().toast('success', 'settings.resetDone')
              }}
            >
              {t('settings.reset')}
            </Button>
          </>
        }
      >
        <p>{t('settings.advanced.resetAllBody')}</p>
      </Modal>
    </section>
  )
}

export function SettingsPage() {
  const t = useT()
  const [cat, setCat] = useState<PageCategory>('general')
  const body: Record<PageCategory, ReactNode> = {
    general: <GeneralSection />,
    recording: <RecordingSection />,
    audio: <AudioSection />,
    files: <FilesSection />,
    shortcuts: (
      <Section title={t('settings.cat.shortcuts')} category="shortcuts">
        <ShortcutEditor />
      </Section>
    ),
    appearance: <AppearanceSection />,
    notifications: <NotificationsSection />,
    transcription: <TranscriptionSection />,
    updates: <UpdatesSection />,
    advanced: <AdvancedSection />
  }
  return (
    <div className="settings-page">
      <div className="page-head">
        <div>
          <h1>{t('nav.settings')}</h1>
          <p className="muted">{t('settings.subtitle')}</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.categories')}>
          <ul>
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <button type="button" className={`settings-nav-item ${cat === c.id ? 'active' : ''}`} aria-current={cat === c.id ? 'true' : undefined} onClick={() => setCat(c.id)}>
                  {cat === c.id && <motion.span layoutId="settings-active" className="nav-active-bg" transition={{ duration: 0.2 }} />}
                  <c.icon size={16} strokeWidth={1.6} aria-hidden="true" />
                  <span>{t(c.key)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="settings-body">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={cat} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
              {body[cat]}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

