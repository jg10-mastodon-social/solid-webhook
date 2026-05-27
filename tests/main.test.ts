import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Config, WebhookRegistration } from '../src/types/index.js'

const originalEnv = process.env

describe('Config', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
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

    it('should throw if WHITELISTED_ISSUERS is missing', async () => {
      process.env.BASE_URL = 'http://localhost:8081'

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('WHITELISTED_ISSUERS is required')
    })

    it('should throw if WEBHOOK_CONFIG_URL is missing', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.BASE_URL = 'http://localhost:8081'
      delete process.env.WEBHOOK_CONFIG_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('WEBHOOK_CONFIG_URL is required')
    })

    it('should throw if HANDLER_BASE_URL is missing', async () => {
      process.env.WHITELISTED_ISSUERS = 'https://solidcommunity.net'
      process.env.BASE_URL = 'http://localhost:8081'
      process.env.WEBHOOK_CONFIG_URL = 'https://pod.example.com/webhooks.ttl'
      delete process.env.HANDLER_BASE_URL

      const { loadConfig } = await import('../src/config.js')
      expect(() => loadConfig()).toThrow('HANDLER_BASE_URL is required')
    })
  })
})

describe('parseWebhooksFromRDF', () => {
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

  it('should parse gitDir from CommitHandler webhook', async () => {
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
})

describe('Webhook handler dispatch', () => {
  it('should map InboxModified handler to correct registration type', async () => {
    const { parseWebhooksFromRDF } = await import('../src/config.js')

    const handlerBaseUrl = 'https://example.com/handlers#'
    const rdfContent = `
      @prefix : <${handlerBaseUrl}> .
      :webhook1 a :WebHook;
        :topic <https://pod.example.com/inbox/>;
        :handler <https://example.com/handlers#InboxModified>.
    `

    const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
    expect(webhooks).toHaveLength(1)
    expect(webhooks[0].handler).toBe('InboxModified')
  })

  it('should map CommitHandler with gitDir to correct registration type', async () => {
    const { parseWebhooksFromRDF } = await import('../src/config.js')

    const handlerBaseUrl = 'https://example.com/handlers#'
    const rdfContent = `
      @prefix : <${handlerBaseUrl}> .
      :commitWebhook a :WebHook;
        :topic <https://pod.example.com/.git/COMMIT_EDITMSG>;
        :handler <https://example.com/handlers#CommitHandler>;
        :gitDir "/repos/myrepo" .
    `

    const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
    expect(webhooks).toHaveLength(1)
    expect(webhooks[0].handler).toBe('CommitHandler')
    expect(webhooks[0].gitDir).toBe('/repos/myrepo')
  })

  it('should handle unknown handlers without throwing', async () => {
    const { parseWebhooksFromRDF } = await import('../src/config.js')

    const handlerBaseUrl = 'https://example.com/handlers#'
    const rdfContent = `
      @prefix : <${handlerBaseUrl}> .
      :webhook1 a :WebHook;
        :topic <https://pod.example.com/tasks/main/>;
        :handler <https://example.com/handlers#UnknownHandler>.
    `

    const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
    expect(webhooks).toHaveLength(1)
    expect(webhooks[0].handler).toBe('UnknownHandler')
  })

  it('should parse actor from webhook configuration', async () => {
    const { parseWebhooksFromRDF } = await import('../src/config.js')

    const handlerBaseUrl = 'https://example.com/handlers#'
    const rdfContent = `
      @prefix : <${handlerBaseUrl}> .
      :webhook1 a :WebHook;
        :topic <https://pod.example.com/inbox/>;
        :handler <https://example.com/handlers#InboxModified>;
        :actor <https://pod.example.com/actor/#me> .
    `

    const webhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
    expect(webhooks).toHaveLength(1)
    expect(webhooks[0].actor).toBe('https://pod.example.com/actor/#me')
  })
})
