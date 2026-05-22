import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://solidcommunity.net'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()

      expect(config.webId).toBe('https://pod.example.com/profile/card#me')
      expect(config.webhookConfigUrl).toBe('https://pod.example.com/webhooks.ttl')
      expect(config.handlerBaseUrl).toBe('https://pod.example.com/handlers#')
    })

    it('should fail without WEBHOOK_CONFIG_URL', async () => {
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://pod.example.com'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      delete process.env.WEBHOOK_CONFIG_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('WEBHOOK_CONFIG_URL is required')
    })

    it('should fail without HANDLER_BASE_URL', async () => {
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://pod.example.com'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      delete process.env.HANDLER_BASE_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('HANDLER_BASE_URL is required')
    })
  })

  describe('Webhook parsing', () => {
    it('should parse handler names from RDF', async () => {
      const { parseWebhooksFromRDF } = await import('../src/config.js')

      const rdfContent = `@prefix : <https://example.com/settings/webhooks.ttl#> .
:webhook1 a :WebHook;
  :topic <https://pod.example.com/inbox/>;
  :handler <https://example.com/handlers#InboxModified> .`

      const webhooks = await parseWebhooksFromRDF(rdfContent, 'https://example.com/handlers#')

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].topic).toBe('https://pod.example.com/inbox/')
      expect(webhooks[0].handler).toBe('InboxModified')
    })
  })
})