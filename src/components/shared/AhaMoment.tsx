import { useState } from 'react'
import type { CSSProperties } from 'react'
import useAppStore from '../../stores/appStore'
import './AhaMoment.css'

interface Particle {
  id: number
  tx: number
  ty: number
  delay: number
}

type ParticleStyle = CSSProperties & {
  '--tx': string
  '--ty': string
}

export default function AhaMoment() {
  const active = useAppStore((s) => s.ahaMomentActive)
  if (!active) return null
  return <AhaMomentInner />
}

function AhaMomentInner() {
  const [particles] = useState<Particle[]>(() => {
    const arr: Particle[] = []
    const count = 24
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const distance = 150 + Math.random() * 150
      const tx = Math.cos(angle) * distance
      const ty = Math.sin(angle) * distance
      const delay = Math.random() * 0.1
      arr.push({ id: i, tx, ty, delay })
    }
    return arr
  })

  return (
    <div className="aha-moment-overlay">
      <div className="aha-shatter" />
      <div className="aha-glow" />
      {particles.map((p) => {
        const style: ParticleStyle = {
          '--tx': `${p.tx}px`,
          '--ty': `${p.ty}px`,
          animationDelay: `${p.delay}s`,
        }
        return <div key={p.id} className="aha-particle" style={style} />
      })}
    </div>
  )
}
