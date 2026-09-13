export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] }
  | {
      role: 'tool'
      toolCallId: string
      name: string
      content: string
      /** Present only for a tool result that captured an image (currently
       * just look_at_screen) - how each provider serializes this varies:
       * Anthropic/OpenAI support it natively (OpenAI as a separate
       * synthetic user message, since its tool-message content type is
       * text-only), Ollama drops it with a text note instead. */
      image?: { mediaType: string; base64: string }
    }

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
  /** When given, a provider that supports it streams incremental text
   * chunks here as they arrive, in addition to still resolving the full
   * ChatResult once the turn completes - purely a "show progress" layer,
   * not a change to what's returned. Providers without streaming support
   * (or a turn that never produces plain text) simply never call it. */
  onTextDelta?: (chunk: string) => void
}

export interface ChatResult {
  text: string
  toolCalls: ToolCallRequest[]
  stopReason: 'end' | 'tool_use'
}

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface LLMProvider {
  readonly id: string
  chat(request: ChatRequest): Promise<ChatResult>
}
