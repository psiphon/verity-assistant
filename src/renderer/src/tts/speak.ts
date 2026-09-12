import type { TtsAudio, TtsEngine } from '@shared/types'

export interface SpeakOptions {
  /** Which backend to use. Defaults to the system `speechSynthesis` voices. */
  engine?: TtsEngine
  /** System-voice name (ignored by the 'fish' engine). */
  voiceName?: string
  /** Playback speed multiplier - honored by both engines. */
  rate?: number
  onStart?: () => void
  onEnd?: () => void
}

// The reply text is written for the ear but also shown in the window. A voice
// synth either reads emoji/symbols out by name ("thumbs up sign") or chokes on
// them, so strip pictographs and stray markdown before speaking. Display keeps
// the original. Any zero-width joiners / selectors left behind by a stripped
// emoji sequence are silent, so they don't matter.
function stripUnspeakable(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/gv, '')
    .replace(/[*_`~]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim()
}

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!isTtsSupported()) return []
  return window.speechSynthesis.getVoices()
}

export function speak(text: string, options: SpeakOptions = {}): void {
  const spoken = stripUnspeakable(text)
  if (!spoken) {
    options.onEnd?.()
    return
  }

  if (options.engine === 'fish') {
    // Stop whatever's currently playing (either engine) before the async
    // fetch, same as the system path cancels prior speech synchronously.
    cancelSpeech()
    void speakWithFishAudio(spoken, options)
    return
  }

  speakWithSystemVoice(spoken, options)
}

function speakWithSystemVoice(spoken: string, options: SpeakOptions): void {
  if (!isTtsSupported()) {
    options.onEnd?.()
    return
  }

  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(spoken)
  utterance.rate = options.rate ?? 1

  if (options.voiceName) {
    const voice = listVoices().find((v) => v.name === options.voiceName)
    if (voice) utterance.voice = voice
  }

  utterance.onstart = () => options.onStart?.()
  utterance.onend = () => options.onEnd?.()
  utterance.onerror = () => options.onEnd?.()

  window.speechSynthesis.speak(utterance)
}

// --- Fish Audio (self-hosted fish-speech server, proxied through main) -------

let fishCtx: AudioContext | null = null
let currentFishSource: AudioBufferSourceNode | null = null

function stopFishAudio(): void {
  if (!currentFishSource) return
  try {
    currentFishSource.onended = null
    currentFishSource.stop()
  } catch {
    // already stopped / never started - nothing to do
  }
  currentFishSource = null
}

async function speakWithFishAudio(spoken: string, options: SpeakOptions): Promise<void> {
  let audio: TtsAudio | null = null
  try {
    audio = await window.verity.tts.synthesize(spoken)
  } catch {
    audio = null
  }

  // Server unreachable, disabled, or errored: don't leave Verity mute - read
  // it with the system voice instead.
  if (!audio || !audio.data || audio.data.byteLength === 0) {
    speakWithSystemVoice(spoken, options)
    return
  }

  try {
    fishCtx ??= new AudioContext()
    if (fishCtx.state === 'suspended') await fishCtx.resume()

    // decodeAudioData wants a standalone ArrayBuffer; copy the view's slice out
    // (it may be a partial view over a larger transferred buffer).
    const view = audio.data
    const arrayBuffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    const decoded = await fishCtx.decodeAudioData(arrayBuffer as ArrayBuffer)

    stopFishAudio()
    const source = fishCtx.createBufferSource()
    source.buffer = decoded
    source.playbackRate.value = options.rate ?? 1
    source.connect(fishCtx.destination)
    currentFishSource = source
    source.onended = () => {
      if (currentFishSource === source) currentFishSource = null
      options.onEnd?.()
    }
    options.onStart?.()
    source.start()
  } catch (err) {
    console.error('[fish-audio] playback failed, falling back to system voice', err)
    speakWithSystemVoice(spoken, options)
  }
}

export function cancelSpeech(): void {
  if (isTtsSupported()) window.speechSynthesis.cancel()
  stopFishAudio()
}
