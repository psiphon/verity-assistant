import OpenAI from 'openai'
import type { ChatRequest, ChatResult, LLMProvider, ProviderConfig, ToolCallRequest } from './types'

const DEFAULT_MODEL = 'gpt-4.1'

export class OpenAIProvider implements LLMProvider {
  readonly id = 'openai'
  private client: OpenAI
  private model: string

  constructor(config: ProviderConfig) {
    // Local/self-hosted OpenAI-compatible servers (llama.cpp, LM Studio, vLLM)
    // usually don't check the key, but the SDK still requires a non-empty
    // string to be present - only a custom baseUrl gets this free pass.
    const apiKey = config.apiKey || (config.baseUrl ? 'not-needed' : '')
    this.client = new OpenAI({ apiKey, baseURL: config.baseUrl })
    this.model = config.model || DEFAULT_MODEL
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: request.system }
    ]

    for (const msg of request.messages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls?.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input) }
          }))
        })
      } else if (msg.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: msg.toolCallId, content: msg.content })
      }
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema }
      }))
    })

    const choice = response.choices[0]
    const toolCalls: ToolCallRequest[] = (choice.message.tool_calls ?? [])
      .filter((c): c is OpenAI.ChatCompletionMessageFunctionToolCall => c.type === 'function')
      .map((c) => ({
        id: c.id,
        name: c.function.name,
        input: safeParse(c.function.arguments)
      }))

    return {
      text: choice.message.content ?? '',
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end'
    }
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}
