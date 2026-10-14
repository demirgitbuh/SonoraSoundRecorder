import type { Locale } from '../types'
import { LOCALES } from '../types'
import en from './locales/en'
import tr from './locales/tr'
import de from './locales/de'
import fr from './locales/fr'
import zh from './locales/zh'
import ru from './locales/ru'

/** English is the source catalog; every other catalog must define exactly the same keys. */
export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
export type TranslateParams = Record<string, string | number>

export const CATALOGS: Record<Locale, Messages> = { en, tr, de, fr, zh, ru }

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key)
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

export function translate(locale: Locale, key: MessageKey | string, params?: TranslateParams): string {
  const catalog = CATALOGS[locale] ?? en
  const template = isMessageKey(key) ? (catalog[key] ?? en[key]) : key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

export type Translator = (key: MessageKey, params?: TranslateParams) => string

export function createTranslator(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params)
}

/** Placeholder names used by a message, e.g. `{count}`. */
export function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
}
