import { create } from 'zustand'
import type { CommitSectionUpdate } from '../utils/api'
import useKitStore from './useKitStore'

export type CommitPhase = 'idle' | 'analyzing' | 'preview' | 'saving' | 'done' | 'error'

export interface CommitMessage {
  role: string
  content: string
  timestamp?: number
}

export interface CommitTopicContext {
  pillarId: string
  topicId: string
  topicName: string
}

type SetUpdater<T> = Set<T> | ((prev: Set<T>) => Set<T>)

export interface CommitStoreState {
  isOpen: boolean
  isMinimized: boolean
  phase: CommitPhase
  errorMsg: string
  updates: CommitSectionUpdate[]
  enabledSections: Set<string>
  savedCount: number
  messages: CommitMessage[]
  topicContext: CommitTopicContext | null
  currentCallId: number

  setMinimized: (min: boolean) => void
  closeCompletely: () => void
  startAnalysis: (messages: CommitMessage[], topicContext: CommitTopicContext | null) => void
  setPhase: (phase: CommitPhase) => void
  setError: (errorMsg: string) => void
  setUpdatesResult: (updates: CommitSectionUpdate[], enabledSet: Set<string>) => void
  mergeUpdatesResult: (newUpdates: CommitSectionUpdate[], targetSectionIds: string[]) => void
  setEnabledSections: (updater: SetUpdater<string>) => void
  setSavedCount: (count: number) => void
}

const useCommitStore = create<CommitStoreState>((set) => ({
  isOpen: false,
  isMinimized: false,

  phase: 'idle',
  errorMsg: '',
  updates: [],
  enabledSections: new Set<string>(),
  savedCount: 0,

  messages: [],
  topicContext: null,
  currentCallId: 0,

  setMinimized: (min) => set({ isMinimized: min, isOpen: !min }),
  closeCompletely: () =>
    set((s) => ({
      isOpen: false,
      isMinimized: false,
      phase: 'idle',
      updates: [],
      enabledSections: new Set<string>(),
      savedCount: 0,
      messages: [],
      topicContext: null,
      errorMsg: '',
      currentCallId: s.currentCallId + 1,
    })),

  startAnalysis: (messages, topicContext) =>
    set({
      isOpen: true,
      isMinimized: false,
      phase: 'idle',
      errorMsg: '',
      updates: [],
      enabledSections: new Set<string>(),
      savedCount: 0,
      messages,
      topicContext,
    }),

  setPhase: (phase) => set({ phase }),
  setError: (errorMsg) => set({ errorMsg, phase: 'error' }),

  setUpdatesResult: (updates, enabledSet) =>
    set({
      updates,
      enabledSections: enabledSet,
      phase: 'preview',
    }),

  mergeUpdatesResult: (newUpdates, targetSectionIds) =>
    set((state) => {
      const nextUpdates = [...state.updates]
      for (const u of newUpdates) {
        const idx = nextUpdates.findIndex((x) => x.sectionId === u.sectionId)
        if (idx >= 0) nextUpdates[idx] = u
        else nextUpdates.push(u)
      }

      const nextEnabled = new Set(state.enabledSections)
      for (const id of targetSectionIds) nextEnabled.add(id)

      return {
        updates: nextUpdates,
        enabledSections: nextEnabled,
        phase: 'preview',
      }
    }),

  setEnabledSections: (updater) =>
    set((state) => ({
      enabledSections: typeof updater === 'function' ? updater(state.enabledSections) : updater,
    })),

  setSavedCount: (count) => set({ savedCount: count }),
}))

// Reset active commit state when switching Kits so notes from Kit A cannot commit into Kit B.
useKitStore.subscribe((state, prevState) => {
  if (state.activeKitSlug !== prevState.activeKitSlug) {
    const cur = useCommitStore.getState()
    if (cur.isOpen || cur.isMinimized || cur.phase !== 'idle') {
      cur.closeCompletely()
    }
  }
})

if (typeof window !== 'undefined') {
  window.addEventListener('toolbox:unauthorized', () => {
    useCommitStore.getState().closeCompletely()
  })
}

export default useCommitStore
