import { useEffect, useState } from 'react'
import type {
  AppSettings,
  McpServerConfig,
  MemoryEntry,
  ProviderId,
  RapportState
} from '@shared/types'
import { listVoices } from '../tts/speak'

interface SettingsPanelProps {
  onClose: () => void
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  ollama: 'Ollama (local)'
}

export function SettingsPanel({ onClose }: SettingsPanelProps): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [saved, setSaved] = useState(false)
  const [logPath, setLogPath] = useState('')
  const [rapport, setRapport] = useState<RapportState | null>(null)
  const [memories, setMemories] = useState<MemoryEntry[]>([])

  useEffect(() => {
    window.verity.settings.get().then(setSettings)
    window.verity.logs.getPath().then(setLogPath)
    window.verity.rapport.get().then(setRapport)
    window.verity.memories.get().then(setMemories)
    const load = (): void => setVoices(listVoices())
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  async function handleResetRapport(): Promise<void> {
    if (!window.confirm('Reset the relationship back to a full 100/100? This forgets everything.'))
      return
    setRapport(await window.verity.rapport.reset())
  }

  async function handleDeleteMemory(id: string): Promise<void> {
    setMemories(await window.verity.memories.delete(id))
  }

  async function handleClearMemories(): Promise<void> {
    if (!window.confirm(`Delete all ${memories.length} saved memories? This can't be undone.`))
      return
    setMemories(await window.verity.memories.clear())
  }

  if (!settings) return <div className="settings-panel">Loading...</div>

  function update(patch: Partial<AppSettings>): void {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function updateProvider(
    id: ProviderId,
    patch: Partial<AppSettings['providers'][ProviderId]>
  ): void {
    if (!settings) return
    update({ providers: { ...settings.providers, [id]: { ...settings.providers[id], ...patch } } })
  }

  function updateServer(id: string, patch: Partial<McpServerConfig>): void {
    if (!settings) return
    update({ mcpServers: settings.mcpServers.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  function addServer(): void {
    if (!settings) return
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: 'new-server',
      command: '',
      args: [],
      enabled: true
    }
    update({ mcpServers: [...settings.mcpServers, server] })
  }

  function removeServer(id: string): void {
    if (!settings) return
    update({ mcpServers: settings.mcpServers.filter((s) => s.id !== id) })
  }

  async function save(): Promise<void> {
    if (!settings) return
    await window.verity.settings.set(settings)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  const provider = settings.providers[settings.activeProvider]

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <button onClick={onClose} aria-label="Close settings">
          ✕
        </button>
      </div>

      <section>
        <label>LLM Provider</label>
        <select
          value={settings.activeProvider}
          onChange={(e) => update({ activeProvider: e.target.value as ProviderId })}
        >
          {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => (
            <option key={id} value={id}>
              {PROVIDER_LABELS[id]}
            </option>
          ))}
        </select>

        {settings.activeProvider !== 'ollama' && (
          <>
            <label>API Key</label>
            <input
              type="password"
              value={provider.apiKey}
              onChange={(e) => updateProvider(settings.activeProvider, { apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </>
        )}

        <label>Model {settings.activeProvider === 'ollama' ? '' : '(optional override)'}</label>
        <input
          type="text"
          value={provider.model}
          onChange={(e) => updateProvider(settings.activeProvider, { model: e.target.value })}
          placeholder={settings.activeProvider === 'ollama' ? 'llama3.1' : 'default'}
        />

        <label>
          Base URL{' '}
          {settings.activeProvider === 'ollama'
            ? ''
            : '(optional - point at a local/self-hosted server)'}
        </label>
        <input
          type="text"
          value={provider.baseUrl}
          onChange={(e) => updateProvider(settings.activeProvider, { baseUrl: e.target.value })}
          placeholder={
            settings.activeProvider === 'openai'
              ? 'e.g. http://localhost:8080/v1 for llama.cpp / LM Studio'
              : settings.activeProvider === 'anthropic'
                ? 'default: api.anthropic.com'
                : 'http://localhost:11434'
          }
        />
        {settings.activeProvider === 'openai' && (
          <p className="hint">
            OpenAI-compatible local servers (llama.cpp, LM Studio, vLLM) usually don&apos;t check
            the API key - any non-empty value works.
          </p>
        )}
      </section>

      <section>
        <div className="settings-row-header">
          <label>System Prompt (optional)</label>
          <button onClick={() => update({ systemPrompt: '' })}>Use Default</button>
        </div>
        <textarea
          rows={5}
          value={settings.systemPrompt}
          onChange={(e) => update({ systemPrompt: e.target.value })}
          placeholder="Leave blank to use Verity's default persona. Anything you write here replaces it entirely - rapport and tool-use instructions are always kept regardless."
        />
        {settings.systemPrompt.trim() && (
          <p className="hint">
            You have a custom prompt saved, so changes to Verity&apos;s built-in default won&apos;t
            apply until you clear this (or click &quot;Use Default&quot;) and save.
          </p>
        )}
      </section>

      <section>
        <div className="settings-row-header">
          <label>Relationship</label>
          <button onClick={handleResetRapport}>Reset</button>
        </div>
        {rapport ? (
          <p className="hint">
            Rapport: {rapport.value}/100 - {rapport.tierLabel}
          </p>
        ) : (
          <p className="hint">Loading...</p>
        )}
        <p className="hint">
          The model adjusts this itself (adjust_rapport tool) in reaction to how it&apos;s treated,
          and it persists across restarts - her tone shifts as it crosses tiers instead of resetting
          every conversation.
        </p>
      </section>

      <section>
        <div className="settings-row-header">
          <label>Memories ({memories.length})</label>
          {memories.length > 0 && <button onClick={handleClearMemories}>Clear All</button>}
        </div>
        {memories.length === 0 ? (
          <p className="hint">
            Nothing saved yet - the model remembers things itself via save_memory.
          </p>
        ) : (
          <div className="memory-list">
            {[...memories].reverse().map((m) => (
              <div key={m.id} className="memory-row">
                <span className="memory-content">{m.content}</span>
                <button onClick={() => handleDeleteMemory(m.id)} aria-label="Forget this">
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <label>
          <input
            type="checkbox"
            checked={settings.ttsEnabled}
            onChange={(e) => update({ ttsEnabled: e.target.checked })}
          />
          Speak replies aloud
        </label>

        {settings.ttsEnabled && (
          <>
            <label>Voice</label>
            <select
              value={settings.ttsVoice}
              onChange={(e) => update({ ttsVoice: e.target.value })}
            >
              <option value="">System default</option>
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>

            <label>Rate ({settings.ttsRate.toFixed(1)}x)</label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.ttsRate}
              onChange={(e) => update({ ttsRate: Number(e.target.value) })}
            />
          </>
        )}
      </section>

      <section>
        <div className="settings-row-header">
          <label>MCP Servers</label>
          <button onClick={addServer}>+ Add</button>
        </div>
        {settings.mcpServers.length === 0 && <p className="hint">No MCP servers configured.</p>}
        {settings.mcpServers.map((server) => (
          <div key={server.id} className="mcp-server-row">
            <input
              type="text"
              value={server.name}
              placeholder="name"
              onChange={(e) => updateServer(server.id, { name: e.target.value })}
            />
            <input
              type="text"
              value={server.command}
              placeholder="command (e.g. npx)"
              onChange={(e) => updateServer(server.id, { command: e.target.value })}
            />
            <input
              type="text"
              value={server.args.join(' ')}
              placeholder="args (space separated)"
              onChange={(e) =>
                updateServer(server.id, { args: e.target.value.split(' ').filter(Boolean) })
              }
            />
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={(e) => updateServer(server.id, { enabled: e.target.checked })}
              />
              on
            </label>
            <button onClick={() => removeServer(server.id)} aria-label="Remove server">
              🗑
            </button>
          </div>
        ))}
      </section>

      <section>
        <div className="settings-row-header">
          <label>Debug Log</label>
          <button onClick={() => window.verity.logs.openFolder()}>Open Log Folder</button>
        </div>
        <p className="hint">
          Every chat turn, tool call, mood change, and provider/MCP error is written here - useful
          when something isn&apos;t working as expected.
        </p>
        {logPath && <p className="hint mono">{logPath}</p>}
      </section>

      <div className="settings-footer">
        <button onClick={save}>{saved ? 'Saved!' : 'Save'}</button>
      </div>
    </div>
  )
}
