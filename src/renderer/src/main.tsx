import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/fonts.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/pages.css'
import './styles/developer.css'
import './styles/experience.css'
import { createRoot } from 'react-dom/client'
import { invoke, log, on, send, windowKind } from './api'
import { useApp } from './stores/app'

function hideSplash(): void {
  const splash = document.getElementById('splash')
  if (!splash) return
  splash.classList.add('hide')
  window.setTimeout(() => splash.remove(), 260)
}

/** The mini panel only loads its own small module; the recorder, pages and engine stay out of it. */
async function bootMini(): Promise<void> {
  const { MiniApp } = await import('./pages/MiniApp')
  createRoot(document.getElementById('root')!).render(<MiniApp />)
}

async function bootMain(): Promise<void> {
  const app = useApp.getState()
  const [{ App }, { engine }, { watchDevices }, { useLibrary }, { useEngine }, { setLiveVisible }] = await Promise.all([
    import('./App'),
    import('./audio/engine'),
    import('./stores/devices'),
    import('./stores/library'),
    import('./stores/engine'),
    import('./components/live')
  ])
  on('library:changed', (snap) => useLibrary.getState().setSnapshot(snap))
  on('runs:changed', (runs) => useApp.getState().setPendingRuns(runs))
  on('toast', (t) => useApp.getState().pushToast(t))
  on('task:progress', (p) => useApp.getState().setTask(p))
  on('transcribe:progress', (p) => useLibrary.getState().setJob(p))
  on('navigate', (route) => useApp.getState().navigate(route))
  on('schedules:changed', (list) => useEngine.getState().setSchedules(list))
  on('window:visibility', ({ visible }) => setLiveVisible(visible))

  const [library, runs, shortcutStatus, update, jobs] = await Promise.all([
    invoke('library:get'),
    invoke('runs:list'),
    invoke('shortcuts:status'),
    invoke('update:status'),
    invoke('transcribe:jobs')
  ])
  useLibrary.getState().setSnapshot(library)
  useLibrary.getState().setJobs(jobs)
  app.setPendingRuns(runs)
  app.setShortcutStatus(shortcutStatus)
  app.setUpdate(update)
  const settings = useApp.getState().settings
  if (runs.length > 0 && settings?.onboardingCompleted) app.setRecoveryDialog(true)
  engine.start()
  watchDevices()
  createRoot(document.getElementById('root')!).render(<App />)
}

async function boot(): Promise<void> {
  const data = await invoke('app:bootstrap')
  useApp.getState().init(data)
  document.documentElement.dataset.theme = data.settings.theme

  on('settings:changed', (s) => useApp.getState().setSettings(s))
  on('update:status', (u) => useApp.getState().setUpdate(u))
  on('shortcuts:status', (s) => useApp.getState().setShortcutStatus(s))

  if (windowKind === 'mini') await bootMini()
  else await bootMain()
  requestAnimationFrame(() => {
    hideSplash()
    send('app:ready')
  })
}

window.addEventListener('error', (e) => log('error', 'window', `${e.message} @ ${e.filename}:${e.lineno}`))
window.addEventListener('unhandledrejection', (e) => log('error', 'promise', String((e.reason as Error)?.message ?? e.reason)))

boot().catch((err) => {
  log('error', 'boot', String((err as Error)?.message ?? err))
  hideSplash()
  const root = document.getElementById('root')
  if (root) root.textContent = 'Sonora Sound Recorder could not start. See the log file for details.'
})
