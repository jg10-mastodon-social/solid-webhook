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
    it('should return false when no registration found', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/notes/mashlib/my-file.md',
        topic: 'https://pod.example.com/notes/mashlib/',
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, {} as any)

      expect(result).toBe(false)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should return false when PATCH request fails', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://pod.example.com/notes/mashlib/my-file.md',
        topic: 'https://pod.example.com/notes/mashlib/',
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, mockContext as any)

      expect(result).toBe(false)
    })

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

    it('should patch index when .md file is removed', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      mockFetch.mockResolvedValueOnce({ ok: true })

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
      const patchBody = mockFetch.mock.calls[0][1].body as string
      expect(patchBody).toContain('<https://pod.example.com/notes/mashlib/my-file.md>')
      expect(patchBody).toContain('rdfs:label')
      expect(patchBody).toContain('"My File"')
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
      const patchBody = mockFetch.mock.calls[0][1].body as string
      expect(patchBody).toContain('<https://pod.example.com/notes/mashlib/my-file.md>')
      expect(patchBody).toContain('rdfs:label')
      expect(patchBody).toContain('"My File"')
    })
  })

  describe('basenameToTitle', () => {
    it('converts kebab-case to Title Case', async () => {
      const { basenameToTitle } = await import('../../src/handlers/wikiIndexer.js')
      expect(basenameToTitle('my-file.md')).toBe('My File')
    })

    it('converts snake_case to Title Case', async () => {
      const { basenameToTitle } = await import('../../src/handlers/wikiIndexer.js')
      expect(basenameToTitle('my_file.md')).toBe('My File')
    })

    it('handles single word filename', async () => {
      const { basenameToTitle } = await import('../../src/handlers/wikiIndexer.js')
      expect(basenameToTitle('readme.md')).toBe('Readme')
    })

    it('handles filename without extension', async () => {
      const { basenameToTitle } = await import('../../src/handlers/wikiIndexer.js')
      expect(basenameToTitle('my-file')).toBe('My File')
    })
  })
})
