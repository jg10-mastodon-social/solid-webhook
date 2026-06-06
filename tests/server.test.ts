import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Koa from 'koa'
import type { Server } from 'http'
import Router from '@koa/router'

vi.mock('@soid/koa', () => {
  const router = new Router()
  router.use((ctx, next) => {
    const authHeader = ctx.headers.authorization
    if (authHeader) {
      ctx.state.webId = 'https://pod.example.com/profile/card#me'
    }
    return next()
  })
  return {
    getAuthenticatedFetch: vi.fn().mockResolvedValue(vi.fn()),
    solidIdentity: vi.fn().mockReturnValue({
      routes: () => router.routes(),
    }),
  }
})

vi.mock('@solid/access-token-verifier', () => ({
  default: {
    createSolidTokenVerifier: () => async () => ({
      webid: 'https://pod.example.com/profile/card#me',
      client_id: 'https://pod.example.com/client#id',
      iss: 'https://pod.example.com',
    }),
  },
}))

vi.mock('../src/services/webhookChannel.js', () => ({
  subscribeWebhookChannel: vi.fn().mockResolvedValue({
    id: 'https://pod.example.com/webhook/123',
    receiveFrom: 'https://pod.example.com/webhook/receive/123',
    topic: 'https://pod.example.com/inbox/',
  }),
  unsubscribeWebhookChannel: vi.fn().mockResolvedValue(undefined),
}))

