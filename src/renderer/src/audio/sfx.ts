export type SfxName = 'chime' | 'glitch' | 'hum' | 'stinger'

let ctx: AudioContext | null = null

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

/** Browsers (Electron included) create AudioContext in a "suspended" state
 * until resumed from within a user gesture, and sounds scheduled while
 * suspended never audibly play (no error, nothing - just silence). Tool-call
 * sounds arrive asynchronously after the LLM round-trip, well outside the
 * click/keydown that sent the message, so call this synchronously from
 * within the actual gesture handler (e.g. the send button's onClick) to
 * unlock playback before that reply comes back. */
export function unlockAudio(): void {
  const audio = getContext()
  if (audio.state === 'suspended') void audio.resume()
}

/** All effects are synthesized (no audio files to ship/license) - short and
 * cheap, meant as punctuation for a reaction, not a music bed. */
export function playSfx(name: SfxName): void {
  try {
    const audio = getContext()
    if (audio.state === 'suspended') void audio.resume()
    const now = audio.currentTime
    switch (name) {
      case 'chime':
        tone(audio, now, [660, 880], 0.5, 'sine')
        break
      case 'glitch':
        noiseBurst(audio, now, 0.22)
        break
      case 'hum':
        tone(audio, now, [80, 84], 1.1, 'sawtooth', 0.12)
        break
      case 'stinger':
        tone(audio, now, [220, 110], 0.35, 'square', 0.18)
        break
    }
  } catch {
    // best-effort - autoplay restrictions or no audio device shouldn't crash the app
  }
}

function tone(
  audio: AudioContext,
  start: number,
  freqs: number[],
  duration: number,
  type: OscillatorType,
  gainLevel = 0.2
): void {
  freqs.forEach((freq, i) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    const t0 = start + i * 0.05
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(gainLevel, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
    osc.connect(gain)
    gain.connect(audio.destination)
    osc.start(t0)
    osc.stop(t0 + duration + 0.05)
  })
}

function noiseBurst(audio: AudioContext, start: number, duration: number): void {
  const bufferSize = Math.floor(audio.sampleRate * duration)
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
  }
  const source = audio.createBufferSource()
  source.buffer = buffer
  const filter = audio.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1800
  const gain = audio.createGain()
  gain.gain.setValueAtTime(0.25, start)
  source.connect(filter)
  filter.connect(gain)
  gain.connect(audio.destination)
  source.start(start)
}
