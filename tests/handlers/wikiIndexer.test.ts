import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent, WikiIndexerWebhook, TrackedSubscription } from '../../src/types/index.js'
import { discoverWikiContainers } from '../../src/services/wikiContainers.js'
import { subscribeTracked } from '../../src/services/subscriptions.js'
import { unsubscribeWebhookChannel } from '../../src/services/webhookChannel.js'

vi.mock('../../src/services/wikiContainers.js', () => ({
  discoverWikiContainers: vi.fn(),
}))
vi.mock('../../src/services/subscriptions.js', () => ({
  subscribeTracked: vi.fn(),
}))
vi.mock('../../src/services/webhookChannel.js', () => ({
  unsubscribeWebhookChannel: vi.fn(),
}))

const WIKI_ROOT = 'https://pod.example.com/notes/mashlib/'
const WIKI_INDEX = 'https://pod.example.com/notes/mashlib/index.ttl'
const SEND_TO = 'https://app.example.com/webhook'

function wikiRegistration(overrides: Partial<WikiIndexerWebhook> = {}): WikiIndexerWebhook {
  return {
    handler: 'WikiIndexer',
    topic: WIKI_ROOT,
    indexUrl: WIKI_INDEX,
    maxDepth: 1,
    callback: vi.fn(),
    ...overrides,
  }
}

