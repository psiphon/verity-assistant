import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-store')
vi.mock('electron')

import {
  clearMemories,
  deleteMemory,
  formatMemoriesForPrompt,
  getMemories,
  saveMemory,
  searchMemories
} from './memory'
import { settingsStore } from './store'
import type { MemoryEntry, MemoryKind } from '@shared/types'

describe('memory', () => {
  beforeEach(() => {
    clearMemories()
  })

  it('starts empty', () => {
    expect(getMemories()).toEqual([])
  })

  it('saves a memory with a trimmed content, id, and timestamp', () => {
    const entry = saveMemory('  likes dark mode  ')
    expect(entry.content).toBe('likes dark mode')
    expect(entry.id).toBeTruthy()
    expect(new Date(entry.createdAt).toString()).not.toBe('Invalid Date')
    expect(getMemories()).toEqual([entry])
  })

  it('appends rather than replacing on repeated saves', () => {
    saveMemory('first fact')
    saveMemory('second fact')
    expect(getMemories().map((m) => m.content)).toEqual(['first fact', 'second fact'])
  })

  it('archives the oldest batch instead of silently dropping them once past the cap', () => {
    for (let i = 0; i < 205; i++) saveMemory(`fact ${i}`)
    const memories = getMemories()
    // Consolidation trades exact-200 for "nothing outright lost" - the
    // oldest batch gets compressed into one archived entry rather than
    // deleted, so the final count is well under 205 but not a hard 200.
    expect(memories.length).toBeLessThan(205)
    expect(memories[0].kind).toBe('event')
    expect(memories[0].content).toContain('Archived:')
    expect(memories[0].content).toContain('fact 0')
    expect(memories[memories.length - 1].content).toBe('fact 204')
  })

  describe('kind', () => {
    it('defaults to fact when none is given', () => {
      expect(saveMemory('a fact').kind).toBe('fact')
    })

    it('accepts a valid kind', () => {
      expect(saveMemory('likes tea', 'preference').kind).toBe('preference')
    })

    it('falls back to fact for an invalid kind', () => {
      expect(saveMemory('x', 'bogus' as MemoryKind).kind).toBe('fact')
    })

    it('normalizes memories saved before kind existed', () => {
      const legacy = [
        { id: '1', content: 'old memory', createdAt: new Date().toISOString() }
      ] as unknown as MemoryEntry[]
      settingsStore.set('memories', legacy)
      expect(getMemories()[0].kind).toBe('fact')
    })
  })

  describe('searchMemories', () => {
    beforeEach(() => {
      saveMemory('Loves cats')
      saveMemory('Hates mushrooms')
      saveMemory('Works as a CAT groomer')
    })

    it('returns everything when the query is empty', () => {
      expect(searchMemories('')).toHaveLength(3)
      expect(searchMemories('   ')).toHaveLength(3)
    })

    it('matches case-insensitively on a substring', () => {
      const results = searchMemories('cat')
      expect(results.map((m) => m.content)).toEqual(['Loves cats', 'Works as a CAT groomer'])
    })

    it('returns an empty array when nothing matches', () => {
      expect(searchMemories('spaceship')).toEqual([])
    })
  })

  it('deletes a memory by id and leaves the rest intact', () => {
    const a = saveMemory('a')
    const b = saveMemory('b')
    deleteMemory(a.id)
    expect(getMemories()).toEqual([b])
  })

  it('deleting an unknown id is a harmless no-op', () => {
    saveMemory('a')
    deleteMemory('does-not-exist')
    expect(getMemories()).toHaveLength(1)
  })

  it('clearMemories empties the list', () => {
    saveMemory('a')
    saveMemory('b')
    clearMemories()
    expect(getMemories()).toEqual([])
  })

  describe('formatMemoriesForPrompt', () => {
    it('says none saved yet when empty', () => {
      expect(formatMemoriesForPrompt()).toBe('(none saved yet)')
    })

    it('formats each memory as a bulleted line', () => {
      saveMemory('likes tea')
      saveMemory('dislikes cold coffee')
      expect(formatMemoriesForPrompt()).toBe('- likes tea\n- dislikes cold coffee')
    })

    it('only includes the most recent 20 memories', () => {
      for (let i = 0; i < 25; i++) saveMemory(`fact ${i}`)
      const formatted = formatMemoriesForPrompt()
      const lines = formatted.split('\n')
      expect(lines).toHaveLength(20)
      expect(lines[0]).toBe('- fact 5')
      expect(lines[19]).toBe('- fact 24')
    })

    it('prefixes a non-default kind but leaves a plain fact unprefixed', () => {
      saveMemory('likes tea')
      saveMemory('hates spiders', 'preference')
      expect(formatMemoriesForPrompt()).toBe('- likes tea\n- (preference) hates spiders')
    })

    it('stays within the prompt character budget even with many long memories', () => {
      for (let i = 0; i < 20; i++) saveMemory('x'.repeat(490))
      expect(formatMemoriesForPrompt().length).toBeLessThanOrEqual(4000)
    })
  })

  describe('sanitizeMemoryContent (via saveMemory)', () => {
    it('clamps an over-long memory so it cannot plant a large persistent directive', () => {
      const entry = saveMemory('a'.repeat(5000))
      expect(entry.content.length).toBeLessThanOrEqual(501)
    })

    it('collapses newlines and control characters into single spaces', () => {
      const entry = saveMemory('line one\n\n\t=== FAKE PROMPT SECTION ===\r\nline two')
      expect(entry.content).toBe('line one === FAKE PROMPT SECTION === line two')
      expect(entry.content).not.toContain('\n')
    })
  })
})
