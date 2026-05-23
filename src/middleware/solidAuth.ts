import verifier from '@solid/access-token-verifier'
import type { Context, Next } from 'koa'

export function createSolidAuthMiddleware(
  expectedUrl: string,
  expectedMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' = 'POST'
): (ctx: Context, next: Next) => Promise<void> {
  return async (ctx: Context, next: Next): Promise<void> => {
    const authHeader = ctx.headers.authorization
    const dpopHeader = ctx.headers.dpop

    if (!authHeader) {
      ctx.status = 401
      ctx.body = 'Authorization required'
      return
    }

    if (!dpopHeader) {
      ctx.status = 401
      ctx.body = 'DPoP header required'
      return
    }

    const dpopValue = Array.isArray(dpopHeader) ? dpopHeader[0] : dpopHeader

    try {
      const { webid: webId, client_id: clientId } = await verifier.createSolidTokenVerifier()(
        authHeader,
        { header: dpopValue, method: expectedMethod, url: expectedUrl }
      )

      ctx.state.webId = webId
      ctx.state.clientId = clientId

      await next()
    } catch (error) {
      ctx.status = 401
      ctx.body = error instanceof Error ? error.message : 'Token verification failed'
    }
  }
}