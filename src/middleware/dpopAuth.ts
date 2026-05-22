import type { Context, Next } from 'koa'
import * as jose from 'jose'

const seenJtis = new Set<string>()
const JTI_CLEANUP_INTERVAL = 60 * 1000
const JTI_TTL = 5 * 60 * 1000

let lastCleanup = Date.now()

function cleanupJtis(): void {
  if (Date.now() - lastCleanup < JTI_CLEANUP_INTERVAL) return
  seenJtis.clear()
  lastCleanup = Date.now()
}

export interface DpopMiddlewareOptions {
  expectedHtu: string
  expectedHtm: string
  whitelistedIssuers: string[]
  jwkSet?: jose.JWTVerifyGetKey
}

export function createDpopMiddleware(whitelistedIssuers: string[], expectedHtu: string, expectedHtm = 'POST'): (ctx: Context, next: Next) => Promise<void> {
  return async (ctx: Context, next: Next): Promise<void> => {
    const authHeader = ctx.headers.authorization
    const dpopHeader = ctx.headers.dpop

    if (!authHeader || !authHeader.startsWith('DPoP ')) {
      ctx.status = 401
      ctx.body = 'Authorization required'
      return
    }

    if (!dpopHeader) {
      ctx.status = 401
      ctx.body = 'DPoP header required'
      return
    }

    const token = authHeader.substring(5)

    try {
      const payload = jose.decodeJwt(token)
      const header = jose.decodeProtectedHeader(token)

      if (!payload.iss || !whitelistedIssuers.includes(payload.iss)) {
        ctx.status = 401
        ctx.body = `Issuer ${payload.iss} not allowed`
        return
      }

      if (payload.htu !== expectedHtu) {
        ctx.status = 401
        ctx.body = `htu does not match: expected ${expectedHtu}, got ${payload.htu}`
        return
      }

      if (payload.htm !== expectedHtm) {
        ctx.status = 401
        ctx.body = `htm does not match: expected ${expectedHtm}, got ${payload.htm}`
        return
      }

      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        ctx.status = 401
        ctx.body = 'Token expired'
        return
      }

      cleanupJtis()

      if (payload.jti) {
        if (seenJtis.has(payload.jti)) {
          ctx.status = 401
          ctx.body = 'jti has already been seen'
          return
        }
        seenJtis.add(payload.jti)
        
        if (seenJtis.size > 100) {
          seenJtis.clear()
        }
      }

      ctx.state.webId = payload.webId || (payload as jose.JWTPayload).sub
      ctx.state.dpopHeader = header

      await next()
    } catch (error) {
      ctx.status = 401
      ctx.body = error instanceof Error ? error.message : 'Token verification failed'
    }
  }
}

export async function verifyDpopToken(
  token: string,
  options: DpopMiddlewareOptions
): Promise<jose.JWTVerifyResult> {
  const jwks = options.jwkSet || createRemoteJWKSet(options.whitelistedIssuers[0] + '/.well-known/openid-configuration')
  
  return jose.jwtVerify(token, jwks, {
    issuer: options.whitelistedIssuers,
  })
}

function createRemoteJWKSet(jwksUri: string): jose.JWTVerifyGetKey {
  return jose.createRemoteJWKSet(new URL(jwksUri))
}
