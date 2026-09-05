import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelSpeech, isTtsSupported, listVoices, speak } from './speak'

class FakeUtterance {
  rate = 1
  voice: unknown = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public text: string) {}
}

function fakeVoice(name: string): SpeechSynthesisVoice {
  return { name } as SpeechSynthesisVoice
}

let fakeSynth: {
  cancel: ReturnType<typeof vi.fn>
  speak: ReturnType<typeof vi.fn>
  getVoices: ReturnType<typeof vi.fn>
}

function stubSpeechSynthesis(voices: SpeechSynthesisVoice[] = []): void {
  fakeSynth = { cancel: vi.fn(), speak: vi.fn(), getVoices: vi.fn(() => voices) }
  vi.stubGlobal('speechSynthesis', fakeSynth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isTtsSupported / listVoices', () => {
  it('is unsupported when speechSynthesis is not present', () => {
    expect(isTtsSupported()).toBe(false)
    expect(listVoices()).toEqual([])
  })

  it('is supported once speechSynthesis is present, and lists its voices', () => {
    stubSpeechSynthesis([fakeVoice('Alex'), fakeVoice('Samantha')])
    expect(isTtsSupported()).toBe(true)
    expect(listVoices().map((v) => v.name)).toEqual(['Alex', 'Samantha'])
  })
})

describe('speak', () => {
  beforeEach(() => stubSpeechSynthesis([fakeVoice('Alex'), fakeVoice('Samantha')]))

  it('calls onEnd immediately without speaking when text is empty/whitespace', () => {
    const onEnd = vi.fn()
    speak('   ', { onEnd })
    expect(onEnd).toHaveBeenCalled()
    expect(fakeSynth.speak).not.toHaveBeenCalled()
  })

  it('calls onEnd immediately when TTS is unsupported', () => {
    vi.unstubAllGlobals()
    const onEnd = vi.fn()
    speak('hello', { onEnd })
    expect(onEnd).toHaveBeenCalled()
  })

  it('cancels any prior speech before starting new speech', () => {
    speak('hello there')
    expect(fakeSynth.cancel).toHaveBeenCalled()
    expect(fakeSynth.speak).toHaveBeenCalledTimes(1)
  })

  it('defaults the rate to 1 and applies a custom rate when given', () => {
    speak('hello', {})
    const first = fakeSynth.speak.mock.calls[0][0] as FakeUtterance
    expect(first.rate).toBe(1)

    speak('hello', { rate: 1.5 })
    const second = fakeSynth.speak.mock.calls[1][0] as FakeUtterance
    expect(second.rate).toBe(1.5)
  })

  it('selects a matching voice by name when it exists', () => {
    speak('hello', { voiceName: 'Samantha' })
    const utterance = fakeSynth.speak.mock.calls[0][0] as FakeUtterance
    expect((utterance.voice as SpeechSynthesisVoice).name).toBe('Samantha')
  })

  it('leaves the voice unset when the requested name does not match any voice', () => {
    speak('hello', { voiceName: 'Nonexistent' })
    const utterance = fakeSynth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.voice).toBeNull()
  })

  it('wires onStart/onEnd through the utterance event handlers', () => {
    const onStart = vi.fn()
    const onEnd = vi.fn()
    speak('hello', { onStart, onEnd })
    const utterance = fakeSynth.speak.mock.calls[0][0] as FakeUtterance

    utterance.onstart?.()
    expect(onStart).toHaveBeenCalled()

    utterance.onend?.()
    expect(onEnd).toHaveBeenCalled()
  })

  it('treats an utterance error as the end of speech', () => {
    const onEnd = vi.fn()
    speak('hello', { onEnd })
    const utterance = fakeSynth.speak.mock.calls[0][0] as FakeUtterance
    utterance.onerror?.()
    expect(onEnd).toHaveBeenCalled()
  })
})

describe('cancelSpeech', () => {
  it('cancels when supported', () => {
    stubSpeechSynthesis()
    cancelSpeech()
    expect(fakeSynth.cancel).toHaveBeenCalled()
  })

  it('is a harmless no-op when unsupported', () => {
    expect(() => cancelSpeech()).not.toThrow()
  })
})
