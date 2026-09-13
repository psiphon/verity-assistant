import { useCallback, useRef, useState } from 'react'

// The Web Speech API isn't part of TypeScript's bundled DOM lib (it's a
// Chromium-only API, never standardized past a draft), so the handful of
// members actually used here are declared by hand rather than pulled in
// from a full type-only dependency.
interface SpeechRecognitionResultLike {
  0: { transcript: string }
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

export interface UseSpeechRecognition {
  /** False when the browser has neither SpeechRecognition nor the
   * webkit-prefixed variant - callers should hide the mic button entirely
   * rather than show one that can never work. */
  supported: boolean
  listening: boolean
  start: () => void
  stop: () => void
}

/** Push-to-talk, not always-on: `start()` begins listening for a single
 * utterance and calls `onResult` once with the transcript, mirroring how a
 * user would type-then-send rather than dictating continuously. */
export function useSpeechRecognition(onResult: (text: string) => void): UseSpeechRecognition {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const Ctor =
    typeof window !== 'undefined'
      ? (window.SpeechRecognition ?? window.webkitSpeechRecognition)
      : undefined
  const supported = Boolean(Ctor)

  const start = useCallback(() => {
    if (!Ctor || listening) return
    const recognition = new Ctor()
    recognition.lang = navigator.language || 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim()
      if (text) onResult(text)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }, [Ctor, listening, onResult])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  return { supported, listening, start, stop }
}
