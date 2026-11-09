import { useMemo, useState } from 'react'
import { Layout, X, ChevronRight } from 'lucide-react'
import { ARCHITECTURE_TEMPLATES } from '../../utils/templates'
import { useActiveKit } from '../../stores/useKitStore'

const CONCEPT_STARTER_TEMPLATES = [
  {
    id: 'concept-causal-chain',
    name: 'Causal Mechanism & Evidence Map',
    category: 'Concept Maps',
    description: 'Links a core concept to its underlying mechanism, theorem, concrete example, and boundary edge case.',
    nodes: [
      { id: 'c-core', name: 'Core Concept', icon: 'brain', category: 'Foundations', x: 260, y: 60 },
      { id: 'c-mech', name: 'Mechanism / Process', icon: 'cog', category: 'Mechanisms', x: 110, y: 190 },
      { id: 'c-principle', name: 'Theorem / Principle', icon: 'scale', category: 'Foundations', x: 410, y: 190 },
      { id: 'c-example', name: 'Concrete Example', icon: 'file-text', category: 'Evidence', x: 110, y: 320 },
      { id: 'c-counter', name: 'Counterexample / Edge Case', icon: 'alert-triangle', category: 'Evidence', x: 410, y: 320 },
    ],
    edges: [
      { id: 'ce-1', from: 'c-core', to: 'c-mech', label: 'operates via' },
      { id: 'ce-2', from: 'c-core', to: 'c-principle', label: 'governed by' },
      { id: 'ce-3', from: 'c-mech', to: 'c-example', label: 'example of' },
      { id: 'ce-4', from: 'c-principle', to: 'c-counter', label: 'contrasts with' },
    ],
  },
  {
    id: 'concept-hypothesis-inquiry',
    name: 'Hypothesis & Falsification Triad',
    category: 'Inquiry',
    description: 'Structures a central question/hypothesis against supporting drivers and falsifying counterexamples.',
    nodes: [
      { id: 'h-q', name: 'Question / Hypothesis', icon: 'help-circle', category: 'Inquiry', x: 250, y: 60 },
      { id: 'h-driver', name: 'Causal Driver / Force', icon: 'zap', category: 'Mechanisms', x: 100, y: 210 },
      { id: 'h-edge', name: 'Counterexample / Edge Case', icon: 'alert-triangle', category: 'Evidence', x: 400, y: 210 },
    ],
    edges: [
      { id: 'he-1', from: 'h-driver', to: 'h-q', label: 'causes' },
      { id: 'he-2', from: 'h-edge', to: 'h-q', label: 'contrasts with' },
    ],
  },
]

function parseKitTemplate(t, fallbackCategory) {
  let nodes = Array.isArray(t.nodes) ? t.nodes : []
  let edges = Array.isArray(t.edges) ? t.edges : []
  if (!nodes.length && typeof t.nodesJson === 'string') {
    try {
      const parsed = JSON.parse(t.nodesJson)
      if (Array.isArray(parsed)) nodes = parsed
    } catch {
      nodes = []
    }
  }
  if (!edges.length && typeof t.edgesJson === 'string') {
    try {
      const parsed = JSON.parse(t.edgesJson)
      if (Array.isArray(parsed)) edges = parsed
    } catch {
      edges = []
    }
  }
  return {
    id: t.id,
    name: t.name,
    category: t.category || fallbackCategory,
    description: t.description || '',
    nodes,
    edges,
  }
}

/**
 * Template Gallery — shows Kit-configured and pre-built canvas templates
 * users can load onto the builder or concept canvas with one click.
 */
export default function TemplateGallery({ onSelect, onClose }) {
  const { skeleton, capabilities } = useActiveKit()
  const isConceptMode = capabilities?.canvas === 'concept'
  const [selectedCategory, setSelectedCategory] = useState('All')

  const templates = useMemo(() => {
    const rawKitTemplates = skeleton?.canvasConfig?.templates || []
    const kitTemplates = rawKitTemplates.map((t) =>
      parseKitTemplate(t, isConceptMode ? 'Kit Templates' : 'Kit Architectures')
    )
    const defaults = isConceptMode ? CONCEPT_STARTER_TEMPLATES : ARCHITECTURE_TEMPLATES
    const seen = new Set(kitTemplates.map((t) => t.id))
    return [...kitTemplates, ...defaults.filter((d) => !seen.has(d.id))]
  }, [skeleton, isConceptMode])

  const categories = ['All', ...new Set(templates.map((t) => t.category))]
  const filtered =
    selectedCategory === 'All'
      ? templates
      : templates.filter((t) => t.category === selectedCategory)

  return (
    <div className="template-gallery" id="template-gallery">
      <div className="template-gallery-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Layout size={16} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Templates</span>
        </div>
        <button
          className="btn btn-ghost btn-icon"
          onClick={onClose}
          aria-label="Close templates"
          style={{ width: 28, height: 28 }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Category tabs */}
      <div className="template-category-tabs">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`template-category-tab${selectedCategory === cat ? ' active' : ''}`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Template cards */}
      <div className="template-list">
        {filtered.map((template) => (
          <button
            key={template.id}
            className="template-card"
            onClick={() => onSelect(template)}
          >
            <div className="template-card-header">
              <span className="template-card-name">{template.name}</span>
              <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
            <p className="template-card-desc">{template.description}</p>
            <div className="template-card-meta">
              <span>{template.nodes.length} nodes</span>
              <span>{template.edges.length} connections</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
