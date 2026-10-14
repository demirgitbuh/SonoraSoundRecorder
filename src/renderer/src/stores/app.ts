import { create } from 'zustand'
import type { BootstrapData, PendingRun, Route, TaskProgress, UpdateStatus } from '../../../shared/ipc'
import type { Settings, SettingsPatch } from '../../../shared/settings'
import type { Locale, PlatformCapabilities, ShortcutStatus, ToastKind, ToastPayload } from '../../../shared/types'
import { invoke } from '../api'

export type EditorSource = { kind: 'run'; runId: string; sessionId: string | null } | { kind: 'recording'; recordingId: string }

export type RouteState = { name: Route } | { name: 'editor'; source: EditorSource; back: Route }

export interface ArchivePreset {
  folderId?: string | null
  tagId?: string
}

interface AppState {
  boot: BootstrapData | null
  settings: Settings | null
  caps: PlatformCapabilities | null
  locale: Locale
  route: RouteState
  archivePreset: ArchivePreset | null
  toasts: ToastPayload[]
  update: UpdateStatus | null
  updateDialog: boolean
  recoveryDialog: boolean
  shortcutStatus: ShortcutStatus[]
  tasks: Record<string, TaskProgress>
  pendingRuns: PendingRun[]
  announcement: { text: string; seq: number; assertive: boolean }
  /** While true the in-app shortcut handler ignores key presses (shortcut capture UI). */
  shortcutCapture: boolean
  /** Run waiting for a name ("ask for a name" post-recording action). */
  nameDialog: { runId: string; sessionId: string } | null

  init: (boot: BootstrapData) => void
  setSettings: (s: Settings) => void
  updateSettings: (patch: SettingsPatch) => Promise<Settings>
  navigate: (route: Route) => void
  openEditor: (source: EditorSource) => void
  openArchive: (preset: ArchivePreset | null) => void
  closeEditor: () => void
  toast: (kind: ToastKind, titleKey: string, opts?: { bodyKey?: string; params?: Record<string, string | number>; detail?: string }) => void
  pushToast: (t: ToastPayload) => void
  dismissToast: (id: string) => void
  setUpdate: (u: UpdateStatus | null) => void
  setUpdateDialog: (open: boolean) => void
  setRecoveryDialog: (open: boolean) => void
  setShortcutStatus: (s: ShortcutStatus[]) => void
  setTask: (t: TaskProgress) => void
  setPendingRuns: (runs: PendingRun[]) => void
  announce: (text: string, assertive?: boolean) => void
  setShortcutCapture: (v: boolean) => void
  setNameDialog: (v: { runId: string; sessionId: string } | null) => void
}

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  boot: null,
  settings: null,
  caps: null,
  locale: 'en',
  route: { name: 'record' },
  archivePreset: null,
  toasts: [],
  update: null,
  updateDialog: false,
  recoveryDialog: false,
  shortcutStatus: [],
  tasks: {},
  pendingRuns: [],
  announcement: { text: '', seq: 0, assertive: false },
  shortcutCapture: false,
  nameDialog: null,

  init: (boot) =>
    set({
      boot,
      settings: boot.settings,
      caps: boot.capabilities,
      locale: boot.settings.language ?? boot.systemLocale
    }),
  setSettings: (s) => set((st) => ({ settings: s, locale: s.language ?? st.boot?.systemLocale ?? 'en' })),
  updateSettings: async (patch) => {
    const s = await invoke('settings:update', patch)
    get().setSettings(s)
    return s
  },
  navigate: (route) => set({ route: { name: route }, archivePreset: route === 'archive' ? get().archivePreset : null }),
  openEditor: (source) => {
    const current = get().route
    const back: Route = current.name === 'editor' ? current.back : current.name
    set({ route: { name: 'editor', source, back } })
  },
  openArchive: (preset) => set({ route: { name: 'archive' }, archivePreset: preset }),
  closeEditor: () => {
    const current = get().route
    set({ route: { name: current.name === 'editor' ? current.back : 'record' } })
  },
  toast: (kind, titleKey, opts) => {
    get().pushToast({ id: `local-${++toastSeq}`, kind, titleKey, ...opts })
  },
  pushToast: (t) => set((st) => ({ toasts: [...st.toasts.filter((x) => x.id !== t.id), t].slice(-4) })),
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
  setUpdate: (u) => set({ update: u }),
  setUpdateDialog: (open) => set({ updateDialog: open }),
  setRecoveryDialog: (open) => set({ recoveryDialog: open }),
  setShortcutStatus: (s) => set({ shortcutStatus: s }),
  setTask: (t) =>
    set((st) => {
      const tasks = { ...st.tasks, [t.taskId]: t }
      if (t.percent >= 100) delete tasks[t.taskId]
      return { tasks }
    }),
  setPendingRuns: (runs) => set({ pendingRuns: runs }),
  announce: (text, assertive = false) => set((st) => ({ announcement: { text, seq: st.announcement.seq + 1, assertive } })),
  setShortcutCapture: (v) => set({ shortcutCapture: v }),
  setNameDialog: (v) => set({ nameDialog: v })
}))
