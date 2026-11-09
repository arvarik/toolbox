/**
 * @fileoverview Global Application Store
 * Manages UI state (theme, chat overlays), API configuration (model selection, API key presence),
 * and shared workspace data (diagram nodes/edges).
 */
import { create } from 'zustand'
import { configApi } from '../utils/api'
import type { AvailableModelsResponse, ModelGroup } from '../utils/api'
import useKitStore from './useKitStore'

export type ThemeMode = 'dark' | 'light'
export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastInput {
  type?: ToastType
  message: string
  action?: ToastAction
}

export interface ToastItem extends ToastInput {
  id: string
}

export interface CanvasNode {
  id: string
  type?: string
  position?: { x: number; y: number }
  data?: {
    name?: string
    icon?: string
    category?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface CanvasEdge {
  id: string
  source?: string
  target?: string
  from?: string
  to?: string
  label?: string
  data?: {
    label?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface AppStoreState {
  theme: ThemeMode
  toggleTheme: () => void

  model: string
  setModel: (model: string) => void

  sidebarCollapsed: boolean
  toggleSidebar: () => void

  chatOpen: Record<string, boolean>
  toggleChat: (page: string) => void
  setChatOpen: (page: string, open: boolean) => void

  apiKeyConfigured: boolean
  setApiKeyConfigured: (status: boolean) => void
  apiKeysConfigured: Record<string, boolean>
  setApiKeysConfigured: (status: Record<string, boolean>) => void

  availableModels: ModelGroup[]
  fetchAvailableModels: () => Promise<void>
  refreshModels: () => Promise<AvailableModelsResponse>
  applyModelGroups: (groups: ModelGroup[]) => void

  toasts: ToastItem[]
  addToast: (toast: ToastInput) => void
  removeToast: (id: string) => void

  calcModalOpen: boolean
  setCalcModalOpen: (open: boolean) => void
  toggleCalcModal: () => void

  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  toggleSearch: () => void

  srsVersion: number
  bumpSrsVersion: () => void

  nodes: CanvasNode[]
  setNodes: (nodes: CanvasNode[]) => void
  edges: CanvasEdge[]
  setEdges: (edges: CanvasEdge[]) => void

  ahaMomentActive: boolean
  triggerAhaMoment: () => void

  pendingActions: Record<string, ReturnType<typeof setTimeout>>
  scheduleAction: (id: string, executeFn: () => void, delay?: number) => void
  cancelAction: (id: string) => boolean

  resetWorkspaceState: () => void
}

const getInitialTheme = (): ThemeMode => {
  try {
    const saved = localStorage.getItem('toolbox_theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  return 'dark'
}

const applyTheme = (theme: ThemeMode): void => {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
  try { localStorage.setItem('toolbox_theme', theme) } catch { /* ignore */ }
}

const getInitialModel = (): string => {
  try {
    const saved = localStorage.getItem('toolbox_model')
    if (saved) return saved
  } catch { /* ignore */ }
  return 'gemini-3.5-flash'
}

const initialTheme = getInitialTheme()
applyTheme(initialTheme)

let toastCounter = 0

const useAppStore = create<AppStoreState>((set, get) => ({
  theme: initialTheme,
  toggleTheme: () =>
    set((s) => {
      const next: ThemeMode = s.theme === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return { theme: next }
    }),

  model: getInitialModel(),
  setModel: (model) => {
    try { localStorage.setItem('toolbox_model', model) } catch { /* ignore */ }
    set({ model })
  },

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

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

  apiKeyConfigured: false,
  setApiKeyConfigured: (status) => set({ apiKeyConfigured: status }),
  apiKeysConfigured: {},
  setApiKeysConfigured: (status) =>
    set({
      apiKeysConfigured: status,
      apiKeyConfigured: Object.values(status).some(Boolean),
    }),

  availableModels: [],
  fetchAvailableModels: async () => {
    try {
      const data = await configApi.getAvailableModels()
      get().applyModelGroups(data.groups || [])
    } catch {
      // Silently fail — models will just show as empty
    }
  },

  refreshModels: async () => {
    const data = await configApi.refreshModels()
    get().applyModelGroups(data.groups || [])
    return data
  },

  applyModelGroups: (groups) => {
    set({ availableModels: groups })
    const allIds = groups.flatMap((g) => g.models.map((m) => m.id))
    if (allIds.length > 0 && !allIds.includes(get().model)) {
      get().setModel(allIds[0])
    }
  },

  toasts: [],
  addToast: (toast) =>
    set((s) => {
      toastCounter += 1
      return {
        toasts: [...s.toasts, { id: `${Date.now()}-${toastCounter}`, ...toast }],
      }
    }),
  removeToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),

  calcModalOpen: false,
  setCalcModalOpen: (open) => set({ calcModalOpen: open }),
  toggleCalcModal: () => set((s) => ({ calcModalOpen: !s.calcModalOpen })),

  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),

  srsVersion: 0,
  bumpSrsVersion: () => set((s) => ({ srsVersion: s.srsVersion + 1 })),

  nodes: [],
  setNodes: (nodes) => set({ nodes }),
  edges: [],
  setEdges: (edges) => set({ edges }),

  ahaMomentActive: false,
  triggerAhaMoment: () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([40, 60, 100])
      }
    } catch {
      // Ignore haptic errors on unsupported devices
    }
    set({ ahaMomentActive: true })
    setTimeout(() => set({ ahaMomentActive: false }), 2000)
  },

  pendingActions: {},
  scheduleAction: (id, executeFn, delay = 5000) => {
    const existing = get().pendingActions[id]
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      executeFn()
      set((s) => {
        const next = { ...s.pendingActions }
        delete next[id]
        return { pendingActions: next }
      })
    }, delay)
    set((s) => ({
      pendingActions: { ...s.pendingActions, [id]: timer },
    }))
  },
  cancelAction: (id) => {
    let cancelled = false
    set((s) => {
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

  resetWorkspaceState: () =>
    set((s) => {
      for (const timer of Object.values(s.pendingActions)) {
        clearTimeout(timer)
      }
      return {
        nodes: [],
        edges: [],
        toasts: [],
        calcModalOpen: false,
        searchOpen: false,
        availableModels: [],
        apiKeyConfigured: false,
        apiKeysConfigured: {},
        pendingActions: {},
      }
    }),
}))

// Clear cross-Kit canvas/modal state whenever the active Kit changes.
useKitStore.subscribe((state, prevState) => {
  if (state.activeKitSlug !== prevState.activeKitSlug) {
    useAppStore.setState({
      nodes: [],
      edges: [],
      calcModalOpen: false,
      searchOpen: false,
    })
  }
})

// Clear sensitive/pending workspace state on session expiration or sign-out.
if (typeof window !== 'undefined') {
  window.addEventListener('toolbox:unauthorized', () => {
    useAppStore.getState().resetWorkspaceState()
  })
}

export default useAppStore
