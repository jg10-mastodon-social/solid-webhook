import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SubscriptionInfo, SolidFetch } from '../../src/types/index.js'

const mockFetch = vi.fn()

vi.mock('@soid/koa', () => ({
  getAuthenticatedFetch: vi.fn().mockResolvedValue(mockFetch),
}))

const mockStorageDescription = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix notifications: <http://www.w3.org/ns/solid/notifications#> .

<https://pod.example.com/> solid:storageDescription <https://pod.example.com/.well-known/solid-storage> .
`

const mockSocketList = `
@prefix notifications: <http://www.w3.org/ns/solid/notifications#> .

<https://pod.example.com/.well-known/solid-storage> notifications:channelType notifications:WebhookChannel2023 .
`

describe('WebhookChannel Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createMockFetch = (responses: Map<string, () => Response>): SolidFetch => {
    return async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString()
      const key = Array.from(responses.keys()).find(k => urlStr.includes(k) || k.includes(urlStr)) || urlStr
      const responseFactory = responses.get(key) || responses.get(urlStr)
      if (!responseFactory) {
        throw new Error(`No mock response for ${urlStr}`)
      }
      return responseFactory()
    }
  }

  describe('subscribeWebhookChannel', () => {
    it('should subscribe to WebhookChannel2023', async () => {
      const mockSubscriptionResponse = JSON.stringify({
        '@context': 'https://www.w3.org/ns/solid/notification/v1',
        type: 'http://www.w3.org/ns/solid/notifications#WebhookChannel2023',
        id: 'https://pod.example.com/webhook/123',
        receiveFrom: 'https://pod.example.com/webhook/receive/123',
      })

      mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()
        
        if (init?.method === 'HEAD' && urlStr.includes('/inbox/')) {
          return new Response(null, {
            status: 200,
            headers: {
              'link': '<https://pod.example.com/.well-known/solid-storage>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
            },
          })
        }
        
        if (urlStr.includes('solid-storage') && init?.method === undefined) {
          return new Response(mockSocketList, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        }
        
        if (urlStr.includes('solid-storage') && init?.method === 'POST') {
          return new Response(mockSubscriptionResponse, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        
        throw new Error(`Unexpected URL: ${urlStr}`)
      })

      const { subscribeWebhookChannel } = await import('../../src/services/webhookChannel.js')
      
      const result = await subscribeWebhookChannel(
        'https://pod.example.com/inbox/',
        'https://pod.example.com/webhook/',
        mockFetch
      )

      expect(result).toMatchObject({
        id: 'https://pod.example.com/webhook/123',
        receiveFrom: 'https://pod.example.com/webhook/receive/123',
        topic: 'https://pod.example.com/inbox/',
      })
    })

    it('should throw if topic URL returns no storage description', async () => {
      const mockResponses = new Map<string, () => Response>([
        [
          'inbox',
          () => new Response(null, { status: 200 }),
        ],
      ])

      mockFetch.mockImplementation(createMockFetch(mockResponses))

      const { subscribeWebhookChannel } = await import('../../src/services/webhookChannel.js')
      
      await expect(
        subscribeWebhookChannel(
          'https://pod.example.com/inbox/',
          'https://pod.example.com/webhook/',
          mockFetch
        )
      ).rejects.toThrow('No storage description link found')
    })

    it('should throw if no WebhookChannel2023 socket is found', async () => {
      const mockResponses = new Map<string, () => Response>([
        [
          'inbox',
          () => new Response(null, {
            status: 200,
            headers: {
              'link': '<https://pod.example.com/.well-known/solid-storage>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
            },
          }),
        ],
        [
          'solid-storage',
          () => new Response(`
