import {
  Database, Zap, Globe, Monitor, Smartphone, Shield,
  AlertTriangle, FileText, BarChart, Radio, Activity, HardDrive,
  Archive, Search, Brain, Cpu, ExternalLink, Mail, Box, Cog,
  Split, DoorOpen,
} from 'lucide-react'
import { BUILDER_COMPONENTS } from '../../utils/constants'

/**
 * Icon mapper for builder toolbox items.
 */
const iconMap = {
  split: Split,
  'door-open': DoorOpen,
  box: Box,
  zap: Zap,
  cog: Cog,
  mail: Mail,
  radio: Radio,
  activity: Activity,
  database: Database,
  'hard-drive': HardDrive,
  archive: Archive,
  search: Search,
  brain: Brain,
  globe: Globe,
  monitor: Monitor,
  smartphone: Smartphone,
  cpu: Cpu,
  'external-link': ExternalLink,
  shield: Shield,
  'alert-triangle': AlertTriangle,
  'file-text': FileText,
  'bar-chart': BarChart,
}

/**
 * Builder component toolbox — categorized palette of draggable system components.
 */
export default function Toolbox() {
  const handleDragStart = (e, item, category) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ ...item, category }))
    e.dataTransfer.effectAllowed = 'copy'
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
        Components
      </div>

      {BUILDER_COMPONENTS.map((group) => (
        <div className="toolbox-section" key={group.category}>
          <div className="toolbox-section-title">{group.category}</div>
          {group.items.map((item) => {
            const Icon = iconMap[item.icon] || Box
            return (
              <div
                key={item.id}
                className="toolbox-item"
                draggable
                onDragStart={(e) => handleDragStart(e, item, group.category)}
                id={`toolbox-${item.id}`}
              >
                <div
                  className="toolbox-item-icon"
                  style={{ background: `${group.color}15`, color: group.color }}
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
