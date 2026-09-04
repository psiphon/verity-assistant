export interface SpeakOptions {
  voiceName?: string
  rate?: number
  onStart?: () => void
  onEnd?: () => void
}

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!isTtsSupported()) return []
  return window.speechSynthesis.getVoices()
}

export function speak(text: string, options: SpeakOptions = {}): void {
  if (!isTtsSupported() || !text.trim()) {
    options.onEnd?.()
    return
  }

  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
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

export function cancelSpeech(): void {
  if (isTtsSupported()) window.speechSynthesis.cancel()
}
