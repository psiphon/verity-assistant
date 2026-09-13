import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { unlockAudio } from '../audio/sfx'
import { useSpeechRecognition } from './useSpeech'

interface ChatInputProps {
  disabled: boolean
  onSend: (text: string) => void
}

export function ChatInput({ disabled, onSend }: ChatInputProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const speech = useSpeechRecognition((text) =>
    setValue((prev) => (prev ? `${prev} ${text}` : text))
  )

  function submit(): void {
    if (!value.trim()) return
    // Must happen synchronously inside this gesture - see unlockAudio's docs.
    unlockAudio()
    onSend(value)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') submit()
  }

  return (
    <div className={`chat-input${speech.supported ? ' chat-input-has-mic' : ''}`}>
      {speech.supported && (
        <button
          type="button"
          className="chat-input-mic"
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          disabled={disabled}
          aria-label={speech.listening ? 'Stop listening' : 'Speak instead of typing'}
          aria-pressed={speech.listening}
        >
          {speech.listening ? '●' : '🎤'}
        </button>
      )}
      <input
        type="text"
        value={value}
        placeholder="Say something to Verity..."
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button onClick={submit} disabled={disabled || !value.trim()} aria-label="Send">
        ➤
      </button>
    </div>
  )
}
