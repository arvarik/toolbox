import { useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { Box, Plus } from 'lucide-react'
import { BUILDER_COMPONENTS } from '../../utils/constants'
import useAppStore from '../../stores/appStore'
import { useActiveKit } from '../../stores/useKitStore'
import {
  BUILDER_ICONS,
  DEFAULT_CONCEPT_COMPONENTS,
  categoryColor,
  readStoreNodes,
  writeStoreGraph,
  type BuilderFlowNode,
  type PaletteGroup,
  type PaletteItem,
} from './boardModel'

/**
 * Builder / Concept Map component toolbox — categorized palette of draggable primitives
 * driven by activeKit.skeleton.canvasConfig.components or domain-appropriate defaults.
 */
export default function Toolbox() {
  const { skeleton, capabilities } = useActiveKit()
  const isConceptMode = capabilities?.canvas === 'concept'
  const [customConceptName, setCustomConceptName] = useState('')

  const paletteGroups = useMemo<PaletteGroup[]>(() => {
    const configured = skeleton?.canvasConfig?.components
    if (Array.isArray(configured) && configured.length > 0) {
      const byCategory = new Map<string, PaletteGroup>()
      for (const comp of configured) {
        const cat = comp.category || (isConceptMode ? 'Concepts' : 'Components')
        let group = byCategory.get(cat)
        if (!group) {
          group = {
            category: cat,
            color: comp.color || categoryColor(cat),
            items: [],
          }
          byCategory.set(cat, group)
        }
        const legacyId =
          'id' in comp && typeof comp.id === 'string' ? comp.id : undefined
        group.items.push({
          id: comp.type || legacyId || comp.name.toLowerCase().replace(/\s+/g, '-'),
          name: comp.name,
          icon: comp.icon || 'box',
          ...(comp.color ? { color: comp.color } : {}),
        })
      }
      return Array.from(byCategory.values())
    }

    return isConceptMode ? DEFAULT_CONCEPT_COMPONENTS : (BUILDER_COMPONENTS as PaletteGroup[])
  }, [skeleton, isConceptMode])

  const handleDragStart = (
    e: DragEvent<HTMLDivElement>,
    item: PaletteItem,
    category: string,
    groupColor: string
  ) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        ...item,
        category,
        ...(item.color || groupColor ? { color: item.color || groupColor } : {}),
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleQuickAddConcept = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = customConceptName.trim()
    if (!trimmed) return
    const existing = readStoreNodes(useAppStore.getState())
    const count = existing.length
    const node: BuilderFlowNode = {
      id: `concept-${Date.now()}`,
      type: 'component',
      position: {
        x: 120 + (count % 4) * 180,
        y: 100 + Math.floor(count / 4) * 110,
      },
      data: {
        name: trimmed,
        icon: 'brain',
        category: 'Foundations',
        color: '#818cf8',
      },
    }
    writeStoreGraph({ nodes: [...existing, node] })
    setCustomConceptName('')
  }

  return (
    <div className="builder-toolbox" id="builder-toolbox">
      <div
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
          color: 'var(--color-text-tertiary)',
          padding: '0 var(--space-1) var(--space-4)',
        }}
      >
        {isConceptMode ? 'Concept Primitives' : 'Components'}
      </div>

      {isConceptMode && (
        <form
          onSubmit={handleQuickAddConcept}
          style={{
            display: 'flex',
            gap: '6px',
            marginBottom: 'var(--space-4)',
          }}
        >
          <input
            type="text"
            value={customConceptName}
            onChange={(e) => setCustomConceptName(e.target.value)}
            placeholder="Add custom concept…"
            aria-label="Custom concept name"
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 'var(--text-xs)',
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
            }}
          />
          <button
            type="submit"
            className="btn btn-secondary btn-sm"
            aria-label="Add concept node"
            title="Add concept node to map"
            style={{ padding: '0 8px' }}
          >
            <Plus size={14} />
          </button>
        </form>
      )}

      {paletteGroups.map((group) => (
        <div className="toolbox-section" key={group.category}>
          <div className="toolbox-section-title">{group.category}</div>
          {group.items.map((item) => {
            const Icon = BUILDER_ICONS[item.icon] || Box
            const itemColor = item.color || group.color
            return (
              <div
                key={item.id}
                className="toolbox-item"
                draggable
                onDragStart={(e) => handleDragStart(e, item, group.category, group.color)}
                id={`toolbox-${item.id}`}
              >
                <div
                  className="toolbox-item-icon"
                  style={{ background: `${itemColor}15`, color: itemColor }}
                >
                  <Icon size={14} />
                </div>
                <span>{item.name}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
