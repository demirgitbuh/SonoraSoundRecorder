import { isBusy } from '../../../shared/state-machine'
import { createSessionConfig } from '../../../shared/settings'
import type { EngineCommand, EngineSnapshot } from '../../../shared/ipc'
import type { Schedule, SessionConfig } from '../../../shared/types'
import { createTranslator } from '../../../shared/i18n'
import { legalAccepted } from '../../../shared/legal'
import type { MessageKey } from '../../../shared/i18n'
import { invoke, on, send } from '../api'
import { useApp } from '../stores/app'
import { emptyRuntime, useEngine } from '../stores/engine'
import { SessionController } from './session-controller'
import type { ControllerHost, SessionDiagnostics } from './session-controller'

export const MAX_SESSIONS = 6

/**
 * Owns every recording session of the main window, routes commands (keyboard, global shortcuts,
 * tray, mini panel, schedules) to the selected session, and mirrors the state to the main process
 * for the tray, the mini panel and safe quitting/updating.
 */
class Engine {
  private readonly controllers = new Map<string, SessionController>()
  private started = false
  private snapshotTimer = 0
  private scheduleTimer = 0
  private lastSnapshot = ''

  private readonly host: ControllerHost = {
    settings: () => useApp.getState().settings!,
    caps: () => useApp.getState().caps!,
    config: (id) => useApp.getState().settings?.sessions.find((s) => s.id === id),
    updateConfig: (id, patch) => void this.updateSession(id, patch),
    systemCaptureActiveElsewhere: (id) => [...this.controllers.values()].some((c) => c.id !== id && c.capturesSystem),
    onStateChange: () => {
      this.pushSnapshot()
      this.syncScheduleRuns()
    },
    notify: (kind, titleKey, opts) => {
      void invoke('notify', { kind, titleKey, ...opts }).catch(() => undefined)
    },
    announce: (key, params, assertive) => {
      const t = createTranslator(useApp.getState().locale)
      useApp.getState().announce(t(key as MessageKey, params), assertive)
    },
    openPreview: (runId, sessionId) => {
      useApp.getState().openEditor({ kind: 'run', runId, sessionId })
      void invoke('window:show-main', null).catch(() => undefined)
    },
    askName: (runId, sessionId) => {
      useApp.getState().setNameDialog({ runId, sessionId })
      void invoke('window:show-main', null).catch(() => undefined)
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.syncSessions()
    useApp.subscribe((st, prev) => {
      if (st.settings !== prev.settings) this.syncSessions()
    })
    on('engine:command', (cmd) => void this.handle(cmd))
    on('app:prepare-quit', () => void this.prepareQuit())
    on('rec:failed', ({ runId, errorKey }) => {
      for (const c of this.controllers.values()) if (c.currentRunId === runId) c.onWriteFailed(errorKey)
    })
    on('schedules:changed', (list) => useEngine.getState().setSchedules(list))
    this.snapshotTimer = window.setInterval(() => this.pushSnapshot(), 1000)
    void this.loadSchedules()
    this.pushSnapshot(true)
  }

  stop(): void {
    window.clearInterval(this.snapshotTimer)
    window.clearInterval(this.scheduleTimer)
    for (const c of this.controllers.values()) c.dispose()
    this.controllers.clear()
  }

  /** Creates/removes controllers to match the session list in settings. */
  private syncSessions(): void {
    const settings = useApp.getState().settings
    if (!settings) return
    const ids = new Set(settings.sessions.map((s) => s.id))
    for (const s of settings.sessions) {
      let c = this.controllers.get(s.id)
      if (!c) {
        c = new SessionController(s.id, this.host)
        this.controllers.set(s.id, c)
        useEngine.getState().patch(s.id, emptyRuntime(s.id))
      } else {
        c.applyLevels(s)
      }
    }
    for (const [id, c] of this.controllers) {
      if (!ids.has(id) && !isBusy(c.state)) {
        c.dispose()
        this.controllers.delete(id)
        useEngine.getState().remove(id)
      }
    }
    const selected = settings.selectedSessionId && ids.has(settings.selectedSessionId) ? settings.selectedSessionId : settings.sessions[0]?.id ?? null
    if (selected && useEngine.getState().selectedId !== selected) useEngine.getState().select(selected)
  }

  controller(id: string): SessionController | undefined {
    return this.controllers.get(id)
  }

  selected(): SessionController | undefined {
    const id = useEngine.getState().selectedId
    return id ? this.controllers.get(id) : undefined
  }

  async select(id: string): Promise<void> {
    if (!this.controllers.has(id)) return
    useEngine.getState().select(id)
    this.pushSnapshot(true)
    await useApp.getState().updateSettings({ selectedSessionId: id }).catch(() => undefined)
  }

  async handle(cmd: EngineCommand): Promise<void> {
    if (cmd.action === 'select') {
      if (cmd.sessionId) await this.select(cmd.sessionId)
      return
    }
    if (cmd.action === 'stopAll') {
      await Promise.all([...this.controllers.values()].map((c) => c.stop()))
      return
    }
    const target = cmd.sessionId ? this.controllers.get(cmd.sessionId) : this.selected()
    if (!target) return
    // Until the current terms are accepted, keys, tray and mini panel cannot start a recording.
    const settings = useApp.getState().settings
    const idle = target.state === 'ready' || target.state === 'error'
    if (cmd.action === 'toggleRecord' && idle && cmd.origin !== 'schedule' && settings && !legalAccepted(settings.legal)) return
    switch (cmd.action) {
      case 'toggleRecord':
        await target.toggleRecord(cmd.origin === 'schedule' ? 'schedule' : 'user')
        break
      case 'togglePause':
        await target.togglePause()
        break
      case 'addMarker':
        target.addMarker()
        break
    }
  }

  // ---------------------------------------------------------------------------- sessions

  async addSession(name: string): Promise<string | null> {
    const settings = useApp.getState().settings
    if (!settings || settings.sessions.length >= MAX_SESSIONS) return null
    const id = crypto.randomUUID()
    const cfg = createSessionConfig(settings, id, name)
    await useApp.getState().updateSettings({ sessions: [...settings.sessions, cfg], selectedSessionId: id })
    return id
  }

  async removeSession(id: string): Promise<boolean> {
    const settings = useApp.getState().settings
    const c = this.controllers.get(id)
    if (!settings || settings.sessions.length <= 1) return false
    if (c && c.state !== 'ready' && c.state !== 'error') return false
    const sessions = settings.sessions.filter((s) => s.id !== id)
    const selectedSessionId = settings.selectedSessionId === id ? sessions[0]!.id : settings.selectedSessionId
    await useApp.getState().updateSettings({ sessions, selectedSessionId })
    return true
  }

  async updateSession(id: string, patch: Partial<SessionConfig>): Promise<void> {
    const settings = useApp.getState().settings
    if (!settings) return
    const sessions = settings.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
    await useApp.getState().updateSettings({ sessions })
  }

  // ---------------------------------------------------------------------------- developer

  diagnostics(): SessionDiagnostics[] {
    return [...this.controllers.values()].map((c) => c.diagnostics())
  }

  /** Simulates an unplugged device on the selected session (developer tool). */
  simulateSourceLoss(which: 'mic' | 'system'): boolean {
    return this.selected()?.simulateSourceLoss(which) ?? false
  }

  // ---------------------------------------------------------------------------- snapshot

  snapshot(): EngineSnapshot {
    const settings = useApp.getState().settings
    const rt = useEngine.getState()
    return {
      sessions: (settings?.sessions ?? []).map((s) => {
        const c = this.controllers.get(s.id)
        return {
          id: s.id,
          name: s.name,
          state: c?.state ?? 'ready',
          elapsedMs: c ? Math.round(c.elapsedMs) : 0,
          capturesSystem: c?.capturesSystem ?? false
        }
      }),
      selectedId: rt.selectedId,
      unsavedPreviews: Object.values(rt.sessions).filter((s) => s.state === 'preview').length
    }
  }

  private pushSnapshot(force = false): void {
    const snap = this.snapshot()
    const key = JSON.stringify(snap)
    if (!force && key === this.lastSnapshot) return
    this.lastSnapshot = key
    send('engine:state', snap)
  }

  private async prepareQuit(): Promise<void> {
    try {
      await Promise.all([...this.controllers.values()].map((c) => c.stopForQuit()))
    } finally {
      send('engine:quit-ack')
    }
  }

  // ---------------------------------------------------------------------------- schedules

  private async loadSchedules(): Promise<void> {
    const list = await invoke('schedules:list').catch(() => [] as Schedule[])
    const now = Date.now()
    let changed = false
    // Schedules are only executed while the app runs; anything due while it was closed is missed.
    const fixed = list.map((s) => {
      if (s.status === 'upcoming' && Date.parse(s.startAt) <= now) {
        changed = true
        return { ...s, status: 'missed' as const, reasonKey: 'schedule.reasonAppClosed' }
      }
      if (s.status === 'running') {
        changed = true
        return { ...s, status: 'failed' as const, reasonKey: 'schedule.reasonInterrupted' }
      }
      return s
    })
    useEngine.getState().setSchedules(fixed)
    if (changed) await invoke('schedules:save', fixed).catch(() => undefined)
    this.scheduleTimer = window.setInterval(() => void this.tickSchedules(), 1000)
  }

  async saveSchedules(list: Schedule[]): Promise<void> {
    useEngine.getState().setSchedules(list)
    await invoke('schedules:save', list)
  }

  private async tickSchedules(): Promise<void> {
    const list = useEngine.getState().schedules
    const now = Date.now()
    let changed = false
    const next: Schedule[] = []
    for (const s of list) {
      const start = Date.parse(s.startAt)
      const end = Date.parse(s.endAt)
      if (s.status === 'upcoming' && now >= start) {
        changed = true
        const c = this.controllers.get(s.sessionId)
        if (now >= end) next.push({ ...s, status: 'missed', reasonKey: 'schedule.reasonAppClosed' })
        else if (!c) next.push({ ...s, status: 'failed', reasonKey: 'schedule.reasonNoSession' })
        else if (c.state !== 'ready' && c.state !== 'error') next.push({ ...s, status: 'failed', reasonKey: 'schedule.reasonBusy' })
        else {
          next.push({ ...s, status: 'running', reasonKey: null })
          void c.start('schedule').then((ok) => {
            if (!ok) void this.markSchedule(s.id, 'failed', 'schedule.reasonStartFailed')
          })
        }
      } else if (s.status === 'running' && now >= end) {
        changed = true
        const c = this.controllers.get(s.sessionId)
        if (c && (c.state === 'recording' || c.state === 'paused')) void c.stop()
        next.push({ ...s, status: 'completed', reasonKey: null })
      } else {
        next.push(s)
      }
    }
    if (changed) await this.saveSchedules(next).catch(() => undefined)
  }

  /** A running schedule whose session was stopped by hand counts as completed. */
  private syncScheduleRuns(): void {
    const list = useEngine.getState().schedules
    let changed = false
    const next = list.map((s) => {
      if (s.status !== 'running') return s
      const c = this.controllers.get(s.sessionId)
      if (c && c.state !== 'recording' && c.state !== 'paused' && c.state !== 'countdown' && !c.machine.isPending) {
        changed = true
        return { ...s, status: 'completed' as const }
      }
      return s
    })
    if (changed) void this.saveSchedules(next).catch(() => undefined)
  }

  private async markSchedule(id: string, status: Schedule['status'], reasonKey: string | null): Promise<void> {
    const next = useEngine.getState().schedules.map((s) => (s.id === id ? { ...s, status, reasonKey } : s))
    await this.saveSchedules(next).catch(() => undefined)
  }
}

export const engine = new Engine()
