import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { TranscriptEntry } from '@shared/types'
import type { ChatMessage } from './llm/types'

// The LLM's own working context is replayed in full on every turn, so it
// can't grow without bound - past this many messages the oldest are dropped
// (never splitting an assistant tool_use call from its tool results).
const MAX_HISTORY_MESSAGES = 40
// The display transcript is a separate, larger budget: it's for a human
// scrolling back, not for what gets sent to the LLM, so it can hold a lot
// more than the working history without costing anything per turn.
const MAX_TRANSCRIPT_ENTRIES = 300

interface ConversationStoreShape {
  workingHistory: ChatMessage[]
  transcript: TranscriptEntry[]
}

const conversationStore = new Store<ConversationStoreShape>({
  name: 'verity-conversation',
  defaults: { workingHistory: [], transcript: [] }
})

/** Never begin the kept slice on an orphaned tool result whose matching
 * assistant tool_use call was just trimmed away. */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages
  let start = messages.length - MAX_HISTORY_MESSAGES
  while (start < messages.length && messages[start].role === 'tool') start++
  return messages.slice(start)
}

export function getWorkingHistory(): ChatMessage[] {
  return conversationStore.get('workingHistory', [])
}

export function setWorkingHistory(messages: ChatMessage[]): void {
  conversationStore.set('workingHistory', trimHistory(messages))
}

export function getTranscript(): TranscriptEntry[] {
  return conversationStore.get('transcript', [])
}

export function appendTranscript(entry: Pick<TranscriptEntry, 'role' | 'text'>): TranscriptEntry {
  const full: TranscriptEntry = {
    id: randomUUID(),
    role: entry.role,
    text: entry.text,
    createdAt: new Date().toISOString()
  }
  const transcript = [...getTranscript(), full].slice(-MAX_TRANSCRIPT_ENTRIES)
  conversationStore.set('transcript', transcript)
  return full
}

export function clearConversation(): void {
  conversationStore.set({ workingHistory: [], transcript: [] })
}
