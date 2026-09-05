import { describe, expect, it, vi } from 'vitest'

const { create, constructorCalls, MockOpenAI } = vi.hoisted(() => {
  const create = vi.fn()
  const constructorCalls: unknown[] = []
  class MockOpenAI {
    chat = { completions: { create } }
    constructor(config: unknown) {
      constructorCalls.push(config)
    }
  }
  return { create, constructorCalls, MockOpenAI }
})
vi.mock('openai', () => ({ default: MockOpenAI }))

import { OpenAIProvider } from './openai'
import type { ChatMessage } from './types'

function response(message: Record<string, unknown>): unknown {
  return { choices: [{ message }] }
}

describe('OpenAIProvider', () => {
  it('uses an empty apiKey when none is given and no baseUrl either', () => {
    new OpenAIProvider({})
    expect(constructorCalls).toEqual([{ apiKey: '', baseURL: undefined }])
  })

  it('substitutes a placeholder apiKey only when a custom baseUrl is set', () => {
    constructorCalls.length = 0
    new OpenAIProvider({ baseUrl: 'http://localhost:8080/v1' })
    expect(constructorCalls).toEqual([
      { apiKey: 'not-needed', baseURL: 'http://localhost:8080/v1' }
    ])
  })

  it('keeps a real apiKey even when a baseUrl is also set', () => {
    constructorCalls.length = 0
    new OpenAIProvider({ apiKey: 'sk-real', baseUrl: 'http://localhost:8080/v1' })
    expect(constructorCalls).toEqual([{ apiKey: 'sk-real', baseURL: 'http://localhost:8080/v1' }])
  })

  it('converts a plain text reply with no tool calls', async () => {
    create.mockResolvedValue(response({ content: 'Hello there.' }))
    const provider = new OpenAIProvider({ apiKey: 'k' })
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result).toEqual({ text: 'Hello there.', toolCalls: [], stopReason: 'end' })
  })

  it('treats a null content as empty text', async () => {
    create.mockResolvedValue(response({ content: null }))
    const provider = new OpenAIProvider({ apiKey: 'k' })
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result.text).toBe('')
  })

  it('maps function tool_calls into ToolCallRequests and parses arguments', async () => {
    create.mockResolvedValue(
      response({
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'get_current_time', arguments: '{}' } }
        ]
      })
    )
    const provider = new OpenAIProvider({ apiKey: 'k' })
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result).toEqual({
      text: '',
      toolCalls: [{ id: 'c1', name: 'get_current_time', input: {} }],
      stopReason: 'tool_use'
    })
  })

  it('falls back to an empty object for malformed tool call arguments', async () => {
    create.mockResolvedValue(
      response({
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: 'not json' } }]
      })
    )
    const provider = new OpenAIProvider({ apiKey: 'k' })
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result.toolCalls[0].input).toEqual({})
  })

  it('ignores non-function tool call types', async () => {
    create.mockResolvedValue(
      response({ content: 'ok', tool_calls: [{ id: 'c1', type: 'custom' }] })
    )
    const provider = new OpenAIProvider({ apiKey: 'k' })
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result.toolCalls).toEqual([])
  })

  it('puts the system prompt first and converts user/assistant/tool history', async () => {
    create.mockResolvedValue(response({ content: 'ok' }))
    const provider = new OpenAIProvider({ apiKey: 'k' })
    const history: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'get_current_time', input: { a: 1 } }]
      },
      { role: 'tool', toolCallId: 't1', name: 'get_current_time', content: 'noon' }
    ]
    await provider.chat({ system: 'sys prompt', messages: history, tools: [] })

    const request = create.mock.calls[0][0]
    expect(request.messages).toEqual([
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 't1',
            type: 'function',
            function: { name: 'get_current_time', arguments: '{"a":1}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 't1', content: 'noon' }
    ])
  })

  it('maps ToolDefinitions into OpenAI function-tool schema', async () => {
    create.mockResolvedValue(response({ content: 'ok' }))
    const provider = new OpenAIProvider({ apiKey: 'k' })
    await provider.chat({
      system: 'sys',
      messages: [],
      tools: [{ name: 'get_weather', description: 'weather', inputSchema: { type: 'object' } }]
    })
    const request = create.mock.calls[0][0]
    expect(request.tools).toEqual([
      {
        type: 'function',
        function: { name: 'get_weather', description: 'weather', parameters: { type: 'object' } }
      }
    ])
  })
})
