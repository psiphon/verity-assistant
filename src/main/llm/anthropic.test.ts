import { describe, expect, it, vi } from 'vitest'

const { create, constructorCalls, MockAnthropic } = vi.hoisted(() => {
  const create = vi.fn()
  const constructorCalls: unknown[] = []
  class MockAnthropic {
    messages = { create }
    constructor(config: unknown) {
      constructorCalls.push(config)
    }
  }
  return { create, constructorCalls, MockAnthropic }
})
vi.mock('@anthropic-ai/sdk', () => ({ default: MockAnthropic }))

import { AnthropicProvider } from './anthropic'
import type { ChatMessage } from './types'

describe('AnthropicProvider', () => {
  it('passes apiKey/baseUrl through to the SDK client and defaults the model', () => {
    new AnthropicProvider({ apiKey: 'k', baseUrl: 'https://custom' })
    expect(constructorCalls).toEqual([{ apiKey: 'k', baseURL: 'https://custom' }])
  })

  it('converts a plain text reply with no tool use', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'Hello there.' }],
      stop_reason: 'end_turn'
    })
    const provider = new AnthropicProvider({ apiKey: 'k' })
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result).toEqual({ text: 'Hello there.', toolCalls: [], stopReason: 'end' })
  })

  it('maps a tool_use content block into a ToolCallRequest and reports stopReason tool_use', async () => {
    create.mockResolvedValue({
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_current_time', input: {} }
      ],
      stop_reason: 'tool_use'
    })
    const provider = new AnthropicProvider({ apiKey: 'k' })
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result).toEqual({
      text: 'Let me check.',
      toolCalls: [{ id: 'toolu_1', name: 'get_current_time', input: {} }],
      stopReason: 'tool_use'
    })
  })

  it('converts user, assistant-with-tool-calls, and tool messages into Anthropic shape', async () => {
    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    const provider = new AnthropicProvider({ apiKey: 'k' })

    const history: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'checking',
        toolCalls: [{ id: 't1', name: 'get_current_time', input: {} }]
      },
      { role: 'tool', toolCallId: 't1', name: 'get_current_time', content: 'noon' }
    ]

    await provider.chat({ system: 'sys', messages: history, tools: [] })

    const request = create.mock.calls[0][0]
    expect(request.messages).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'checking' },
          { type: 'tool_use', id: 't1', name: 'get_current_time', input: {} }
        ]
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'noon' }] }
    ])
  })

  it('omits the text block for an assistant turn with empty content', async () => {
    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    const provider = new AnthropicProvider({ apiKey: 'k' })
    await provider.chat({
      system: 'sys',
      messages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'x', input: {} }] }
      ],
      tools: []
    })
    const request = create.mock.calls[0][0]
    expect(request.messages[0].content).toEqual([
      { type: 'tool_use', id: 't1', name: 'x', input: {} }
    ])
  })

  it('maps ToolDefinitions into Anthropic tool schema', async () => {
    create.mockResolvedValue({ content: [], stop_reason: 'end_turn' })
    const provider = new AnthropicProvider({ apiKey: 'k' })
    await provider.chat({
      system: 'sys',
      messages: [],
      tools: [{ name: 'get_weather', description: 'weather', inputSchema: { type: 'object' } }]
    })
    const request = create.mock.calls[0][0]
    expect(request.tools).toEqual([
      { name: 'get_weather', description: 'weather', input_schema: { type: 'object' } }
    ])
    expect(request.system).toBe('sys')
  })
})
