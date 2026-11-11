import { useEffect, useMemo } from 'react'
import { CheckCircle, AlertCircle, Info } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import type { ToastType } from '../../stores/appStore'
import { ToastStack, type ToastMessage } from '../ui/Controls'

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

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) => setTimeout(() => removeToast(t.id), 4000))
    return () => timers.forEach(clearTimeout)
  }, [toasts, removeToast])

  const stackItems = useMemo<ToastMessage[]>(
    () =>
      toasts.map((t) => {
        const type: ToastType = t.type ?? 'info'
        const Icon = icons[type]
        return {
          id: t.id,
          title: t.message,
          icon: <Icon size={15} style={{ color: iconColorByType[type] }} />,
          action: t.action,
        }
      }),
    [toasts],
  )

  return <ToastStack toasts={stackItems} onDismiss={removeToast} />
}
