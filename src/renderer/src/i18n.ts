import { useMemo } from 'react'
import { createTranslator } from '../../shared/i18n'
import type { MessageKey, TranslateParams, Translator } from '../../shared/i18n'
import { useApp } from './stores/app'

export type { MessageKey, Translator }

/** Translator for the current interface language; re-renders when the language changes. */
export function useT(): Translator {
  const locale = useApp((s) => s.locale)
  return useMemo(() => createTranslator(locale), [locale])
}

/** Translates keys that arrive at runtime (from the main process) and may be unknown. */
export function useDynamicT(): (key: string, params?: TranslateParams) => string {
  const t = useT()
  return (key, params) => t(key as MessageKey, params)
}
