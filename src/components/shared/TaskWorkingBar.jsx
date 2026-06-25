import { Loader2, GitCommit, Maximize2 } from 'lucide-react'
import useCommitStore from '../../stores/useCommitStore'

export default function TaskWorkingBar() {
  const { isMinimized, phase, topicContext, setMinimized } = useCommitStore()

  if (!isMinimized) return null
  
  // Don't show if there's no active background process or we are totally done/idle
  if (phase === 'idle' || phase === 'error' || phase === 'done') {
    return null
  }

  return (
    <div
      onClick={() => setMinimized(false)}
      style={{
        position: 'fixed',
        bottom: 'var(--space-6)',
        right: 'var(--space-6)',
        zIndex: 900,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-full)',
        padding: 'var(--space-2) var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        animation: 'slideUpFade 0.3s ease',
        maxWidth: 'calc(100vw - 32px)', // Mobile safe
      }}
      className="task-working-bar"
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: '50%',
        background: 'var(--color-accent-subtle)'
      }}>
        {phase === 'analyzing' || phase === 'saving' ? (
          <Loader2 size={14} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />
        ) : (
          <GitCommit size={14} style={{ color: 'var(--color-accent)' }} />
        )}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, paddingRight: 'var(--space-2)' }}>
        <span style={{ 
          fontSize: 'var(--text-xs)', 
          fontWeight: 600, 
          color: 'var(--color-text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {phase === 'analyzing' ? 'Analyzing Session...' : phase === 'saving' ? 'Saving Commits...' : 'Review Commits'}
        </span>
        <span style={{ 
          fontSize: '10px', 
          color: 'var(--color-text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {topicContext?.topicName || 'Unknown Topic'}
        </span>
      </div>

      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        paddingLeft: 'var(--space-2)', 
        borderLeft: '1px solid var(--color-border)' 
      }}>
        <Maximize2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
      </div>

      <style>{`
        @keyframes slideUpFade {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        /* Mobile overrides */
        @media (max-width: 768px) {
          .task-working-bar {
            right: 50% !important;
            transform: translateX(50%);
            bottom: var(--space-4) !important;
            width: max-content;
          }
          
          /* Keep the animation working properly with the transform override */
          @keyframes slideUpFadeMobile {
            from { opacity: 0; transform: translate(50%, 20px); }
            to { opacity: 1; transform: translate(50%, 0); }
          }
          
          .task-working-bar {
            animation: slideUpFadeMobile 0.3s ease !important;
          }
        }
      `}</style>
    </div>
  )
}