describe('Koa Server', () => {
  let server: Server | null = null

  afterEach(() => {
    if (server) {
      server.close()
      server = null
    }
  })

  describe('GET /subscriptions', () => {
    const adminWebId = 'https://pod.example.com/profile/card#me'

    it('should return HTML with subscription list for admin', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: adminWebId,
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8085,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8085',
        adminWebId,
      })

      app.context.subscriptions = [
        {
          id: '',
          receiveFrom: '',
          topic: 'https://pod.example.com/inbox/',
          status: 'active',
        },
      ]

      server = await startServer(app, 8085)

      const response = await fetch('http://localhost:8085/subscriptions', {
        headers: {
          accept: 'text/html',
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
        },
      })

      expect(response.status).toBe(200)
      const body = await response.text()
      expect(body).toContain('<!DOCTYPE html>')
      expect(body).toContain('https://pod.example.com/inbox/')
    })

    it('should include CORS headers', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: adminWebId,
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8089,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8089',
        adminWebId,
      })

      app.context.subscriptions = [
        {
          id: '',
          receiveFrom: '',
          topic: 'https://pod.example.com/inbox/',
          status: 'active',
        },
      ]

      server = await startServer(app, 8089)

      const response = await fetch('http://localhost:8089/subscriptions', {
        headers: {
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
          origin: 'https://other.example.com',
        },
      })

      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('should handle OPTIONS preflight request', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: adminWebId,
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8090,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8090',
        adminWebId,
      })

      app.context.subscriptions = [
        {
          id: '',
          receiveFrom: '',
          topic: 'https://pod.example.com/inbox/',
          status: 'active',
        },
      ]

      server = await startServer(app, 8090)

      const response = await fetch('http://localhost:8090/subscriptions', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://other.example.com',
          'access-control-request-method': 'GET',
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('should return 401 for unauthenticated request', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: adminWebId,
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8086,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8086',
        adminWebId,
      })

      server = await startServer(app, 8086)

      const response = await fetch('http://localhost:8086/subscriptions')
      expect(response.status).toBe(401)
    })

    it('should show failed status for failed subscriptions', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: adminWebId,
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8087,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8087',
        adminWebId,
      })

      app.context.subscriptions = [
        {
          id: '',
          receiveFrom: '',
          topic: 'https://pod.example.com/inbox/',
          status: 'failed',
          error: 'Connection refused',
        },
      ]

      server = await startServer(app, 8087)

      const response = await fetch('http://localhost:8087/subscriptions', {
        headers: {
          authorization: 'Bearer test',
          dpop: 'test-dpop-header',
        },
      })
      const body = await response.text()
      expect(body).toContain('failed')
    })

    it('should return 403 for non-whitelisted issuer', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: adminWebId,
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8091,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://trusted.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8091',
        adminWebId,
      })

      server = await startServer(app, 8091)

      const response = await fetch('http://localhost:8091/subscriptions', {
        headers: {
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
        },
      })

      expect(response.status).toBe(403)
      const body = await response.text()
      expect(body).toContain('Issuer not allowed')
    })

    it('should show active status for successful subscriptions', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: adminWebId,
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8088,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8088',
        adminWebId,
      })

      app.context.subscriptions = [
        {
          id: 'https://pod.example.com/webhook/123',
          receiveFrom: 'https://pod.example.com/webhook/receive/123',
          topic: 'https://pod.example.com/inbox/',
          status: 'active',
        },
      ]

      server = await startServer(app, 8088)

      const response = await fetch('http://localhost:8088/subscriptions', {
        headers: {
          authorization: 'Bearer test',
          dpop: 'test-dpop-header',
        },
      })
      const body = await response.text()
      expect(body).toContain('active')
    })
  })

  describe('Webhook endpoint', () => {
    it('should return 403 for non-whitelisted issuer', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8092,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://other-trusted.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8092',
        adminWebId: 'https://pod.example.com/profile/card#me',
      })

      server = await startServer(app, 8092)

      const response = await fetch('http://localhost:8092/webhook', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'Add', object: 'https://example.com/activity' }),
      })

      expect(response.status).toBe(403)
      const body = await response.text()
      expect(body).toContain('Issuer not allowed')
    })

    it('should reject unauthenticated requests', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8082,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8082',
        adminWebId: 'https://pod.example.com/profile/card#me',
      })

      server = await startServer(app, 8082)
      
      const response = await fetch('http://localhost:8082/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'Add', object: 'https://example.com/activity' }),
      })

      expect(response.status).toBe(401)
    })

    it('should start server successfully', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8084,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8084',
        adminWebId: 'https://pod.example.com/profile/card#me',
      })

      server = await startServer(app, 8084)
      await new Promise(resolve => setTimeout(resolve, 500))

      const response = await fetch('http://localhost:8084/')
      expect(response.status).toBeGreaterThanOrEqual(200)
      expect(response.status).toBeLessThan(500)
    })

    it('should invoke handler when object matches registration topic', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const callback = vi.fn()
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8093,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8093',
        adminWebId: 'https://pod.example.com/profile/card#me',
      })

      app.context.registrations = [{
        topic: 'https://pod.example.com/inbox/',
        handler: 'InboxModified',
        callback,
        actor: 'https://pod.example.com/actor',
      }]

      server = await startServer(app, 8093)

      const response = await fetch('http://localhost:8093/webhook', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'Add', object: 'https://pod.example.com/inbox/abc' }),
      })

      expect(response.status).toBe(200)
      expect(callback).toHaveBeenCalledTimes(1)
      const callArgs = callback.mock.calls[0]
      expect(callArgs[0]).toMatchObject({
        type: 'Add',
        object: 'https://pod.example.com/inbox/abc',
        topic: 'https://pod.example.com/inbox/',
      })
    })

    it('should pass fetch from app.context to actual handler', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const { handleItemListIndexer } = await import('../src/handlers/itemListIndexer.js')

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => `<https://pod.example.com/tasks/123> a <https://schema.org/Action> ;
          <https://schema.org/name> "Test Task" ;
          <https://schema.org/actionStatus> <https://schema.org/PotentialActionStatus> .`,
      })

      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8096,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8096',
        adminWebId: 'https://pod.example.com/profile/card#me',
      })

      app.context.fetch = mockFetch
      app.context.registrations = [{
        topic: 'https://pod.example.com/pod/tasks/main/',
        handler: 'ItemListIndexer',
        callback: async (event, fetch, context) => {
          await handleItemListIndexer(event, fetch, context)
        },
        indexUrl: 'https://pod.example.com/tasks/index.ttl',
        actor: 'https://pod.example.com/actor',
      }]

      server = await startServer(app, 8096)

      const response = await fetch('http://localhost:8096/webhook', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'Add',
          object: 'https://pod.example.com/pod/tasks/main/3273780338324163',
        }),
      })

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should log error when no handler matches object', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const callback = vi.fn()
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8094,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8094',
        adminWebId: 'https://pod.example.com/profile/card#me',
      })

      app.context.registrations = [{
        topic: 'https://pod.example.com/inbox/',
        handler: 'InboxModified',
        callback,
        actor: 'https://pod.example.com/actor',
      }]

      server = await startServer(app, 8094)

      const response = await fetch('http://localhost:8094/webhook', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ type: 'Add', object: 'https://other.example.com/inbox/abc' }),
      })

      expect(response.status).toBe(200)
      expect(callback).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('No handler found for object')
      )
      consoleErrorSpy.mockRestore()
    })

    it('should correctly parse JSON body', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const callback = vi.fn()
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8095,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8095',
        adminWebId: 'https://pod.example.com/profile/card#me',
      })

      app.context.registrations = [{
        topic: 'https://pod.example.com/inbox/',
        handler: 'InboxModified',
        callback,
        actor: 'https://pod.example.com/actor',
      }]

      server = await startServer(app, 8095)

      const webhookBody = { type: 'Remove', object: 'https://pod.example.com/inbox/item123' }
      const response = await fetch('http://localhost:8095/webhook', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          dpop: 'test-dpop-header',
          'content-type': 'application/json',
        },
        body: JSON.stringify(webhookBody),
      })

      expect(response.status).toBe(200)
      expect(callback).toHaveBeenCalledTimes(1)
      const callArgs = callback.mock.calls[0]
      expect(callArgs[0]).toMatchObject({
        type: 'Remove',
        object: 'https://pod.example.com/inbox/item123',
        raw: webhookBody,
      })
    })
  })
})