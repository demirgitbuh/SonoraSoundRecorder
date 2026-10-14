import type { Locale } from '../../../shared/types'

const INTL_LOCALE: Record<Locale, string> = { en: 'en-US', tr: 'tr-TR', de: 'de-DE', fr: 'fr-FR', zh: 'zh-CN', ru: 'ru-RU' }

export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale]
}

/** 01:02:03 or 02:03 */
export function formatClock(ms: number, alwaysHours = false): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number): string => String(n).padStart(2, '0')
  return h > 0 || alwaysHours ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}

/** 02:03.4 — tenths for editing positions. */
export function formatPrecise(ms: number): string {
  const v = Math.max(0, ms)
  const tenths = Math.floor((v % 1000) / 100)
  return `${formatClock(v)}.${tenths}`
}

export function formatBytes(bytes: number, locale: Locale): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, bytes)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const nf = new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: v >= 100 || i === 0 ? 0 : 1 })
  return `${nf.format(v)} ${units[i]}`
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'medium' }).format(new Date(iso))
}

export function formatKHz(rate: number, locale: Locale): string {
  return `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(rate / 1000)} kHz`
}

export function dbfs(v: number): number {
  return v > 0 ? 20 * Math.log10(v) : -Infinity
}

/** Local `YYYY-MM-DDTHH:mm` for datetime-local inputs. */
export function toLocalInput(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
