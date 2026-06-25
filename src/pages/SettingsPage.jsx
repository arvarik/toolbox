import { useState, useEffect } from 'react'
import { Eye, EyeOff, Download, Upload, Trash2, Sun, Moon } from 'lucide-react'
import useAppStore from '../stores/appStore'
import { configApi, systemApi, profileApi, guideContentApi } from '../utils/api'
import Modal from '../components/shared/Modal'

const AVAILABLE_MODELS = [
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Fast and efficient — best for most tasks' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Previous generation, still capable' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable, slower responses' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Legacy model' },
]

export default function SettingsPage() {
  const { apiKeyConfigured, setApiKeyConfigured, addToast, theme, toggleTheme, model, setModel } = useAppStore()
  const [apiKey, setApiKey] = useState('')
  const isMac = typeof window !== 'undefined' && navigator.userAgent.includes('Mac')
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [keyStatus, setKeyStatus] = useState(apiKeyConfigured ? 'connected' : 'disconnected')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [systemStats, setSystemStats] = useState(null)
  const [profileText, setProfileText] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Check initial API key status on mount
  useEffect(() => {
    configApi.get().then((config) => {
      if (config.api_key_configured) {
        setApiKeyConfigured(true)
        setKeyStatus('connected')
      }
    }).catch(() => {})

    systemApi.stats().then(setSystemStats).catch(console.error)
    profileApi.get().then(res => setProfileText(res.profileText || '')).catch(console.error)
  }, [setApiKeyConfigured])

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return

    setIsTesting(true)
    try {
      const result = await configApi.testApiKey(apiKey.trim())
      if (result.valid) {
        setApiKeyConfigured(true)
        setKeyStatus('connected')
        setApiKey('')
        addToast({ type: 'success', message: 'API key saved and verified' })
      } else {
        setKeyStatus('disconnected')
        addToast({ type: 'error', message: 'Invalid API key' })
      }
    } catch (err) {
      setKeyStatus('disconnected')
      addToast({ type: 'error', message: err.message || 'Failed to verify API key' })
    } finally {
      setIsTesting(false)
    }
  }

  const handleClearKey = async () => {
    try {
      await configApi.update({ gemini_api_key: '' })
      setApiKey('')
      setApiKeyConfigured(false)
      setKeyStatus('disconnected')
      addToast({ type: 'info', message: 'API key removed' })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to remove API key' })
    }
  }

  const handleClearCache = async () => {
    try {
      await systemApi.clearCache()
      addToast({ type: 'success', message: 'AI starter cache cleared successfully' })
      systemApi.stats().then(setSystemStats).catch(console.error)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to clear cache' })
    }
  }

  const handleSaveProfile = async () => {
    setIsSavingProfile(true)
    try {
      await profileApi.update(profileText)
      addToast({ type: 'success', message: 'Shadow memory updated' })
      systemApi.stats().then(setSystemStats).catch(console.error)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to update shadow memory' })
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleExportGuide = () => {
    window.open(guideContentApi.exportUrl(), '_blank')
  }

  return (
    <div className="page-wrapper" id="settings-page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">
          Configure your Toolbox instance, manage your API key, and customize your experience.
        </p>
      </div>

      <div className="settings-content">
        {/* API Key Section */}
        <div className="settings-section">
          <h2 className="settings-section-title">Gemini API Key</h2>
          <p className="settings-section-desc">
            Required for AI-powered features: Guide chat, architecture verification, and flashcard generation.
          </p>

          <div className="settings-field">
            <label className="settings-label" htmlFor="api-key-input">API Key</label>
            <div className="api-key-input-wrapper">
              <input
                id="api-key-input"
                className="input"
                type={showKey ? 'text' : 'password'}
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveKey}
                disabled={!apiKey.trim() || isTesting}
              >
                {isTesting ? 'Verifying...' : 'Save & Verify'}
              </button>
            </div>
            <div className={`api-key-status ${keyStatus}`}>
              <span className="api-key-status-dot" />
              {keyStatus === 'connected'
                ? 'Connected — AI features are enabled'
                : 'Not configured — AI features are disabled'}
            </div>
            <p className="settings-help">
              Get your API key from{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
              >
                Google AI Studio
              </a>
              . Your key is stored locally on this server and never shared.
            </p>
          </div>

          {apiKeyConfigured && (
            <div style={{ marginTop: 'var(--space-6)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-error)', marginBottom: 'var(--space-1)' }}>Danger Zone</h3>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
                Permanently remove your saved credentials.
              </p>
              <button
                className="btn btn-ghost"
                onClick={() => setShowConfirmModal(true)}
                style={{ color: 'var(--color-error)' }}
              >
                <Trash2 size={14} />
                Remove API Key
              </button>
            </div>
          )}
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* AI Shadow Memory */}
        <div className="settings-section">
          <h2 className="settings-section-title">AI Shadow Memory</h2>
          <p className="settings-section-desc">
            The AI learns facts about you over time (e.g., "Interviewing at Google in 2 weeks") to tailor its explanations. You can view or manually edit its memory here.
          </p>

          <textarea
            className="input settings-textarea"
            rows={5}
            value={profileText}
            onChange={(e) => setProfileText(e.target.value)}
            placeholder="No profile data learned yet. You can manually type facts about yourself here..."
          />
          <div className="settings-action-bar">
            <button
              className="btn btn-primary"
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
            >
              {isSavingProfile ? 'Saving...' : 'Save Memory'}
            </button>
          </div>
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* Model Selection */}
        <div className="settings-section">
          <h2 className="settings-section-title">AI Model</h2>
          <p className="settings-section-desc">
            Choose which Gemini model to use for AI chat and content generation.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            {AVAILABLE_MODELS.map((m) => (
              <label
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${model === m.id ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: model === m.id ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                  cursor: 'pointer',
                  transition: 'all var(--duration-fast)',
                }}
              >
                <input
                  type="radio"
                  name="model"
                  value={m.id}
                  checked={model === m.id}
                  onChange={() => {
                    setModel(m.id)
                    addToast({ type: 'info', message: `Model switched to ${m.name}` })
                  }}
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{m.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{m.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* Appearance */}
        <div className="settings-section">
          <h2 className="settings-section-title">Appearance</h2>
          <p className="settings-section-desc">
            Toggle between dark and light themes.
          </p>

          <button
            className="btn btn-secondary"
            onClick={toggleTheme}
            id="settings-theme-toggle"
            style={{ marginTop: 'var(--space-3)' }}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          </button>
          <p className="settings-help" style={{ marginTop: 'var(--space-2)' }}>
            You can also toggle with <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'var(--color-bg-hover)', padding: '1px 4px', borderRadius: '3px', border: '1px solid var(--color-border)' }}>{isMac ? '⌘' : 'Ctrl+'}D</kbd>
          </p>
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* System Diagnostics */}
        <div className="settings-section">
          <h2 className="settings-section-title">System Diagnostics</h2>
          <p className="settings-section-desc">
            View database statistics and clear caches.
          </p>

          {systemStats && (
            <div className="settings-stats-grid">
              <div className="stat-card">
                <div className="stat-card-label">Guide Sections</div>
                <div className="stat-card-value">{systemStats.guideCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Flashcards</div>
                <div className="stat-card-value">{systemStats.flashcardsCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Whiteboards</div>
                <div className="stat-card-value">{systemStats.boardsCount}</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Cached AI Starters</div>
                <div className="stat-card-value">{systemStats.cachedStartersCount}</div>
              </div>
            </div>
          )}

          <button
            className="btn btn-secondary"
            onClick={handleClearCache}
          >
            Clear AI Starter Caches
          </button>
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* Data Management */}
        <div className="settings-section">
          <h2 className="settings-section-title">Data Management</h2>
          <p className="settings-section-desc">
            Export or import your flashcard decks and whiteboard designs.
          </p>

          <div className="data-management-buttons" style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button className="btn btn-secondary" onClick={handleExportGuide}>
              <Download size={14} />
              Export Guide (.md)
            </button>
            <button className="btn btn-secondary" id="export-data-btn" onClick={() => window.open(systemApi.exportDbUrl(), '_blank')}>
              <Download size={14} />
              Export All Data
            </button>
            <button className="btn btn-secondary" id="import-data-btn">
              <Upload size={14} />
              Import Data
            </button>
          </div>
          <p className="settings-help" style={{ marginTop: 'var(--space-3)' }}>
            Guide notes are exported as a unified Markdown document. All data is exported as JSON.
          </p>
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* Keyboard Shortcuts */}
        <div className="settings-section">
          <h2 className="settings-section-title">Keyboard Shortcuts</h2>
          <p className="settings-section-desc">
            Boost your workflow with these shortcuts.
          </p>

          <div className="shortcut-list">
            {[
              ['1', 'Navigate to Guide'],
              ['2', 'Navigate to Builder'],
              ['3', 'Navigate to Flashcards'],
              [',', 'Navigate to Settings'],
              ['K', 'Toggle AI Chat'],
              ['B', 'Toggle Sidebar'],
              ['D', 'Toggle Dark/Light Mode'],
              ['S', 'Save Board (in Builder)'],
              ['/', 'Search Topics'],
            ].map(([key, desc]) => (
              <div key={key} className="shortcut-item">
                <span className="shortcut-desc">{desc}</span>
                <kbd className="shortcut-key">
                  {isMac ? `⌘${key}` : `Ctrl+${key}`}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* About */}
        <div className="settings-section">
          <h2 className="settings-section-title">About</h2>
          <p className="settings-section-desc">
            Toolbox is an open-source system design interview preparation tool. Self-hosted for complete data privacy.
          </p>

          <div className="flex-column" style={{ gap: 'var(--space-2)' }}>
            {[
              ['Version', '0.2.0'],
              ['Storage', 'SQLite (local)'],
              ['AI Backend', 'Google Gemini'],
              ['Active Model', model],
            ].map(([label, value]) => (
              <div key={label} className="about-list-item">
                <span>{label}</span>
                <span className="about-list-value">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="Remove API Key"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ background: 'var(--color-error)' }}
              onClick={() => {
                handleClearKey()
                setShowConfirmModal(false)
              }}
            >
              Remove
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Are you sure you want to remove your saved Gemini API Key?
        </p>
      </Modal>
    </div>
  )
}
