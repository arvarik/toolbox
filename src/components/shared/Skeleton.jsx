

export default function Skeleton({ className = '', style = {}, variant = 'rectangular' }) {
  // variants: 'rectangular', 'circular', 'text'
  return (
    <div 
      className={`skeleton skeleton-${variant} ${className}`}
      style={style}
    />
  )
}
