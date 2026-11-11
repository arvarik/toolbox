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
import { Button, Kbd } from '../ui/Controls'

export type ModelPickerVariant = 'sidebar' | 'header' | 'settings'

export interface ModelPickerProps {
  variant?: ModelPickerVariant
  triggerId?: string
}

function findModel(groups: readonly ModelGroup[], id: string): ModelCatalogItem | null {
  for (const group of groups) {
    const m = group.models.find((entry) => entry.id === id)
    if (m) return m
  }
  return null
}

export default function ModelPicker({
  variant = 'sidebar',
  triggerId = 'model-picker-trigger',
}: ModelPickerProps) {
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)
  const availableModels = useAppStore((s) => s.availableModels)
  const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels)
  const addToast = useAppStore((s) => s.addToast)
  const navigate = useNavigate()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const openPicker = () => {
    setQuery('')
    setActiveIndex(0)
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
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setOpen(false)
      }
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

  const flatFilteredModels = useMemo(
    () => filteredGroups.flatMap((g) => g.models),
    [filteredGroups],
  )

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
  const triggerDotColor = activeModel ? 'var(--color-brand)' : 'var(--color-ink-faint)'

  const trigger =
    variant === 'settings' ? (
      <Button variant="secondary" size="sm" id={triggerId} onClick={openPicker}>
        <ChevronsUpDown size={14} />
        Change model
      </Button>
    ) : (
      <button
        type="button"
        className={`model-trigger model-trigger-${variant}`}
        id={triggerId}
        onClick={openPicker}
        title={`Change model (${triggerLabel})`}
        style={{
          background: 'var(--color-surface-elevated)',
          borderColor: 'var(--color-line-strong)',
          color: 'var(--color-ink)',
          boxShadow: 'var(--shadow-hairline)',
        }}
      >
        <span className="model-trigger-dot" style={{ background: triggerDotColor }} />
        <span className="model-trigger-label" style={{ color: 'var(--color-ink)' }}>
          {triggerLabel}
        </span>
        {variant === 'sidebar' && activeModel?.family && (
          <span
            className="model-trigger-family"
            style={{
              color: 'var(--color-ink-faint)',
              borderColor: 'var(--color-line-strong)',
              background: 'var(--color-surface-low)',
            }}
          >
            {activeModel.family}
          </span>
        )}
        <ChevronsUpDown
          size={variant === 'header' ? 11 : 13}
          style={{ flexShrink: 0, color: 'var(--color-ink-faint)' }}
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
            style={{
              background: 'var(--color-surface-card)',
              borderColor: 'var(--color-line-strong)',
              boxShadow: 'var(--shadow-float)',
            }}
          >
            <div className="model-picker-handle" aria-hidden="true" />

            <div
              className="model-picker-search"
              style={{
                background: 'var(--color-surface-low)',
                borderColor: 'var(--color-line-strong)',
                color: 'var(--color-ink-faint)',
              }}
            >
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                id="model-picker-search"
                placeholder="Search models…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIndex(0)
                }}
                onKeyDown={(e) => {
                  if (flatFilteredModels.length === 0) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActiveIndex((i) => (i + 1) % flatFilteredModels.length)
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActiveIndex(
                      (i) => (i - 1 + flatFilteredModels.length) % flatFilteredModels.length,
                    )
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    const picked = flatFilteredModels[activeIndex]
                    if (picked) handleSelect(picked)
                  }
                }}
              />
              <Kbd>Esc</Kbd>
            </div>

            <div className="model-picker-list">
              {!hasAnyModels ? (
                <div className="model-picker-empty">
                  <Boxes size={26} strokeWidth={1.5} aria-hidden="true" />
                  <p className="model-picker-empty-title">No models yet</p>
                  <p>Connect a provider key or local endpoint to enable Kit.</p>
                  <Button variant="primary" size="sm" onClick={goToSettings} className="mt-2">
                    <Settings2 size={14} />
                    Set up providers
                  </Button>
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
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      <span
                        className="model-trigger-dot"
                        style={{ background: 'var(--color-ink-faint)' }}
                      />
                      {group.provider.name}
                    </div>
                    {group.models.map((m) => {
                      const isSelected = m.id === model
                      const isKeyboardActive = flatFilteredModels[activeIndex]?.id === m.id
                      return (
                        <button
                          type="button"
                          key={m.id}
                          className={`model-picker-option${isSelected ? ' active' : ''}`}
                          onClick={() => handleSelect(m)}
                          onMouseEnter={() => {
                            const idx = flatFilteredModels.findIndex((item) => item.id === m.id)
                            if (idx >= 0) setActiveIndex(idx)
                          }}
                          aria-pressed={isSelected}
                          style={
                            isSelected || isKeyboardActive
                              ? {
                                  background: isSelected
                                    ? 'var(--color-surface-elevated)'
                                    : 'var(--color-surface-hover)',
                                  boxShadow: isSelected ? 'var(--shadow-hairline)' : undefined,
                                }
                              : undefined
                          }
                        >
                          <span className="model-picker-option-name">{m.name}</span>
                          {m.family && (
                            <span
                              className="model-trigger-family"
                              style={{
                                color: 'var(--color-ink-muted)',
                                borderColor: 'var(--color-line-strong)',
                                background: 'var(--color-surface-low)',
                              }}
                            >
                              {m.family}
                            </span>
                          )}
                          {isSelected && (
                            <Check
                              size={15}
                              className="model-picker-check"
                              style={{ color: 'var(--color-brand)' }}
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            <div
              className="model-picker-footer"
              style={{
                borderTopColor: 'var(--color-line)',
                background: 'var(--color-surface-low)',
              }}
            >
              <button
                type="button"
                className="model-picker-footer-btn"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                id="model-picker-refresh"
              >
                <RefreshCw size={12} className={isRefreshing ? 'spin' : undefined} />
                {isRefreshing ? 'Syncing…' : 'Refresh catalog'}
              </button>
              <button
                type="button"
                className="model-picker-footer-btn"
                onClick={goToSettings}
              >
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
