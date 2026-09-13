import { useEffect, useState } from 'react'
import type {
  AppSettings,
  FacePackId,
  McpServerConfig,
  McpServerStatus,
  MemoryEntry,
  ProviderId,
  RapportEvent,
  RapportState,
  ActivityEntry,
  Reminder
} from '@shared/types'
import { listVoices } from '../tts/speak'
import { FACE_PACKS } from '../face/faceAtlas'

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
  const [logPath, setLogPath] = useState('')
  const [rapport, setRapport] = useState<RapportState | null>(null)
  const [rapportHistory, setRapportHistory] = useState<RapportEvent[]>([])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [conversationCleared, setConversationCleared] = useState(false)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [hotkeyError, setHotkeyError] = useState(false)
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([])

  useEffect(() => {
    window.verity.settings.get().then(setSettings)
    window.verity.logs.getPath().then(setLogPath)
    window.verity.rapport.get().then(setRapport)
    window.verity.rapport.getHistory().then(setRapportHistory)
    window.verity.memories.get().then(setMemories)
    window.verity.activity.get().then(setActivity)
    window.verity.reminders.get().then(setReminders)
    window.verity.mcp.getStatuses().then(setMcpStatuses)
    const offMcpStatuses = window.verity.mcp.onStatuses(setMcpStatuses)
    const load = (): void => setVoices(listVoices())
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => {
      offMcpStatuses()
      window.speechSynthesis?.removeEventListener('voiceschanged', load)
    }
  }, [])

  async function handleResetRapport(): Promise<void> {
    if (!window.confirm('Reset the relationship back to a full 100/100? This forgets everything.'))
      return
    setRapport(await window.verity.rapport.reset())
    setRapportHistory([])
  }

  async function handleClearConversation(): Promise<void> {
    if (!window.confirm("Clear the conversation Verity remembers? This can't be undone.")) return
    await window.verity.conversation.clear()
    setConversationCleared(true)
  }

  async function handleDeleteMemory(id: string): Promise<void> {
    setMemories(await window.verity.memories.delete(id))
  }

  async function handleClearMemories(): Promise<void> {
    if (!window.confirm(`Delete all ${memories.length} saved memories? This can't be undone.`))
      return
    setMemories(await window.verity.memories.clear())
  }

  async function handleClearActivity(): Promise<void> {
    setActivity(await window.verity.activity.clear())
  }

  async function handleCancelReminder(id: string): Promise<void> {
    setReminders(await window.verity.reminders.cancel(id))
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

  function updateFish(patch: Partial<AppSettings['fishAudio']>): void {
    if (!settings) return
    update({ fishAudio: { ...settings.fishAudio, ...patch } })
  }

  function updateServer(id: string, patch: Partial<McpServerConfig>): void {
    if (!settings) return
    update({ mcpServers: settings.mcpServers.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  }

  function toggleServerTool(server: McpServerConfig, toolName: string, enabled: boolean): void {
    const disabledTools = enabled
      ? server.disabledTools.filter((t) => t !== toolName)
      : [...server.disabledTools, toolName]
    updateServer(server.id, { disabledTools })
  }

  function addServer(): void {
    if (!settings) return
    const server: McpServerConfig = {
      id: crypto.randomUUID(),
      name: 'new-server',
      command: '',
      args: [],
      enabled: true,
      disabledTools: []
    }
    update({ mcpServers: [...settings.mcpServers, server] })
  }

  function removeServer(id: string): void {
    if (!settings) return
    update({ mcpServers: settings.mcpServers.filter((s) => s.id !== id) })
  }

  async function save(): Promise<void> {
    if (!settings) return
    const { hotkeyRegistered } = await window.verity.settings.set(settings)
    if (!hotkeyRegistered) {
      setHotkeyError(true)
      return
    }
    onClose()
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
        <label>Face</label>
        <select
          value={settings.facePack}
          onChange={(e) => update({ facePack: e.target.value as FacePackId })}
        >
          {(Object.keys(FACE_PACKS) as FacePackId[]).map((id) => (
            <option key={id} value={id}>
              {FACE_PACKS[id].label}
            </option>
          ))}
        </select>
        <p className="hint">
          Which set of expressions the floating head cycles through. It still switches on its own
          with her mood and your rapport - this only changes the artwork.
        </p>
      </section>

      <section>
        <label>
          <input
            type="checkbox"
            checked={settings.hotkeyEnabled}
            onChange={(e) => update({ hotkeyEnabled: e.target.checked })}
          />
          Global hotkey to show/hide
        </label>
        {settings.hotkeyEnabled && (
          <input
            type="text"
            value={settings.hotkeyAccelerator}
            onChange={(e) => {
              setHotkeyError(false)
              update({ hotkeyAccelerator: e.target.value })
            }}
            placeholder="CommandOrControl+Shift+V"
          />
        )}
        {hotkeyError ? (
          <p className="hint">
            Couldn&apos;t register that shortcut - it may already be in use by another app. Try a
            different combination.
          </p>
        ) : (
          <p className="hint">
            Works even when another app is focused. Uses Electron accelerator syntax (e.g.
            CommandOrControl+Shift+V).
          </p>
        )}
      </section>

      <section>
        <label>
          <input
            type="checkbox"
            checked={settings.ambientEnabled}
            onChange={(e) => update({ ambientEnabled: e.target.checked })}
          />
          Ambient check-ins
        </label>
        <p className="hint">
          Off by default - lets Verity occasionally speak or act completely unprompted, at a random
          interval, instead of only ever replying to you. Each check-in is a real LLM call (counts
          against your token usage / API cost) even on the ticks where it decides to do nothing,
          which is most of them.
        </p>
        {settings.ambientEnabled && (
          <div className="settings-row-header">
            <label>
              Every{' '}
              <input
                type="number"
                min={1}
                max={180}
                value={settings.ambientMinMinutes}
                onChange={(e) => update({ ambientMinMinutes: Number(e.target.value) })}
              />{' '}
              to{' '}
              <input
                type="number"
                min={1}
                max={180}
                value={settings.ambientMaxMinutes}
                onChange={(e) => update({ ambientMaxMinutes: Number(e.target.value) })}
              />{' '}
              minutes
            </label>
          </div>
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
        {rapportHistory.length > 0 && (
          <div className="memory-list">
            {rapportHistory.slice(0, 10).map((e) => (
              <div key={e.createdAt} className="memory-row">
                <span className="memory-content">
                  {e.delta >= 0 ? '+' : ''}
                  {e.delta} ({e.reason}) &rarr; {e.value}/100
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="settings-row-header">
          <label>Conversation</label>
          <button onClick={handleClearConversation}>Clear</button>
        </div>
        <p className="hint">
          {conversationCleared
            ? "Cleared - Verity won't remember the conversation on the next message."
            : 'The conversation (and what Verity has been discussing) persists across restarts, separately from saved memories and rapport.'}
        </p>
      </section>

      <section>
        <div className="settings-row-header">
          <label>Activity ({activity.length})</label>
          {activity.length > 0 && <button onClick={handleClearActivity}>Clear Activity</button>}
        </div>
        <p className="hint">
          Every tool call Verity has actually made - builtin and MCP alike - so you can see what she
          did, not just what she said.
        </p>
        {activity.length > 0 && (
          <div className="memory-list">
            {[...activity]
              .reverse()
              .slice(0, 20)
              .map((a) => (
                <div key={a.id} className="memory-row">
                  <span className="memory-content">{a.summary}</span>
                </div>
              ))}
          </div>
        )}
      </section>

      <section>
        <label>Reminders ({reminders.length})</label>
        {reminders.length === 0 ? (
          <p className="hint">None pending - set via the set_reminder tool in chat.</p>
        ) : (
          <div className="memory-list">
            {reminders.map((r) => (
              <div key={r.id} className="memory-row">
                <span className="memory-content">
                  {r.message} - {new Date(r.fireAt).toLocaleString()}
                </span>
                <button onClick={() => handleCancelReminder(r.id)} aria-label="Cancel reminder">
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
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
                <span className="memory-content">
                  {m.kind !== 'fact' && <span className="memory-kind">{m.kind}</span>}
                  {m.content}
                </span>
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
            <label>Engine</label>
            <select
              value={settings.ttsEngine}
              onChange={(e) => update({ ttsEngine: e.target.value as AppSettings['ttsEngine'] })}
            >
              <option value="system">System voice (offline)</option>
              <option value="fish">Fish Audio (natural)</option>
            </select>

            {settings.ttsEngine === 'system' && (
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
              </>
            )}

            {settings.ttsEngine === 'fish' && (
              <>
                <label>Server URL</label>
                <input
                  type="text"
                  value={settings.fishAudio.baseUrl}
                  onChange={(e) => updateFish({ baseUrl: e.target.value })}
                  placeholder="http://localhost:8080"
                />

                <label>API Key</label>
                <input
                  type="password"
                  value={settings.fishAudio.apiKey}
                  onChange={(e) => updateFish({ apiKey: e.target.value })}
                  placeholder="matches the server's --api-key"
                />

                <label>Voice reference (optional)</label>
                <input
                  type="text"
                  value={settings.fishAudio.referenceId}
                  onChange={(e) => updateFish({ referenceId: e.target.value })}
                  placeholder="reference id / staged voice name - blank = default"
                />

                <label>Audio format</label>
                <select
                  value={settings.fishAudio.format}
                  onChange={(e) =>
                    updateFish({ format: e.target.value as AppSettings['fishAudio']['format'] })
                  }
                >
                  <option value="wav">wav (most compatible)</option>
                  <option value="mp3">mp3 (smaller)</option>
                  <option value="opus">opus (smallest)</option>
                </select>

                <p className="hint">
                  Needs a running fish-speech server - see docker/fish-audio/README.md.
                  Verity&apos;s main process sends each reply&apos;s text to this URL to synthesize;
                  it falls back to the system voice if the server can&apos;t be reached.
                </p>
              </>
            )}

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
        {settings.mcpServers.map((server) => {
          const status = mcpStatuses.find((s) => s.id === server.id)
          return (
            <div key={server.id} className="mcp-server-card">
              <div className="mcp-server-card-header">
                <input
                  type="text"
                  value={server.name}
                  placeholder="name"
                  onChange={(e) => updateServer(server.id, { name: e.target.value })}
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
              <label className="mcp-field-label">Command</label>
              <input
                type="text"
                value={server.command}
                placeholder="command (e.g. npx)"
                onChange={(e) => updateServer(server.id, { command: e.target.value })}
              />
              <label className="mcp-field-label">Args</label>
              <input
                type="text"
                value={server.args.join(' ')}
                placeholder="args (space separated)"
                onChange={(e) =>
                  updateServer(server.id, { args: e.target.value.split(' ').filter(Boolean) })
                }
              />
              {status && status.toolNames.length > 0 && (
                <>
                  <label className="mcp-field-label">Tools</label>
                  <div className="mcp-tool-list">
                    {status.toolNames.map((toolName) => (
                      <label key={toolName} className="checkbox-inline">
                        <input
                          type="checkbox"
                          checked={!server.disabledTools.includes(toolName)}
                          onChange={(e) => toggleServerTool(server, toolName, e.target.checked)}
                        />
                        {toolName}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </section>

      <section>
        <label>Privacy</label>
        <p className="hint">
          API keys and MCP server secrets are stored encrypted via your OS keychain. The weather
          tool contacts open-meteo.com (and ipapi.co for approximate IP location when you don&apos;t
          name a city). The file tools (read/search) send whatever they read to your configured LLM
          provider, and are blocked from unprompted &quot;ambient&quot; check-ins. With the Fish
          Audio voice engine, each spoken reply&apos;s text is sent to the TTS server URL you
          configure (local by default).
        </p>
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
        <button className="settings-cancel" onClick={onClose}>
          Cancel
        </button>
        <button onClick={save}>Save</button>
      </div>
    </div>
  )
}
