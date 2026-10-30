import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { PendingRun } from '../../../shared/ipc'
import { AppError, invoke } from '../api'
import { engine } from '../audio/engine'
import { Button, Modal, Notice } from '../components/controls'
import { ArrowRight, CircleCheck, ICON_STROKE, MonitorSpeaker, Mic } from '../components/icons'
import { WaveArt } from '../components/wave-art'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useEngine } from '../stores/engine'
import { formatBytes, formatClock, formatDate, formatDateTime } from '../util/format'

/** Tiny, safe Markdown subset for release notes (no HTML is ever injected). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={i++}>{tok.slice(1, -1)}</code>)
    else out.push(<span key={i++}>{tok.slice(1, tok.indexOf(']'))}</span>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function ReleaseNotes({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = (): void => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      list.push(bullet[1]!)
      continue
    }
    flush()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) blocks.push(<h4 key={`h${blocks.length}`}>{inline(heading[1]!)}</h4>)
    else if (line.trim() === '' || /^\|?[-:| ]+\|?$/.test(line)) continue
    else blocks.push(<p key={`p${blocks.length}`}>{inline(line.replace(/\|/g, ' '))}</p>)
  }
  flush()
  return <div className="release-notes">{blocks}</div>
}

export function UpdateDialog() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const open = useApp((s) => s.updateDialog)
  const setOpen = useApp((s) => s.setUpdateDialog)
  const update = useApp((s) => s.update)
  const shown = useRef(new Set<string>())

  // A newly found version is presented once; nothing is downloaded without the user's choice.
  useEffect(() => {
    if (update?.phase === 'available' && update.release && !shown.current.has(update.release.version)) {
      shown.current.add(update.release.version)
      setOpen(true)
    }
  }, [update, setOpen])

  if (!update) return null
  const rel = update.release
  const phase = update.phase
  const call = (fn: () => Promise<unknown>): void => {
    fn().catch((err) => useApp.getState().toast('error', 'updates.errorGeneric', { detail: err instanceof AppError ? (err.detail ?? err.key) : undefined }))
  }
  const footer =
    phase === 'available' || phase === 'error' ? (
      <>
        <Button onClick={() => setOpen(false)}>{t('update.later')}</Button>
        {phase === 'error' ? (
          <Button onClick={() => call(() => invoke('update:check'))}>{t('update.retryCheck')}</Button>
        ) : null}
        {rel && (
          <>
            <Button onClick={() => call(() => invoke('update:download', false))}>{t('update.download')}</Button>
            <Button variant="primary" onClick={() => call(() => invoke('update:download', true))}>
              {update.autoInstall ? t('update.downloadAndUpdate') : t('update.downloadAndOpen')}
            </Button>
          </>
        )}
      </>
    ) : phase === 'downloaded' ? (
      <>
        <Button onClick={() => setOpen(false)}>{t('update.later')}</Button>
        <Button variant="primary" onClick={() => call(() => invoke('update:install'))}>
          {update.autoInstall ? t('update.installNow') : t('update.openDownload')}
        </Button>
      </>
    ) : (
      <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
    )

  const percent = update.progress ? Math.round(update.progress.percent) : 0
  const waveProgress = phase === 'downloading' ? percent : phase === 'downloaded' || phase === 'installing' || phase === 'waiting-for-idle' ? 100 : undefined
  const newer = rel && phase !== 'not-available'

  return (
    <Modal open={open} title={rel ? t('update.title', { version: rel.version }) : t('update.titleGeneric')} onClose={() => setOpen(false)} wide footer={footer}>
      <div className="stack">
        <div className={`update-hero phase-${phase}`}>
          <div className="update-versions">
            <span className={`update-v ${newer ? 'from' : ''}`}>{update.currentVersion}</span>
            {newer && rel && (
              <>
                <motion.span className="update-arrow" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, delay: 0.08 }}>
                  <ArrowRight size={22} strokeWidth={ICON_STROKE} aria-hidden="true" />
                </motion.span>
                <motion.span className="update-v to" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}>
                  {rel.version}
                </motion.span>
              </>
            )}
            {phase === 'not-available' && <CircleCheck className="update-ok" size={24} strokeWidth={ICON_STROKE} aria-hidden="true" />}
          </div>
          <div
            className="update-wave"
            role={phase === 'downloading' ? 'progressbar' : undefined}
            aria-label={phase === 'downloading' ? t('update.progressLabel') : undefined}
            aria-valuemin={phase === 'downloading' ? 0 : undefined}
            aria-valuemax={phase === 'downloading' ? 100 : undefined}
            aria-valuenow={phase === 'downloading' ? percent : undefined}
          >
            <WaveArt progress={waveProgress} className={phase === 'installing' || phase === 'checking' ? 'is-busy' : ''} />
          </div>
          <div className="update-caption tnum">
            {phase === 'downloading' && update.progress
              ? `${percent}%${update.progress.total ? ` · ${formatBytes(update.progress.transferred, locale)} / ${formatBytes(update.progress.total, locale)}` : ''}`
              : phase === 'checking'
                ? t('update.checking')
                : phase === 'not-available'
                  ? t('update.upToDate', { version: update.currentVersion })
                  : rel?.publishedAt
                    ? formatDate(rel.publishedAt, locale)
                    : ''}
          </div>
        </div>
        {phase === 'waiting-for-idle' && <Notice kind="warning">{t('update.waitingForIdle')}</Notice>}
        {phase === 'installing' && <Notice>{t('update.installing')}</Notice>}
        {phase === 'downloaded' && !update.autoInstall && update.downloadedFile && (
          <Notice title={t('update.manualTitle')}>{t(`update.manual.${update.installKind}` as MessageKey, { file: update.downloadedFile })}</Notice>
        )}
        {phase === 'error' && update.errorKey && (
          <Notice kind="error" title={t('update.errorTitle')}>
            {t(update.errorKey as MessageKey)}
            {update.errorDetail ? <span className="faint"> ({update.errorDetail})</span> : null}
          </Notice>
        )}
        {newer && rel && rel.notes && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">{t('update.notes')}</span>
            <ReleaseNotes text={rel.notes} />
          </div>
        )}
      </div>
    </Modal>
  )
}

function RunRow({ run }: { run: PendingRun }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const openEditor = useApp((s) => s.openEditor)
  const setOpen = useApp((s) => s.setRecoveryDialog)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const recs = await invoke('runs:save', run.runId, { name: null, encoding: run.encoding, keep: null, saveMode: 'edited-only', markers: run.markers, normalize: false })
      useApp.getState().toast('success', 'notify.saved', { params: { name: recs[0]?.name ?? '' } })
    } catch (err) {
      useApp.getState().toast('error', 'notify.saveFailed', { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected' })
    } finally {
      setBusy(false)
    }
  }
  const discard = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('runs:discard', run.runId)
    } finally {
      setBusy(false)
    }
  }
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }} className="run-row">
      <div className="run-icon" aria-hidden="true">
        {run.source === 'system' ? <MonitorSpeaker size={18} strokeWidth={ICON_STROKE} /> : <Mic size={18} strokeWidth={ICON_STROKE} />}
      </div>
      <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
        <div className="row nowrap">
          <strong className="truncate">{run.suggestedName}</strong>
          <span className={`status ${run.kind === 'crashed' ? 'is-warning' : 'is-busy'}`}>
            {run.kind === 'crashed' ? t('recovery.kindCrashed') : t('recovery.kindUnsaved')}
          </span>
        </div>
        <span className="faint tnum">
          {run.sessionName} · {formatDateTime(run.startedAt, locale)} · {formatClock(run.durationMs, true)} · {formatBytes(run.sizeBytes, locale)}
        </span>
      </div>
      <div className="row">
        {confirm ? (
          <>
            <Button size="sm" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="danger-solid" disabled={busy} onClick={() => void discard()}>
              {t('recovery.confirmDiscard')}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(true)}>
              {t('recovery.discard')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              {t('recovery.save')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                openEditor({ kind: 'run', runId: run.runId, sessionId: null })
              }}
            >
              {t('recovery.open')}
            </Button>
          </>
        )}
      </div>
    </motion.li>
  )
}

export function RecoveryDialog() {
  const t = useT()
  const open = useApp((s) => s.recoveryDialog)
  const setOpen = useApp((s) => s.setRecoveryDialog)
  const runs = useApp((s) => s.pendingRuns)
  const sessions = useEngine((s) => s.sessions)
  const inPreview = new Set(Object.values(sessions).map((s) => s.previewRunId).filter(Boolean))
  const list = runs.filter((r) => !inPreview.has(r.runId))
  useEffect(() => {
    if (open && list.length === 0) setOpen(false)
  }, [open, list.length, setOpen])
  return (
    <Modal open={open} title={t('recovery.title')} onClose={() => setOpen(false)} wide footer={<Button onClick={() => setOpen(false)}>{t('recovery.later')}</Button>}>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t('recovery.body')}
      </p>
      <ul className="run-list">
        <AnimatePresence initial={false}>
          {list.map((r) => (
            <Fragment key={r.runId}>
              <RunRow run={r} />
            </Fragment>
          ))}
        </AnimatePresence>
      </ul>
    </Modal>
  )
}

export function NameDialog() {
  const t = useT()
  const pending = useApp((s) => s.nameDialog)
  const setPending = useApp((s) => s.setNameDialog)
  const runs = useApp((s) => s.pendingRuns)
  const run = pending ? runs.find((r) => r.runId === pending.runId) : undefined
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (run) setName(run.suggestedName)
  }, [run?.runId])
  if (!pending) return null
  const controller = engine.controller(pending.sessionId)
  const editFirst = (): void => {
    setPending(null)
    useApp.getState().openEditor({ kind: 'run', runId: pending.runId, sessionId: pending.sessionId })
  }
  const save = async (): Promise<void> => {
    if (!run) return
    setBusy(true)
    controller?.resolvePreview('saving')
    try {
      const recs = await invoke('runs:save', run.runId, {
        name: name.trim() || null,
        encoding: run.encoding,
        keep: null,
        saveMode: 'edited-only',
        markers: run.markers,
        normalize: useApp.getState().settings?.export.normalize ?? false
      })
      controller?.resolvePreview('saved')
      useApp.getState().toast('success', 'notify.saved', { params: { name: recs[0]?.name ?? '' } })
      setPending(null)
    } catch (err) {
      controller?.resolvePreview('save-failed')
      useApp.getState().toast('error', 'notify.saveFailed', { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={!!pending}
      title={t('nameDialog.title')}
      onClose={editFirst}
      footer={
        <>
          <Button onClick={editFirst}>{t('nameDialog.editFirst')}</Button>
          <Button variant="primary" disabled={busy || !run} onClick={() => void save()}>
            {t('nameDialog.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label className="stack" style={{ gap: 6 }}>
          <span className="field-label">{t('nameDialog.label')}</span>
          <input className="input" data-autofocus value={name} maxLength={180} onChange={(e) => setName(e.target.value)} />
        </label>
      </form>
    </Modal>
  )
}
