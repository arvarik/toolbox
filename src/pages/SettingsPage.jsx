import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Download, Upload, Trash2, Sun, Moon } from 'lucide-react'
import useAppStore from '../stores/appStore'
import { configApi, systemApi, profileApi, guideContentApi } from '../utils/api'
import Modal from '../components/shared/Modal'

/**
 * Default fallback provider config (used before server metadata loads).
 * These match the static getters in GeminiProvider and ClaudeProvider,
 * but serve as client-side defaults until the /available-models response arrives.
 */
const DEFAULT_PROVIDER_DEFS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    configKey: 'gemini_api_key',
    color: '#4285F4',
    keyPlaceholder: 'AIza...',
    keyHelpUrl: 'https://aistudio.google.com/apikey',
    keyHelpLabel: 'Google AI Studio',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    shortName: 'Claude',
    configKey: 'claude_api_key',
    color: '#D97757',
    keyPlaceholder: 'sk-ant-...',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    keyHelpLabel: 'Anthropic Console',
  },
]

/**
 * Reusable component for managing a single provider's API key.
 */
function ProviderKeySection({ providerId, providerDef, keyStatus, onKeyStatusChange }) {
  const addToast = useAppStore((s) => s.addToast)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return
    setIsTesting(true)
    try {
      const result = await configApi.testApiKey(apiKey.trim(), providerId)
      if (result.valid) {
        onKeyStatusChange(providerId, 'connected')
        setApiKey('')
        addToast({ type: 'success', message: `${providerDef.shortName} API key saved and verified` })
      } else {
        onKeyStatusChange(providerId, 'disconnected')
        addToast({ type: 'error', message: `Invalid ${providerDef.shortName} API key` })
      }
    } catch (err) {
      onKeyStatusChange(providerId, 'disconnected')
      addToast({ type: 'error', message: err.message || `Failed to verify ${providerDef.shortName} API key` })
    } finally {
      setIsTesting(false)
    }
  }

  const handleClearKey = async () => {
    try {
      await configApi.update({ [providerDef.configKey]: '' })
      setApiKey('')
      onKeyStatusChange(providerId, 'disconnected')
      addToast({ type: 'info', message: `${providerDef.shortName} API key removed` })
    } catch (err) {
      addToast({ type: 'error', message: err.message || `Failed to remove ${providerDef.shortName} API key` })
    }
  }

  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: providerDef.color,
            flexShrink: 0,
          }}
        />
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
          {providerDef.name}
        </h3>
      </div>

      <div className="settings-field">
        <div className="api-key-input-wrapper">
          <input
            id={`${providerId}-api-key-input`}
            className="input"
            type={showKey ? 'text' : 'password'}
            placeholder={providerDef.keyPlaceholder}
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
            ? 'Connected — AI features enabled'
            : 'Not configured'}
        </div>
        <p className="settings-help">
          Get your API key from{' '}
          {providerDef.keyHelpUrl ? (
            <a
              href={providerDef.keyHelpUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}
            >
              {providerDef.keyHelpLabel}
            </a>
          ) : null}
          . Your key is stored locally and never shared.
        </p>
      </div>

      {keyStatus === 'connected' && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <button
            className="btn btn-ghost"
            onClick={() => setShowConfirmModal(true)}
            style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}
          >
            <Trash2 size={12} />
            Remove {providerDef.shortName} Key
          </button>
        </div>
      )}

      <Modal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title={`Remove ${providerDef.shortName} API Key`}
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
          Are you sure you want to remove your saved {providerDef.name} API Key?
        </p>
      </Modal>
    </div>
  )
}

