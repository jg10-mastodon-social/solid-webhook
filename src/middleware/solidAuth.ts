import verifier from '@solid/access-token-verifier'
import type { Context, Next } from 'koa'

export function createSolidAuthMiddleware(
  expectedUrl: string,
  expectedMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' = 'POST',
  whitelistedIssuers: string[] = []
): (ctx: Context, next: Next) => Promise<void> {
  return async (ctx: Context, next: Next): Promise<void> => {
    const authHeader = ctx.headers.authorization
    const dpopHeader = ctx.headers.dpop

    console.log(`[solidAuth] ${expectedMethod} ${expectedUrl}`)
    console.log(`[solidAuth] Authorization header: ${authHeader ? 'present' : 'missing'}`)
    console.log(`[solidAuth] DPoP header: ${dpopHeader ? 'present' : 'missing'}`)

    if (!authHeader) {
      console.log(`[solidAuth] DENIED: No Authorization header`)
      ctx.status = 401
      ctx.body = 'Authorization required'
      return
    }

    if (!dpopHeader) {
      console.log(`[solidAuth] DENIED: No DPoP header`)
      ctx.status = 401
      ctx.body = 'DPoP header required'
      return
    }

    const dpopValue = Array.isArray(dpopHeader) ? dpopHeader[0] : dpopHeader

    try {
      console.log(`[solidAuth] Verifying token...`)
      const payload = await verifier.createSolidTokenVerifier()(
        authHeader,
        { header: dpopValue, method: expectedMethod, url: expectedUrl }
      )

      console.log(`[solidAuth] Token verified, webId: ${payload.webid}`)
      ctx.state.webId = payload.webid
      ctx.state.clientId = payload.client_id

      if (whitelistedIssuers.length > 0 && !whitelistedIssuers.includes(payload.iss)) {
        console.log(`[solidAuth] DENIED: Issuer not allowed: ${payload.iss}`)
        ctx.status = 403
        ctx.body = 'Issuer not allowed'
        return
      }

      await next()
    } catch (error) {
      console.log(`[solidAuth] DENIED: Token verification failed: ${error}`)
      ctx.status = 401
      ctx.body = error instanceof Error ? error.message : 'Token verification failed'
    }
  }
}