import { create } from 'zustand'

const useCommitStore = create((set) => ({
  // Modal visibility state
  isOpen: false,
  isMinimized: false,

  // Analysis / Save state
  phase: 'idle', // 'idle' | 'analyzing' | 'preview' | 'saving' | 'done' | 'error'
  errorMsg: '',
  updates: [],
  enabledSections: new Set(),
  expandedSections: new Set(),
  savedCount: 0,
  
  // Context for the current commit
  messages: [],
  topicContext: null, // { pillarId, topicId, topicName }
  currentCallId: 0,

  // Visibility actions
  setOpen: (open) => set({ isOpen: open, isMinimized: false }),
  setMinimized: (min) => set({ isMinimized: min, isOpen: !min }),
  closeCompletely: () => set({ 
    isOpen: false, 
    isMinimized: false,
    phase: 'idle',
    updates: [],
    enabledSections: new Set(),
    expandedSections: new Set(),
    savedCount: 0,
    messages: [],
    topicContext: null,
    errorMsg: ''
  }),

  // Actions for the commit flow
  startAnalysis: (messages, topicContext) => set({
    isOpen: true,
    isMinimized: false,
    phase: 'idle',
    errorMsg: '',
    updates: [],
    enabledSections: new Set(),
    expandedSections: new Set(),
    savedCount: 0,
    messages,
    topicContext
  }),

  setPhase: (phase) => set({ phase }),
  setError: (errorMsg) => set({ errorMsg, phase: 'error' }),
  
  setUpdatesResult: (updates, enabledSet, expandedSet) => set({
    updates,
    enabledSections: enabledSet,
    expandedSections: expandedSet,
    phase: 'preview'
  }),

  mergeUpdatesResult: (newUpdates, targetSectionIds) => set((state) => {
    const nextUpdates = [...state.updates]
    for (const u of newUpdates) {
      const idx = nextUpdates.findIndex(x => x.sectionId === u.sectionId)
      if (idx >= 0) nextUpdates[idx] = u
      else nextUpdates.push(u)
    }

    const nextEnabled = new Set(state.enabledSections)
    targetSectionIds.forEach(id => nextEnabled.add(id))

    const nextExpanded = new Set(state.expandedSections)
    targetSectionIds.forEach(id => nextExpanded.add(id))

    return {
      updates: nextUpdates,
      enabledSections: nextEnabled,
      expandedSections: nextExpanded,
      phase: 'preview'
    }
  }),

  setEnabledSections: (updater) => set((state) => ({
    enabledSections: typeof updater === 'function' ? updater(state.enabledSections) : updater
  })),

  setExpandedSections: (updater) => set((state) => ({
    expandedSections: typeof updater === 'function' ? updater(state.expandedSections) : updater
  })),

  setSavedCount: (count) => set({ savedCount: count })
}))

export default useCommitStore
