import { create } from 'zustand'
import type { TranscribeProgress } from '../../../shared/ipc'
import type { ArchiveQuery } from '../../../shared/search'
import { emptyQuery } from '../../../shared/search'
import type { Folder, LibrarySnapshot, Recording, Tag } from '../../../shared/types'

interface LibraryState {
  recordings: Recording[]
  folders: Folder[]
  tags: Tag[]
  loaded: boolean
  query: ArchiveQuery
  transcriptMatches: Set<string>
  selection: Set<string>
  activeId: string | null
  jobs: Record<string, TranscribeProgress>

  setSnapshot: (s: LibrarySnapshot) => void
  setQuery: (patch: Partial<ArchiveQuery>) => void
  resetFilters: () => void
  setTranscriptMatches: (ids: string[]) => void
  toggleSelected: (id: string) => void
  setSelection: (ids: string[]) => void
  clearSelection: () => void
  setActive: (id: string | null) => void
  setJob: (p: TranscribeProgress) => void
  setJobs: (list: TranscribeProgress[]) => void
}

export const useLibrary = create<LibraryState>((set) => ({
  recordings: [],
  folders: [],
  tags: [],
  loaded: false,
  query: emptyQuery(),
  transcriptMatches: new Set(),
  selection: new Set(),
  activeId: null,
  jobs: {},

  setSnapshot: (s) =>
    set((st) => {
      const ids = new Set(s.recordings.map((r) => r.id))
      return {
        recordings: s.recordings,
        folders: s.folders,
        tags: s.tags,
        loaded: true,
        selection: new Set([...st.selection].filter((id) => ids.has(id))),
        activeId: st.activeId && ids.has(st.activeId) ? st.activeId : null
      }
    }),
  setQuery: (patch) => set((st) => ({ query: { ...st.query, ...patch } })),
  resetFilters: () => set((st) => ({ query: { ...emptyQuery(), text: st.query.text, sort: st.query.sort } })),
  setTranscriptMatches: (ids) => set({ transcriptMatches: new Set(ids) }),
  toggleSelected: (id) =>
    set((st) => {
      const next = new Set(st.selection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selection: next }
    }),
  setSelection: (ids) => set({ selection: new Set(ids) }),
  clearSelection: () => set({ selection: new Set() }),
  setActive: (id) => set({ activeId: id }),
  setJob: (p) => set((st) => ({ jobs: { ...st.jobs, [p.recordingId]: p } })),
  setJobs: (list) => set({ jobs: Object.fromEntries(list.map((p) => [p.recordingId, p])) })
}))
