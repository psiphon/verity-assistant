import { useState } from 'react'
import type { KeyboardEvent } from 'react'

interface ChatInputProps {
  disabled: boolean
  onSend: (text: string) => void
}

export function ChatInput({ disabled, onSend }: ChatInputProps): React.JSX.Element {
  const [value, setValue] = useState('')

  function submit(): void {
    if (!value.trim()) return
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
