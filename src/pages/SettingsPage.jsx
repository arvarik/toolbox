import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, Download, Upload, Trash2, Sun, Moon, RefreshCw, Plus, Server } from 'lucide-react'
import useAppStore from '../stores/appStore'
import { configApi, systemApi, profileApi, guideContentApi, endpointsApi } from '../utils/api'
import Modal from '../components/shared/Modal'
import ModelPicker from '../components/shared/ModelPicker'

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
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OpenAI',
    configKey: 'openai_api_key',
    color: '#10A37F',
    keyPlaceholder: 'sk-...',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    keyHelpLabel: 'OpenAI Platform',
  },
]

/**
 * Quick-fill presets for popular OpenAI-compatible engines.
 */
const ENDPOINT_PRESETS = [
  { label: 'Ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'LM Studio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { label: 'vLLM', name: 'vLLM', baseUrl: 'http://localhost:8000/v1' },
  { label: 'OpenRouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
]

/**
 * Reusable component for managing a single provider's API key.
 */
function ProviderKeySection({ providerId, providerDef, keyStatus, maskedKey, onKeyStatusChange }) {
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
        const discovered = result.modelsDiscovered
          ? ` — ${result.modelsDiscovered} models discovered`
          : ''
        addToast({ type: 'success', message: `${providerDef.shortName} API key verified${discovered}` })
      } else {
        onKeyStatusChange(providerId, 'error')
        addToast({ type: 'error', message: `Invalid ${providerDef.shortName} API key` })
      }
    } catch (err) {
      onKeyStatusChange(providerId, 'error')
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
    <div className="provider-card" id={`provider-card-${providerId}`}>
      <div className="provider-card-header">
        <span className="provider-card-dot" style={{ background: providerDef.color }} />
        <h3 className="provider-card-name">{providerDef.name}</h3>
        <span className={`status-pill ${keyStatus}`}>
          {keyStatus === 'connected' ? 'Connected' : keyStatus === 'error' ? 'Error' : 'Not configured'}
        </span>
      </div>

      <div className="settings-field">
        <div className="api-key-input-wrapper">
          <input
            id={`${providerId}-api-key-input`}
            className="input"
            type={showKey ? 'text' : 'password'}
            placeholder={keyStatus === 'connected' && maskedKey ? maskedKey : providerDef.keyPlaceholder}
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
        {keyStatus === 'error' && (
          <div className="api-key-status error">
            <span className="api-key-status-dot" />
            The key was rejected. Check it and try again.
          </div>
        )}
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
        <div style={{ marginTop: 'var(--space-2)' }}>
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

/**
 * "Bring Your Own Model" — manage custom OpenAI-compatible endpoints
 * (Ollama, LM Studio, vLLM, OpenRouter, Groq, ...).
 */
function CustomEndpointsSection() {
  const addToast = useAppStore((s) => s.addToast)
  const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels)
  const [endpoints, setEndpoints] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const loadEndpoints = useCallback(() => {
    endpointsApi.list().then((rows) => setEndpoints(rows || [])).catch(() => {})
  }, [])

  useEffect(() => {
    loadEndpoints()
  }, [loadEndpoints])

  const openAddForm = () => {
    setEditingId(null)
    setForm({ name: '', baseUrl: '', apiKey: '' })
    setShowForm(true)
  }

  const openEditForm = (ep) => {
    setEditingId(ep.id)
    setForm({ name: ep.name, baseUrl: ep.baseUrl, apiKey: '' })
    setShowForm(true)
  }

  const applyPreset = (preset) => {
    setForm((f) => ({ ...f, name: f.name || preset.name, baseUrl: preset.baseUrl }))
  }

  const handleTestForm = async () => {
    setTestingId('form')
    try {
      const result = await endpointsApi.test({
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        endpointId: editingId || undefined,
      })
      addToast({ type: 'success', message: `Endpoint reachable — ${result.modelCount} models found` })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Could not reach the endpoint' })
    } finally {
      setTestingId(null)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload = { name: form.name, baseUrl: form.baseUrl, apiKey: form.apiKey }
      if (editingId) {
        await endpointsApi.update(editingId, payload)
        addToast({ type: 'success', message: `Endpoint "${form.name}" updated` })
      } else {
        const created = await endpointsApi.create(payload)
        addToast({
          type: 'success',
          message: `Endpoint "${created.name}" connected — ${created.models?.length ?? 0} models discovered`,
        })
      }
      setShowForm(false)
      setEditingId(null)
      loadEndpoints()
      fetchAvailableModels()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save endpoint' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleTestSaved = async (ep) => {
    setTestingId(ep.id)
    try {
      const refreshed = await endpointsApi.refreshModels(ep.id)
      addToast({ type: 'success', message: `"${ep.name}" reachable — ${refreshed.models?.length ?? 0} models` })
      loadEndpoints()
      fetchAvailableModels()
    } catch (err) {
      addToast({ type: 'error', message: err.message || `Could not reach "${ep.name}"` })
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await endpointsApi.delete(deleteTarget.id)
      addToast({ type: 'info', message: `Endpoint "${deleteTarget.name}" removed` })
      setDeleteTarget(null)
      loadEndpoints()
      fetchAvailableModels()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to remove endpoint' })
    }
  }

  return (
    <div className="settings-section" id="custom-endpoints-section">
      <h2 className="settings-section-title">Custom Endpoints — Bring Your Own Model</h2>
      <p className="settings-section-desc">
        Connect any OpenAI-compatible server (Ollama, LM Studio, vLLM, OpenRouter, Groq).
        Discovered models join the global model picker under the endpoint&apos;s name.
      </p>

      {endpoints.length === 0 && !showForm && (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', marginTop: 'var(--space-3)' }}>
          No custom endpoints yet. Add one to run models locally and privately.
        </p>
      )}

      {endpoints.map((ep) => (
        <div key={ep.id} className="provider-card">
          <div className="provider-card-header" style={{ marginBottom: 'var(--space-1)' }}>
            <Server size={14} style={{ color: '#8B5CF6', flexShrink: 0 }} />
            <h3 className="provider-card-name">{ep.name}</h3>
            <span className={`status-pill ${ep.models.length > 0 ? 'connected' : 'disconnected'}`}>
              {ep.models.length > 0 ? `${ep.models.length} models` : 'No models'}
            </span>
          </div>
          <p className="settings-help" style={{ margin: '0 0 var(--space-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ep.baseUrl}
            {ep.hasApiKey ? ` · key ${ep.apiKeyMasked}` : ''}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 'var(--text-xs)' }}
              onClick={() => handleTestSaved(ep)}
              disabled={testingId === ep.id}
            >
              <RefreshCw size={12} />
              {testingId === ep.id ? 'Testing...' : 'Test'}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 'var(--text-xs)' }} onClick={() => openEditForm(ep)}>
              Edit
            </button>
            <button
              className="btn btn-ghost"
              style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}
              onClick={() => setDeleteTarget(ep)}
              aria-label={`Remove ${ep.name}`}
            >
              <Trash2 size={12} />
              Remove
            </button>
          </div>
        </div>
      ))}

      {showForm ? (
        <div
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            {ENDPOINT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="btn btn-secondary"
                style={{ fontSize: 'var(--text-xs)', padding: '2px 10px' }}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="settings-field" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <input
              className="input"
              id="endpoint-name-input"
              placeholder="Name (e.g. Homelab Ollama)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              className="input"
              id="endpoint-url-input"
              placeholder="Base URL (e.g. http://localhost:11434/v1)"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
            <input
              className="input"
              id="endpoint-key-input"
              type="password"
              placeholder={editingId ? 'API key (leave blank to keep current)' : 'API key (optional)'}
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            <button
              className="btn btn-secondary"
              onClick={handleTestForm}
              disabled={!form.baseUrl.trim() || testingId === 'form'}
            >
              {testingId === 'form' ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!form.name.trim() || !form.baseUrl.trim() || isSaving}
            >
              {isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Save & Verify'}
            </button>
            <button className="btn btn-ghost" onClick={() => { setShowForm(false); setEditingId(null) }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary" style={{ marginTop: 'var(--space-3)' }} onClick={openAddForm}>
          <Plus size={14} />
          Add Custom Endpoint
        </button>
      )}

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Remove Custom Endpoint"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ background: 'var(--color-error)' }}
              onClick={handleDelete}
            >
              Remove
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Remove &quot;{deleteTarget?.name}&quot;? Its models disappear from the model picker.
        </p>
      </Modal>
    </div>
  )
}

export default function SettingsPage() {
  const { addToast, theme, toggleTheme, model, fetchAvailableModels, availableModels } = useAppStore()
  const isMac = typeof window !== 'undefined' && navigator.userAgent.includes('Mac')
  const [systemStats, setSystemStats] = useState(null)
  const [profileText, setProfileText] = useState('')
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Per-provider key status — initialized dynamically from fetched providers
  const [keyStatuses, setKeyStatuses] = useState({})
  const [providerDefs, setProviderDefs] = useState(DEFAULT_PROVIDER_DEFS)
  // Masked stored keys (e.g. '••••1234') per provider, from the config API
  const [maskedKeys, setMaskedKeys] = useState({})
  const [isRefreshingModels, setIsRefreshingModels] = useState(false)

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
      // Collect masked key hints (config values arrive pre-masked)
      const masked = {}
      for (const def of DEFAULT_PROVIDER_DEFS) {
        if (config[def.configKey]) masked[def.id] = config[def.configKey]
      }
      setMaskedKeys(masked)
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

  const handleRefreshModels = async () => {
    setIsRefreshingModels(true)
    try {
      const data = await useAppStore.getState().refreshModels()
      const errorEntries = Object.entries(data.errors || {})
      if (errorEntries.length > 0) {
        addToast({
          type: 'error',
          message: `Some catalogs failed to refresh: ${errorEntries.map(([id, msg]) => `${id}: ${msg}`).join('; ')}`,
        })
      } else {
        const total = (data.groups || []).reduce((sum, g) => sum + g.models.length, 0)
        addToast({ type: 'success', message: `Model catalog refreshed — ${total} models available` })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to refresh models' })
    } finally {
      setIsRefreshingModels(false)
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
  const activeModelInfo = allModels.find((m) => m.id === model)

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
              maskedKey={maskedKeys[def.id] || ''}
              onKeyStatusChange={handleKeyStatusChange}
            />
          ))}
        </div>

        <div className="divider-h" style={{ margin: 'var(--space-6) 0' }} />

        {/* Custom Endpoints (BYOM) */}
        <CustomEndpointsSection />

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
            <h2 className="settings-section-title">AI Model</h2>
            <button
              className="btn btn-secondary"
              id="refresh-models-btn"
              onClick={handleRefreshModels}
              disabled={isRefreshingModels}
              style={{ fontSize: 'var(--text-xs)' }}
            >
              <RefreshCw size={12} className={isRefreshingModels ? 'spin' : undefined} />
              {isRefreshingModels ? 'Refreshing...' : 'Refresh Models'}
            </button>
          </div>
          <p className="settings-section-desc">
            One model powers every AI feature — chat, whiteboard reviews, Feynman feedback, and flashcard
            generation. Catalogs sync with each provider&apos;s latest releases; only the newest generation of
            each family is shown.
          </p>

          {allModels.length === 0 ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', fontStyle: 'italic', marginTop: 'var(--space-3)' }}>
              No models available yet. Add an API key or a custom endpoint above to unlock AI features.
            </p>
          ) : (
            <div className="active-model-card" id="active-model-card">
              <span
                className="model-trigger-dot"
                style={{
                  width: 10,
                  height: 10,
                  background: activeModelInfo?.providerColor ?? 'var(--color-text-tertiary)',
                }}
              />
              <div className="active-model-card-info">
                <div className="active-model-card-name">
                  {activeModelInfo?.name ?? model}
                  {activeModelInfo?.family && (
                    <span
                      className="model-trigger-family"
                      style={{ color: activeModelInfo.providerColor, borderColor: activeModelInfo.providerColor }}
                    >
                      {activeModelInfo.family}
                    </span>
                  )}
                </div>
                <div className="active-model-card-desc">
                  {activeModelInfo
                    ? `${activeModelInfo.providerName}${activeModelInfo.description ? ` — ${activeModelInfo.description}` : ''}`
                    : 'This model is no longer available — pick another one.'}
                </div>
              </div>
              <ModelPicker variant="settings" />
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
              ['Version', import.meta.env.VITE_APP_VERSION || 'Unknown'],
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
