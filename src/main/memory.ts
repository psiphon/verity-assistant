import { randomUUID } from 'node:crypto'
import type { MemoryEntry, MemoryKind } from '@shared/types'
import { settingsStore } from './store'
import { log } from './logger'

const MAX_MEMORIES = 200
// When a save would push the store past MAX_MEMORIES, the oldest batch of
// this size is condensed into a single archived entry rather than dropped -
// see consolidateIfNeeded.
const CONSOLIDATE_BATCH = 20
const PROMPT_LIMIT = 20
// The model writes memory content itself, and every memory is spliced back
// into the system prompt on future turns - cap each one so a single stray
// (or injected) save_memory call can't plant a large persistent directive
// or blow out the prompt budget.
const MAX_MEMORY_CHARS = 500
// Total characters the recent-memory block may contribute to the prompt.
const PROMPT_CHAR_BUDGET = 4000

const MEMORY_KINDS: readonly MemoryKind[] = ['fact', 'preference', 'event', 'relationship']

function sanitizeKind(kind: unknown): MemoryKind {
  return MEMORY_KINDS.includes(kind as MemoryKind) ? (kind as MemoryKind) : 'fact'
}

export function getMemories(): MemoryEntry[] {
  // Normalizes entries saved before `kind` existed, so old data on disk
  // doesn't break callers that expect it to always be present.
  return settingsStore.get('memories', []).map((m) => ({ ...m, kind: sanitizeKind(m.kind) }))
}

/** Collapse whitespace and strip control characters (so a memory can't fake
 * a prompt section header or inject blank lines) then clamp the length. */
function sanitizeMemoryContent(content: string): string {
  const oneLine = content
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return oneLine.length > MAX_MEMORY_CHARS ? `${oneLine.slice(0, MAX_MEMORY_CHARS)}…` : oneLine
}

/** Once the store would exceed MAX_MEMORIES, don't just drop the oldest
 * ones - condense the oldest CONSOLIDATE_BATCH into a single archived entry
 * so old information degrades into a compressed note instead of vanishing
 * outright. Deliberately deterministic (string concatenation, not another
 * LLM call) to keep this module's persistence logic simple and synchronous. */
function consolidateIfNeeded(memories: MemoryEntry[]): MemoryEntry[] {
  if (memories.length <= MAX_MEMORIES) return memories
  const toArchive = memories.slice(0, CONSOLIDATE_BATCH)
  const rest = memories.slice(CONSOLIDATE_BATCH)
  const archived: MemoryEntry = {
    id: randomUUID(),
    content: sanitizeMemoryContent(`Archived: ${toArchive.map((m) => m.content).join(' | ')}`),
    kind: 'event',
    createdAt: toArchive[0].createdAt
  }
  return [archived, ...rest]
}

export function saveMemory(content: string, kind?: MemoryKind): MemoryEntry {
  const entry: MemoryEntry = {
    id: randomUUID(),
    content: sanitizeMemoryContent(content),
    kind: sanitizeKind(kind),
    createdAt: new Date().toISOString()
  }
  const memories = consolidateIfNeeded([...getMemories(), entry])
  settingsStore.set('memories', memories)
  log.info('memory', `Saved (${entry.kind}): ${entry.content}`)
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
 * dig up anything older or more specific than this recent slice. The block is
 * framed explicitly as data (not instructions) because its contents are
 * model-authored and persisted across turns. */
export function formatMemoriesForPrompt(): string {
  const memories = getMemories()
  if (memories.length === 0) return '(none saved yet)'

  const lines: string[] = []
  let used = 0
  for (const m of memories.slice(-PROMPT_LIMIT).reverse()) {
    const line = m.kind === 'fact' ? `- ${m.content}` : `- (${m.kind}) ${m.content}`
    if (used + line.length > PROMPT_CHAR_BUDGET) break
    lines.push(line)
    used += line.length + 1
  }
  lines.reverse()
  return lines.join('\n')
}
