import { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import useAppStore from '../../stores/appStore'

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}

function Toast({ toast, onDismiss }) {
  const Icon = icons[toast.type] || Info

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div className={`toast toast-${toast.type}`}>
      <Icon className="toast-icon" size={18} />
      <span style={{ flex: 1 }}>{toast.message}</span>
      {toast.action && (
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginRight: 8, padding: '2px 8px', minHeight: 'unset', height: 24, fontSize: '0.8rem' }}
          onClick={() => {
            toast.action.onClick()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        style={{ width: 24, height: 24 }}
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
    <div className="toast-container">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  )
}
