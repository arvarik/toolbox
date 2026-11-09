/**
 * @fileoverview ModelPicker — the unified model selection surface.
 *
 * One component, three trigger shapes:
 *   - variant="sidebar"  → full-width chip in the sidebar footer
 *   - variant="header"   → compact pill in the mobile header
 *   - variant="settings" → "Change model" button on the settings page
 */
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { Search, Check, RefreshCw, ChevronsUpDown, Settings2, Boxes } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import type { ModelCatalogItem, ModelGroup } from '../../utils/api'

export type ModelPickerVariant = 'sidebar' | 'header' | 'settings'

export interface ModelPickerProps {
  variant?: ModelPickerVariant
}

interface ResolvedModel extends ModelCatalogItem {
  providerColor?: string
  providerName: string
}

function findModel(groups: readonly ModelGroup[], id: string): ResolvedModel | null {
  for (const group of groups) {
    const m = group.models.find((entry) => entry.id === id)
    if (m) {
      return {
        ...m,
        providerColor: group.provider.color,
        providerName: group.provider.name,
      }
    }
  }
  return null
}

export default function ModelPicker({ variant = 'sidebar' }: ModelPickerProps) {
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)
  const availableModels = useAppStore((s) => s.availableModels)
  const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels)
  const addToast = useAppStore((s) => s.addToast)
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const openPicker = () => {
    setQuery('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    void fetchAvailableModels()
    const t = setTimeout(() => searchRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [open, fetchAvailableModels])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  const activeModel = useMemo(
    () => findModel(availableModels, model),
    [availableModels, model],
  )

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return availableModels
      .map((group) => ({
        ...group,
        models: group.models.filter((m) => {
          if (!q) return true
          return [m.name, m.id, m.family, group.provider.name]
            .filter((s): s is string => Boolean(s))
            .some((s) => s.toLowerCase().includes(q))
        }),
      }))
      .filter((group) => group.models.length > 0)
  }, [availableModels, query])

  const hasAnyModels = availableModels.some((g) => g.models.length > 0)

  const handleSelect = (m: ModelCatalogItem) => {
    if (m.id !== model) {
      setModel(m.id)
      addToast({ type: 'info', message: `Model switched to ${m.name}` })
    }
    setOpen(false)
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const data = await useAppStore.getState().refreshModels()
      const errors = Object.entries(data.errors || {})
      if (errors.length > 0) {
        addToast({
          type: 'error',
          message: `Some catalogs failed to refresh: ${errors.map(([id]) => id).join(', ')}`,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh models'
      addToast({ type: 'error', message })
    } finally {
      setIsRefreshing(false)
    }
  }

  const goToSettings = () => {
    setOpen(false)
    navigate('/settings')
  }

  const triggerLabel = activeModel ? activeModel.name : model
  const triggerColor = activeModel?.providerColor || 'var(--color-text-tertiary)'

  const trigger =
    variant === 'settings' ? (
      <button className="btn btn-secondary" id="model-picker-trigger" onClick={openPicker}>
        <ChevronsUpDown size={14} />
        Change model
      </button>
    ) : (
      <button
        className={`model-trigger model-trigger-${variant}`}
        id="model-picker-trigger"
        onClick={openPicker}
        title={`Change model (${triggerLabel})`}
      >
        <span className="model-trigger-dot" style={{ background: triggerColor }} />
        <span className="model-trigger-label">{triggerLabel}</span>
        {variant === 'sidebar' && activeModel?.family && (
          <span className="model-trigger-family">{activeModel.family}</span>
        )}
        <ChevronsUpDown
          size={variant === 'header' ? 11 : 13}
          style={{ flexShrink: 0, opacity: 0.6 }}
        />
      </button>
    )

  const sheet = open
    ? createPortal(
        <div className="model-picker-overlay" onClick={() => setOpen(false)}>
          <div
            className="model-picker-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Select AI model"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="model-picker-handle" aria-hidden="true" />

            <div className="model-picker-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                id="model-picker-search"
                placeholder="Search models…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="model-picker-list">
              {!hasAnyModels ? (
                <div className="model-picker-empty">
                  <Boxes size={28} strokeWidth={1.5} aria-hidden="true" />
                  <p className="model-picker-empty-title">No models yet</p>
                  <p>Connect a provider key or a local endpoint to unlock AI features.</p>
                  <button className="btn btn-primary" onClick={goToSettings}>
                    <Settings2 size={14} />
                    Set up providers
                  </button>
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="model-picker-empty">
                  <p>No models match &quot;{query}&quot;</p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <div key={group.provider.id} className="model-picker-group">
                    <div
                      className="model-picker-group-label"
                      style={{ color: group.provider.color }}
                    >
                      <span
                        className="model-trigger-dot"
                        style={{ background: group.provider.color }}
                      />
                      {group.provider.name}
                    </div>
                    {group.models.map((m) => (
                      <button
                        key={m.id}
                        className={`model-picker-option${m.id === model ? ' active' : ''}`}
                        onClick={() => handleSelect(m)}
                        aria-pressed={m.id === model}
                      >
                        <span className="model-picker-option-name">{m.name}</span>
                        {m.family && (
                          <span
                            className="model-trigger-family"
                            style={{
                              color: group.provider.color,
                              borderColor: group.provider.color,
                            }}
                          >
                            {m.family}
                          </span>
                        )}
                        {m.id === model && (
                          <Check size={15} className="model-picker-check" aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="model-picker-footer">
              <button
                className="model-picker-footer-btn"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                id="model-picker-refresh"
              >
                <RefreshCw size={12} className={isRefreshing ? 'spin' : undefined} />
                {isRefreshing ? 'Syncing…' : 'Refresh catalog'}
              </button>
              <button className="model-picker-footer-btn" onClick={goToSettings}>
                <Settings2 size={12} />
                Manage providers
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      {trigger}
      {sheet}
    </>
  )
}
