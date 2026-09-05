import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEntry } from './chat/useAssistant'
import type { FaceState } from './face/faceAtlas'

vi.mock('./audio/sfx')
vi.mock('./chat/useAssistant')
vi.mock('./face/FaceStage', () => ({
  FaceStage: (props: { state: FaceState; rapport: number; onClick?: () => void }) => (
    <button data-testid="face-stage" onClick={props.onClick}>
      {props.state}-{props.rapport}
    </button>
  )
}))
vi.mock('./settings/SettingsPanel', () => ({
  SettingsPanel: (props: { onClose: () => void }) => (
    <div data-testid="settings-panel">
      <button onClick={props.onClose}>close-settings</button>
    </div>
  )
}))
vi.mock('./chat/ChatInput', () => ({
  ChatInput: (props: { disabled: boolean; onSend: (text: string) => void }) => (
    <button data-testid="chat-input" disabled={props.disabled} onClick={() => props.onSend('hi')}>
      chat-input
    </button>
  )
}))

import { unlockAudio } from './audio/sfx'
import { useAssistant } from './chat/useAssistant'
import App from './App'

function mockAssistant(overrides: Partial<ReturnType<typeof useAssistant>> = {}): {
  send: ReturnType<typeof vi.fn>
} {
  const send = vi.fn()
  vi.mocked(useAssistant).mockReturnValue({
    entries: [],
    faceState: 'resting',
    rapport: 100,
    thinking: false,
    activeTool: null,
    send,
    ...overrides
  })
  return { send }
}

let openSettingsListeners: Set<() => void>

beforeEach(() => {
  openSettingsListeners = new Set()
  window.verity = {
    window: {
      onOpenSettings: (cb: () => void) => {
        openSettingsListeners.add(cb)
        return () => openSettingsListeners.delete(cb)
      }
    }
  } as unknown as Window['verity']
})

afterEach(() => {
  vi.restoreAllMocks()
  // @ts-expect-error test-only cleanup of the global the component reads
  delete window.verity
})

describe('App', () => {
  it('renders the face and a collapsed, disabled chat input by default', () => {
    mockAssistant()
    render(<App />)
    expect(screen.getByTestId('face-stage')).toHaveTextContent('resting-100')
    expect(screen.getByTestId('chat-input')).toBeDisabled()
  })

  it('expands the panel and unlocks audio when the face is clicked, and enables the input', () => {
    mockAssistant()
    render(<App />)

    fireEvent.click(screen.getByTestId('face-stage'))

    expect(unlockAudio).toHaveBeenCalled()
    expect(screen.getByTestId('chat-input')).toBeEnabled()
  })

  it('collapses again on a second click', () => {
    mockAssistant()
    render(<App />)
    const face = screen.getByTestId('face-stage')

    fireEvent.click(face)
    expect(screen.getByTestId('chat-input')).toBeEnabled()
    fireEvent.click(face)
    expect(screen.getByTestId('chat-input')).toBeDisabled()
  })

  it('keeps the chat input disabled while expanded if thinking is true', () => {
    mockAssistant({ thinking: true })
    render(<App />)
    fireEvent.click(screen.getByTestId('face-stage'))
    expect(screen.getByTestId('chat-input')).toBeDisabled()
  })

  it('forwards ChatInput sends to the assistant hook', () => {
    const { send } = mockAssistant()
    render(<App />)
    fireEvent.click(screen.getByTestId('face-stage')) // expand so the input isn't disabled
    fireEvent.click(screen.getByTestId('chat-input'))
    expect(send).toHaveBeenCalledWith('hi')
  })

  describe('status line', () => {
    it('shows a thinking pill when thinking and no active tool', () => {
      mockAssistant({ thinking: true })
      render(<App />)
      expect(screen.getByText('thinking…')).toBeInTheDocument()
    })

    it('shows the active tool even while thinking', () => {
      mockAssistant({ thinking: true, activeTool: 'get_current_time' })
      render(<App />)
      expect(screen.getByText('using get_current_time…')).toBeInTheDocument()
      expect(screen.queryByText('thinking…')).not.toBeInTheDocument()
    })

    it('shows the last assistant/system entry when idle', () => {
      const entries: ChatEntry[] = [
        { id: '1', role: 'user', text: 'hi' },
        { id: '2', role: 'assistant', text: 'hello there' }
      ]
      mockAssistant({ entries })
      render(<App />)
      expect(screen.getByText('hello there')).toBeInTheDocument()
    })

    it('finds the last non-user entry even if a user message came after it', () => {
      const entries: ChatEntry[] = [
        { id: '1', role: 'user', text: 'hi' },
        { id: '2', role: 'assistant', text: 'hello there' },
        { id: '3', role: 'user', text: 'a follow-up with no reply yet' }
      ]
      mockAssistant({ entries })
      render(<App />)
      expect(screen.getByText('hello there')).toBeInTheDocument()
    })

    it('shows nothing when there are no non-user entries yet', () => {
      mockAssistant({ entries: [{ id: '1', role: 'user', text: 'hi' }] })
      render(<App />)
      expect(screen.queryByText('hi')).not.toBeInTheDocument()
      expect(screen.queryByText('thinking…')).not.toBeInTheDocument()
    })
  })

  describe('settings', () => {
    it('switches to the settings panel when the main process asks it to', () => {
      mockAssistant()
      render(<App />)
      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('face-stage')) // sanity: normal view is interactive
      act(() => openSettingsListeners.forEach((cb) => cb()))

      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('face-stage')).not.toBeInTheDocument()
    })

    it('returns to the normal view when settings closes', () => {
      mockAssistant()
      render(<App />)
      act(() => openSettingsListeners.forEach((cb) => cb()))
      expect(screen.getByTestId('settings-panel')).toBeInTheDocument()

      fireEvent.click(screen.getByText('close-settings'))
      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()
      expect(screen.getByTestId('face-stage')).toBeInTheDocument()
    })
  })
})
