import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppError, invoke } from '../api'
import { Button, IconButton, Modal } from '../components/controls'
import { ChevronRight, Folder, ICON_STROKE, Pencil, Plus, Tag, Trash2 } from '../components/icons'
import { useT } from '../i18n'
import type { MessageKey } from '../i18n'
import { useApp } from '../stores/app'
import { useLibrary } from '../stores/library'

type Kind = 'folder' | 'tag'

function NameModal({ open, title, initial, onClose, onSubmit }: { open: boolean; title: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const t = useT()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await onSubmit(name.trim())
                onClose()
              } catch (err) {
                setError(err instanceof AppError ? err.key : 'errors.unexpected')
              }
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <input className="input" data-autofocus value={name} maxLength={80} aria-label={title} onChange={(e) => setName(e.target.value)} />
      {error && <p className="field-desc warn-text">{t(error as MessageKey)}</p>}
    </Modal>
  )
}

export function CollectionsPage() {
  const t = useT()
  const folders = useLibrary((s) => s.folders)
  const tags = useLibrary((s) => s.tags)
  const recordings = useLibrary((s) => s.recordings)
  const openArchive = useApp((s) => s.openArchive)
  const [editing, setEditing] = useState<{ kind: Kind; id: string | null; name: string } | null>(null)
  const [deleting, setDeleting] = useState<{ kind: Kind; id: string; name: string } | null>(null)
  const live = recordings.filter((r) => !r.trash)

  const submit = async (name: string): Promise<void> => {
    if (!editing) return
    if (editing.kind === 'folder') {
      if (editing.id) await invoke('library:folder-rename', editing.id, name)
      else await invoke('library:folder-create', name)
    } else if (editing.id) await invoke('library:tag-rename', editing.id, name)
    else await invoke('library:tag-create', name)
  }

  const section = (kind: Kind) => {
    const items = kind === 'folder' ? folders : tags
    const Icon = kind === 'folder' ? Folder : Tag
    return (
      <section className="card card-pad">
        <div className="card-head">
          <h2>{kind === 'folder' ? t('collections.folders') : t('collections.tags')}</h2>
          <Button size="sm" icon={Plus} onClick={() => setEditing({ kind, id: null, name: '' })}>
            {kind === 'folder' ? t('collections.newFolder') : t('collections.newTag')}
          </Button>
        </div>
        <p className="field-desc" style={{ marginBottom: 10 }}>
          {kind === 'folder' ? t('collections.foldersDesc') : t('collections.tagsDesc')}
        </p>
        {items.length === 0 ? (
          <p className="faint">{kind === 'folder' ? t('collections.noFolders') : t('collections.noTags')}</p>
        ) : (
          <ul className="collection-list">
            <AnimatePresence initial={false}>
              {items.map((item) => {
                const count = live.filter((r) => (kind === 'folder' ? r.folderId === item.id : r.tagIds.includes(item.id))).length
                return (
                  <motion.li key={item.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                    <button
                      type="button"
                      className="collection-open"
                      onClick={() => openArchive(kind === 'folder' ? { folderId: item.id } : { tagId: item.id })}
                    >
                      <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      <span className="truncate">{item.name}</span>
                      <span className="faint tnum">{t('collections.count', { count })}</span>
                      <ChevronRight size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
                    </button>
                    <IconButton icon={Pencil} small label={t('collections.rename', { name: item.name })} onClick={() => setEditing({ kind, id: item.id, name: item.name })} />
                    <IconButton icon={Trash2} small label={t('collections.delete', { name: item.name })} onClick={() => setDeleting({ kind, id: item.id, name: item.name })} />
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </section>
    )
  }

  return (
    <div className="collections-page">
      <div className="page-head">
        <div>
          <h1>{t('nav.collections')}</h1>
          <p className="muted">{t('collections.subtitle')}</p>
        </div>
      </div>
      <div className="two-col">
        {section('folder')}
        {section('tag')}
      </div>
      {editing && (
        <NameModal
          open
          key={`${editing.kind}-${editing.id ?? 'new'}`}
          title={
            editing.id
              ? t('collections.renameTitle')
              : editing.kind === 'folder'
                ? t('collections.newFolder')
                : t('collections.newTag')
          }
          initial={editing.name}
          onClose={() => setEditing(null)}
          onSubmit={submit}
        />
      )}
      <Modal
        open={!!deleting}
        title={t('collections.deleteTitle', { name: deleting?.name ?? '' })}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger-solid"
              onClick={async () => {
                if (deleting) await invoke(deleting.kind === 'folder' ? 'library:folder-delete' : 'library:tag-delete', deleting.id)
                setDeleting(null)
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{deleting?.kind === 'folder' ? t('collections.deleteFolderBody') : t('collections.deleteTagBody')}</p>
      </Modal>
    </div>
  )
}
