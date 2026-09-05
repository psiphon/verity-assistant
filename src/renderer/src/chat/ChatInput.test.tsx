import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../audio/sfx')

import { unlockAudio } from '../audio/sfx'
import { ChatInput } from './ChatInput'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ChatInput', () => {
  it('sends the trimmed value, unlocks audio, and clears the input on button click', () => {
    const onSend = vi.fn()
    render(<ChatInput disabled={false} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Say something to Verity...') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  hello  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(unlockAudio).toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledWith('  hello  ')
    expect(input.value).toBe('')
  })

  it('sends on Enter as well as on button click', () => {
    const onSend = vi.fn()
    render(<ChatInput disabled={false} onSend={onSend} />)

    const input = screen.getByPlaceholderText('Say something to Verity...')
    fireEvent.change(input, { target: { value: 'via enter' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('via enter')
  })

  it('does not send when the input is blank', () => {
    const onSend = vi.fn()
    render(<ChatInput disabled={false} onSend={onSend} />)

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).not.toHaveBeenCalled()
    expect(unlockAudio).not.toHaveBeenCalled()
  })

  it('ignores keys other than Enter', () => {
    const onSend = vi.fn()
    render(<ChatInput disabled={false} onSend={onSend} />)
    const input = screen.getByPlaceholderText('Say something to Verity...')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables the input and button when disabled is true', () => {
    render(<ChatInput disabled={true} onSend={vi.fn()} />)
    expect(screen.getByPlaceholderText('Say something to Verity...')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('disables the send button while the input is empty, even if not globally disabled', () => {
    render(<ChatInput disabled={false} onSend={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('enables the send button once there is non-whitespace text', () => {
    render(<ChatInput disabled={false} onSend={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Say something to Verity...'), {
      target: { value: 'x' }
    })
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
})
