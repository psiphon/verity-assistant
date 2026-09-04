import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { OllamaProvider } from './ollama'
import type { LLMProvider, ProviderConfig } from './types'
import type { ProviderId } from '@shared/types'

export type { ProviderId }

export function createProvider(id: ProviderId, config: ProviderConfig): LLMProvider {
  switch (id) {
    case 'anthropic':
      return new AnthropicProvider(config)
    case 'openai':
      return new OpenAIProvider(config)
    case 'ollama':
      return new OllamaProvider(config)
    default:
      throw new Error(`Unknown provider: ${id}`)
  }
}

export * from './types'
