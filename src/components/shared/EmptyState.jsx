/**
 * Generic empty state placeholder.
 * @param {React.ReactNode} icon - Icon component
 * @param {string} title - Heading text
 * @param {string} description - Body text
 * @param {React.ReactNode} action - Optional action button
 */
export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {action}
    </div>
  )
}
