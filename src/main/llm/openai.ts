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
        // OpenAI's tool-message content type is text-only (no image parts) -
        // a synthetic follow-up user message is the standard workaround for
        // handing a tool-produced image to a vision-capable model.
        if (msg.image) {
          messages.push({
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${msg.image.mediaType};base64,${msg.image.base64}` }
              }
            ]
          })
        }
      }
    }

    const tools = request.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema }
    }))

    if (request.onTextDelta) {
      return this.chatStreaming(messages, tools, request.onTextDelta)
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools
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

  private async chatStreaming(
    messages: OpenAI.ChatCompletionMessageParam[],
    tools: OpenAI.ChatCompletionTool[],
    onTextDelta: (chunk: string) => void
  ): Promise<ChatResult> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools,
      stream: true
    })

    let text = ''
    // Tool-call argument fragments arrive as partial JSON strings, keyed by
    // their position in the response (not by id, which may only appear on
    // the first fragment) - concatenated per index, then parsed once the
    // stream ends.
    const pending = new Map<number, { id?: string; name?: string; args: string }>()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      if (delta.content) {
        text += delta.content
        onTextDelta(delta.content)
      }
      for (const toolCall of delta.tool_calls ?? []) {
        const entry = pending.get(toolCall.index) ?? { args: '' }
        if (toolCall.id) entry.id = toolCall.id
        if (toolCall.function?.name) entry.name = toolCall.function.name
        if (toolCall.function?.arguments) entry.args += toolCall.function.arguments
        pending.set(toolCall.index, entry)
      }
    }

    const toolCalls: ToolCallRequest[] = [...pending.values()]
      .filter((e): e is { id: string; name: string; args: string } => Boolean(e.id && e.name))
      .map((e) => ({ id: e.id, name: e.name, input: safeParse(e.args) }))

    return { text, toolCalls, stopReason: toolCalls.length > 0 ? 'tool_use' : 'end' }
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}
