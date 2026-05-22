import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Koa from 'koa'
import type { Server } from 'http'

vi.mock('@soid/koa', () => ({
  solidIdentity: vi.fn().mockReturnValue(vi.fn()),
  getAuthenticatedFetch: vi.fn().mockResolvedValue(vi.fn()),
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
      })

      server = await startServer(app, 8082)
      
      const response = await fetch('http://localhost:8082/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'Add', object: 'https://example.com/activity' }),
      })

      expect(response.status).toBe(401)
    })

    it('should serve identity endpoints', async () => {
      const { createApp, startServer } = await import('../src/index.js')
      const app = await createApp({
        webId: 'https://pod.example.com/profile/card#me',
        issuer: 'https://pod.example.com',
        webhookEndpoint: '/webhook',
        port: 8084,
        sendToUrl: 'https://pod.example.com/webhook/',
        whitelistedIssuers: ['https://pod.example.com'],
      })

      server = await startServer(app, 8084)
      
      const response = await fetch('http://localhost:8084/.well-known/openid-configuration')
      
      expect(response.status).toBe(200)
      const data = await response.json() as { issuer: string }
      expect(data.issuer).toBe('https://pod.example.com')
    })
  })
})
