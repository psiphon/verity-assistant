import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeAudioParam {
  value = 0
  setValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
}
class FakeAudioNode {
  connect = vi.fn()
}
class FakeOscillator extends FakeAudioNode {
  type = 'sine'
  frequency = new FakeAudioParam()
  start = vi.fn()
  stop = vi.fn()
}
class FakeGain extends FakeAudioNode {
  gain = new FakeAudioParam()
}
class FakeBiquadFilter extends FakeAudioNode {
  type = 'lowpass'
  frequency = new FakeAudioParam()
}
class FakeBufferSource extends FakeAudioNode {
  buffer: unknown
  start = vi.fn()
}
class FakeAudioBuffer {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number
  ) {}
  getChannelData(): Float32Array {
    return new Float32Array(this.length)
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  currentTime = 0
  sampleRate = 44100
  state: 'suspended' | 'running' = 'suspended'
  destination = new FakeAudioNode()
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  createOscillator = vi.fn(() => new FakeOscillator())
  createGain = vi.fn(() => new FakeGain())
  createBiquadFilter = vi.fn(() => new FakeBiquadFilter())
  createBuffer = vi.fn(
    (channels: number, length: number, sampleRate: number) =>
      new FakeAudioBuffer(channels, length, sampleRate)
  )
  createBufferSource = vi.fn(() => new FakeBufferSource())

  constructor() {
    FakeAudioContext.instances.push(this)
  }
}

beforeEach(() => {
  FakeAudioContext.instances = []
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('unlockAudio', () => {
  it('creates the context and resumes it when suspended', async () => {
    const { unlockAudio } = await import('./sfx')
    unlockAudio()
    const ctx = FakeAudioContext.instances[0]
    expect(ctx.resume).toHaveBeenCalled()
  })

  it('does not call resume again once already running', async () => {
    const { unlockAudio } = await import('./sfx')
    unlockAudio()
    const ctx = FakeAudioContext.instances[0]
    ctx.state = 'running'
    ctx.resume.mockClear()
    unlockAudio()
    expect(ctx.resume).not.toHaveBeenCalled()
  })
})

describe('playSfx', () => {
  it('resumes a suspended context before playing', async () => {
    const { playSfx } = await import('./sfx')
    playSfx('chime')
    const ctx = FakeAudioContext.instances[0]
    expect(ctx.resume).toHaveBeenCalled()
  })

  it.each(['chime', 'hum', 'stinger'] as const)(
    'creates and connects an oscillator/gain chain for %s',
    async (name) => {
      const { playSfx } = await import('./sfx')
      playSfx(name)
      const ctx = FakeAudioContext.instances[0]
      expect(ctx.createOscillator).toHaveBeenCalled()
      expect(ctx.createGain).toHaveBeenCalled()
      const osc = ctx.createOscillator.mock.results[0].value as FakeOscillator
      expect(osc.start).toHaveBeenCalled()
      expect(osc.stop).toHaveBeenCalled()
      expect(osc.connect).toHaveBeenCalled()
    }
  )

  it('builds a filtered noise burst for glitch instead of a tone', async () => {
    const { playSfx } = await import('./sfx')
    playSfx('glitch')
    const ctx = FakeAudioContext.instances[0]
    expect(ctx.createOscillator).not.toHaveBeenCalled()
    expect(ctx.createBufferSource).toHaveBeenCalled()
    expect(ctx.createBiquadFilter).toHaveBeenCalled()
    const source = ctx.createBufferSource.mock.results[0].value as FakeBufferSource
    expect(source.start).toHaveBeenCalled()
  })

  it('reuses the same AudioContext across multiple calls', async () => {
    const { playSfx } = await import('./sfx')
    playSfx('chime')
    playSfx('hum')
    expect(FakeAudioContext.instances).toHaveLength(1)
  })

  it('never throws even if the underlying Web Audio calls fail', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('no audio device')
        }
      }
    )
    const { playSfx } = await import('./sfx')
    expect(() => playSfx('chime')).not.toThrow()
  })
})
