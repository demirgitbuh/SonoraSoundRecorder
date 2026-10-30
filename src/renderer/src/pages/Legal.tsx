import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LEGAL_VERSION, legalDoc } from '../../../shared/legal'
import type { LegalDocId } from '../../../shared/legal'
import { invoke } from '../api'
import { Button, Modal, Segmented } from '../components/controls'
import { useT } from '../i18n'
import { useApp } from '../stores/app'

/** One legal document, rendered as plain text sections (no HTML from data). */
export function LegalDocView({ id }: { id: LegalDocId }) {
  const locale = useApp((s) => s.locale)
  const doc = legalDoc(locale, id)
  return (
    <article className="legal-doc">
      {doc.sections.map((section, i) => (
        <section key={section.title} className="legal-section">
          <h3>
            <span className="legal-num tnum">{String(i + 1).padStart(2, '0')}</span>
            {section.title}
          </h3>
          {section.body.map((p, j) => (
            <p key={j}>{p}</p>
          ))}
        </section>
      ))}
    </article>
  )
}

function LegalTabs({ value, onChange }: { value: LegalDocId; onChange: (v: LegalDocId) => void }) {
  const t = useT()
  const locale = useApp((s) => s.locale)
  return (
    <Segmented<LegalDocId>
      label={t('legal.documents')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'terms', label: legalDoc(locale, 'terms').title },
        { value: 'privacy', label: legalDoc(locale, 'privacy').title }
      ]}
    />
  )
}

function LegalBody({ doc }: { doc: LegalDocId }) {
  return (
    <div className="legal-scroll">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={doc} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
          <LegalDocView id={doc} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** Read-only view of the Terms of Use and the Privacy Policy. */
export function LegalModal({ open, initial, onClose }: { open: boolean; initial: LegalDocId; onClose: () => void }) {
  const t = useT()
  const [doc, setDoc] = useState<LegalDocId>(initial)
  const [shownFor, setShownFor] = useState(initial)
  if (initial !== shownFor) {
    setShownFor(initial)
    setDoc(initial)
  }
  return (
    <Modal open={open} wide title={t('legal.title')} onClose={onClose} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <div className="stack">
        <LegalTabs value={doc} onChange={setDoc} />
        <LegalBody doc={doc} />
      </div>
    </Modal>
  )
}

/** Asks once for acceptance of the current terms; quitting is the only alternative. */
export function LegalConsentDialog() {
  const t = useT()
  const [doc, setDoc] = useState<LegalDocId>('terms')
  const [busy, setBusy] = useState(false)
  const accept = async (): Promise<void> => {
    setBusy(true)
    try {
      await useApp.getState().updateSettings({ legal: { acceptedVersion: LEGAL_VERSION, acceptedAt: new Date().toISOString() } })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      wide
      dismissable={false}
      title={t('legal.consentTitle')}
      onClose={() => undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => void invoke('app:quit')}>
            {t('legal.quit')}
          </Button>
          <Button variant="primary" disabled={busy} data-autofocus onClick={() => void accept()}>
            {t('legal.accept')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <LegalTabs value={doc} onChange={setDoc} />
        <LegalBody doc={doc} />
      </div>
    </Modal>
  )
}
