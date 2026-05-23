import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { Context, Next } from 'koa'

describe('SolidAuth Middleware', () => {
  let ctx: Partial<Context>
  let next: Next

  beforeEach(async () => {
    vi.clearAllMocks()
    ctx = {
      headers: {},
      path: '/webhook',
      state: {},
      status: 200,
      body: undefined,
    }
    next = vi.fn().mockResolvedValue(undefined)
  })

  describe('Header Validation', () => {
    it('should reject request without Authorization header', async () => {
      ctx.headers = { dpop: 'somedpop' }

      const { createSolidAuthMiddleware } = await import('../../src/middleware/solidAuth.js')
      const middleware = createSolidAuthMiddleware('https://pod.example.com/webhook/', 'POST')

      await middleware(ctx as Context, next)

      expect(ctx.status).toBe(401)
      expect(ctx.body).toBe('Authorization required')
      expect(next).not.toHaveBeenCalled()
    })

    it('should reject request without DPoP header', async () => {
      ctx.headers = { authorization: 'DPoP sometoken' }

      const { createSolidAuthMiddleware } = await import('../../src/middleware/solidAuth.js')
      const middleware = createSolidAuthMiddleware('https://pod.example.com/webhook/', 'POST')

      await middleware(ctx as Context, next)

      expect(ctx.status).toBe(401)
      expect(ctx.body).toBe('DPoP header required')
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('createSolidAuthMiddleware', () => {
    it('should create middleware with default POST method', async () => {
      const { createSolidAuthMiddleware } = await import('../../src/middleware/solidAuth.js')
      const middleware = createSolidAuthMiddleware('https://pod.example.com/webhook/')
      expect(typeof middleware).toBe('function')
    })

    it('should create middleware with custom method', async () => {
      const { createSolidAuthMiddleware } = await import('../../src/middleware/solidAuth.js')
      const middleware = createSolidAuthMiddleware('https://pod.example.com/webhook/', 'GET')
      expect(typeof middleware).toBe('function')
    })
  })
})