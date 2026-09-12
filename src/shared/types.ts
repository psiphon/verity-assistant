export type ProviderId = 'anthropic' | 'openai' | 'ollama'

export type FacePackId = 'photos' | 'meeseeks'

/** Which text-to-speech backend voices Verity's replies. `system` is the
 * browser `speechSynthesis` voices (offline, robotic); `fish` is a
 * self-hosted fish-speech / OpenAudio server (see docker/fish-audio/). */
export type TtsEngine = 'system' | 'fish'

export interface FishAudioSettings {
  /** Base URL of the fish-speech API server, e.g. http://localhost:8080.
   * Only the Electron main process contacts this (see src/main/tts.ts). */
  baseUrl: string
  /** Bearer token the server was started with (--api-key). Encrypted at rest
   * like the provider API keys - see src/main/secrets.ts. */
  apiKey: string
  /** Optional reference-voice id / staged archive name for voice cloning.
   * Empty means the server's default voice. */
  referenceId: string
  /** Container the server encodes audio in. wav is the most broadly decodable. */
  format: 'wav' | 'mp3' | 'opus'
}

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
  /** Which backend synthesizes spoken replies. */
  ttsEngine: TtsEngine
  /** System-voice name (only used when ttsEngine === 'system'). */
  ttsVoice: string
  /** Playback speed multiplier - applies to both engines. */
  ttsRate: number
  /** Connection + voice settings for ttsEngine === 'fish'. */
  fishAudio: FishAudioSettings
  alwaysOnTop: boolean
  /** Which set of face images the floating head uses. */
  facePack: FacePackId
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

/** Synthesized audio handed back from the main process over IPC. `data` is the
 * raw encoded file bytes (structured-cloned across the bridge). */
export interface TtsAudio {
  format: FishAudioSettings['format']
  data: Uint8Array
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