export default function SettingsPage() {
  const { addToast, theme, toggleTheme, model, setModel, fetchAvailableModels, availableModels } = useAppStore()
  const isMac = typeof window !== 'undefined' && navigator.userAgent.includes('Mac')
  const [systemStats, setSystemStats] = useState(null)
  const [profileText, setProfileText] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Per-provider key status — initialized dynamically from fetched providers
  const [keyStatuses, setKeyStatuses] = useState({})
  const [providerDefs, setProviderDefs] = useState(DEFAULT_PROVIDER_DEFS)

  const handleKeyStatusChange = useCallback((providerId, status) => {
    setKeyStatuses((prev) => ({ ...prev, [providerId]: status }))
    // Refresh available models whenever a key status changes
    fetchAvailableModels()
    // Update the global store
    const newConfigured = {}
    const updated = { ...keyStatuses, [providerId]: status }
    for (const [id, s] of Object.entries(updated)) {
      newConfigured[id] = s === 'connected'
    }
    useAppStore.getState().setApiKeysConfigured(newConfigured)
  }, [keyStatuses, fetchAvailableModels])

  useEffect(() => {
    // Fetch provider definitions and available models
    configApi.getAvailableModels().then((data) => {
      if (data.providers && data.providers.length > 0) {
        setProviderDefs(data.providers)
      }
    }).catch(() => {})

    configApi.get().then((config) => {
      const statuses = {}
      if (config.api_keys_configured) {
        for (const [providerId, configured] of Object.entries(config.api_keys_configured)) {
          statuses[providerId] = configured ? 'connected' : 'disconnected'
        }
      } else if (config.api_key_configured) {
        statuses.gemini = 'connected'
      }
      setKeyStatuses(statuses)
      const configuredMap = {}
      for (const [id, s] of Object.entries(statuses)) {
        configuredMap[id] = s === 'connected'
      }
      useAppStore.getState().setApiKeysConfigured(configuredMap)
    }).catch(() => {})

    fetchAvailableModels()
    systemApi.stats().then(setSystemStats).catch(console.error)
    profileApi.get().then(res => setProfileText(res.profileText || '')).catch(console.error)
  }, [fetchAvailableModels])

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

  const handleClearCache = async () => {
    try {
      await systemApi.clearCache()
      addToast({ type: 'success', message: 'AI starter cache cleared successfully' })
      systemApi.stats().then(setSystemStats).catch(console.error)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to clear cache' })
    }
  }

  const handleExportGuide = () => {
    window.open(guideContentApi.exportUrl(), '_blank')
  }

  // Flatten available models for easy display
  const allModels = availableModels.flatMap(group =>
    group.models.map(m => ({ ...m, providerColor: group.provider.color, providerName: group.provider.name }))
  )

  // Determine active providers for About section
  const activeProviders = Object.entries(keyStatuses)
    .filter(([, s]) => s === 'connected')
    .map(([id]) => {
      const def = providerDefs.find(p => p.id === id)
      return def?.name || id
    })

  return (
    <div className="page-wrapper" id="settings-page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">
          Configure your Toolbox instance, manage your API keys, and customize your experience.
        </p>
      </div>

      <div className="settings-content">
        {/* API Keys Section */}
        <div className="settings-section">
          <h2 className="settings-section-title">AI Provider API Keys</h2>
          <p className="settings-section-desc">
            Configure API keys for AI-powered features. Add keys for one or more providers — models will appear based on which keys are configured.
          </p>

          {providerDefs.map((def) => (
            <ProviderKeySection
              key={def.id}
              providerId={def.id}
              providerDef={def}
              keyStatus={keyStatuses[def.id] || 'disconnected'}
              onKeyStatusChange={handleKeyStatusChange}
            />
          ))}
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* AI Shadow Memory */}
        <div className="settings-section">
          <h2 className="settings-section-title">AI Shadow Memory</h2>
          <p className="settings-section-desc">
            The AI learns facts about you over time (e.g., &quot;Interviewing at Google in 2 weeks&quot;) to tailor its explanations. You can view or manually edit its memory here.
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
            Choose which AI model to use for chat and content generation. Available models depend on your configured API keys.
          </p>

          {allModels.length === 0 ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', marginTop: 'var(--space-3)' }}>
              No models available. Configure at least one API key above.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              {/* Group by provider */}
              {availableModels.map((group) => (
                <div key={group.provider.id}>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    color: group.provider.color,
                    letterSpacing: '0.05em',
                    marginBottom: 'var(--space-1)',
                    marginTop: 'var(--space-2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                  }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: group.provider.color,
                      display: 'inline-block',
                    }} />
                    {group.provider.name}
                  </div>
                  {group.models.map((m) => (
                    <label
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${model === m.id ? group.provider.color : 'var(--color-border)'}`,
                        background: model === m.id ? 'var(--color-accent-subtle)' : 'var(--color-surface)',
                        cursor: 'pointer',
                        transition: 'all var(--duration-fast)',
                        marginBottom: 'var(--space-1)',
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
                        style={{ accentColor: group.provider.color }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{m.name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{m.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
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
              ['AI Providers', activeProviders.length > 0 ? activeProviders.join(', ') : 'None configured'],
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
    </div>
  )
}
