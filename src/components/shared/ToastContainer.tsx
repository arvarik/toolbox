import { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import type { ToastItem, ToastType } from '../../stores/appStore'

const icons: Record<ToastType, LucideIcon> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertCircle,
  info: Info,
}

const iconColorByType: Record<ToastType, string> = {
  success: 'var(--color-ok)',
  error: 'var(--color-err)',
  warning: 'var(--color-brand)',
  info: 'var(--color-ink-muted)',
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const type: ToastType = toast.type ?? 'info'
  const Icon = icons[type]

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div
      className={`toast toast-${type} animate-popover-enter pointer-events-auto flex max-w-sm min-w-[280px] items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]`}
      style={{
        background: 'var(--color-surface-elevated)',
        borderColor: 'var(--color-line-strong)',
        color: 'var(--color-ink)',
        boxShadow: 'var(--shadow-float)',
      }}
    >
      <Icon
        className="toast-icon shrink-0"
        size={16}
        style={{ color: iconColorByType[type] }}
      />
      <span className="min-w-0 flex-1 leading-snug text-[var(--color-ink)]">
        {toast.message}
      </span>
      {toast.action && (
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-ink)] transition-[transform,background-color] duration-120 hover:bg-[var(--color-surface-hover)] active:scale-[0.97]"
          onClick={() => {
            toast.action?.onClick()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="toast-container pointer-events-none fixed right-5 bottom-5 z-[600] flex flex-col gap-2 max-sm:right-3 max-sm:bottom-3 max-sm:left-3"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  )
}
