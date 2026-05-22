import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as jose from 'jose'
import type { Context, Next } from 'koa'

describe('DPoP Middleware', () => {
  let ctx: Partial<Context>
  let next: Next
  let privateKey: jose.KeyLike

  beforeEach(async () => {
    vi.clearAllMocks()
    const keyPair = await jose.generateKeyPair('ES256')
    privateKey = keyPair.privateKey as jose.KeyLike
    
    ctx = {
      headers: {},
      path: '/webhook',
      state: {},
      status: 200,
      body: undefined,
    }
    next = vi.fn().mockResolvedValue(undefined)
  })

  const createTestToken = async (
    payload: Record<string, unknown> = {}
  ): Promise<string> => {
    const fullPayload = {
      htu: 'https://pod.example.com/webhook/',
      htm: 'POST',
      iss: 'https://solidcommunity.net',
      ...payload,
    }
    
    return new jose.SignJWT(fullPayload as jose.JWTPayload)
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt' })
      .setIssuedAt()
      .sign(privateKey)
  }

  describe('Token Creation Verification', () => {
    it('should create valid token that can be decoded', async () => {
      const token = await createTestToken()
      const decoded = jose.decodeJwt(token)
      expect(decoded.htu).toBe('https://pod.example.com/webhook/')
      expect(decoded.htm).toBe('POST')
      expect(decoded.iss).toBe('https://solidcommunity.net')
    })
  })

  describe('Header Validation', () => {
    it('should reject request without Authorization header', async () => {
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      
      expect(ctx.status).toBe(401)
      expect(ctx.body).toBe('Authorization required')
      expect(next).not.toHaveBeenCalled()
    })

    it('should reject request without DPoP prefix in Authorization header', async () => {
      ctx.headers = { authorization: 'Bearer sometoken' }
      
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      
      expect(ctx.status).toBe(401)
      expect(ctx.body).toBe('Authorization required')
    })

    it('should reject request without DPoP header', async () => {
      ctx.headers = { authorization: 'DPoP sometoken' }
      
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      
      expect(ctx.status).toBe(401)
      expect(ctx.body).toBe('DPoP header required')
    })
  })

  describe('Token Validation', () => {
    it('should reject expired DPoP token', async () => {
      const token = await createTestToken({ exp: Math.floor(Date.now() / 1000) - 3600 })
      ctx.headers = { authorization: 'DPoP ' + token, dpop: token }
      
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      
      expect(ctx.status).toBe(401)
      expect(ctx.body).toContain('expired')
    })

    it('should reject DPoP token with wrong htu', async () => {
      const token = await createTestToken({ htu: 'https://wrong.example.com/webhook/' })
      ctx.headers = { authorization: 'DPoP ' + token, dpop: token }
      
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      
      expect(ctx.status).toBe(401)
      expect(ctx.body).toContain('htu')
    })

    it('should reject DPoP token with wrong htm', async () => {
      const token = await createTestToken({ htm: 'GET' })
      ctx.headers = { authorization: 'DPoP ' + token, dpop: token }
      
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      
      expect(ctx.status).toBe(401)
      expect(ctx.body).toContain('htm')
    })

    it('should reject issuer not in whitelist', async () => {
      const token = await createTestToken({ iss: 'https://unknown.example.com' })
      ctx.headers = { authorization: 'DPoP ' + token, dpop: token }
      
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      
      expect(ctx.status).toBe(401)
      expect(ctx.body).toContain('Issuer')
    })
  })

  describe('JTI Replay Protection', () => {
    it('should reject reused jti (replay attack)', async () => {
      const token = await createTestToken({ jti: 'unique-jti-123' })
      ctx.headers = { authorization: 'DPoP ' + token, dpop: token }
      
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      await middleware(ctx as Context, next)
      expect(next).toHaveBeenCalled()
      
      vi.clearAllMocks()
      ctx.state = {}
      next = vi.fn().mockResolvedValue(undefined)
      
      await middleware(ctx as Context, next)
      expect(ctx.status).toBe(401)
      expect(ctx.body).toContain('jti')
    })

    it('should allow different jti in each request', async () => {
      const { createDpopMiddleware } = await import('../../src/middleware/dpopAuth.js')
      const middleware = createDpopMiddleware(['https://solidcommunity.net'], 'https://pod.example.com/webhook/')
      
      const token1 = await createTestToken({ jti: 'jti-1' })
      ctx.headers = { authorization: 'DPoP ' + token1, dpop: token1 }
      await middleware(ctx as Context, next)
      expect(next).toHaveBeenCalledTimes(1)
      
      vi.clearAllMocks()
      ctx.state = {}
      next = vi.fn().mockResolvedValue(undefined)
      
      const token2 = await createTestToken({ jti: 'jti-2' })
      ctx.headers = { authorization: 'DPoP ' + token2, dpop: token2 }
      await middleware(ctx as Context, next)
      expect(next).toHaveBeenCalledTimes(1)
    })
  })
})
