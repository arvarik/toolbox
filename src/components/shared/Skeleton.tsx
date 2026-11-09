import type { CSSProperties } from 'react'

export type SkeletonVariant = 'rectangular' | 'circular' | 'text'

export interface SkeletonProps {
  className?: string
  style?: CSSProperties
  variant?: SkeletonVariant
}

export default function Skeleton({
  className = '',
  style = {},
  variant = 'rectangular',
}: SkeletonProps) {
  return <div className={`skeleton skeleton-${variant} ${className}`.trim()} style={style} />
}
