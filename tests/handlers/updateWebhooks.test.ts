import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WebhookEvent, SolidFetch } from '../../src/types/index.js'

const mockFetch = vi.fn()
const mockSubscribeWebhookChannel = vi.fn()

vi.mock('../../src/services/webhookChannel.js', () => ({
  subscribeWebhookChannel: mockSubscribeWebhookChannel,
}))

vi.mock('../../src/config.js', () => ({
  parseWebhooksFromRDF: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../src/services/wikiIndexerInit.js', () => ({
  initializeWikiIndexers: vi.fn(),
}))

import { parseWebhooksFromRDF } from '../../src/config.js'
import { initializeWikiIndexers } from '../../src/services/wikiIndexerInit.js'

describe('UpdateWebhooks Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockContext.subscriptions = []
    mockContext.registrations = []
  })

  const mockContext = {
    subscriptions: [] as any[],
    registrations: [] as any[],
    handlers: {
      InboxModified: vi.fn(),
      CommitHandler: vi.fn(),
      WikiIndexer: vi.fn(),
    },
    sendToUrl: 'https://example.com/webhook',
    handlerBaseUrl: 'https://example.com/handlers#',
  }

  describe('handleUpdateWebhooks', () => {
    it('should ignore Add events', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Add', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockSubscribeWebhookChannel).not.toHaveBeenCalled()
    })

    it('should ignore Remove events', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      const event: WebhookEvent = {
        type: 'Remove',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Remove', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockSubscribeWebhookChannel).not.toHaveBeenCalled()
    })

    it('should fetch RDF config from event.object on Update', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      mockFetch.mockResolvedValue(
        new Response('', { status: 200 })
      )
      ;(parseWebhooksFromRDF as any).mockResolvedValue([])

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/new-config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/new-config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/new-config.ttl',
        { headers: { accept: 'text/turtle,application/x-turtle' } }
      )
    })

    it('should skip duplicate topics already in subscriptions', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      mockContext.subscriptions = [
        {
          id: 'https://example.com/sub/123',
          receiveFrom: 'https://example.com/receive',
          topic: 'https://pod.example.com/inbox/',
          status: 'active',
        },
      ]

      const rdfContent = `
        @prefix solid: <http://www.w3.org/ns/solid/terms#>.
        <https://pod.example.com/webhook#1> a <https://example.com/handlers#WebHook>;
          solid:topic <https://pod.example.com/inbox/>;
          solid:handler <https://example.com/handlers#InboxModified>.
      `
      mockFetch.mockResolvedValue(
        new Response(rdfContent, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        { topic: 'https://pod.example.com/inbox/', handler: 'InboxModified' },
      ])

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockSubscribeWebhookChannel).not.toHaveBeenCalled()
    })

    it('should add subscription with failed status for unknown handlers', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      const rdfContent = `
        @prefix solid: <http://www.w3.org/ns/solid/terms#>.
        <https://pod.example.com/webhook#1> a <https://example.com/handlers#WebHook>;
          solid:topic <https://pod.example.com/new-inbox/>;
          solid:handler <https://example.com/handlers#UnknownHandler>.
      `
      mockFetch.mockResolvedValue(
        new Response(rdfContent, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        { topic: 'https://pod.example.com/new-inbox/', handler: 'UnknownHandler' },
      ])

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockContext.subscriptions).toHaveLength(1)
      expect(mockContext.subscriptions[0]).toMatchObject({
        topic: 'https://pod.example.com/new-inbox/',
        status: 'failed',
        error: 'Unknown handler: UnknownHandler',
      })
      expect(mockSubscribeWebhookChannel).not.toHaveBeenCalled()
    })

    it('should subscribe and add registration for known handlers', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      const rdfContent = `
        @prefix solid: <http://www.w3.org/ns/solid/terms#>.
        <https://pod.example.com/webhook#1> a <https://example.com/handlers#WebHook>;
          solid:topic <https://pod.example.com/new-inbox/>;
          solid:handler <https://example.com/handlers#InboxModified>.
      `
      mockFetch.mockResolvedValue(
        new Response(rdfContent, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        { topic: 'https://pod.example.com/new-inbox/', handler: 'InboxModified', actor: 'https://pod.example.com/actor#me' },
      ])

      mockSubscribeWebhookChannel.mockResolvedValue({
        id: 'https://example.com/sub/456',
        receiveFrom: 'https://example.com/receive/456',
        topic: 'https://pod.example.com/new-inbox/',
      })

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockSubscribeWebhookChannel).toHaveBeenCalledWith(
        'https://pod.example.com/new-inbox/',
        'https://example.com/webhook',
        mockFetch
      )
      expect(mockContext.subscriptions).toHaveLength(1)
      expect(mockContext.subscriptions[0]).toMatchObject({
        id: 'https://example.com/sub/456',
        receiveFrom: 'https://example.com/receive/456',
        topic: 'https://pod.example.com/new-inbox/',
        status: 'active',
      })
      expect(mockContext.registrations).toHaveLength(1)
      expect(mockContext.registrations[0]).toMatchObject({
        handler: 'InboxModified',
        topic: 'https://pod.example.com/new-inbox/',
        actor: 'https://pod.example.com/actor#me',
      })
    })

    it('should register WikiIndexer with indexUrl and explicit maxDepth and initialize', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      mockFetch.mockResolvedValue(new Response('', { status: 200 }))
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        {
          topic: 'https://pod.example.com/wiki/',
          handler: 'WikiIndexer',
          indexUrl: 'https://pod.example.com/index.ttl',
          maxDepth: 3,
        },
      ])

      mockSubscribeWebhookChannel.mockResolvedValue({
        id: 'https://example.com/sub/wiki',
        receiveFrom: 'https://example.com/receive/wiki',
        topic: 'https://pod.example.com/wiki/',
      })

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockContext.registrations).toHaveLength(1)
      expect(mockContext.registrations[0]).toMatchObject({
        handler: 'WikiIndexer',
        topic: 'https://pod.example.com/wiki/',
        indexUrl: 'https://pod.example.com/index.ttl',
        maxDepth: 3,
      })
      expect(initializeWikiIndexers).toHaveBeenCalledWith(mockContext, mockFetch)
    })

    it('should default WikiIndexer maxDepth to 1 when omitted', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      mockFetch.mockResolvedValue(new Response('', { status: 200 }))
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        {
          topic: 'https://pod.example.com/wiki/',
          handler: 'WikiIndexer',
          indexUrl: 'https://pod.example.com/index.ttl',
        },
      ])

      mockSubscribeWebhookChannel.mockResolvedValue({
        id: 'https://example.com/sub/wiki',
        receiveFrom: 'https://example.com/receive/wiki',
        topic: 'https://pod.example.com/wiki/',
      })

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockContext.registrations).toHaveLength(1)
      expect(mockContext.registrations[0]).toMatchObject({
        handler: 'WikiIndexer',
        indexUrl: 'https://pod.example.com/index.ttl',
        maxDepth: 1,
      })
      expect(initializeWikiIndexers).toHaveBeenCalledWith(mockContext, mockFetch)
    })

    it('should fail WikiIndexer registration when indexUrl is missing', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      mockFetch.mockResolvedValue(new Response('', { status: 200 }))
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        { topic: 'https://pod.example.com/wiki/', handler: 'WikiIndexer' },
      ])

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockContext.subscriptions).toHaveLength(1)
      expect(mockContext.subscriptions[0]).toMatchObject({
        topic: 'https://pod.example.com/wiki/',
        status: 'failed',
        error: 'WikiIndexer webhook is missing required :indexUrl',
      })
      expect(mockContext.registrations).toHaveLength(0)
      expect(mockSubscribeWebhookChannel).not.toHaveBeenCalled()
      expect(initializeWikiIndexers).not.toHaveBeenCalled()
    })

    it('should register CommitHandler with gitDir and not initialize WikiIndexers', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      mockFetch.mockResolvedValue(new Response('', { status: 200 }))
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        {
          topic: 'https://pod.example.com/repo/',
          handler: 'CommitHandler',
          gitDir: '/data/repos/example',
        },
      ])

      mockSubscribeWebhookChannel.mockResolvedValue({
        id: 'https://example.com/sub/repo',
        receiveFrom: 'https://example.com/receive/repo',
        topic: 'https://pod.example.com/repo/',
      })

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockContext.registrations).toHaveLength(1)
      expect(mockContext.registrations[0]).toMatchObject({
        handler: 'CommitHandler',
        topic: 'https://pod.example.com/repo/',
        gitDir: '/data/repos/example',
      })
      expect(initializeWikiIndexers).not.toHaveBeenCalled()
    })

    it('should fail CommitHandler registration when gitDir is missing', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      mockFetch.mockResolvedValue(new Response('', { status: 200 }))
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        { topic: 'https://pod.example.com/repo/', handler: 'CommitHandler' },
      ])

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockContext.subscriptions).toHaveLength(1)
      expect(mockContext.subscriptions[0]).toMatchObject({
        topic: 'https://pod.example.com/repo/',
        status: 'failed',
        error: 'CommitHandler webhook is missing required :gitDir',
      })
      expect(mockContext.registrations).toHaveLength(0)
      expect(mockSubscribeWebhookChannel).not.toHaveBeenCalled()
      expect(initializeWikiIndexers).not.toHaveBeenCalled()
    })

    it('should add subscription with failed status when subscribe fails', async () => {
      const { handleUpdateWebhooks } = await import('../../src/handlers/updateWebhooks.js')

      const rdfContent = `
        @prefix solid: <http://www.w3.org/ns/solid/terms#>.
        <https://pod.example.com/webhook#1> a <https://example.com/handlers#WebHook>;
          solid:topic <https://pod.example.com/new-inbox/>;
          solid:handler <https://example.com/handlers#InboxModified>.
      `
      mockFetch.mockResolvedValue(
        new Response(rdfContent, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        })
      )
      ;(parseWebhooksFromRDF as any).mockResolvedValue([
        { topic: 'https://pod.example.com/new-inbox/', handler: 'InboxModified' },
      ])

      mockSubscribeWebhookChannel.mockRejectedValue(new Error('Connection refused'))

      const event: WebhookEvent = {
        type: 'Update',
        object: 'https://example.com/config.ttl',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Update', object: 'https://example.com/config.ttl' },
      }

      await handleUpdateWebhooks(event, mockFetch, mockContext)

      expect(mockContext.subscriptions).toHaveLength(1)
      expect(mockContext.subscriptions[0]).toMatchObject({
        topic: 'https://pod.example.com/new-inbox/',
        status: 'failed',
        error: 'Connection refused',
      })
      expect(mockContext.registrations).toHaveLength(0)
    })
  })
})