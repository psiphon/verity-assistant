import type { ChatRequest, ChatResult, LLMProvider, ProviderConfig, ToolCallRequest } from './types'

const DEFAULT_MODEL = 'llama3.1'

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama'
  private baseUrl: string
  private model: string

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434'
    this.model = config.model || DEFAULT_MODEL
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const messages: OllamaMessage[] = [{ role: 'system', content: request.system }]

    for (const msg of request.messages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: msg.content,
          tool_calls: msg.toolCalls?.map((c) => ({
            function: { name: c.name, arguments: c.input }
          }))
        })
      } else if (msg.role === 'tool') {
        messages.push({ role: 'tool', content: msg.content })
      }
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages,
        tools: request.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.inputSchema }
        }))
      })
    })

    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`)
    }

    const data = (await res.json()) as {
      message: {
        content: string
        tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
      }
    }

    const toolCalls: ToolCallRequest[] = (data.message.tool_calls ?? []).map((c, i) => ({
      id: `${c.function.name}-${i}`,
      name: c.function.name,
      input: c.function.arguments
    }))

    return {
      text: data.message.content ?? '',
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end'
    }
  }
}
