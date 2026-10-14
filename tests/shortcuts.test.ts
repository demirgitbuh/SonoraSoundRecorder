import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BINDINGS,
  acceleratorKeycaps,
  eventMatches,
  eventToAccelerator,
  keyFromCode,
  normalizeAccelerator,
  parseAccelerator,
  validateBindings
} from '../src/shared/shortcuts'
import { ShortcutService } from '../src/main/services/shortcut-service'
import type { GlobalShortcutApi } from '../src/main/services/shortcut-service'
import type { ShortcutStatus } from '../src/shared/types'
import { tempDir, testLogger } from './helpers'

const key = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('accelerators', () => {
  it('maps physical keys independent of the keyboard layout', () => {
    expect(keyFromCode('KeyK')).toBe('K')
    expect(keyFromCode('Space')).toBe('Space')
    expect(keyFromCode('Digit7')).toBe('7')
    expect(keyFromCode('F12')).toBe('F12')
    expect(keyFromCode('ArrowLeft')).toBe('Left')
    expect(keyFromCode('IntlBackslash')).toBeNull()
  })

  it('builds accelerators from key events in a stable modifier order', () => {
    expect(eventToAccelerator(key('KeyR', { shiftKey: true, ctrlKey: true }), 'win32')).toBe('Control+Shift+R')
    expect(eventToAccelerator(key('KeyR', { metaKey: true, altKey: true }), 'darwin')).toBe('Command+Alt+R')
    expect(eventToAccelerator(key('ShiftLeft', { shiftKey: true }), 'win32')).toBeNull()
  })

  it('parses and normalizes aliases', () => {
    expect(normalizeAccelerator('ctrl+shift+k')).toBeNull()
    expect(normalizeAccelerator('Shift+Ctrl+K')).toBe('Control+Shift+K')
    expect(normalizeAccelerator('Space')).toBe('Space')
    expect(parseAccelerator('Shift')).toBeNull()
    expect(parseAccelerator('Control++')).toBeNull()
  })

  it('matches the default keys K, Space and L', () => {
    expect(eventMatches(DEFAULT_BINDINGS.toggleRecord, key('KeyK'), 'linux')).toBe(true)
    expect(eventMatches(DEFAULT_BINDINGS.togglePause, key('Space'), 'linux')).toBe(true)
    expect(eventMatches(DEFAULT_BINDINGS.addMarker, key('KeyL'), 'linux')).toBe(true)
    expect(eventMatches('K', key('KeyK', { ctrlKey: true }), 'linux')).toBe(false)
  })

  it('detects duplicate and invalid bindings', () => {
    expect(validateBindings(DEFAULT_BINDINGS)).toEqual([])
    const dup = validateBindings({ toggleRecord: 'K', togglePause: 'K', addMarker: 'nope' })
    expect(dup).toContainEqual({ action: 'togglePause', issue: 'duplicate' })
    expect(dup).toContainEqual({ action: 'toggleRecord', issue: 'duplicate' })
    expect(dup).toContainEqual({ action: 'addMarker', issue: 'invalid' })
  })

  it('renders platform keycaps', () => {
    expect(acceleratorKeycaps('Control+Shift+R', 'win32', 'Space')).toEqual(['Ctrl', 'Shift', 'R'])
    expect(acceleratorKeycaps('Command+Alt+R', 'darwin', 'Space')).toEqual(['⌘', '⌥', 'R'])
    expect(acceleratorKeycaps('Space', 'linux', 'Boşluk')).toEqual(['Boşluk'])
  })
})

class FakeGlobalShortcut implements GlobalShortcutApi {
  registered = new Map<string, () => void>()
  blocked = new Set<string>()
  register(acc: string, cb: () => void): boolean {
    if (this.blocked.has(acc) || this.registered.has(acc)) return false
    this.registered.set(acc, cb)
    return true
  }
  unregister(acc: string): void {
    this.registered.delete(acc)
  }
  isRegistered(acc: string): boolean {
    return this.registered.has(acc)
  }
}

function setup() {
  const { dir, cleanup } = tempDir()
  const api = new FakeGlobalShortcut()
  const fired: string[] = []
  let last: ShortcutStatus[] = []
  const svc = new ShortcutService(api, (a) => fired.push(a), testLogger(dir), (s) => (last = s), true)
  return { api, svc, fired, cleanup, status: () => last }
}

describe('global shortcut registration', () => {
  it('registers all bindings globally and fires the right action', () => {
    const { api, svc, fired, cleanup } = setup()
    const status = svc.apply(DEFAULT_BINDINGS, 'global')
    expect([...api.registered.keys()].sort()).toEqual(['K', 'L', 'Space'])
    expect(status.every((s) => s.state === 'registered')).toBe(true)
    api.registered.get('K')!()
    api.registered.get('L')!()
    expect(fired).toEqual(['toggleRecord', 'addMarker'])
    cleanup()
  })

  it('reports a real conflict instead of silently picking another key', () => {
    const { api, svc, cleanup } = setup()
    api.blocked.add('Space')
    const status = svc.apply(DEFAULT_BINDINGS, 'global')
    const pause = status.find((s) => s.action === 'togglePause')!
    expect(pause.state).toBe('failed')
    expect(pause.reasonKey).toBe('shortcuts.reason.inUse')
    expect(pause.accelerator).toBe('Space')
    expect(api.registered.has('Space')).toBe(false)
    cleanup()
  })

  it('releases global keys while a Sonora window is focused so typing never triggers them', () => {
    const { api, svc, cleanup } = setup()
    svc.apply(DEFAULT_BINDINGS, 'global')
    svc.setAppFocused(true)
    expect(api.registered.size).toBe(0)
    svc.setAppFocused(false)
    expect(api.registered.size).toBe(3)
    cleanup()
  })

  it('re-registers when bindings change and removes the old keys', () => {
    const { api, svc, cleanup } = setup()
    svc.apply(DEFAULT_BINDINGS, 'global')
    svc.apply({ toggleRecord: 'Control+Shift+R', togglePause: 'Control+Shift+P', addMarker: 'Control+Shift+M' }, 'global')
    expect([...api.registered.keys()].sort()).toEqual(['Control+Shift+M', 'Control+Shift+P', 'Control+Shift+R'])
    cleanup()
  })

  it('app-only scope registers nothing globally', () => {
    const { api, svc, cleanup } = setup()
    const status = svc.apply(DEFAULT_BINDINGS, 'app')
    expect(api.registered.size).toBe(0)
    expect(status.every((s) => s.state === 'in-app')).toBe(true)
    cleanup()
  })

  it('suspends everything while a new key is being recorded and restores afterwards', () => {
    const { api, svc, cleanup } = setup()
    svc.apply(DEFAULT_BINDINGS, 'global')
    const suspended = svc.setSuspended(true)
    expect(api.registered.size).toBe(0)
    expect(suspended.every((s) => s.state === 'suspended')).toBe(true)
    svc.setSuspended(false)
    expect(api.registered.size).toBe(3)
    cleanup()
  })

  it('cleans up every registration on quit', () => {
    const { api, svc, cleanup } = setup()
    svc.apply(DEFAULT_BINDINGS, 'global')
    svc.unregisterAll()
    expect(api.registered.size).toBe(0)
    cleanup()
  })
})
