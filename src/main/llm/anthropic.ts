import Anthropic from '@anthropic-ai/sdk'
import type { ChatRequest, ChatResult, LLMProvider, ProviderConfig, ToolCallRequest } from './types'

const DEFAULT_MODEL = 'claude-sonnet-4-5'

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic'
  private client: Anthropic
  private model: string

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })
    this.model = config.model || DEFAULT_MODEL
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const messages: Anthropic.MessageParam[] = []

    for (const msg of request.messages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        const blocks: Anthropic.ContentBlockParam[] = []
        if (msg.content) blocks.push({ type: 'text', text: msg.content })
        for (const call of msg.toolCalls ?? []) {
          blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
        }
        messages.push({ role: 'assistant', content: blocks })
      } else if (msg.role === 'tool') {
        const content: Anthropic.ToolResultBlockParam['content'] = msg.image
          ? [
              ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: msg.image.mediaType as Anthropic.Base64ImageSource['media_type'],
                  data: msg.image.base64
                }
              }
            ]
          : msg.content
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.toolCallId, content }]
        })
      }
    }

    const params = {
      model: this.model,
      max_tokens: 1024,
      system: request.system,
      messages,
      tools: request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema
      }))
    }

    let response: Anthropic.Message
    if (request.onTextDelta) {
      const stream = this.client.messages.stream(params)
      stream.on('text', (delta) => request.onTextDelta!(delta))
      response = await stream.finalMessage()
    } else {
      response = await this.client.messages.create(params)
    }

    let text = ''
    const toolCalls: ToolCallRequest[] = []
    for (const block of response.content) {
      if (block.type === 'text') text += block.text
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>
        })
      }
    }

    return {
      text,
      toolCalls,
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end'
    }
  }
}
