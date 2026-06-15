/**
 * @fileoverview Global Application Store
 * Manages UI state (theme, chat overlays), API configuration (model selection, API key presence),
 * and shared workspace data (diagram nodes/edges).
 */
import { create } from 'zustand'

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
const useAppStore = create((set) => ({
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

  // API key status
  apiKeyConfigured: false,
  setApiKeyConfigured: (status) => set({ apiKeyConfigured: status }),

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

  // Canvas Whiteboard Nodes
  nodes: [],
  setNodes: (nodes) => set({ nodes }),

  // Canvas Whiteboard Edges
  edges: [],
  setEdges: (edges) => {
    if (typeof edges === 'function') {
      set((s) => ({ edges: edges(s.edges) }))
    } else {
      set({ edges })
    }
  },
  addEdge: (edge) =>
    set((s) => ({ edges: [...s.edges, edge] })),
  removeEdge: (id) =>
    set((s) => ({ edges: s.edges.filter((e) => e.id !== id) })),
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
}))

export default useAppStore
