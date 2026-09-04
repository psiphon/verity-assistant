import { useCallback, useEffect, useState } from 'react'
import type { FaceState } from '../face/faceAtlas'
import { cancelSpeech, speak } from '../tts/speak'
import { playSfx } from '../audio/sfx'
import type { SfxName } from '../audio/sfx'

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
}

export function useAssistant(): {
  entries: ChatEntry[]
  faceState: FaceState
  rapport: number
  thinking: boolean
  activeTool: string | null
  send: (text: string) => void
} {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [thinking, setThinking] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [rapport, setRapport] = useState(100)
  const [activeTool, setActiveTool] = useState<string | null>(null)

  useEffect(() => {
    window.verity.rapport.get().then((r) => setRapport(r.value))

    const offThinking = window.verity.chat.onThinking(setThinking)
    const offRapport = window.verity.rapport.onChanged((r) => setRapport(r.value))
    const offToolCall = window.verity.chat.onToolCall((call) => {
      setActiveTool(call.name.replace(/^mcp__[^_]+__/, ''))
      window.setTimeout(() => setActiveTool(null), 2500)
    })
    const offPlaySound = window.verity.chat.onPlaySound((name) => playSfx(name as SfxName))
    const offMessage = window.verity.chat.onMessage(async (text) => {
      setEntries((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text }])
      // Fetched fresh each time (not cached) so a voice/rate change saved in
      // Settings takes effect on the very next reply.
      const settings = await window.verity.settings.get()
      if (settings.ttsEnabled) {
        setSpeaking(true)
        speak(text, {
          voiceName: settings.ttsVoice,
          rate: settings.ttsRate,
          onEnd: () => setSpeaking(false)
        })
      }
    })
    const offError = window.verity.chat.onError((message) => {
      setEntries((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'system', text: `Error: ${message}` }
      ])
    })

    return () => {
      offThinking()
      offRapport()
      offToolCall()
      offPlaySound()
      offMessage()
      offError()
      cancelSpeech()
    }
  }, [])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setEntries((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }])
    cancelSpeech()
    setSpeaking(false)
    window.verity.chat.send(trimmed)
  }, [])

  const faceState: FaceState = thinking ? 'thinking' : speaking ? 'talking' : 'resting'

  return { entries, faceState, rapport, thinking, activeTool, send }
}
