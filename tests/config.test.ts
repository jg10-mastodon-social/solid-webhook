import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Config, WebhookRegistration } from '../src/types/index.js'

const originalEnv = process.env

describe('Config', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('loadConfig', () => {
    it('should load config from environment variables', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net,https://pod.example.com'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8080'
      process.env.WEBHOOK_ENDPOINT = '/webhook'
      process.env.PORT = '8080'
      process.env.SEND_TO_URL = 'https://pod.example.com/webhook/'
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://pod.example.com'
      process.env.ADMIN_WEBID = 'https://pod.example.com/profile/card#me'

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()

      expect(config.webId).toBe('https://pod.example.com/profile/card#me')
      expect(config.issuer).toBe('https://pod.example.com')
      expect(config.webhookEndpoint).toBe('/webhook')
      expect(config.port).toBe(8080)
      expect(config.sendToUrl).toBe('https://pod.example.com/webhook/')
      expect(config.whitelistedIssuers).toEqual(['https://solidcommunity.net', 'https://pod.example.com'])
      expect(config.webhookConfigUrl).toBe('https://pod.example.com/webhooks.ttl')
      expect(config.handlerBaseUrl).toBe('https://pod.example.com/handlers#')
      expect(config.baseUrl).toBe('http://localhost:8080')
      expect(config.adminWebId).toBe('https://pod.example.com/profile/card#me')
    })

    it('should return empty whitelistedIssuers when WHITELISTED_ISSUERS is missing and no webhooks provided', async () => {
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()
      expect(config.whitelistedIssuers).toEqual([])
    })

    it('should throw if WEBHOOK_CONFIG_URL is missing', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.BASE_URL = 'http://localhost:8081'
      delete process.env.WEBHOOK_CONFIG_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('WEBHOOK_CONFIG_URL is required')
    })

    it('should throw if required BASE_URL is missing', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      delete process.env.BASE_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('BASE_URL is required')
    })

    it('should throw if HANDLER_BASE_URL is missing', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.BASE_URL = 'http://localhost:8081'
      delete process.env.HANDLER_BASE_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('HANDLER_BASE_URL is required')
    })

    it('should load all required config including webhook vars', async () => {
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://pod.example.com'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net,https://pod.example.com'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/settings/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/settings/webhooks.ttl#'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.ADMIN_WEBID = 'https://pod.example.com/profile/card#me'

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()

      expect(config.webhookConfigUrl).toBe('https://pod.example.com/settings/webhooks.ttl')
      expect(config.handlerBaseUrl).toBe('https://pod.example.com/settings/webhooks.ttl#')
    })

    it('should use defaults for optional values', async () => {
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://solidcommunity.net'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.SEND_TO_URL = 'https://pod.example.com/webhook/'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.ADMIN_WEBID = 'https://pod.example.com/profile/card#me'
      delete process.env.PORT
      delete process.env.WEBHOOK_ENDPOINT

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()

      expect(config.port).toBe(8081)
      expect(config.webhookEndpoint).toBe('/webhook')
      expect(config.sendToUrl).toBe('https://pod.example.com/webhook/')
    })

    it('should accept issuer in whitelist', async () => {
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://solidcommunity.net'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.ADMIN_WEBID = 'https://pod.example.com/profile/card#me'

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()
      expect(config.issuer).toBe('https://solidcommunity.net')
    })
  })

  describe('parseWebhooksFromRDF', () => {
    it('should parse valid RDF webhook configuration using handlerBaseUrl as namespace', async () => {
      const handlerBaseUrl = 'https://example.com/settings/webhooks.ttl#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .
        @prefix as: <https://www.w3.org/ns/activitystreams#> .

        :webhook1 a :WebHook;
          :topic <https://example.com/inbox/>;
          :handler <https://example.com/handlers#InboxModified>;
          :actor <https://example.com/actor/#me> .

        :webhook2 a :WebHook;
          :topic <https://example.com/outbox/>;
          :handler <https://example.com/handlers#OutboxModified> .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(2)
      expect(webhooks[0]).toMatchObject({
        topic: 'https://example.com/inbox/',
        handler: 'InboxModified',
        actor: 'https://example.com/actor/#me',
      })
      expect(webhooks[1]).toMatchObject({
        topic: 'https://example.com/outbox/',
        handler: 'OutboxModified',
      })
    })

    it('should return empty array for empty RDF', async () => {
      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF('', 'https://example.com/handlers')
      expect(webhooks).toEqual([])
    })

    it('should throw on invalid RDF syntax', async () => {
      const invalidRdf = 'this is not valid RDF'
      const { parseWebhooksFromRDF } = await import('../src/config.js')
      await expect(parseWebhooksFromRDF(invalidRdf, '')).rejects.toThrow()
    })

    it('should handle multiple handlers', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :webhook1 a :WebHook;
          :topic <https://example.com/inbox/>;
          :handler <https://example.com/handlers#InboxModified> .

        :webhook2 a :WebHook;
          :topic <https://example.com/inbox/>;
          :handler <https://example.com/handlers#ItemListIndexer> .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(2)
    })

    it('should parse gitDir from webhook configuration', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :commitWebhook a :WebHook;
          :topic <https://pod.example.com/.git/COMMIT_EDITMSG>;
          :handler <https://example.com/handlers#CommitHandler>;
          :gitDir "/repos/myrepo" .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].gitDir).toBe('/repos/myrepo')
      expect(webhooks[0].handler).toBe('CommitHandler')
      expect(webhooks[0].topic).toBe('https://pod.example.com/.git/COMMIT_EDITMSG')
    })

    it('should parse indexUrl from ItemListIndexer webhook', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :indexWebhook a :WebHook;
          :topic <https://pod.example.com/tasks/main/>;
          :handler <https://example.com/handlers#ItemListIndexer>;
          :indexUrl <https://pod.example.com/tasks/index.ttl> .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].handler).toBe('ItemListIndexer')
      expect(webhooks[0].topic).toBe('https://pod.example.com/tasks/main/')
      expect((webhooks[0] as any).indexUrl).toBe('https://pod.example.com/tasks/index.ttl')
    })

    it('should throw when ItemListIndexer is missing :indexUrl', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :indexWebhook a :WebHook;
          :topic <https://pod.example.com/tasks/main/>;
          :handler <https://example.com/handlers#ItemListIndexer> .
      `

      const { parseWebhooksFromRDF, createWebhookRegistrations } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(1)
      expect(() => createWebhookRegistrations(webhooks, {})).toThrow('ItemListIndexer webhook is missing required :indexUrl')
    })

    it('should throw when CommitHandler is missing :gitDir', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :commitWebhook a :WebHook;
          :topic <https://pod.example.com/.git/COMMIT_EDITMSG>;
          :handler <https://example.com/handlers#CommitHandler> .
      `

      const { parseWebhooksFromRDF, createWebhookRegistrations } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(1)
      expect(() => createWebhookRegistrations(webhooks, {})).toThrow('CommitHandler webhook is missing required :gitDir')
    })
  })
})
