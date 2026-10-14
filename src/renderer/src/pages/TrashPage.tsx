import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { BulkResult } from '../../../shared/types'
import { invoke } from '../api'
import { Button, Modal } from '../components/controls'
import { ICON_STROKE, RotateCcw, Trash2 } from '../components/icons'
import { EmptyTrashArt } from '../components/illustrations'
import { useT } from '../i18n'
import { useApp } from '../stores/app'
import { useLibrary } from '../stores/library'
import { formatBytes, formatClock, formatDateTime } from '../util/format'
import { reportBulk } from './bulk'

export function TrashPage() {
  const t = useT()
  const locale = useApp((s) => s.locale)
  const recordings = useLibrary((s) => s.recordings)
  const items = recordings.filter((r) => r.trash).sort((a, b) => b.trash!.trashedAt.localeCompare(a.trash!.trashedAt))
  const [confirm, setConfirm] = useState<{ ids: string[]; all: boolean } | null>(null)

  const restore = async (ids: string[]): Promise<void> => {
    const res: BulkResult = await invoke('library:restore', ids)
    reportBulk(res, 'trash.restored', 'trash.restoreFailed')
    // Explain when a file could not go back to its original place or name.
    for (const r of res.results) {
      if (r.ok && r.detail === 'relocated') useApp.getState().toast('warning', 'trash.relocated', { params: { name: r.name }, detail: r.outputPath })
      else if (r.ok && r.detail === 'renamed') useApp.getState().toast('info', 'trash.renamed', { params: { name: r.name } })
    }
  }

  const remove = async (): Promise<void> => {
    if (!confirm) return
    const res = confirm.all ? await invoke('library:empty-trash') : await invoke('library:delete-forever', confirm.ids)
    reportBulk(res, 'trash.deleted', 'trash.deleteFailed')
    setConfirm(null)
  }

  return (
    <div className="trash-page">
      <div className="page-head">
        <div>
          <h1>{t('nav.trash')}</h1>
          <p className="muted">{t('trash.subtitle')}</p>
        </div>
        {items.length > 0 && (
          <Button variant="danger" icon={Trash2} onClick={() => setConfirm({ ids: items.map((r) => r.id), all: true })}>
            {t('trash.empty')}
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <EmptyTrashArt />
          <h3>{t('trash.emptyTitle')}</h3>
          <p>{t('trash.emptyBody')}</p>
        </div>
      ) : (
        <ul className="trash-list">
          <AnimatePresence initial={false}>
            {items.map((r) => (
              <motion.li key={r.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="card trash-item">
                <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <strong className="truncate">{r.name}</strong>
                  <span className="faint tnum truncate">
                    {t('trash.deletedAt', { date: formatDateTime(r.trash!.trashedAt, locale) })} · {formatClock(r.durationMs)} · {formatBytes(r.sizeBytes, locale)}
                  </span>
                  <span className="faint truncate" title={r.trash!.originalPath}>
                    {t('trash.originalLocation', { path: r.trash!.originalPath })}
                  </span>
                </div>
                <Button size="sm" icon={RotateCcw} onClick={() => void restore([r.id])}>
                  {t('trash.restore')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setConfirm({ ids: [r.id], all: false })}>
                  <Trash2 size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  {t('trash.deleteForever')}
                </Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <Modal
        open={!!confirm}
        title={confirm?.all ? t('trash.emptyConfirmTitle') : t('trash.deleteConfirmTitle')}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="danger-solid" onClick={() => void remove()}>
              {t('trash.deleteForever')}
            </Button>
          </>
        }
      >
        <p>{t('trash.deleteConfirmBody', { count: confirm?.ids.length ?? 0 })}</p>
      </Modal>
    </div>
  )
}
