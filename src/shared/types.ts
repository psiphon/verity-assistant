export type ProviderId = 'anthropic' | 'openai' | 'ollama'

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
}

export interface ProviderSettings {
  apiKey: string
  baseUrl: string
  model: string
}

export interface AppSettings {
  activeProvider: ProviderId
  providers: Record<ProviderId, ProviderSettings>
  mcpServers: McpServerConfig[]
  ttsEnabled: boolean
  ttsVoice: string
  ttsRate: number
  alwaysOnTop: boolean
  /** Overrides Verity's default persona. Empty string means "use the
   * built-in default". Rapport and tool-use instructions are always
   * appended regardless of what's here. */
  systemPrompt: string
  /** 0-100 relationship/rapport score the model adjusts via the
   * adjust_rapport tool in reaction to how it's being treated. Persisted
   * (not reset per-conversation) - has its own UI in Settings, not part of
   * the general settings form. */
  rapport: number
  /** Freeform facts the model chose to remember via save_memory, persisted
   * across restarts and conversations. Has its own UI in Settings. */
  memories: MemoryEntry[]
  /** Off by default - each check-in is a real LLM call (token cost) even
   * when the model decides to do nothing, so this is opt-in. */
  ambientEnabled: boolean
  /** Randomized interval range (minutes) between ambient check-ins. */
  ambientMinMinutes: number
  ambientMaxMinutes: number
}

export interface MemoryEntry {
  id: string
  content: string
  createdAt: string
}

export interface RapportState {
  value: number
  tierLabel: string
}

export interface McpServerStatus {
  id: string
  name: string
  connected: boolean
  toolCount: number
  error?: string
}
