import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent, WikiIndexerWebhook } from '../../src/types/index.js'

const mockFetch = vi.fn()
const mockContext = {
  registrations: [{
    handler: 'WikiIndexer' as const,
    topic: 'https://pod.example.com/notes/mashlib/',
    indexUrl: 'https://pod.example.com/notes/mashlib/index.ttl',
    callback: vi.fn(),
  }],
}

describe('WikiIndexer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleWikiIndexer', () => {
    it('should not patch index for non-markdown files', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/notes/mashlib/data.json',
        topic: 'https://pod.example.com/notes/mashlib/',
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, mockContext as any)

      expect(result).toBe(false)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should not patch index when .md file is removed', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      const event: WebhookEvent = {
        type: 'Remove',
        object: 'https://pod.example.com/notes/mashlib/my-file.md',
        topic: 'https://pod.example.com/notes/mashlib/',
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, mockContext as any)

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pod.example.com/notes/mashlib/index.ttl',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            'content-type': 'application/sparql-update',
          }),
          body: expect.stringContaining('DELETE DATA'),
        })
      )
    })

    it('should patch index when .md file is added', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      mockFetch.mockResolvedValueOnce({ ok: true })

      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/notes/mashlib/my-file.md',
        topic: 'https://pod.example.com/notes/mashlib/',
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, mockContext as any)

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pod.example.com/notes/mashlib/index.ttl',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            'content-type': 'application/sparql-update',
          }),
          body: expect.stringContaining('INSERT DATA'),
        })
      )
    })
  })
})
