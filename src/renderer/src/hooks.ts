import { useEffect, useState } from 'react'
import { SHORTCUT_ACTIONS } from '../../shared/types'
import { eventMatches, parseAccelerator } from '../../shared/shortcuts'
import { platform, setZoomFactor } from './api'
import { engine } from './audio/engine'
import { useApp } from './stores/app'

const KEY_OPERATED = 'button, [role="button"], [role="switch"], [role="radio"], [role="tab"], [role="checkbox"], [role="slider"], [role="option"], a, summary'

/**
 * In-app handling of the recording shortcuts. Text fields, dialogs, the shortcut recorder and
 * local key areas (the waveform editor) never trigger recording commands. Space/Enter keep their
 * normal meaning on a control that was focused with the keyboard.
 */
export function useInAppShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const st = useApp.getState()
      const s = st.settings
      if (!s || !s.onboardingCompleted || st.shortcutCapture || e.repeat || e.defaultPrevented) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target) {
        if (target.closest('[data-shortcut-scope="local"]')) return
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
        if (target.closest('[role="dialog"]')) return
      }
      for (const action of SHORTCUT_ACTIONS) {
        const acc = s.shortcuts.bindings[action]
        if (!eventMatches(acc, e, platform)) continue
        const key = parseAccelerator(acc)?.key
        if ((key === 'Space' || key === 'Enter') && target && target.matches(':focus-visible') && target.closest(KEY_OPERATED)) return
        e.preventDefault()
        void engine.handle({ action, origin: 'shortcut' })
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

/** Mirrors theme, contrast, motion, language and scale preferences onto the document. */
export function useDocumentPrefs(): void {
  const settings = useApp((s) => s.settings)
  const locale = useApp((s) => s.locale)
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.dataset.contrast = settings.highContrast ? 'high' : 'normal'
    root.dataset.motion = settings.reduceMotion === 'on' ? 'reduce' : settings.reduceMotion === 'off' ? 'full' : 'system'
    root.lang = locale === 'zh' ? 'zh-CN' : locale
    setZoomFactor(settings.uiScale)
  }, [settings, locale])
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (): void => setMatch(mq.matches)
    mq.addEventListener('change', onChange)
    onChange()
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
}

/** framer-motion reduced-motion mode derived from the user's preference. */
export function useReducedMotionMode(): 'always' | 'never' | 'user' {
  const pref = useApp((s) => s.settings?.reduceMotion ?? 'system')
  return pref === 'on' ? 'always' : pref === 'off' ? 'never' : 'user'
}

export function useInterval(fn: () => void, ms: number | null): void {
  useEffect(() => {
    if (ms === null) return
    const id = window.setInterval(fn, ms)
    return () => window.clearInterval(id)
  }, [fn, ms])
}
