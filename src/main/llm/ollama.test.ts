import { afterEach, describe, expect, it, vi } from 'vitest'
import { OllamaProvider } from './ollama'
import type { ChatMessage } from './types'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OllamaProvider', () => {
  it('defaults baseUrl and model when not given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: { content: 'hi' } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OllamaProvider({})
    await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/chat')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.model).toBe('llama3.1')
  })

  it('uses a custom baseUrl and model when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: { content: 'hi' } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OllamaProvider({ baseUrl: 'http://box:1234', model: 'mixtral' })
    await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(fetchMock.mock.calls[0][0]).toBe('http://box:1234/api/chat')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('mixtral')
  })

  it('converts a plain text reply with no tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ message: { content: 'Hello.' } }))
    )
    const provider = new OllamaProvider({})
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result).toEqual({ text: 'Hello.', toolCalls: [], stopReason: 'end' })
  })

  it('maps tool_calls into ToolCallRequests with a synthesized id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          message: {
            content: '',
            tool_calls: [{ function: { name: 'get_current_time', arguments: {} } }]
          }
        })
      )
    )
    const provider = new OllamaProvider({})
    const result = await provider.chat({ system: 'sys', messages: [], tools: [] })
    expect(result).toEqual({
      text: '',
      toolCalls: [{ id: 'get_current_time-0', name: 'get_current_time', input: {} }],
      stopReason: 'tool_use'
    })
  })

  it('builds the message list with system first and converts history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: { content: 'ok' } })))
    const provider = new OllamaProvider({})
    const history: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'checking',
        toolCalls: [{ id: 't1', name: 'get_current_time', input: { a: 1 } }]
      },
      { role: 'tool', toolCallId: 't1', name: 'get_current_time', content: 'noon' }
    ]
    await provider.chat({ system: 'sys prompt', messages: history, tools: [] })

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'checking',
        tool_calls: [{ function: { name: 'get_current_time', arguments: { a: 1 } } }]
      },
      { role: 'tool', content: 'noon' }
    ])
  })

  it('maps ToolDefinitions into the function-tool schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: { content: 'ok' } })))
    const provider = new OllamaProvider({})
    await provider.chat({
      system: 'sys',
      messages: [],
      tools: [{ name: 'get_weather', description: 'weather', inputSchema: { type: 'object' } }]
    })
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string)
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'get_weather', description: 'weather', parameters: { type: 'object' } }
      }
    ])
  })

  it('throws with the status and body text when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, false, 404)))
    const provider = new OllamaProvider({})
    await expect(provider.chat({ system: 'sys', messages: [], tools: [] })).rejects.toThrow(
      /Ollama request failed: 404/
    )
  })
})
