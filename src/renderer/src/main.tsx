import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/pages.css'
import './styles/developer.css'
import { createRoot } from 'react-dom/client'
import { invoke, log, on, send, windowKind } from './api'
import { useApp } from './stores/app'
import { useLibrary } from './stores/library'
import { useEngine } from './stores/engine'
import { engine } from './audio/engine'
import { watchDevices } from './stores/devices'
import { App } from './App'
import { MiniApp } from './pages/MiniApp'

function hideSplash(): void {
  const splash = document.getElementById('splash')
  if (!splash) return
  splash.classList.add('hide')
  window.setTimeout(() => splash.remove(), 260)
}

async function boot(): Promise<void> {
  const data = await invoke('app:bootstrap')
  const app = useApp.getState()
  app.init(data)
  document.documentElement.dataset.theme = data.settings.theme

  on('settings:changed', (s) => useApp.getState().setSettings(s))
  on('update:status', (u) => useApp.getState().setUpdate(u))
  on('shortcuts:status', (s) => useApp.getState().setShortcutStatus(s))

  if (windowKind === 'main') {
    on('library:changed', (snap) => useLibrary.getState().setSnapshot(snap))
    on('runs:changed', (runs) => useApp.getState().setPendingRuns(runs))
    on('toast', (t) => useApp.getState().pushToast(t))
    on('task:progress', (p) => useApp.getState().setTask(p))
    on('transcribe:progress', (p) => useLibrary.getState().setJob(p))
    on('navigate', (route) => useApp.getState().navigate(route))
    on('schedules:changed', (list) => useEngine.getState().setSchedules(list))

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
    if (runs.length > 0 && data.settings.onboardingCompleted) app.setRecoveryDialog(true)
    engine.start()
    watchDevices()
  }

  createRoot(document.getElementById('root')!).render(windowKind === 'mini' ? <MiniApp /> : <App />)
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
