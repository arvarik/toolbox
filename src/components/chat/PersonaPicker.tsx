import { useMemo, type ReactNode } from 'react'
import { Lightbulb, Sparkles, ShieldAlert, Scale } from 'lucide-react'
import type { PersonaDef, PersonaId } from './personas'
import { SelectPopover } from '../ui'

interface PersonaPickerProps {
  personas: Record<PersonaId, PersonaDef>
  activeId: PersonaId
  onSelect: (id: PersonaId) => void
}

const PERSONA_ICONS: Record<PersonaId, ReactNode> = {
  socratic: <Lightbulb size={13} className="text-[var(--color-ink-muted)]" />,
  eli5: <Sparkles size={13} className="text-[var(--color-ink-muted)]" />,
  gordon: <ShieldAlert size={13} className="text-[var(--color-ink-muted)]" />,
  devil: <Scale size={13} className="text-[var(--color-ink-muted)]" />,
}

/**
 * PersonaPicker Dropdown — switches between the 4 tutoring styles using SelectPopover.
 */
export default function PersonaPicker({ personas, activeId, onSelect }: PersonaPickerProps) {
  const options = useMemo(
    () =>
      Object.values(personas).map((p) => ({
        value: p.id,
        label: p.name,
        icon: PERSONA_ICONS[p.id],
      })),
    [personas],
  )

  return (
    <SelectPopover
      size="xs"
      align="right"
      ariaLabel="Change AI Persona"
      value={activeId in personas ? activeId : 'socratic'}
      onChange={onSelect}
      options={options}
      menuWidthClass="w-52"
    />
  )
}
