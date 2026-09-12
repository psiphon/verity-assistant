import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelSpeech, isTtsSupported, listVoices, speak } from './speak'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

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

  it('strips emoji, symbols and stray markdown from the spoken text', () => {
    speak('Hello there 👋🏽 — *so* nice to see you 🙂', {})
    const utterance = fakeSynth.speak.mock.calls[0][0] as FakeUtterance
    expect(utterance.text).toBe('Hello there — so nice to see you')
  })

  it('does not speak when the text is nothing but emoji', () => {
    const onEnd = vi.fn()
    speak('🎉🎉🎉', { onEnd })
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

describe('speak - fish engine', () => {
  class FakeBufferSource {
    buffer: unknown = null
    playbackRate = { value: 1 }
    onended: (() => void) | null = null
    connect = vi.fn()
    start = vi.fn()
    stop = vi.fn()
  }
  let sources: FakeBufferSource[]
  let decodeAudioData: ReturnType<typeof vi.fn>
  let synthesize: ReturnType<typeof vi.fn>
  // speak.ts keeps a module-level AudioContext, so reload the module per test
  // to stop one test's fake context leaking into the next.
  let speak: typeof import('./speak').speak
  let cancelSpeech: typeof import('./speak').cancelSpeech

  beforeEach(async () => {
    vi.resetModules()
    stubSpeechSynthesis([fakeVoice('Alex')])
    sources = []
    decodeAudioData = vi.fn(async () => ({ duration: 1 }))
    const decode = decodeAudioData
    class FakeAudioContext {
      state: 'suspended' | 'running' = 'running'
      destination = {}
      resume = vi.fn(async () => {})
      decodeAudioData = decode
      createBufferSource = vi.fn(() => {
        const s = new FakeBufferSource()
        sources.push(s)
        return s
      })
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    synthesize = vi.fn(async () => ({ format: 'wav', data: new Uint8Array([1, 2, 3, 4]) }))
    vi.stubGlobal('verity', { tts: { synthesize } })
    ;({ speak, cancelSpeech } = await import('./speak'))
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('sends the stripped text to the main-process synthesizer', async () => {
    speak('Hello 👋 *there*', { engine: 'fish' })
    await flush()
    expect(synthesize).toHaveBeenCalledWith('Hello there')
  })

  it('decodes and plays the returned audio, wiring onStart/onEnd and rate', async () => {
    const onStart = vi.fn()
    const onEnd = vi.fn()
    speak('hello', { engine: 'fish', rate: 1.5, onStart, onEnd })
    await flush()

    expect(decodeAudioData).toHaveBeenCalled()
    expect(sources).toHaveLength(1)
    expect(sources[0].playbackRate.value).toBe(1.5)
    expect(sources[0].start).toHaveBeenCalled()
    expect(onStart).toHaveBeenCalled()

    expect(onEnd).not.toHaveBeenCalled()
    sources[0].onended?.()
    expect(onEnd).toHaveBeenCalled()
  })

  it('falls back to the system voice when synthesis returns null', async () => {
    synthesize.mockResolvedValueOnce(null)
    const onEnd = vi.fn()
    speak('hello', { engine: 'fish', onEnd })
    await flush()

    expect(fakeSynth.speak).toHaveBeenCalledTimes(1)
    expect(sources).toHaveLength(0)
  })

  it('falls back to the system voice when the synthesizer throws', async () => {
    synthesize.mockRejectedValueOnce(new Error('offline'))
    speak('hello', { engine: 'fish' })
    await flush()
    expect(fakeSynth.speak).toHaveBeenCalledTimes(1)
  })

  it('falls back to the system voice when decoding fails', async () => {
    decodeAudioData.mockRejectedValueOnce(new Error('bad audio'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    speak('hello', { engine: 'fish' })
    await flush()
    expect(fakeSynth.speak).toHaveBeenCalledTimes(1)
  })

  it('cancelSpeech stops an in-progress fish playback', async () => {
    speak('hello', { engine: 'fish' })
    await flush()
    expect(sources).toHaveLength(1)

    cancelSpeech()
    expect(sources[0].stop).toHaveBeenCalled()
  })

  it('does not hit the synthesizer at all for empty text', async () => {
    const onEnd = vi.fn()
    speak('   ', { engine: 'fish', onEnd })
    await flush()
    expect(synthesize).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalled()
  })
})
