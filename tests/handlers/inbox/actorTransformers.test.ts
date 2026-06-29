import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SolidFetch } from '../../../src/types/index.js'

const mockFetch = vi.fn()

describe('Actor Transformers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registerActorTransformer', () => {
    it('should register a transformer for a specific actor', async () => {
      const { registerActorTransformer, applyActorTransformer } = await import('../../../src/handlers/inbox/actorTransformers.js')

      const transformer = vi.fn().mockResolvedValue({ type: 'Note', content: 'transformed' })
      registerActorTransformer('https://example.com/actor', transformer)

      const activity = { type: 'Create' as const, actor: 'https://example.com/actor' }
      const result = await applyActorTransformer(activity, mockFetch)

      expect(transformer).toHaveBeenCalledWith(activity, mockFetch)
      expect(result).toEqual({ type: 'Note', content: 'transformed' })
    })

    it('should allow registering multiple transformers for different actors', async () => {
      const { registerActorTransformer, applyActorTransformer } = await import('../../../src/handlers/inbox/actorTransformers.js')

      const transformer1 = vi.fn().mockResolvedValue({ type: 'Actor1' })
      const transformer2 = vi.fn().mockResolvedValue({ type: 'Actor2' })
      registerActorTransformer('https://actor1.example', transformer1)
      registerActorTransformer('https://actor2.example', transformer2)

      const activity1 = { type: 'Create' as const, actor: 'https://actor1.example' }
      const activity2 = { type: 'Create' as const, actor: 'https://actor2.example' }

      await applyActorTransformer(activity1, mockFetch)
      await applyActorTransformer(activity2, mockFetch)

      expect(transformer1).toHaveBeenCalled()
      expect(transformer2).toHaveBeenCalled()
    })
  })

  describe('applyActorTransformer', () => {
    it('should return null when no transformer is registered for actor', async () => {
      const { applyActorTransformer } = await import('../../../src/handlers/inbox/actorTransformers.js')

      const activity = { type: 'Create' as const, actor: 'https://unknown.example' }
      const result = await applyActorTransformer(activity, mockFetch)

      expect(result).toBeNull()
    })

    it('should return null when activity has no actor', async () => {
      const { registerActorTransformer, applyActorTransformer } = await import('../../../src/handlers/inbox/actorTransformers.js')

      const transformer = vi.fn()
      registerActorTransformer('https://example.com/actor', transformer)

      const activity = { type: 'Create' as const }
      const result = await applyActorTransformer(activity as Record<string, unknown>, mockFetch)

      expect(result).toBeNull()
    })

    it('should pass the fetch function to the transformer', async () => {
      const { registerActorTransformer, applyActorTransformer } = await import('../../../src/handlers/inbox/actorTransformers.js')

      const transformer = vi.fn().mockResolvedValue({})
      registerActorTransformer('https://example.com/actor', transformer)

      const activity = { type: 'Create' as const, actor: 'https://example.com/actor' }
      await applyActorTransformer(activity, mockFetch)

      expect(transformer).toHaveBeenCalledWith(activity, mockFetch)
    })
  })
})