@prefix notifications: <http://www.w3.org/ns/solid/notifications#> .
<https://pod.example.com/.well-known/solid-storage> notifications:channelType notifications:WebSocketChannel2023 .
`, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          }),
        ],
      ])

      mockFetch.mockImplementation(createMockFetch(mockResponses))

      const { subscribeWebhookChannel } = await import('../../src/services/webhookChannel.js')
      
      await expect(
        subscribeWebhookChannel(
          'https://pod.example.com/inbox/',
          'https://pod.example.com/webhook/',
          mockFetch
        )
      ).rejects.toThrow('No WebhookChannel2023 socket found')
    })

    it('should find storage description when not first in multi-value Link header', async () => {
      const mockSubscriptionResponse = JSON.stringify({
        '@context': 'https://www.w3.org/ns/solid/notification/v1',
        type: 'http://www.w3.org/ns/solid/notifications#WebhookChannel2023',
        id: 'https://pod.example.com/webhook/456',
        receiveFrom: 'https://pod.example.com/webhook/receive/456',
      })

      mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()

        if (init?.method === 'HEAD' && urlStr.includes('/inbox/')) {
          return new Response(null, {
            status: 200,
            headers: {
              'link': '<http://www.w3.org/ns/ldp#Resource>; rel="type", <https://pod.example.com/.well-known/solid-storage>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
            },
          })
        }

        if (urlStr.includes('solid-storage') && init?.method === undefined) {
          return new Response(mockSocketList, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        }

        if (urlStr.includes('solid-storage') && init?.method === 'POST') {
          return new Response(mockSubscriptionResponse, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }

        throw new Error(`Unexpected URL: ${urlStr}`)
      })

      const { subscribeWebhookChannel } = await import('../../src/services/webhookChannel.js')

      const result = await subscribeWebhookChannel(
        'https://pod.example.com/inbox/',
        'https://pod.example.com/webhook/',
        mockFetch
      )

      expect(result).toMatchObject({
        id: 'https://pod.example.com/webhook/456',
        receiveFrom: 'https://pod.example.com/webhook/receive/456',
        topic: 'https://pod.example.com/inbox/',
      })
    })

    it('should find storage description when Link header has multiple separate entries', async () => {
      const mockSubscriptionResponse = JSON.stringify({
        '@context': 'https://www.w3.org/ns/solid/notification/v1',
        type: 'http://www.w3.org/ns/solid/notifications#WebhookChannel2023',
        id: 'https://pod.example.com/webhook/789',
        receiveFrom: 'https://pod.example.com/webhook/receive/789',
      })

      mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString()

        if (init?.method === 'HEAD' && urlStr.includes('/inbox/')) {
          const headers = new Headers()
          headers.append('link', '<http://www.w3.org/ns/ldp#Resource>; rel="type"')
          headers.append('link', '<https://pod.example.com/.well-known/solid-storage>; rel="http://www.w3.org/ns/solid/terms#storageDescription"')
          return new Response(null, { status: 200, headers })
        }

        if (urlStr.includes('solid-storage') && init?.method === undefined) {
          return new Response(mockSocketList, {
            status: 200,
            headers: { 'content-type': 'text/turtle' },
          })
        }

        if (urlStr.includes('solid-storage') && init?.method === 'POST') {
          return new Response(mockSubscriptionResponse, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }

        throw new Error(`Unexpected URL: ${urlStr}`)
      })

      const { subscribeWebhookChannel } = await import('../../src/services/webhookChannel.js')

      const result = await subscribeWebhookChannel(
        'https://pod.example.com/inbox/',
        'https://pod.example.com/webhook/',
        mockFetch
      )

      expect(result).toMatchObject({
        id: 'https://pod.example.com/webhook/789',
        receiveFrom: 'https://pod.example.com/webhook/receive/789',
        topic: 'https://pod.example.com/inbox/',
      })
    })
  })

  describe('unsubscribeWebhookChannel', () => {
    it('should unsubscribe from a webhook channel', async () => {
      mockFetch.mockResolvedValue(
        new Response(null, { status: 204 })
      )

      const { unsubscribeWebhookChannel } = await import('../../src/services/webhookChannel.js')
      
      await expect(
        unsubscribeWebhookChannel(
          'https://pod.example.com/webhook/123',
          mockFetch
        )
      ).resolves.toBeUndefined()
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://pod.example.com/webhook/123',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('should throw on unsubscribe error', async () => {
      mockFetch.mockResolvedValue(
        new Response('Error', { status: 500 })
      )

      const { unsubscribeWebhookChannel } = await import('../../src/services/webhookChannel.js')
      
      await expect(
        unsubscribeWebhookChannel(
          'https://pod.example.com/webhook/123',
          mockFetch
        )
      ).rejects.toThrow('Failed to unsubscribe')
    })
  })
})
