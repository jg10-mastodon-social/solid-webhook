import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SolidFetch } from '../../../../src/types/index.js'

const mockFetch = vi.fn()

const SAVAGE_CHICKENS_ACTOR = 'https://rss-parrot.net/u/savagechickens.com'

describe('SavageChickens Transformer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should be registered for the savage chickens actor', async () => {
    await import('../../../../src/handlers/inbox/transformers/index.js')
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    const activity = {
      type: 'Create' as const,
      actor: SAVAGE_CHICKENS_ACTOR,
      object: { content: 'Test' },
    }

    const result = await applyActorTransformer(activity, mockFetch)

    expect(result).not.toBeNull()
  })

  it('should not transform activities from other actors', async () => {
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    const activity = {
      type: 'Create' as const,
      actor: 'https://other.example/actor',
      object: { content: 'Test' },
    }

    const result = await applyActorTransformer(activity, mockFetch)

    expect(result).toBeNull()
  })

  it('should not transform activities without object content', async () => {
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    const activity = {
      type: 'Create' as const,
      actor: SAVAGE_CHICKENS_ACTOR,
    }

    const result = await applyActorTransformer(activity, mockFetch)

    expect(result).toEqual(activity)
  })

  it('should not transform if no html URL found in content', async () => {
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    const activity = {
      type: 'Create' as const,
      actor: SAVAGE_CHICKENS_ACTOR,
      object: { content: 'Just plain text without any links' },
    }

    const result = await applyActorTransformer(activity, mockFetch)

    expect(result).toEqual(activity)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should not transform if oEmbed fetch fails', async () => {
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    mockFetch.mockRejectedValue(new Error('Network error'))

    const activity = {
      type: 'Create' as const,
      actor: SAVAGE_CHICKENS_ACTOR,
      object: { content: '<p><a href="https://www.savagechickens.com/2025/12/test.html">Link</a></p>' },
    }

    const result = await applyActorTransformer(activity, mockFetch)

    expect(result).toEqual(activity)
  })

  it('should add oEmbed thumbnail as attachment when found', async () => {
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    const oembedResponse = {
      thumbnail_url: 'https://www.savagechickens.com/wp-content/uploads/test-thumb.jpg',
    }

    let capturedOembedUrl: string | null = null
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('oembed')) {
        capturedOembedUrl = url
        return new Response(JSON.stringify(oembedResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/activity+json' } })
    })

    const activity = {
      type: 'Create' as const,
      actor: SAVAGE_CHICKENS_ACTOR,
      object: {
        content: '<p><a href="https://www.savagechickens.com/2025/12/tis-the-season.html">www.savagechickens.com/2025/12/tis-the-season.html</a></p>',
      },
    }

    const result = await applyActorTransformer(activity, mockFetch)

    expect(capturedOembedUrl).toContain('https://www.savagechickens.com/wp-json/oembed/1.0/embed')
    expect(capturedOembedUrl).toContain('url=https://www.savagechickens.com/2025/12/tis-the-season.html')

    const resultObj = result!.object as Record<string, unknown>
    expect(resultObj.attachment).toEqual([
      { url: 'https://www.savagechickens.com/wp-content/uploads/test-thumb.jpg', type: 'Image' },
    ])
  })

  it('should preserve original activity when no thumbnail_url in oEmbed response', async () => {
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    mockFetch.mockImplementation(async () => {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const activity = {
      type: 'Create' as const,
      actor: SAVAGE_CHICKENS_ACTOR,
      object: {
        content: '<p><a href="https://www.savagechickens.com/2025/12/test.html">Link</a></p>',
      },
    }

    const result = await applyActorTransformer(activity, mockFetch)

    expect(result).toEqual(activity)
  })

  it('should only process first html URL in content', async () => {
    const { applyActorTransformer } = await import('../../../../src/handlers/inbox/actorTransformers.js')

    const oembedResponse = { thumbnail_url: 'https://example.com/thumb.jpg' }
    const fetchedUrls: string[] = []

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('oembed')) {
        fetchedUrls.push(url)
        return new Response(JSON.stringify(oembedResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/activity+json' } })
    })

    const activity = {
      type: 'Create' as const,
      actor: SAVAGE_CHICKENS_ACTOR,
      object: {
        content: '<p><a href="https://www.savagechickens.com/first.html">First</a> and <a href="https://www.savagechickens.com/second.html">Second</a></p>',
      },
    }

    await applyActorTransformer(activity, mockFetch)

    expect(fetchedUrls).toHaveLength(1)
    expect(fetchedUrls[0]).toContain('first.html')
    expect(fetchedUrls[0]).not.toContain('second.html')
  })
})
