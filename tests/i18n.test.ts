import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CATALOGS, createTranslator, isMessageKey, placeholders, translate } from '../src/shared/i18n'
import en from '../src/shared/i18n/locales/en'
import { LOCALES, LOCALE_NATIVE_NAMES } from '../src/shared/types'

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'locales') continue
      out.push(...sourceFiles(p))
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const NAMESPACES =
  'common|nav|state|record|source|devices|audio|capture|processing|platform|permissions|output|quality|format|schedule|recovery|editor|player|preview|notify|announce|errors|archive|filters|sort|bulk|detail|transcription|export|edit|trash|collections|settings|shortcuts|update|updates|onboarding|nameDialog|mini|window|titlebar|tray|quit|keys|a11y|files|save'
const NOT_MESSAGES = new Set(['audio.defaultMicDeviceId', 'files.recordingsDir', 'transcription.modelPath', 'settings.json'])

describe('translations', () => {
  const enKeys = Object.keys(en).sort()

  it('ships exactly the six supported languages', () => {
    expect([...LOCALES]).toEqual(['en', 'tr', 'de', 'fr', 'zh', 'ru'])
    expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALES].sort())
  })

  it('shows every language name in its own language', () => {
    expect(LOCALE_NATIVE_NAMES).toEqual({ en: 'English', tr: 'Türkçe', de: 'Deutsch', fr: 'Français', zh: '中文', ru: 'Русский' })
  })

  for (const locale of LOCALES) {
    it(`${locale} has every key, no extra keys and no empty text`, () => {
      const catalog = CATALOGS[locale]
      expect(Object.keys(catalog).sort()).toEqual(enKeys)
      for (const [k, v] of Object.entries(catalog)) expect(v.trim(), `${locale}:${k}`).not.toBe('')
    })

    it(`${locale} keeps the same placeholders as English`, () => {
      const catalog = CATALOGS[locale] as Record<string, string>
      for (const k of enKeys) expect(placeholders(catalog[k]!), `${locale}:${k}`).toEqual(placeholders((en as Record<string, string>)[k]!))
    })
  }

  it('every translation key referenced in the source code exists', () => {
    const pattern = new RegExp(`['"\`]((?:${NAMESPACES})\\.[A-Za-z0-9_.\\-]+)['"\`]`, 'g')
    const missing = new Set<string>()
    for (const file of sourceFiles(join(__dirname, '..', 'src'))) {
      if (file.includes(`${join('shared', 'i18n')}`)) continue
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(pattern)) {
        const key = m[1]!
        if (key.endsWith('.') || NOT_MESSAGES.has(key)) continue
        if (!isMessageKey(key)) missing.add(`${key} (${file})`)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('interpolates parameters and leaves unknown placeholders intact', () => {
    expect(translate('en', 'notify.saved', { name: 'Take 1' })).toBe('Saved Take 1')
    expect(translate('tr', 'record.sessionName', { n: 2 })).toBe('Oturum 2')
    expect(createTranslator('de')('archive.count', { shown: 1 })).toBe('1 von {total} Aufnahmen')
  })

  it('falls back to the key for unknown runtime keys', () => {
    expect(translate('fr', 'no.such.key')).toBe('no.such.key')
  })
})
