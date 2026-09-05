import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { unlockAudio } from '../audio/sfx'

interface ChatInputProps {
  disabled: boolean
  onSend: (text: string) => void
}

export function ChatInput({ disabled, onSend }: ChatInputProps): React.JSX.Element {
  const [value, setValue] = useState('')

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
    <div className="chat-input">
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
