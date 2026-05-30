import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Context, Next } from 'koa'

vi.mock('@solid/access-token-verifier', () => ({
  default: {
    createSolidTokenVerifier: () => async () => ({
      webid: 'https://pod.example.com/profile/card#me',
      client_id: 'https://pod.example.com/client#id',
      iss: 'https://pod.example.com',
    }),
  },
}))

describe('SolidAuth Middleware', () => {
  let ctx: Partial<Context>
  let next: Next
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockReturnValue(undefined)
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

  describe('Token Verification Error Handling', () => {
    it('should log time difference when iat claim timestamp check fails', async () => {
      const { isIatTimestampError, logIatTimeDifference } = await import('../../src/middleware/solidAuth.js')

      const error = new Error('JWTClaimValidationFailed: "iat" claim timestamp check failed')
      expect(isIatTimestampError(error)).toBe(true)

      const iatTimestamp = Math.floor(Date.now() / 1000) - 120
      const token = createMockJwt({ alg: 'RS256' }, { iat: iatTimestamp })
      logIatTimeDifference(`DPoP ${token}`)

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('iat')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('seconds')
      )
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('behind')
      )
    })

    it('should correctly identify non-iat errors', async () => {
      const { isIatTimestampError } = await import('../../src/middleware/solidAuth.js')

      const error = new Error('some other error')
      expect(isIatTimestampError(error)).toBe(false)
    })
  })
})

function createMockJwt(header: object, payload: object): string {
  const base64UrlEncode = (obj: object) => {
    const json = JSON.stringify(obj)
    const base64 = Buffer.from(json).toString('base64')
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }
  const encodedHeader = base64UrlEncode(header)
  const encodedPayload = base64UrlEncode(payload)
  return `${encodedHeader}.${encodedPayload}.signature`
}
