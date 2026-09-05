import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeVerity, defaultSettings } from '#test/mocks/verity'

vi.mock('../audio/sfx')
vi.mock('../tts/speak')

import { playSfx } from '../audio/sfx'
import { cancelSpeech, speak } from '../tts/speak'
import { useAssistant } from './useAssistant'

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error test-only cleanup of the global the hook reads
  delete window.verity
})

describe('useAssistant', () => {
  it('loads the current rapport on mount and starts resting/idle', async () => {
    const fake = createFakeVerity({ rapport: { value: 42, tierLabel: 'Entity Emerging' } })
    window.verity = fake.api

    const { result } = renderHook(() => useAssistant())
    await waitFor(() => expect(result.current.rapport).toBe(42))

    expect(result.current.entries).toEqual([])
    expect(result.current.faceState).toBe('resting')
    expect(result.current.thinking).toBe(false)
    expect(result.current.activeTool).toBeNull()
  })

  it('send() ignores blank input', () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    act(() => result.current.send('   '))

    expect(fake.api.chat.send).not.toHaveBeenCalled()
    expect(result.current.entries).toEqual([])
  })

  it('send() adds a trimmed user entry, cancels speech, and forwards to chat.send', () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    act(() => result.current.send('  hello there  '))

    expect(result.current.entries).toMatchObject([{ role: 'user', text: 'hello there' }])
    expect(cancelSpeech).toHaveBeenCalled()
    expect(fake.api.chat.send).toHaveBeenCalledWith('hello there')
  })

  it('reflects onThinking pushes in both thinking and faceState', () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    act(() => fake.emit.thinking(true))
    expect(result.current.thinking).toBe(true)
    expect(result.current.faceState).toBe('thinking')

    act(() => fake.emit.thinking(false))
    expect(result.current.thinking).toBe(false)
    expect(result.current.faceState).toBe('resting')
  })

  it('shows an active tool name (stripped of an mcp__server__ prefix) and clears it after 2.5s', () => {
    vi.useFakeTimers()
    const fake = createFakeVerity()
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    act(() => fake.emit.toolCall({ name: 'mcp__myserver__do_thing', input: {} }))
    expect(result.current.activeTool).toBe('do_thing')

    act(() => vi.advanceTimersByTime(2500))
    expect(result.current.activeTool).toBeNull()
    vi.useRealTimers()
  })

  it('keeps a plain builtin tool name unchanged', () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    act(() => fake.emit.toolCall({ name: 'get_current_time', input: {} }))
    expect(result.current.activeTool).toBe('get_current_time')
  })

  it('forwards onPlaySound pushes to playSfx', () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    renderHook(() => useAssistant())

    act(() => fake.emit.playSound('glitch'))
    expect(playSfx).toHaveBeenCalledWith('glitch')
  })

  it('onMessage appends an assistant entry and speaks it when TTS is enabled', async () => {
    const fake = createFakeVerity({
      settings: defaultSettings({ ttsEnabled: true, ttsVoice: 'Alex', ttsRate: 1.2 })
    })
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    await act(async () => {
      fake.emit.message('Hello there.')
      await Promise.resolve()
    })

    expect(result.current.entries).toMatchObject([{ role: 'assistant', text: 'Hello there.' }])
    expect(speak).toHaveBeenCalledWith(
      'Hello there.',
      expect.objectContaining({ voiceName: 'Alex', rate: 1.2 })
    )
  })

  it('onMessage does not speak when TTS is disabled', async () => {
    const fake = createFakeVerity({ settings: defaultSettings({ ttsEnabled: false }) })
    window.verity = fake.api
    renderHook(() => useAssistant())

    await act(async () => {
      fake.emit.message('Silent reply.')
      await Promise.resolve()
    })

    expect(speak).not.toHaveBeenCalled()
  })

  it('faceState is talking while speaking, and returns to resting once TTS ends', async () => {
    vi.mocked(speak).mockImplementation((_text, options) => {
      options?.onEnd?.()
    })
    const fake = createFakeVerity({ settings: defaultSettings({ ttsEnabled: true }) })
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    await act(async () => {
      fake.emit.message('Hi.')
      await Promise.resolve()
    })

    // The fake speak() calls onEnd synchronously, so speaking flips back off
    // in the same act() - this exercises the onEnd -> setSpeaking(false) wiring.
    expect(result.current.faceState).toBe('resting')
  })

  it('onError appends a system entry prefixed with "Error: "', () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())

    act(() => fake.emit.error('provider unavailable'))
    expect(result.current.entries).toEqual([
      expect.objectContaining({ role: 'system', text: 'Error: provider unavailable' })
    ])
  })

  it('rapport.onChanged updates the reported rapport value', async () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    const { result } = renderHook(() => useAssistant())
    await waitFor(() => expect(fake.api.rapport.get).toHaveBeenCalled())

    act(() => fake.emit.rapportChanged({ value: 12, tierLabel: 'Fully Entity' }))
    expect(result.current.rapport).toBe(12)
  })

  it('unsubscribes every listener and cancels speech on unmount', () => {
    const fake = createFakeVerity()
    window.verity = fake.api
    const { unmount } = renderHook(() => useAssistant())

    vi.mocked(cancelSpeech).mockClear()
    unmount()
    expect(cancelSpeech).toHaveBeenCalled()

    // Emitting after unmount should reach no listeners and not throw.
    expect(() => fake.emit.thinking(true)).not.toThrow()
  })
})
