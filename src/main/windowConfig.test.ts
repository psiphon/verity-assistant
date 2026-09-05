import { describe, expect, it } from 'vitest'
import { WINDOW_SIZE } from './windowConfig'

describe('WINDOW_SIZE', () => {
  it('is a fixed, positive size shared by main and renderer', () => {
    expect(WINDOW_SIZE.width).toBeGreaterThan(0)
    expect(WINDOW_SIZE.height).toBeGreaterThan(0)
  })
})
