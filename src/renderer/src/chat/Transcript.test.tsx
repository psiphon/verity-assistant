import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@shared/types'
import { Transcript } from './Transcript'

function entry(id: string, role: TranscriptEntry['role'], text: string): TranscriptEntry {
  return { id, role, text, createdAt: '' }
}

describe('Transcript', () => {
  it('shows the empty-state hint when there are no entries and nothing streaming', () => {
    render(<Transcript entries={[]} />)
    expect(screen.getByText('Nothing said yet.')).toBeInTheDocument()
  })

  it('renders every entry', () => {
    render(<Transcript entries={[entry('1', 'user', 'hi'), entry('2', 'assistant', 'hello')]} />)
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('shows in-progress streaming text as an extra line, not part of the entries', () => {
    render(<Transcript entries={[entry('1', 'user', 'hi')]} streamingText="thinking out lo" />)
    expect(screen.getByText(/thinking out lo/)).toBeInTheDocument()
  })

  it('is not considered empty while text is streaming, even with no entries yet', () => {
    render(<Transcript entries={[]} streamingText="hi the" />)
    expect(screen.queryByText('Nothing said yet.')).not.toBeInTheDocument()
  })
})
