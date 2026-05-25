import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  WebhookRegistration,
  SubscriptionInfo,
  WebhookEvent,
  SolidFetch,
  Config,
  WebhookHandler,
  InboxCollection,
  InboxPage,
  ActivityStreamsObject,
  PageInfo,
} from '../src/types/index.js'

describe('Types', () => {
  describe('WebhookRegistration', () => {
    it('should define required topic and callback fields', () => {
      const registration: WebhookRegistration = {
        topic: 'https://example.com/inbox/',
        callback: vi.fn(),
      }
      expect(registration.topic).toBeDefined()
      expect(typeof registration.callback).toBe('function')
    })

    it('should allow optional actor field', () => {
      const registration: WebhookRegistration = {
        topic: 'https://example.com/inbox/',
        callback: vi.fn(),
        actor: 'https://example.com/actor/#me',
      }
      expect(registration.actor).toBe('https://example.com/actor/#me')
    })
  })

  describe('SubscriptionInfo', () => {
    it('should define required fields', () => {
      const info: SubscriptionInfo = {
        id: 'https://example.com/subscription/123',
        receiveFrom: 'wss://example.com/ws/123',
        topic: 'https://example.com/inbox/',
      }
      expect(info.id).toBeDefined()
      expect(info.receiveFrom).toBeDefined()
      expect(info.topic).toBeDefined()
    })
  })

  describe('WebhookEvent', () => {
    it('should define required fields', () => {
      const event: WebhookEvent = {
        type: 'Add',
        object: 'https://example.com/activities/123',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Add', object: 'https://example.com/activities/123' },
      }
      expect(event.type).toMatch(/^(Add|Remove)$/)
      expect(event.object).toBeDefined()
      expect(event.topic).toBeDefined()
    })

    it('should support Remove event type', () => {
      const event: WebhookEvent = {
        type: 'Remove',
        object: 'https://example.com/activities/123',
        topic: 'https://example.com/inbox/',
        raw: { type: 'Remove', object: 'https://example.com/activities/123' },
      }
      expect(event.type).toBe('Remove')
    })
  })

  describe('SolidFetch', () => {
    it('should be a function type', () => {
      const fetch: SolidFetch = vi.fn()
      expect(typeof fetch).toBe('function')
    })
  })

  describe('WebhookHandler', () => {
    it('should be an async function type', async () => {
      const mockFetch = vi.fn()
      const handler: WebhookHandler = vi.fn().mockResolvedValue(undefined)
      await handler({ type: 'Add', object: '', topic: '', raw: {} }, mockFetch)
      expect(handler).toHaveBeenCalled()
    })
  })

  describe('Config', () => {
    it('should define required fields', () => {
      const config: Config = {
        webId: 'https://example.com/profile/card#me',
        issuer: 'https://example.com',
        baseUrl: 'http://localhost:8080',
        webhookEndpoint: '/webhook',
        port: 8080,
        sendToUrl: 'https://example.com/webhook/',
        whitelistedIssuers: ['https://solidcommunity.net', 'https://pod.example.com'],
        webhookConfigUrl: 'https://example.com/webhooks.ttl',
        handlerBaseUrl: 'https://example.com/handlers#',
        adminWebId: 'https://example.com/profile/card#me',
      }
      expect(config.webId).toBeDefined()
      expect(config.issuer).toBeDefined()
      expect(config.port).toBeGreaterThan(0)
      expect(Array.isArray(config.whitelistedIssuers)).toBe(true)
      expect(config.webhookConfigUrl).toBeDefined()
      expect(config.handlerBaseUrl).toBeDefined()
      expect(config.adminWebId).toBeDefined()
    })

    it('should allow optional skolemizeBase field', () => {
      const config: Config = {
        webId: 'https://example.com/profile/card#me',
        issuer: 'https://example.com',
        baseUrl: 'http://localhost:8080',
        webhookEndpoint: '/webhook',
        port: 8080,
        sendToUrl: 'https://example.com/webhook/',
        whitelistedIssuers: ['https://solidcommunity.net'],
        webhookConfigUrl: 'https://example.com/webhooks.ttl',
        handlerBaseUrl: 'https://example.com/handlers#',
        adminWebId: 'https://example.com/profile/card#me',
        skolemizeBase: 'https://example.com/.well-known/genid/',
      }
      expect(config.skolemizeBase).toBe('https://example.com/.well-known/genid/')
    })
  })

  describe('InboxCollection', () => {
    it('should define required id and type fields', () => {
      const collection: InboxCollection = {
        id: 'https://example.com/inbox/',
        type: 'OrderedCollection',
      }
      expect(collection.id).toBeDefined()
      expect(collection.type).toBe('OrderedCollection')
    })

    it('should allow optional first, last, and totalItems', () => {
      const collection: InboxCollection = {
        id: 'https://example.com/inbox/',
        type: 'OrderedCollection',
        first: 'https://example.com/inbox/pages/1234567890',
        last: 'https://example.com/inbox/pages/1234500000',
        totalItems: 1000,
      }
      expect(collection.first).toBeDefined()
      expect(collection.last).toBeDefined()
      expect(collection.totalItems).toBe(1000)
    })
  })

  describe('InboxPage', () => {
    it('should define required id, type, and partOf fields', () => {
      const page: InboxPage = {
        id: 'https://example.com/inbox/pages/1234567890',
        type: 'OrderedCollectionPage',
        partOf: 'https://example.com/inbox/',
      }
      expect(page.id).toBeDefined()
      expect(page.type).toBe('OrderedCollectionPage')
      expect(page.partOf).toBeDefined()
    })

    it('should allow optional items and orderedItems', () => {
      const page: InboxPage = {
        id: 'https://example.com/inbox/pages/1234567890',
        type: 'OrderedCollectionPage',
        partOf: 'https://example.com/inbox/',
        items: ['https://example.com/activities/1', 'https://example.com/activities/2'],
      }
      expect(page.items).toHaveLength(2)
    })
  })

  describe('ActivityStreamsObject', () => {
    it('should allow flexible properties', () => {
      const activity: ActivityStreamsObject = {
        type: 'Create',
        id: 'https://example.com/activities/1',
        actor: 'https://example.com/actor/#me',
        object: {
          type: 'Note',
          content: 'Hello world',
        },
      }
      expect(activity.type).toBe('Create')
      expect(activity.actor).toBe('https://example.com/actor/#me')
      expect(activity.object).toBeDefined()
    })

    it('should support actor as array', () => {
      const activity: ActivityStreamsObject = {
        type: 'Create',
        actor: ['https://example.com/actor/1', 'https://example.com/actor/2'],
      }
      expect(Array.isArray(activity.actor)).toBe(true)
    })
  })

  describe('PageInfo', () => {
    it('should define itemCount and isFull', () => {
      const info: PageInfo = {
        itemCount: 150,
        isFull: false,
      }
      expect(info.itemCount).toBe(150)
      expect(info.isFull).toBe(false)
    })
  })
})
