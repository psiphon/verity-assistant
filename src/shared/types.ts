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
  /** Unprefixed names of this server's own tools to withhold from the LLM,
   * without disabling the whole server. */
  disabledTools: string[]
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
  /** Last dragged window position, so the widget reopens where it was left
   * instead of recentering every launch. Null means "not set yet" (first
   * run) - let Electron pick its own default position. */
  windowX: number | null
  windowY: number | null
  /** Global keyboard shortcut to show/hide the widget, on regardless of
   * which app has focus - an Electron accelerator string (e.g.
   * "CommandOrControl+Shift+V"). */
  hotkeyEnabled: boolean
  hotkeyAccelerator: string
  /** Whether to silently check GitHub Releases for a newer version on
   * launch. Only ever checks + notifies (with a link to the release) -
   * never downloads or installs anything automatically. */
  autoUpdateCheckEnabled: boolean
}

/** Synthesized audio handed back from the main process over IPC. `data` is the
 * raw encoded file bytes (structured-cloned across the bridge). */
export interface TtsAudio {
  format: FishAudioSettings['format']
  data: Uint8Array
}

export type MemoryKind = 'fact' | 'preference' | 'event' | 'relationship'

export interface MemoryEntry {
  id: string
  content: string
  kind: MemoryKind
  createdAt: string
}

export interface RapportState {
  value: number
  tierLabel: string
}

/** One rapport adjustment - persisted separately from the running score
 * itself (see src/main/rapport.ts) so Verity can reference specific past
 * incidents, not just the current number. */
export interface RapportEvent {
  delta: number
  reason: string
  /** The resulting score right after this event was applied. */
  value: number
  createdAt: string
}

/** A pending reminder (see src/main/reminders.ts) - persisted so it survives
 * a restart instead of being a bare in-memory setTimeout. */
export interface Reminder {
  id: string
  message: string
  /** ISO timestamp of when it should fire. */
  fireAt: string
  createdAt: string
}

/** One recorded tool call (see src/main/activity.ts) - a readable "what did
 * she actually do" trail distinct from the raw JSONL debug log, covering
 * every builtin and MCP tool call alike. */
export interface ActivityEntry {
  id: string
  tool: string
  summary: string
  createdAt: string
}

/** A single line of the persisted, display-oriented conversation log (see
 * src/main/conversation.ts) - distinct from the LLM's own working history,
 * which also carries tool-call/tool-result payloads this doesn't need. */
export interface TranscriptEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
}

export interface McpServerStatus {
  id: string
  name: string
  connected: boolean
  toolCount: number
  /** Every tool name the server advertises (unprefixed), regardless of
   * whether it's currently disabled - lets Settings render a full toggle
   * checklist, not just the currently-enabled subset. */
  toolNames: string[]
  error?: string
}
