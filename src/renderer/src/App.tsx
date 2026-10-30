import { Suspense, lazy, useEffect } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { legalAccepted } from '../../shared/legal'
import { useApp } from './stores/app'
import { LiveRegion, Sidebar, TitleBar, Toasts } from './components/Shell'
import { useDocumentPrefs, useInAppShortcuts, useMediaQuery, useReducedMotionMode } from './hooks'
import { RecordPage } from './pages/RecordPage'
import { NameDialog, RecoveryDialog, UpdateDialog } from './pages/Dialogs'
import { LegalConsentDialog } from './pages/Legal'
import { engine } from './audio/engine'
import { useT } from './i18n'

// Pages other than the recorder load on first use; they are fetched in the background after start.
const loadArchive = (): Promise<typeof import('./pages/ArchivePage')> => import('./pages/ArchivePage')
const loadCollections = (): Promise<typeof import('./pages/CollectionsPage')> => import('./pages/CollectionsPage')
const loadTrash = (): Promise<typeof import('./pages/TrashPage')> => import('./pages/TrashPage')
const loadSettings = (): Promise<typeof import('./pages/SettingsPage')> => import('./pages/SettingsPage')
const loadEditor = (): Promise<typeof import('./pages/EditorPage')> => import('./pages/EditorPage')
const loadDeveloper = (): Promise<typeof import('./pages/DeveloperPage')> => import('./pages/DeveloperPage')

const ArchivePage = lazy(() => loadArchive().then((m) => ({ default: m.ArchivePage })))
const CollectionsPage = lazy(() => loadCollections().then((m) => ({ default: m.CollectionsPage })))
const TrashPage = lazy(() => loadTrash().then((m) => ({ default: m.TrashPage })))
const SettingsPage = lazy(() => loadSettings().then((m) => ({ default: m.SettingsPage })))
const EditorPage = lazy(() => loadEditor().then((m) => ({ default: m.EditorPage })))
const DeveloperPage = lazy(() => loadDeveloper().then((m) => ({ default: m.DeveloperPage })))
const PerfOverlay = lazy(() => loadDeveloper().then((m) => ({ default: m.PerfOverlay })))
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })))

function Page() {
  const route = useApp((s) => s.route)
  switch (route.name) {
    case 'record':
      return <RecordPage />
    case 'archive':
      return <ArchivePage mode="all" />
    case 'favorites':
      return <ArchivePage mode="favorites" />
    case 'collections':
      return <CollectionsPage />
    case 'trash':
      return <TrashPage />
    case 'settings':
      return <SettingsPage />
    case 'developer':
      return <DeveloperPage />
    case 'editor':
      return <EditorPage source={route.source} />
  }
}

export function App() {
  const t = useT()
  useDocumentPrefs()
  useInAppShortcuts((action) => void engine.handle({ action, origin: 'shortcut' }))
  const settings = useApp((s) => s.settings)
  const route = useApp((s) => s.route)
  const compact = useMediaQuery('(max-width: 899px)')
  const motionMode = useReducedMotionMode()
  useEffect(() => {
    // Warm the page modules while the app is idle so the first navigation is instant.
    const id = window.setTimeout(() => {
      void Promise.all([loadArchive(), loadSettings(), loadEditor(), loadCollections(), loadTrash()]).catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(id)
  }, [])
  if (!settings) return null
  const routeKey = route.name === 'editor' ? `editor-${route.source.kind === 'run' ? route.source.runId : route.source.recordingId}` : route.name
  const consent = !legalAccepted(settings.legal)

  return (
    <MotionConfig reducedMotion={motionMode}>
      {!settings.onboardingCompleted ? (
        <div className="app">
          <TitleBar />
          <Suspense fallback={null}>
            <Onboarding />
          </Suspense>
          <LiveRegion />
        </div>
      ) : (
        <div className="app">
          <a href="#main" className="skip-link">
            {t('a11y.skipToContent')}
          </a>
          <TitleBar />
          <div className="shell">
            <Sidebar compact={compact} />
            <main className="content" id="main" tabIndex={-1}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={routeKey}
                  className="page"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Suspense fallback={null}>
                    <Page />
                  </Suspense>
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
          <Toasts />
          <LiveRegion />
          {consent ? (
            <LegalConsentDialog />
          ) : (
            <>
              <UpdateDialog />
              <RecoveryDialog />
              <NameDialog />
            </>
          )}
          {settings.developer.enabled && settings.developer.ui.perfOverlay && (
            <Suspense fallback={null}>
              <PerfOverlay />
            </Suspense>
          )}
        </div>
      )}
    </MotionConfig>
  )
}
