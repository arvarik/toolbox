/**
 * @fileoverview Global Application Store
 * Manages UI state (theme, chat overlays), API configuration (model selection, API key presence),
 * and shared workspace data (diagram nodes/edges).
 */
import { create } from 'zustand'
import { configApi } from '../utils/api'

// Read initial theme from localStorage
const getInitialTheme = () => {
  try {
    const saved = localStorage.getItem('toolbox_theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  return 'dark'
}

// Apply theme to DOM
const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem('toolbox_theme', theme) } catch { /* ignore */ }
}

// Read initial model from localStorage
const getInitialModel = () => {
  try {
    const saved = localStorage.getItem('toolbox_model')
    if (saved) return saved
  } catch { /* ignore */ }
  return 'gemini-3.5-flash'
}

// Initialize theme on load
const initialTheme = getInitialTheme()
applyTheme(initialTheme)

/**
 * Global application store using Zustand.
 * Manages sidebar state, active views, theme, and shared UI state.
 */
const useAppStore = create((set, get) => ({
  // Theme
  theme: initialTheme,
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return { theme: next }
    }),

  // AI Model Selection
  model: getInitialModel(),
  setModel: (model) => {
    try { localStorage.setItem('toolbox_model', model) } catch { /* ignore */ }
    set({ model })
  },

  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Chat panels (per-page)
  chatOpen: {
    chat: false,
    guide: false,
    builder: false,
    study: false,
  },
  toggleChat: (page) =>
    set((s) => ({
      chatOpen: { ...s.chatOpen, [page]: !s.chatOpen[page] },
    })),
  setChatOpen: (page, open) =>
    set((s) => ({
      chatOpen: { ...s.chatOpen, [page]: open },
    })),

  // API key status (backward-compat: apiKeyConfigured = true if ANY provider key is set)
  apiKeyConfigured: false,
  setApiKeyConfigured: (status) => set({ apiKeyConfigured: status }),
  // Per-provider key status: { gemini: bool, claude: bool }
  apiKeysConfigured: {},
  setApiKeysConfigured: (status) => set({
    apiKeysConfigured: status,
    apiKeyConfigured: Object.values(status).some(Boolean),
  }),

  // Dynamic model catalog (fetched from backend based on configured keys)
  availableModels: [],
  fetchAvailableModels: async () => {
    try {
      const data = await configApi.getAvailableModels()
      get().applyModelGroups(data.groups || [])
    } catch {
      // Silently fail — models will just show as empty
    }
  },

  // Trigger a live re-sync with all providers/endpoints, then apply the result
  refreshModels: async () => {
    const data = await configApi.refreshModels()
    get().applyModelGroups(data.groups || [])
    return data
  },

  /**
   * Apply a fresh set of model groups.
   * Safe fallback: when the active model disappears (key removed,
   * endpoint deleted, model no longer served), the selection resets to
   * the first available model so AI features keep working.
   */
  applyModelGroups: (groups) => {
    set({ availableModels: groups })
    const allIds = groups.flatMap((g) => g.models.map((m) => m.id))
    if (allIds.length > 0 && !allIds.includes(get().model)) {
      get().setModel(allIds[0])
    }
  },

  // Toast notifications
  toasts: [],
  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { id: `${Date.now()}-${Math.random()}`, ...toast }],
    })),
  removeToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),

  // BotE Calculator quick-access modal (available on every page)
  calcModalOpen: false,
  setCalcModalOpen: (open) => set({ calcModalOpen: open }),
  toggleCalcModal: () => set((s) => ({ calcModalOpen: !s.calcModalOpen })),

  // SRS sync counter — bumps after every card review so open views
  // (e.g. the Knowledge Graph heatmap) can refresh without a reload.
  srsVersion: 0,
  bumpSrsVersion: () => set((s) => ({ srsVersion: s.srsVersion + 1 })),

  // Whiteboard canvas state (React Flow node/edge shape; the persisted
  // board format is converted at the boundary — see builder/boardModel.js)
  nodes: [],
  setNodes: (nodes) => set({ nodes }),
  edges: [],
  setEdges: (edges) => set({ edges }),
  // Aha! Moment micro-interaction
  ahaMomentActive: false,
  triggerAhaMoment: () => {
    // Attempt to trigger haptic feedback if supported
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([40, 60, 100]); // "Thump" pattern
      }
    } catch {
      // Ignore haptic errors on unsupported devices
    }
    set({ ahaMomentActive: true })
    // Auto-reset after animation duration (e.g. 1500ms)
    setTimeout(() => set({ ahaMomentActive: false }), 2000)
  },

  // Delayed execution queue (Undo feature)
  pendingActions: {},
  scheduleAction: (id, executeFn, delay = 5000) => {
    const timer = setTimeout(() => {
      executeFn()
      set(s => {
        const next = { ...s.pendingActions }
        delete next[id]
        return { pendingActions: next }
      })
    }, delay)
    set(s => ({
      pendingActions: { ...s.pendingActions, [id]: timer }
    }))
  },
  cancelAction: (id) => {
    let cancelled = false
    set(s => {
      if (s.pendingActions[id]) {
        clearTimeout(s.pendingActions[id])
        const next = { ...s.pendingActions }
        delete next[id]
        cancelled = true
        return { pendingActions: next }
      }
      return s
    })
    return cancelled
  },
}))

export default useAppStore
