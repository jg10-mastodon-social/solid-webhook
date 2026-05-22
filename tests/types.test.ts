import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  WebhookRegistration,
  SubscriptionInfo,
  WebhookEvent,
  SolidFetch,
  Config,
  WebhookHandler,
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
      const handler: WebhookHandler = vi.fn().mockResolvedValue(undefined)
      await handler({ type: 'Add', object: '', topic: '', raw: {} })
      expect(handler).toHaveBeenCalled()
    })
  })

  describe('Config', () => {
    it('should define required fields', () => {
      const config: Config = {
        webId: 'https://example.com/profile/card#me',
        issuer: 'https://example.com',
        webhookEndpoint: '/webhook',
        port: 8080,
        sendToUrl: 'https://example.com/webhook/',
        whitelistedIssuers: ['https://solidcommunity.net', 'https://pod.example.com'],
      }
      expect(config.webId).toBeDefined()
      expect(config.issuer).toBeDefined()
      expect(config.port).toBeGreaterThan(0)
      expect(Array.isArray(config.whitelistedIssuers)).toBe(true)
    })
  })
})
