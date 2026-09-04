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
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolDefinition[]
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
