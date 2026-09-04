import { randomUUID } from 'node:crypto'
import type { MemoryEntry } from '@shared/types'
import { settingsStore } from './store'
import { log } from './logger'

const MAX_MEMORIES = 200
const PROMPT_LIMIT = 20

export function getMemories(): MemoryEntry[] {
  return settingsStore.get('memories', [])
}

export function saveMemory(content: string): MemoryEntry {
  const entry: MemoryEntry = {
    id: randomUUID(),
    content: content.trim(),
    createdAt: new Date().toISOString()
  }
  const memories = [...getMemories(), entry].slice(-MAX_MEMORIES)
  settingsStore.set('memories', memories)
  log.info('memory', `Saved: ${entry.content}`)
  return entry
}

export function searchMemories(query: string): MemoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return getMemories()
  return getMemories().filter((m) => m.content.toLowerCase().includes(q))
}

export function deleteMemory(id: string): void {
  settingsStore.set(
    'memories',
    getMemories().filter((m) => m.id !== id)
  )
}

export function clearMemories(): void {
  settingsStore.set('memories', [])
  log.info('memory', 'Cleared all memories')
}

/** Most-recent memories, formatted for the system prompt - kept short so it
 * doesn't grow the prompt unbounded; recall_memories exists for the model to
 * dig up anything older or more specific than this recent slice. */
export function formatMemoriesForPrompt(): string {
  const memories = getMemories()
  if (memories.length === 0) return '(none saved yet)'
  return memories
    .slice(-PROMPT_LIMIT)
    .map((m) => `- ${m.content}`)
    .join('\n')
}
