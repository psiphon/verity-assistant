import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSpeechRecognition } from './useSpeech'

class FakeSpeechRecognition extends EventTarget {
  static instances: FakeSpeechRecognition[] = []
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null = null
  onerror: (() => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  constructor() {
    super()
    FakeSpeechRecognition.instances.push(this)
  }
}

afterEach(() => {
  FakeSpeechRecognition.instances.length = 0
  delete window.SpeechRecognition
})

describe('useSpeechRecognition', () => {
  it('reports unsupported when neither constructor exists on window', () => {
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))
    expect(result.current.supported).toBe(false)
  })

  it('reports supported and starts/stops a recognition session', () => {
    window.SpeechRecognition = FakeSpeechRecognition as unknown as typeof window.SpeechRecognition
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))
    expect(result.current.supported).toBe(true)

    act(() => result.current.start())
    expect(FakeSpeechRecognition.instances[0].start).toHaveBeenCalled()
    expect(result.current.listening).toBe(true)

    act(() => result.current.stop())
    expect(FakeSpeechRecognition.instances[0].stop).toHaveBeenCalled()
  })

  it('calls onResult with the trimmed transcript and stops listening on end', () => {
    window.SpeechRecognition = FakeSpeechRecognition as unknown as typeof window.SpeechRecognition
    const onResult = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(onResult))

    act(() => result.current.start())
    const recognition = FakeSpeechRecognition.instances[0]
    act(() => recognition.onresult?.({ results: [{ 0: { transcript: '  hi there  ' } }] }))
    expect(onResult).toHaveBeenCalledWith('hi there')

    act(() => recognition.onend?.())
    expect(result.current.listening).toBe(false)
  })

  it('does nothing when start is called while already listening', () => {
    window.SpeechRecognition = FakeSpeechRecognition as unknown as typeof window.SpeechRecognition
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => result.current.start())
    act(() => result.current.start())
    expect(FakeSpeechRecognition.instances).toHaveLength(1)
  })
})
