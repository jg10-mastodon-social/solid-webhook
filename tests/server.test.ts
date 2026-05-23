import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Koa from 'koa'
import type { Server } from 'http'
import Router from '@koa/router'

vi.mock('@soid/koa', () => ({
  getAuthenticatedFetch: vi.fn().mockResolvedValue(vi.fn()),
  solidIdentity: vi.fn().mockReturnValue({
    routes: () => new Router().routes(),
  }),
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

  describe('createApp', () => {
    it('should create a Koa app', async () => {
      const { createApp } = await import('../src/index.js')
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8081,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
        webhookConfigUrl: 'https://pod.example.com/webhooks.ttl',
        handlerBaseUrl: 'https://pod.example.com/handlers#',
        baseUrl: 'http://localhost:8081',
      })
      expect(app).toBeDefined()
    })
  })

  describe('Webhook endpoint', () => {
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
      })

      server = await startServer(app, 8084)
      await new Promise(resolve => setTimeout(resolve, 500))

      const response = await fetch('http://localhost:8084/')
      expect(response.status).toBeGreaterThanOrEqual(200)
      expect(response.status).toBeLessThan(500)
    })
  })
})
