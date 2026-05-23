import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { subscribeWebhookChannel } from '../src/services/webhookChannel.js'

vi.mock('@soid/koa', () => ({
  getAuthenticatedFetch: vi.fn().mockResolvedValue(vi.fn()),
  solidIdentity: vi.fn().mockReturnValue({
    routes: vi.fn().mockReturnValue([]),
  }),
}))

const mockFetch = vi.fn()
vi.mock('../src/services/solidFetch.js', () => ({
  createSolidFetch: vi.fn().mockResolvedValue(mockFetch),
}))

vi.mock('../src/services/webhookChannel.js', () => ({
  subscribeWebhookChannel: vi.fn().mockResolvedValue({
    id: 'https://pod.example.com/webhook/123',
    receiveFrom: 'https://pod.example.com/webhook/receive/123',
    topic: 'https://pod.example.com/inbox/',
  }),
  unsubscribeWebhookChannel: vi.fn().mockResolvedValue(undefined),
}))

const originalEnv = process.env

describe('Main Entry Point', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('main.ts execution', () => {
    it('should be runnable with all config present', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://solidcommunity.net'
      process.env.ADMIN_WEBID = 'https://pod.example.com/profile/card#me'

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()

      expect(config.webId).toBe('https://pod.example.com/profile/card#me')
      expect(config.webhookConfigUrl).toBe('https://pod.example.com/webhooks.ttl')
      expect(config.handlerBaseUrl).toBe('https://pod.example.com/handlers#')
      expect(config.baseUrl).toBe('http://localhost:8081')
    })

    it('should fail without WEBHOOK_CONFIG_URL', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.BASE_URL = 'http://localhost:8081'
      delete process.env.WEBHOOK_CONFIG_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('WEBHOOK_CONFIG_URL is required')
    })

    it('should fail without HANDLER_BASE_URL', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      delete process.env.HANDLER_BASE_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('HANDLER_BASE_URL is required')
    })
  })

  describe('Webhook parsing', () => {
    it('should parse handler names from RDF using handlerBaseUrl as namespace', async () => {
      const { parseWebhooksFromRDF } = await import('../src/config.js')

      const handlerBaseUrl = 'https://example.com/settings/webhooks.ttl#'
      const rdfContent = `@prefix : <${handlerBaseUrl}> .
:webhook1 a :WebHook;
  :topic <https://pod.example.com/inbox/>;
  :handler <https://example.com/handlers#InboxModified> .`

      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].topic).toBe('https://pod.example.com/inbox/')
      expect(webhooks[0].handler).toBe('InboxModified')
    })
  })

  describe('Webhook subscription handling', () => {
    it('should not subscribe to topics with unknown handlers', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8083'
      process.env.SEND_TO_URL = 'https://pod.example.com/webhook/'

      const rdfContent = `
@prefix : <https://pod.example.com/handlers#>.
<https://pod.example.com/handlers#webhook1> a :WebHook;
  :topic <https://pod.example.com/tasks/main/>;
  :handler <https://pod.example.com/handlers#UnknownHandler>.
      `.trim()

      mockFetch.mockImplementation((url: string) => {
        if (url === 'https://pod.example.com/webhooks.ttl') {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve(rdfContent),
          })
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
      })

      vi.mocked(subscribeWebhookChannel).mockClear()

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { main } = await import('../src/main.js')

      main()

      await new Promise(resolve => setTimeout(resolve, 500))

      const subscribeCalls = vi.mocked(subscribeWebhookChannel).mock.calls
      const topicsSubscribed = subscribeCalls.map(call => call[0])
      expect(topicsSubscribed).not.toContain('https://pod.example.com/tasks/main/')

      consoleErrorSpy.mockRestore()
    })

    it('should subscribe to topics with known handlers', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8083'
      process.env.SEND_TO_URL = 'https://pod.example.com/webhook/'

      const rdfContent = `
@prefix : <https://pod.example.com/handlers#>.
<https://pod.example.com/handlers#webhook1> a :WebHook;
  :topic <https://pod.example.com/inbox/>;
  :handler <https://pod.example.com/handlers#InboxModified>.
      `.trim()

      mockFetch.mockImplementation((url: string) => {
        if (url === 'https://pod.example.com/webhooks.ttl') {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve(rdfContent),
          })
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
      })

      vi.mocked(subscribeWebhookChannel).mockClear()

      const { main } = await import('../src/main.js')

      main()

      await new Promise(resolve => setTimeout(resolve, 500))

      const subscribeCalls = vi.mocked(subscribeWebhookChannel).mock.calls
      const topicsSubscribed = subscribeCalls.map(call => call[0])
      expect(topicsSubscribed).toContain('https://pod.example.com/inbox/')
    })
  })

  describe('Webhook config fetch failure', () => {
    it('should not crash server when webhook config fetch fails', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.SEND_TO_URL = 'https://pod.example.com/webhook/'

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { main } = await import('../src/main.js')

      main()

      await new Promise(resolve => setTimeout(resolve, 200))

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Webhook configuration unavailable')
      )

      consoleErrorSpy.mockRestore()
    })

    it('should subscribe to the webhook config URL itself', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.SEND_TO_URL = 'https://pod.example.com/webhook/'

      const rdfContent = `
        @prefix solid: <http://www.w3.org/ns/solid/terms#>.
        <https://pod.example.com/handlers#webhook1> a <https://pod.example.com/handlers#WebHook>;
          solid:topic <https://pod.example.com/inbox/>;
          solid:handler <https://pod.example.com/handlers#InboxModified>.
      `

      let callCount = 0
      mockFetch.mockImplementation((url: string) => {
        if (url === 'https://pod.example.com/webhooks.ttl') {
          return Promise.resolve({
            ok: true,
            status: 200,
            statusText: 'OK',
            text: () => Promise.resolve(rdfContent),
          })
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') })
      })

      const { subscribeWebhookChannel } = await import('../src/services/webhookChannel.js')
      vi.mocked(subscribeWebhookChannel).mockImplementation((topic: string) => {
        callCount++
        return Promise.resolve({
          id: `https://pod.example.com/webhook/${callCount}`,
          receiveFrom: `https://pod.example.com/webhook/receive/${callCount}`,
          topic,
        })
      })

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { main } = await import('../src/main.js')

      main()

      await new Promise(resolve => setTimeout(resolve, 300))

      const calls = vi.mocked(subscribeWebhookChannel).mock.calls
      expect(calls.some(call => call[0] === 'https://pod.example.com/webhooks.ttl')).toBe(true)

      consoleErrorSpy.mockRestore()
    })
  })
})