import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { useApp } from './stores/app'
import { LiveRegion, Sidebar, TitleBar, Toasts } from './components/Shell'
import { useDocumentPrefs, useInAppShortcuts, useMediaQuery, useReducedMotionMode } from './hooks'
import { RecordPage } from './pages/RecordPage'
import { ArchivePage } from './pages/ArchivePage'
import { CollectionsPage } from './pages/CollectionsPage'
import { TrashPage } from './pages/TrashPage'
import { SettingsPage } from './pages/SettingsPage'
import { EditorPage } from './pages/EditorPage'
import { Onboarding } from './pages/Onboarding'
import { NameDialog, RecoveryDialog, UpdateDialog } from './pages/Dialogs'
import { DeveloperPage, PerfOverlay } from './pages/DeveloperPage'
import { engine } from './audio/engine'
import { useT } from './i18n'

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
  if (!settings) return null
  const routeKey = route.name === 'editor' ? `editor-${route.source.kind === 'run' ? route.source.runId : route.source.recordingId}` : route.name

  return (
    <MotionConfig reducedMotion={motionMode}>
      {!settings.onboardingCompleted ? (
        <div className="app">
          <TitleBar />
          <Onboarding />
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
                  <Page />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
          <Toasts />
          <LiveRegion />
          <UpdateDialog />
          <RecoveryDialog />
          <NameDialog />
          {settings.developer.enabled && settings.developer.ui.perfOverlay && <PerfOverlay />}
        </div>
      )}
    </MotionConfig>
  )
}