function tracked(id: string, topic: string): TrackedSubscription {
  return { id, receiveFrom: `${topic}receive`, topic, status: 'active' }
}

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

  describe('applyIndexInsert', () => {
    it('batches multiple files into a single INSERT DATA PATCH', async () => {
      const { applyIndexInsert } = await import('../../src/handlers/wikiIndexer.js')

      mockFetch.mockResolvedValueOnce({ ok: true })

      const result = await applyIndexInsert(
        'https://pod.example.com/index.ttl',
        [
          'https://pod.example.com/wiki/first-file.md',
          'https://pod.example.com/wiki/second_file.md',
        ],
        mockFetch
      )

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('https://pod.example.com/index.ttl')
      expect(init.method).toBe('PATCH')
      expect(init.headers['content-type']).toBe('application/sparql-update')
      expect(init.body).toContain('INSERT DATA')
      expect(init.body).toContain('<https://pod.example.com/wiki/first-file.md>')
      expect(init.body).toContain('"First File"')
      expect(init.body).toContain('<https://pod.example.com/wiki/second_file.md>')
      expect(init.body).toContain('"Second File"')
    })
  })

  describe('applyIndexDelete', () => {
    it('batches multiple files into a single DELETE DATA PATCH', async () => {
      const { applyIndexDelete } = await import('../../src/handlers/wikiIndexer.js')

      mockFetch.mockResolvedValueOnce({ ok: true })

      const result = await applyIndexDelete(
        'https://pod.example.com/index.ttl',
        [
          'https://pod.example.com/wiki/first-file.md',
          'https://pod.example.com/wiki/second_file.md',
        ],
        mockFetch
      )

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('https://pod.example.com/index.ttl')
      expect(init.method).toBe('PATCH')
      expect(init.headers['content-type']).toBe('application/sparql-update')
      expect(init.body).toContain('DELETE DATA')
      expect(init.body).toContain('<https://pod.example.com/wiki/first-file.md>')
      expect(init.body).toContain('<https://pod.example.com/wiki/second_file.md>')
    })
  })

  describe('deleteIndexSubtree', () => {
    const indexUrl = 'https://pod.example.com/index.ttl'
    const containerUrl = 'https://pod.example.com/wiki/topics/'

    it('deletes only labels whose subject is under the container', async () => {
      const { deleteIndexSubtree } = await import('../../src/handlers/wikiIndexer.js')

      const turtle = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<https://pod.example.com/wiki/topics/page.md> rdfs:label "Page" .
<https://pod.example.com/wiki/topics/nested/deep.md> rdfs:label "Deep" .
<https://pod.example.com/wiki/topics-other/page.md> rdfs:label "Other Page" .
<https://pod.example.com/wiki/root.md> rdfs:label "Root" .
`

      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => turtle })
        .mockResolvedValueOnce({ ok: true })

      const result = await deleteIndexSubtree(indexUrl, containerUrl, mockFetch)

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      const [getUrl, getInit] = mockFetch.mock.calls[0]
      expect(getUrl).toBe(indexUrl)
      expect(getInit.method).toBe('GET')
      expect(getInit.headers.accept).toBe('text/turtle')

      const [patchUrl, patchInit] = mockFetch.mock.calls[1]
      expect(patchUrl).toBe(indexUrl)
      expect(patchInit.method).toBe('PATCH')
      expect(patchInit.body).toContain('DELETE DATA')
      expect(patchInit.body).toContain('<https://pod.example.com/wiki/topics/page.md>')
      expect(patchInit.body).toContain('<https://pod.example.com/wiki/topics/nested/deep.md>')
      expect(patchInit.body).not.toContain('<https://pod.example.com/wiki/topics-other/page.md>')
      expect(patchInit.body).not.toContain('<https://pod.example.com/wiki/root.md>')
    })

    it('returns false and does not PATCH when the index GET is not ok', async () => {
      const { deleteIndexSubtree } = await import('../../src/handlers/wikiIndexer.js')

      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

      const result = await deleteIndexSubtree(indexUrl, containerUrl, mockFetch)

      expect(result).toBe(false)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0][1].method).toBe('GET')
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

    it('decodes percent-encoded filenames', async () => {
      const { basenameToTitle } = await import('../../src/handlers/wikiIndexer.js')
      expect(basenameToTitle('water%20quality.md')).toBe('Water Quality')
    })

    it('keeps already-decoded filenames unchanged', async () => {
      const { basenameToTitle } = await import('../../src/handlers/wikiIndexer.js')
      expect(basenameToTitle('water quality.md')).toBe('Water Quality')
    })
  })

  describe('container recursion', () => {
    it('selects the longest matching registration prefix', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      mockFetch.mockResolvedValueOnce({ ok: true })

      const context = {
        registrations: [
          wikiRegistration({
            topic: 'https://pod.example.com/notes/',
            indexUrl: 'https://pod.example.com/notes/index.ttl',
          }),
          wikiRegistration(),
        ],
        subscriptions: [] as TrackedSubscription[],
        sendToUrl: SEND_TO,
      }

      const event: WebhookEvent = {
        type: 'Add',
        object: `${WIKI_ROOT}my-file.md`,
        topic: WIKI_ROOT,
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, context as any)

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        WIKI_INDEX,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('INSERT DATA'),
        })
      )
    })

    it('subscribes and backfills when a child container is added within maxDepth', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      const container = `${WIKI_ROOT}newcontainer/`
      const page = `${container}page.md`

      vi.mocked(discoverWikiContainers).mockResolvedValueOnce({
        containers: [container],
        markdownFiles: [page],
      })
      vi.mocked(subscribeTracked).mockResolvedValueOnce(tracked('sub-1', container))
      mockFetch.mockResolvedValueOnce({ ok: true })

      const context = {
        registrations: [wikiRegistration()],
        subscriptions: [] as TrackedSubscription[],
        sendToUrl: SEND_TO,
      }

      const event: WebhookEvent = {
        type: 'Add',
        object: container,
        topic: WIKI_ROOT,
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, context as any)

      expect(result).toBe(true)
      expect(discoverWikiContainers).toHaveBeenCalledWith(container, 0, mockFetch)
      expect(subscribeTracked).toHaveBeenCalledWith(container, SEND_TO, mockFetch)
      expect(context.subscriptions).toHaveLength(1)
      expect(context.subscriptions[0].topic).toBe(container)
      expect(mockFetch).toHaveBeenCalledWith(
        WIKI_INDEX,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining(page),
        })
      )
    })

    it('does not subscribe or backfill when the container is beyond maxDepth', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      const container = `${WIKI_ROOT}one/two/`

      const context = {
        registrations: [wikiRegistration({ maxDepth: 1 })],
        subscriptions: [] as TrackedSubscription[],
        sendToUrl: SEND_TO,
      }

      const event: WebhookEvent = {
        type: 'Add',
        object: container,
        topic: WIKI_ROOT,
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, context as any)

      expect(result).toBe(false)
      expect(discoverWikiContainers).not.toHaveBeenCalled()
      expect(subscribeTracked).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
      expect(context.subscriptions).toHaveLength(0)
    })

    it('does not duplicate an active subscription but still backfills', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      const container = `${WIKI_ROOT}existing/`
      const page = `${container}page.md`

      vi.mocked(discoverWikiContainers).mockResolvedValueOnce({
        containers: [container],
        markdownFiles: [page],
      })
      mockFetch.mockResolvedValueOnce({ ok: true })

      const context = {
        registrations: [wikiRegistration()],
        subscriptions: [tracked('sub-existing', container)],
        sendToUrl: SEND_TO,
      }

      const event: WebhookEvent = {
        type: 'Add',
        object: container,
        topic: WIKI_ROOT,
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, context as any)

      expect(result).toBe(true)
      expect(subscribeTracked).not.toHaveBeenCalled()
      expect(context.subscriptions).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        WIKI_INDEX,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining(page),
        })
      )
    })

    it('unsubscribes container and descendants and deletes subtree labels on removal', async () => {
      const { handleWikiIndexer } = await import('../../src/handlers/wikiIndexer.js')

      const container = `${WIKI_ROOT}oldcontainer/`
      const page = `${container}page.md`
      const turtle = `<${page}> <http://www.w3.org/2000/01/rdf-schema#label> "Page" .`

      vi.mocked(unsubscribeWebhookChannel).mockResolvedValue(undefined)

      mockFetch
        .mockResolvedValueOnce({ ok: true, text: async () => turtle })
        .mockResolvedValueOnce({ ok: true })

      const other = tracked('sub-other', `${WIKI_ROOT}other/`)
      const subscriptions = [
        tracked('sub-1', container),
        tracked('sub-2', `${container}child/`),
        other,
        tracked('', `${container}noid/`),
      ]
      const context = {
        registrations: [wikiRegistration()],
        subscriptions,
        sendToUrl: SEND_TO,
      }

      const event: WebhookEvent = {
        type: 'Remove',
        object: container,
        topic: WIKI_ROOT,
        raw: {},
      }

      const result = await handleWikiIndexer(event, mockFetch, context as any)

      expect(result).toBe(true)
      expect(unsubscribeWebhookChannel).toHaveBeenCalledWith('sub-1', mockFetch)
      expect(unsubscribeWebhookChannel).toHaveBeenCalledWith('sub-2', mockFetch)
      expect(unsubscribeWebhookChannel).not.toHaveBeenCalledWith('', mockFetch)
      expect(unsubscribeWebhookChannel).not.toHaveBeenCalledWith('sub-other', mockFetch)
      expect(context.subscriptions).toBe(subscriptions)
      expect(context.subscriptions.map(sub => sub.topic)).toEqual([`${WIKI_ROOT}other/`])
      expect(mockFetch).toHaveBeenCalledWith(
        WIKI_INDEX,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining(page),
        })
      )
    })
  })
})
