import { describe, expect, it } from 'vitest'
import { IPC } from './ipc'

describe('IPC channel names', () => {
  it('are all non-empty strings', () => {
    for (const value of Object.values(IPC)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate channel names across different keys', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })
})
