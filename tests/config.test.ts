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

    it('should parse INBOX_PAGE_SIZE env var', async () => {
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://solidcommunity.net'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.ADMIN_WEBID = 'https://pod.example.com/profile/card#me'
      process.env.INBOX_PAGE_SIZE = '100'

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()
      expect(config.inboxPageSize).toBe(100)
    })

    it('should use default inboxPageSize when INBOX_PAGE_SIZE is not set', async () => {
      process.env.WEBID = 'https://pod.example.com/profile/card#me'
      process.env.ISSUER = 'https://solidcommunity.net'
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      process.env.HANDLER_BASE_URL = 'https://pod.example.com/handlers#'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.ADMIN_WEBID = 'https://pod.example.com/profile/card#me'
      delete process.env.INBOX_PAGE_SIZE

      const { loadConfig } = await import('../src/config.js')
      const config = loadConfig()
      expect(config.inboxPageSize).toBeUndefined()
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

    it('should parse maxDepth from WikiIndexer webhook', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :wikiWebhook a :WebHook;
          :topic <https://pod.example.com/wiki/>;
          :handler <https://example.com/handlers#WikiIndexer>;
          :indexUrl <https://pod.example.com/wiki/index.ttl>;
          :maxDepth 2 .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].handler).toBe('WikiIndexer')
      expect(webhooks[0].maxDepth).toBe(2)
    })

    it('should default WikiIndexer maxDepth to 1 when omitted', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :wikiWebhook a :WebHook;
          :topic <https://pod.example.com/wiki/>;
          :handler <https://example.com/handlers#WikiIndexer>;
          :indexUrl <https://pod.example.com/wiki/index.ttl> .
      `

      const { parseWebhooksFromRDF, createWebhookRegistrations } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
      const registrations = createWebhookRegistrations(webhooks, {})

      expect(registrations).toHaveLength(1)
      expect(registrations[0].handler).toBe('WikiIndexer')
      expect((registrations[0] as any).maxDepth).toBe(1)
    })

    it('should throw when WikiIndexer maxDepth is negative', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :wikiWebhook a :WebHook;
          :topic <https://pod.example.com/wiki/>;
          :handler <https://example.com/handlers#WikiIndexer>;
          :indexUrl <https://pod.example.com/wiki/index.ttl>;
          :maxDepth -1 .
      `

      const { parseWebhooksFromRDF, createWebhookRegistrations } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(() => createWebhookRegistrations(webhooks, {})).toThrow('WikiIndexer :maxDepth must be a non-negative integer')
    })

    it('should throw when WikiIndexer maxDepth is not an integer', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :wikiWebhook a :WebHook;
          :topic <https://pod.example.com/wiki/>;
          :handler <https://example.com/handlers#WikiIndexer>;
          :indexUrl <https://pod.example.com/wiki/index.ttl>;
          :maxDepth 1.5 .
      `

      const { parseWebhooksFromRDF, createWebhookRegistrations } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(() => createWebhookRegistrations(webhooks, {})).toThrow('WikiIndexer :maxDepth must be a non-negative integer')
    })

    it('should throw when WikiIndexer maxDepth is not a number', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :wikiWebhook a :WebHook;
          :topic <https://pod.example.com/wiki/>;
          :handler <https://example.com/handlers#WikiIndexer>;
          :indexUrl <https://pod.example.com/wiki/index.ttl>;
          :maxDepth "two" .
      `

      const { parseWebhooksFromRDF, createWebhookRegistrations } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

      expect(() => createWebhookRegistrations(webhooks, {})).toThrow('WikiIndexer :maxDepth must be a non-negative integer')
    })

    it('should resolve a relative :topic against the webhook config document', async () => {
      const handlerBaseUrl = 'https://pod.example.com/pod/settings/webhooks.ttl#'
      const baseIri = 'https://pod.example.com/pod/settings/webhooks.ttl'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :routeWebhook a :WebHook;
          :topic <../notes/wiki-router.ttl>;
          :handler <#RouteInbox> .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl, baseIri)

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].topic).toBe('https://pod.example.com/pod/notes/wiki-router.ttl')
      expect(webhooks[0].handler).toBe('RouteInbox')
    })

    it('should read a fragment handler and subject when a base IRI is given', async () => {
      const handlerBaseUrl = 'https://pod.example.com/pod/settings/webhooks.ttl#'
      const baseIri = 'https://pod.example.com/pod/settings/webhooks.ttl'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        <#routeWebhook> a :WebHook;
          :topic <https://pod.example.com/pod/notes/wiki-router.ttl>;
          :handler <#RouteInbox> .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl, baseIri)

      expect(webhooks).toHaveLength(1)
      expect(webhooks[0].handler).toBe('RouteInbox')
      expect(webhooks[0].topic).toBe('https://pod.example.com/pod/notes/wiki-router.ttl')
    })

    it('should leave absolute IRIs untouched when a base IRI is given', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :webhook1 a :WebHook;
          :topic <https://example.com/inbox/>;
          :handler <https://example.com/handlers#InboxModified> .
      `

      const { parseWebhooksFromRDF } = await import('../src/config.js')
      const withoutBase = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
      const withBase = await parseWebhooksFromRDF(
        rdfContent,
        handlerBaseUrl,
        'https://pod.example.com/pod/settings/webhooks.ttl'
      )

      expect(withBase).toEqual(withoutBase)
      expect(withBase[0].topic).toBe('https://example.com/inbox/')
      expect(withBase[0].handler).toBe('InboxModified')
    })

    it('should build a RouteInbox registration from handler and topic only', async () => {
      const handlerBaseUrl = 'https://example.com/handlers#'
      const rdfContent = `
        @prefix : <${handlerBaseUrl}> .

        :routeWebhook a :WebHook;
          :topic <https://pod.example.com/pod/notes/wiki-router.ttl>;
          :handler <https://example.com/handlers#RouteInbox> .
      `

      const { parseWebhooksFromRDF, createWebhookRegistrations } = await import('../src/config.js')
      const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
      const registrations = createWebhookRegistrations(webhooks, {})

      expect(registrations).toHaveLength(1)
      expect(registrations[0].handler).toBe('RouteInbox')
      expect(registrations[0].topic).toBe('https://pod.example.com/pod/notes/wiki-router.ttl')
    })
  })
})
