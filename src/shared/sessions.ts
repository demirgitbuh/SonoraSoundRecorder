import { CATALOGS, translate } from './i18n'
import type { Locale, SessionConfig } from './types'
import { LOCALES } from './types'

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One pattern per language for the automatic session name, e.g. "Session 3" or "Oturum 3". */
const DEFAULT_NAME_PATTERNS: RegExp[] = LOCALES.map((l) => {
  const template = CATALOGS[l]['record.sessionName']
  return new RegExp(`^${escapeRegex(template).replace('\\{n\\}', '(\\d{1,3})')}$`)
})

export function defaultSessionName(locale: Locale, n: number): string {
  return translate(locale, 'record.sessionName', { n })
}

/** The number of an automatic session name in any language, or null for a name the user chose. */
export function defaultSessionNumber(name: string): number | null {
  const trimmed = name.trim()
  for (const re of DEFAULT_NAME_PATTERNS) {
    const m = re.exec(trimmed)
    if (m) return Number(m[1])
  }
  return null
}

/** Smallest positive number not used by an automatic session name. */
export function nextSessionNumber(names: string[]): number {
  const used = new Set(names.map(defaultSessionNumber).filter((n): n is number => n !== null))
  let n = 1
  while (used.has(n)) n++
  return n
}

/**
 * Renames automatic session names ("Session 1", "Oturum 2", ...) into the given language.
 * Names chosen by the user are never touched.
 */
export function localizeSessionNames(sessions: SessionConfig[], locale: Locale): { sessions: SessionConfig[]; changed: boolean } {
  let changed = false
  const next = sessions.map((s) => {
    const n = defaultSessionNumber(s.name)
    if (n === null) return s
    const name = defaultSessionName(locale, n)
    if (name === s.name) return s
    changed = true
    return { ...s, name }
  })
  return { sessions: next, changed }
}
