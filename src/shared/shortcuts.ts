import type { ShortcutAction, ShortcutBindings } from './types'

export const DEFAULT_BINDINGS: ShortcutBindings = {
  toggleRecord: 'K',
  togglePause: 'Space',
  addMarker: 'L'
}

export type ModifierName = 'Command' | 'Control' | 'Alt' | 'Shift' | 'Super'

const MODIFIER_ORDER: ModifierName[] = ['Command', 'Control', 'Alt', 'Shift', 'Super']

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Backquote: '`'
}

/** Physical key code (layout independent) to Electron accelerator key, or null when unsupported. */
export function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]!
  m = /^Digit([0-9])$/.exec(code)
  if (m) return m[1]!
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return `num${m[1]}`
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)
  if (m) return `F${m[1]}`
  return CODE_TO_KEY[code] ?? null
}

export interface KeyEventLike {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export interface ParsedAccelerator {
  modifiers: ModifierName[]
  key: string
}

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'CapsLock',
  'Fn'
])

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code)
}

export function eventToAccelerator(e: KeyEventLike, platform: string): string | null {
  if (isModifierCode(e.code)) return null
  const key = keyFromCode(e.code)
  if (!key) return null
  const mods: ModifierName[] = []
  if (e.metaKey) mods.push(platform === 'darwin' ? 'Command' : 'Super')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  return formatAccelerator({ modifiers: mods, key })
}

const MODIFIER_ALIASES: Record<string, ModifierName> = {
  command: 'Command',
  cmd: 'Command',
  control: 'Control',
  ctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super'
}

export function parseAccelerator(acc: string): ParsedAccelerator | null {
  if (!acc || typeof acc !== 'string') return null
  // `+` itself is written as "Plus" in Electron accelerators, so splitting on "+" is safe.
  const parts = acc.split('+').map((p) => p.trim())
  if (parts.some((p) => p.length === 0)) return null
  const key = parts.pop()!
  const modifiers: ModifierName[] = []
  for (const p of parts) {
    const mod = MODIFIER_ALIASES[p.toLowerCase()]
    if (!mod || modifiers.includes(mod)) return null
    modifiers.push(mod)
  }
  if (MODIFIER_ALIASES[key.toLowerCase()]) return null
  const validKey =
    /^[A-Z0-9]$/.test(key) ||
    /^num[0-9]$/.test(key) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    Object.values(CODE_TO_KEY).includes(key)
  if (!validKey) return null
  return { modifiers: MODIFIER_ORDER.filter((m) => modifiers.includes(m)), key }
}

export function formatAccelerator(p: ParsedAccelerator): string {
  return [...MODIFIER_ORDER.filter((m) => p.modifiers.includes(m)), p.key].join('+')
}

export function normalizeAccelerator(acc: string): string | null {
  const p = parseAccelerator(acc)
  return p ? formatAccelerator(p) : null
}

export function eventMatches(acc: string, e: KeyEventLike, platform: string): boolean {
  const pressed = eventToAccelerator(e, platform)
  const target = normalizeAccelerator(acc)
  return pressed !== null && target !== null && pressed === target
}

export type BindingIssue = { action: ShortcutAction; issue: 'invalid' | 'duplicate' }

export function validateBindings(bindings: ShortcutBindings): BindingIssue[] {
  const issues: BindingIssue[] = []
  const seen = new Map<string, ShortcutAction>()
  for (const action of Object.keys(bindings) as ShortcutAction[]) {
    const norm = normalizeAccelerator(bindings[action])
    if (!norm) {
      issues.push({ action, issue: 'invalid' })
      continue
    }
    const other = seen.get(norm)
    if (other) {
      issues.push({ action, issue: 'duplicate' })
      if (!issues.some((i) => i.action === other)) issues.push({ action: other, issue: 'duplicate' })
    } else {
      seen.set(norm, action)
    }
  }
  return issues
}

const MAC_SYMBOLS: Record<ModifierName, string> = {
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Super: '⌘'
}

/** Human readable keycaps, e.g. ["Ctrl", "Shift", "R"]. `spaceLabel` is the translated name of Space. */
export function acceleratorKeycaps(acc: string, platform: string, spaceLabel: string): string[] {
  const p = parseAccelerator(acc)
  if (!p) return [acc]
  const mods = p.modifiers.map((m) => {
    if (platform === 'darwin') return MAC_SYMBOLS[m]
    if (m === 'Control') return 'Ctrl'
    if (m === 'Super') return platform === 'win32' ? 'Win' : 'Super'
    return m
  })
  const key = p.key === 'Space' ? spaceLabel : p.key.startsWith('num') ? `Num ${p.key.slice(3)}` : p.key
  return [...mods, key]
}
