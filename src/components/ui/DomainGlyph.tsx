export type DomainGlyphKind =
  | 'distributed'
  | 'gpu'
  | 'bio'
  | 'rust'
  | 'formal'
  | 'notebook'
  | 'flagship'
  | 'challenge'
  | 'fire-wave'
  | 'remediation'

/**
 * Maps arbitrary Kit slugs, names, or legacy icon strings to a bespoke
 * 1.5px monochrome vector glyph so zero emojis appear in Kit chrome.
 */
export function resolveKitGlyph(hint?: string | null): DomainGlyphKind {
  const s = (hint ?? '').toLowerCase()
  if (s.includes('system') || s.includes('distrib') || s.includes('cloud') || s.includes('🏗️') || s.includes('🌐')) {
    return 'distributed'
  }
  if (s.includes('gpu') || s.includes('cuda') || s.includes('ml') || s.includes('hardware') || s.includes('⚡')) {
    return 'gpu'
  }
  if (s.includes('bio') || s.includes('chem') || s.includes('med') || s.includes('🧬')) {
    return 'bio'
  }
  if (s.includes('rust') || s.includes('compil') || s.includes('kernel') || s.includes('🦀')) {
    return 'rust'
  }
  if (
    s.includes('math') ||
    s.includes('geom') ||
    s.includes('formal') ||
    s.includes('proof') ||
    s.includes('logic') ||
    s.includes('📐')
  ) {
    return 'formal'
  }
  return 'notebook'
}

export function DomainGlyph({
  kind,
  size = 16,
  className = '',
}: {
  kind: DomainGlyphKind
  size?: number
  className?: string
}) {
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.45,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: `shrink-0 ${className}`,
    'aria-hidden': true,
  }

  switch (kind) {
    case 'distributed':
      return (
        <svg {...shared}>
          <circle cx="8" cy="8" r="5.5" strokeOpacity="0.4" />
          <circle cx="8" cy="2.5" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="12.8" cy="10.8" r="1.35" fill="currentColor" stroke="none" />
          <circle cx="3.2" cy="10.8" r="1.35" fill="currentColor" stroke="none" />
          <path d="M8 3.9v3.4M8 7.3l3.6 2.7M8 7.3L4.4 10" />
        </svg>
      )
    case 'gpu':
      return (
        <svg {...shared}>
          <rect x="3" y="3" width="10" height="10" rx="2" />
          <path d="M6.3 3v10M9.7 3v10M3 6.3h10M3 9.7h10" strokeOpacity="0.5" />
          <path d="M1.4 5.5H3M1.4 10.5H3M13 5.5h1.6M13 10.5h1.6" />
        </svg>
      )
    case 'bio':
      return (
        <svg {...shared}>
          <path d="M4.2 2.2c0 3.2 7.6 3.2 7.6 6.4s-7.6 3.2-7.6 5.2" />
          <path d="M11.8 2.2c0 3.2-7.6 3.2-7.6 6.4s7.6 3.2 7.6 5.2" strokeOpacity="0.55" />
          <path d="M5.5 4.2h5M5.5 11.8h5" />
        </svg>
      )
    case 'rust':
      return (
        <svg {...shared}>
          <polygon points="8,1.8 13.4,4.9 13.4,11.1 8,14.2 2.6,11.1 2.6,4.9" />
          <circle cx="8" cy="8" r="2.1" />
        </svg>
      )
    case 'formal':
      return (
        <svg {...shared}>
          <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.2" strokeOpacity="0.45" />
          <path d="M5.4 5v6M5.4 8h4.8M8.8 6.2L10.6 8l-1.8 1.8" />
        </svg>
      )
    case 'notebook':
      return (
        <svg {...shared}>
          <path d="M3.5 2.2h6.8l2.2 2.2v9.4H3.5z" />
          <path d="M10.3 2.2v2.4h2.2" strokeOpacity="0.6" />
          <path d="M5.6 7.5h4.8M5.6 10.2h3.4" strokeOpacity="0.55" />
        </svg>
      )
    case 'flagship':
      return (
        <svg {...shared}>
          <path d="M8 1.8L9.6 6.4L14.2 8L9.6 9.6L8 14.2L6.4 9.6L1.8 8L6.4 6.4Z" />
        </svg>
      )
    case 'challenge':
      return (
        <svg {...shared}>
          <path d="M9.2 1.8L3.8 8.6h4.1l-1.1 5.6 5.4-6.8H8.1L9.2 1.8Z" />
        </svg>
      )
    case 'fire-wave':
      return (
        <svg {...shared}>
          <circle cx="3.2" cy="12.5" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="12.8" cy="3.5" r="1.5" />
          <path d="M4.4 11.4l2.4-2.3M9.2 6.9l2.4-2.3" />
        </svg>
      )
    case 'remediation':
      return (
        <svg {...shared}>
          <circle cx="12.2" cy="3.8" r="1.6" strokeOpacity="0.5" />
          <circle cx="4.2" cy="12.2" r="1.8" />
          <path d="M10.9 5.1L5.8 10.2M5.6 7.4v3h3" />
        </svg>
      )
  }
}
