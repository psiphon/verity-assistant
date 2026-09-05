import { describe, expect, it, vi } from 'vitest'

vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }))
vi.mock('openai', () => ({ default: vi.fn() }))

import { createProvider } from './index'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { OllamaProvider } from './ollama'

describe('createProvider', () => {
  it('creates an AnthropicProvider for id "anthropic"', () => {
    expect(createProvider('anthropic', {})).toBeInstanceOf(AnthropicProvider)
  })

  it('creates an OpenAIProvider for id "openai"', () => {
    expect(createProvider('openai', {})).toBeInstanceOf(OpenAIProvider)
  })

  it('creates an OllamaProvider for id "ollama"', () => {
    expect(createProvider('ollama', {})).toBeInstanceOf(OllamaProvider)
  })

  it('throws for an unrecognized provider id', () => {
    // @ts-expect-error deliberately invalid id to exercise the default branch
    expect(() => createProvider('bogus', {})).toThrow('Unknown provider: bogus')
  })
})
