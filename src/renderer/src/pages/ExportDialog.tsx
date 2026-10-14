import { useState } from 'react'
import type { AudioFormat, CustomEncoding, QualityProfile } from '../../../shared/types'
import { AppError, invoke } from '../api'
import { Button, Modal, Segmented } from '../components/controls'
import { useT } from '../i18n'
import { useApp } from '../stores/app'
import { FormatEditor } from './RecordPanels'
import { reportBulk } from './bulk'

/** Exports one or more recordings, keeping the original format or converting with FFmpeg. */
export function ExportDialog({ open, ids, onClose }: { open: boolean; ids: string[]; onClose: () => void }) {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const [mode, setMode] = useState<'original' | 'convert'>('original')
  const [fmt, setFmt] = useState<{ format: AudioFormat; profile: QualityProfile; custom: CustomEncoding }>({
    format: settings.recording.defaultFormat,
    profile: settings.recording.defaultProfile,
    custom: settings.recording.defaultCustom
  })
  const [normalize, setNormalize] = useState(settings.export.normalize)
  const [busy, setBusy] = useState(false)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await invoke('library:export', ids, {
        format: mode === 'original' ? 'original' : fmt.format,
        profile: fmt.profile,
        custom: fmt.custom,
        normalize
      })
      if (res) {
        reportBulk(res, 'export.done', 'export.failed')
        onClose()
      }
    } catch (err) {
      useApp.getState().toast('error', 'export.failed', { bodyKey: err instanceof AppError ? err.key : 'errors.unexpected' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={ids.length > 1 ? t('export.titleMany', { count: ids.length }) : t('export.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void run()}>
            {busy ? t('export.working') : t('export.chooseAndExport')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Segmented<'original' | 'convert'>
          label={t('export.mode')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'original', label: t('export.keepFormat') },
            { value: 'convert', label: t('export.convert') }
          ]}
        />
        {mode === 'convert' && <FormatEditor format={fmt.format} profile={fmt.profile} custom={fmt.custom} onChange={setFmt} />}
        <label className="checkbox">
          <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
          {t('export.normalize')}
        </label>
        <p className="field-desc">{normalize ? t('export.normalizeDesc') : t('export.noProcessing')}</p>
      </div>
    </Modal>
  )
}
