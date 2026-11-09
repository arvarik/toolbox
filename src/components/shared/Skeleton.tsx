import type { CSSProperties } from 'react'

export type SkeletonVariant = 'rectangular' | 'circular' | 'text'

export interface SkeletonProps {
  style?: CSSProperties
  variant?: SkeletonVariant
}

export default function Skeleton({ style = {}, variant = 'rectangular' }: SkeletonProps) {
  return <div className={`skeleton skeleton-${variant}`} style={style} />
}
