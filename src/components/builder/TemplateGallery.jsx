import { useState } from 'react'
import { Layout, X, ChevronRight } from 'lucide-react'
import { ARCHITECTURE_TEMPLATES } from '../../utils/templates'

/**
 * Template Gallery — shows pre-built architecture templates users can
 * load onto the builder canvas with one click.
 */
export default function TemplateGallery({ onSelect, onClose }) {
  const [selectedCategory, setSelectedCategory] = useState('All')

  const categories = ['All', ...new Set(ARCHITECTURE_TEMPLATES.map((t) => t.category))]
  const filtered =
    selectedCategory === 'All'
      ? ARCHITECTURE_TEMPLATES
      : ARCHITECTURE_TEMPLATES.filter((t) => t.category === selectedCategory)

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
