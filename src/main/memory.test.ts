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

  it('caps stored memories at 200, dropping the oldest', () => {
    for (let i = 0; i < 205; i++) saveMemory(`fact ${i}`)
    const memories = getMemories()
    expect(memories).toHaveLength(200)
    expect(memories[0].content).toBe('fact 5')
    expect(memories[memories.length - 1].content).toBe('fact 204')
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
  })
})
