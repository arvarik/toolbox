import { useState, useEffect } from 'react'
import { Eye, EyeOff, Save, Download, Upload, Trash2, CheckCircle } from 'lucide-react'
import useAppStore from '../stores/appStore'
import { configApi } from '../utils/api'

export default function SettingsPage() {
  const { apiKeyConfigured, setApiKeyConfigured, addToast } = useAppStore()
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [keyStatus, setKeyStatus] = useState(apiKeyConfigured ? 'connected' : 'disconnected')

  // Check initial API key status on mount
  useEffect(() => {
    configApi.get().then((config) => {
      if (config.api_key_configured) {
        setApiKeyConfigured(true)
        setKeyStatus('connected')
      }
    }).catch(() => {})
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

  const handleClearKey = () => {
    setApiKey('')
    setApiKeyConfigured(false)
    setKeyStatus('disconnected')
    addToast({ type: 'info', message: 'API key removed' })
  }

  return (
    <div className="page-wrapper" id="settings-page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">
          Configure your Toolbox instance, manage your API key, and customize your experience.
        </p>
      </div>

      <div style={{ padding: 'var(--space-6) var(--space-8)' }}>
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
            <button className="btn btn-ghost" onClick={handleClearKey} style={{ color: 'var(--color-error)' }}>
              <Trash2 size={14} />
              Remove API Key
            </button>
          )}
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* Data Management */}
        <div className="settings-section">
          <h2 className="settings-section-title">Data Management</h2>
          <p className="settings-section-desc">
            Export or import your flashcard decks and whiteboard designs.
          </p>

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button className="btn btn-secondary" id="export-data-btn">
              <Download size={14} />
              Export All Data
            </button>
            <button className="btn btn-secondary" id="import-data-btn">
              <Upload size={14} />
              Import Data
            </button>
          </div>
          <p className="settings-help" style={{ marginTop: 'var(--space-3)' }}>
            Data is exported as a JSON file containing all your decks, cards, and board configurations.
          </p>
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* About */}
        <div className="settings-section">
          <h2 className="settings-section-title">About</h2>
          <p className="settings-section-desc">
            Toolbox is an open-source system design interview preparation tool. Self-hosted for complete data privacy.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              padding: 'var(--space-2) 0',
            }}>
              <span>Version</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>0.1.0</span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              padding: 'var(--space-2) 0',
            }}>
              <span>Storage</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>SQLite (local)</span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              padding: 'var(--space-2) 0',
            }}>
              <span>AI Backend</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>Google Gemini</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
