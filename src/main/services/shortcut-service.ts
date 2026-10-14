import type { ShortcutAction, ShortcutBindings, ShortcutScope, ShortcutStatus } from '../../shared/types'
import { SHORTCUT_ACTIONS } from '../../shared/types'
import { normalizeAccelerator, validateBindings } from '../../shared/shortcuts'
import type { Logger } from './logger'

/** Minimal surface of Electron's globalShortcut, injectable for tests. */
export interface GlobalShortcutApi {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

/**
 * Owns global shortcut registration.
 *
 * While a Sonora window has focus the global registrations are released and the renderer
 * handles keys itself, so typing in text fields never triggers recording commands. When focus
 * leaves Sonora (and the scope is "global"), the shortcuts are registered system wide again.
 */
export class ShortcutService {
  private bindings: ShortcutBindings
  private scope: ShortcutScope
  private registered = new Map<ShortcutAction, string>()
  private failed = new Map<ShortcutAction, string>()
  private appFocused = false
  private suspended = false

  constructor(
    private readonly api: GlobalShortcutApi,
    private readonly onFire: (action: ShortcutAction) => void,
    private readonly logger: Logger,
    private readonly onStatus: (status: ShortcutStatus[]) => void,
    private readonly globalSupported: boolean
  ) {
    this.bindings = { toggleRecord: 'K', togglePause: 'Space', addMarker: 'L' }
    this.scope = 'global'
  }

  /** Applies new bindings and returns the real registration state for each action. */
  apply(bindings: ShortcutBindings, scope: ShortcutScope): ShortcutStatus[] {
    this.bindings = { ...bindings }
    this.scope = scope
    this.failed.clear()
    this.unregisterAll()
    if (scope === 'global' && this.globalSupported && !this.suspended) {
      // Probe every binding once so conflicts with other applications are reported right away,
      // even while Sonora is focused.
      for (const action of SHORTCUT_ACTIONS) {
        const acc = normalizeAccelerator(this.bindings[action])
        if (!acc) {
          this.failed.set(action, 'shortcuts.reason.invalid')
          continue
        }
        if (this.tryRegister(action, acc)) {
          if (this.appFocused) this.release(action)
        }
      }
    }
    return this.publish()
  }

  setAppFocused(focused: boolean): void {
    if (this.appFocused === focused) return
    this.appFocused = focused
    if (focused) {
      this.unregisterAll()
    } else if (this.scope === 'global' && this.globalSupported && !this.suspended) {
      for (const action of SHORTCUT_ACTIONS) {
        const acc = normalizeAccelerator(this.bindings[action])
        if (acc && !this.registered.has(action)) this.tryRegister(action, acc)
      }
    }
    this.publish()
  }

  /** Suspends everything while the user records a new key combination. */
  setSuspended(suspended: boolean): ShortcutStatus[] {
    this.suspended = suspended
    if (suspended) this.unregisterAll()
    else this.apply(this.bindings, this.scope)
    return this.publish()
  }

  private tryRegister(action: ShortcutAction, acc: string): boolean {
    let ok = false
    try {
      ok = this.api.register(acc, () => this.onFire(action))
    } catch (err) {
      this.logger.warn('shortcuts', `register ${acc} threw: ${(err as Error).message}`)
      ok = false
    }
    if (ok) {
      this.registered.set(action, acc)
      this.failed.delete(action)
    } else {
      this.failed.set(action, 'shortcuts.reason.inUse')
      this.logger.warn('shortcuts', `could not register ${acc} for ${action}`)
    }
    return ok
  }

  private release(action: ShortcutAction): void {
    const acc = this.registered.get(action)
    if (!acc) return
    try {
      this.api.unregister(acc)
    } catch {
      /* ignore */
    }
    this.registered.delete(action)
  }

  unregisterAll(): void {
    for (const action of [...this.registered.keys()]) this.release(action)
  }

  status(): ShortcutStatus[] {
    const issues = validateBindings(this.bindings)
    return SHORTCUT_ACTIONS.map((action) => {
      const accelerator = this.bindings[action]
      const issue = issues.find((i) => i.action === action)
      let state: ShortcutStatus['state']
      let reasonKey: string | null = null
      if (this.suspended) {
        state = 'suspended'
      } else if (issue) {
        state = 'failed'
        reasonKey = issue.issue === 'duplicate' ? 'shortcuts.reason.duplicate' : 'shortcuts.reason.invalid'
      } else if (this.scope === 'app') {
        state = 'in-app'
      } else if (!this.globalSupported) {
        state = 'failed'
        reasonKey = 'shortcuts.reason.unsupported'
      } else if (this.failed.has(action)) {
        state = 'failed'
        reasonKey = this.failed.get(action)!
      } else if (this.registered.has(action)) {
        state = 'registered'
      } else {
        // Released because a Sonora window is focused; handled in-app meanwhile.
        state = 'registered'
        reasonKey = 'shortcuts.reason.pausedWhileFocused'
      }
      return { action, accelerator, scope: this.scope, state, reasonKey }
    })
  }

  private publish(): ShortcutStatus[] {
    const s = this.status()
    this.onStatus(s)
    return s
  }
}
