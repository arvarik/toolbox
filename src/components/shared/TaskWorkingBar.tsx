import { GitCommit, Maximize2 } from 'lucide-react'
import useCommitStore from '../../stores/useCommitStore'
import { KitLogo } from '../ui'

export default function TaskWorkingBar() {
  const { isMinimized, phase, topicContext, setMinimized } = useCommitStore()

  if (!isMinimized) return null

  if (phase === 'idle' || phase === 'error' || phase === 'done') {
    return null
  }

  const isWorking = phase === 'analyzing' || phase === 'saving'
  const statusLabel =
    phase === 'analyzing'
      ? 'Analyzing notes…'
      : phase === 'saving'
        ? 'Saving updates…'
        : 'Review updates'

  return (
    <button
      type="button"
      onClick={() => setMinimized(false)}
      aria-label={`${statusLabel} — ${topicContext?.topicName || 'Study session'}`}
      className="task-working-bar animate-popover-enter fixed right-6 bottom-6 z-[900] flex max-w-[calc(100vw-32px)] cursor-pointer items-center gap-3 rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-3.5 py-2 text-left text-[var(--color-ink)] shadow-[var(--shadow-float)] transition-[transform,background-color] duration-150 hover:bg-[var(--color-surface-hover)] active:scale-[0.98] max-md:right-1/2 max-md:bottom-4 max-md:w-max max-md:translate-x-1/2"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] shadow-[var(--shadow-hairline)]">
        {isWorking ? (
          <KitLogo size={16} state="thinking" ariaHidden />
        ) : (
          <GitCommit size={14} className="text-[var(--color-brand)]" />
        )}
      </span>

      <span className="flex min-w-0 flex-col pr-1 leading-tight">
        <span className="truncate text-[12px] font-semibold text-[var(--color-ink)]">
          {statusLabel}
        </span>
        <span className="truncate text-[10.5px] text-[var(--color-ink-muted)]">
          {topicContext?.topicName || 'Study session'}
        </span>
      </span>

      <span className="flex items-center justify-center border-l border-[var(--color-line)] pl-2.5 text-[var(--color-ink-faint)]">
        <Maximize2 size={13} />
      </span>
    </button>
  )
}
