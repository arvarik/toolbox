/**
 * Canonical Kit the Box Turtle geometry from `scripts/brand/kit.ts` (`docs/brand/`).
 * Warm monochrome shell + Kit's signature amber eye, with living companion micro-states:
 * - `thinking`: gentle shell tuck / breath (`animate-kit-thinking`)
 * - `done` / `idle`: calm presence with subtle amber eye blink (`animate-kit-blink`)
 */
export interface KitLogoProps {
  size?: number
  variant?: 'auto' | 'dark' | 'light' | 'mono' | 'tile'
  state?: 'idle' | 'thinking' | 'done'
  className?: string
  ariaHidden?: boolean
}

export function KitLogo({
  size = 24,
  variant = 'auto',
  state = 'idle',
  className = '',
  ariaHidden = false,
}: KitLogoProps) {
  if (variant === 'tile') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role={ariaHidden ? undefined : 'img'}
        aria-label={ariaHidden ? undefined : 'Kit — Toolbox'}
        aria-hidden={ariaHidden || undefined}
        className={className}
      >
        <rect
          x="0"
          y="0"
          width="100"
          height="100"
          rx="22"
          fill="var(--color-surface-elevated)"
          stroke="var(--color-line-strong)"
          strokeWidth="3"
        />
        <g
          transform="translate(10 10) scale(0.8)"
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth="4.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={state === 'thinking' ? 'animate-kit-thinking' : undefined}
        >
          <path d="M 12 60 C 11 40 23 25 40 25 C 57 25 70 37 72 58" />
          <path d="M 70.8 50 C 73.5 46.5 75.5 42 78.5 39 C 81.5 35.8 87.5 35 90.8 38 C 94 41 94.5 45.5 92.5 48.5 C 90.5 51.5 86.5 53.2 82.5 53.2 C 79 53.2 76 56.5 73.5 58.5 C 62 65 22 66.5 8 57" />
          <path d="M 29.5 27.1 L 34 35 L 46 35 L 50.5 26.7 M 34 35 L 28 45 L 34 55 L 46 55 L 52 45 L 46 35" />
          <path d="M 28 45 L 13.9 45 M 52 45 L 69.2 45 M 34 55 L 31.5 63.4 M 46 55 L 48.5 63.6" />
          {state !== 'thinking' && (
            <>
              <path d="M 57 63 C 57 68 58 72 60.5 75.5 C 62.5 78.3 67 78.6 70 77.6 C 72.5 76.8 72 74 70 72.5 C 67.5 70.6 66 67 65.5 62.5" />
              <path d="M 23.5 63.5 C 23 68 21.5 72 18.5 75.5 C 16.5 78 12 78.6 9.5 77.4 C 7.2 76.3 7.8 74 9.8 72.5 C 12.5 70.5 14.2 66.5 14.8 61" />
            </>
          )}
          <circle
            cx="85.5"
            cy="43"
            r="3.4"
            fill="var(--color-brand)"
            stroke="none"
            className="animate-kit-blink"
          />
        </g>
      </svg>
    )
  }

  const stroke =
    variant === 'mono'
      ? 'currentColor'
      : variant === 'light'
        ? '#1e1c19'
        : variant === 'dark'
          ? '#ebe7e0'
          : 'var(--color-ink)'
  const eye = variant === 'mono' ? 'currentColor' : 'var(--color-brand)'
  const strokeWidth = size < 20 ? 6.0 : size < 36 ? 4.8 : 4.0

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={ariaHidden ? undefined : 'img'}
      aria-label={ariaHidden ? undefined : 'Kit'}
      aria-hidden={ariaHidden || undefined}
      className={className}
    >
      <g
        transform="translate(5 5) scale(0.9)"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={state === 'thinking' ? 'animate-kit-thinking' : undefined}
      >
        <path d="M 12 60 C 11 40 23 25 40 25 C 57 25 70 37 72 58" />
        <path d="M 70.8 50 C 73.5 46.5 75.5 42 78.5 39 C 81.5 35.8 87.5 35 90.8 38 C 94 41 94.5 45.5 92.5 48.5 C 90.5 51.5 86.5 53.2 82.5 53.2 C 79 53.2 76 56.5 73.5 58.5 C 62 65 22 66.5 8 57" />
        {size >= 20 && (
          <>
            <path d="M 29.5 27.1 L 34 35 L 46 35 L 50.5 26.7 M 34 35 L 28 45 L 34 55 L 46 55 L 52 45 L 46 35" />
            <path d="M 28 45 L 13.9 45 M 52 45 L 69.2 45 M 34 55 L 31.5 63.4 M 46 55 L 48.5 63.6" />
          </>
        )}
        {state !== 'thinking' && (
          <>
            <path d="M 57 63 C 57 68 58 72 60.5 75.5 C 62.5 78.3 67 78.6 70 77.6 C 72.5 76.8 72 74 70 72.5 C 67.5 70.6 66 67 65.5 62.5" />
            <path d="M 23.5 63.5 C 23 68 21.5 72 18.5 75.5 C 16.5 78 12 78.6 9.5 77.4 C 7.2 76.3 7.8 74 9.8 72.5 C 12.5 70.5 14.2 66.5 14.8 61" />
          </>
        )}
        {size >= 16 && (
          <circle
            cx="85.5"
            cy="43"
            r="3.6"
            fill={eye}
            stroke="none"
            className={state !== 'thinking' ? 'animate-kit-blink' : undefined}
          />
        )}
      </g>
    </svg>
  )
}

/**
 * Compact avatar badge for Kit inside chat messages, thinking indicators, and completion moments.
 */
export function KitAvatar({
  state = 'idle',
  size = 24,
  className = '',
}: {
  state?: 'idle' | 'thinking' | 'done'
  size?: number
  className?: string
}) {
  return (
    <span
      title={state === 'thinking' ? 'Kit is thinking...' : 'Kit'}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] shadow-[var(--shadow-hairline)] ${className}`}
      style={{ width: size + 8, height: size + 8 }}
    >
      <KitLogo size={size} state={state} />
    </span>
  )
}
