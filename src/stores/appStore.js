import { create } from 'zustand'

/**
 * Global application store using Zustand.
 * Manages sidebar state, active views, and shared UI state.
 */
const useAppStore = create((set) => ({
  // Sidebar
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Chat panels (per-page)
  chatOpen: {
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
}))

export default useAppStore
