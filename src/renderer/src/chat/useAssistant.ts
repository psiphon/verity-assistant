import { useCallback, useEffect, useState } from 'react'
import type { TranscriptEntry } from '@shared/types'
import type { FaceState } from '../face/faceAtlas'
import { cancelSpeech, speak } from '../tts/speak'
import { playSfx } from '../audio/sfx'
import type { SfxName } from '../audio/sfx'

export type { TranscriptEntry as ChatEntry } from '@shared/types'

function newEntry(role: TranscriptEntry['role'], text: string): TranscriptEntry {
  return { id: crypto.randomUUID(), role, text, createdAt: new Date().toISOString() }
}

export function useAssistant(): {
  entries: TranscriptEntry[]
  faceState: FaceState
  rapport: number
  thinking: boolean
  activeTool: string | null
  send: (text: string) => void
} {
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [thinking, setThinking] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [rapport, setRapport] = useState(100)
  const [activeTool, setActiveTool] = useState<string | null>(null)

  useEffect(() => {
    window.verity.rapport.get().then((r) => setRapport(r.value))
    // Rehydrates the scrollback from disk so a restart doesn't wipe the
    // visible conversation, even though a fresh agent turn still starts
    // from the (separately persisted) working history in the main process.
    // Guarded so this cold-start fetch can never clobber a live message that
    // already arrived while it was in flight.
    window.verity.conversation.get().then((seeded) => {
      setEntries((prev) => (prev.length > 0 ? prev : seeded))
    })

    const offThinking = window.verity.chat.onThinking(setThinking)
    const offRapport = window.verity.rapport.onChanged((r) => setRapport(r.value))
    const offToolCall = window.verity.chat.onToolCall((call) => {
      setActiveTool(call.name.replace(/^mcp__[^_]+__/, ''))
      window.setTimeout(() => setActiveTool(null), 2500)
    })
    const offPlaySound = window.verity.chat.onPlaySound((name) => playSfx(name as SfxName))
    const offMessage = window.verity.chat.onMessage(async (text) => {
      setEntries((prev) => [...prev, newEntry('assistant', text)])
      // Fetched fresh each time (not cached) so a voice/rate change saved in
      // Settings takes effect on the very next reply.
      const settings = await window.verity.settings.get()
      if (settings.ttsEnabled) {
        setSpeaking(true)
        speak(text, {
          engine: settings.ttsEngine,
          voiceName: settings.ttsVoice,
          rate: settings.ttsRate,
          onEnd: () => setSpeaking(false)
        })
      }
    })
    const offError = window.verity.chat.onError((message) => {
      setEntries((prev) => [...prev, newEntry('system', `Error: ${message}`)])
    })
    const offConversationCleared = window.verity.conversation.onCleared(() => setEntries([]))

    return () => {
      offThinking()
      offRapport()
      offToolCall()
      offPlaySound()
      offMessage()
      offError()
      offConversationCleared()
      cancelSpeech()
    }
  }, [])

  const send = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setEntries((prev) => [...prev, newEntry('user', trimmed)])
    cancelSpeech()
    setSpeaking(false)
    window.verity.chat.send(trimmed)
  }, [])

  const faceState: FaceState = thinking ? 'thinking' : speaking ? 'talking' : 'resting'

  return { entries, faceState, rapport, thinking, activeTool, send }
}
