import verifier from '@solid/access-token-verifier'
import type { Context, Next } from 'koa'

export function isIatTimestampError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('"iat" claim timestamp check failed')
  }
  return false
}

function parseJwtPayload(token: string): { header: Record<string, unknown>, payload: Record<string, unknown> } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const decode = (part: string) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return { header: decode(parts[0]), payload: decode(parts[1]) }
  } catch {
    return null
  }
}

export function logIatTimeDifference(authHeader: string | undefined): void {
  if (!authHeader) return
  const token = authHeader.replace(/^DPoP\s+/i, '')
  const parsed = parseJwtPayload(token)
  console.log(`[solidAuth] Token payload: ${JSON.stringify(parsed?.payload)}`)
  if (!parsed || typeof parsed.payload.iat !== 'number') return
  const iatTimestamp = parsed.payload.iat
  const currentTimestamp = Math.floor(Date.now() / 1000)
  const diffSeconds = currentTimestamp - iatTimestamp
  const direction = diffSeconds >= 0 ? 'behind' : 'ahead'
  console.log(`[solidAuth] Token iat timestamp is ${Math.abs(diffSeconds)} seconds ${direction} server time`)
}

export function createSolidAuthMiddleware(
  expectedUrl: string,
  expectedMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' = 'POST'
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

      const whitelistedIssuers = (ctx as any).app?.context?.whitelistedIssuers
      if (!whitelistedIssuers || whitelistedIssuers.length === 0 || !whitelistedIssuers.includes(payload.iss)) {
        console.log(`[solidAuth] DENIED: Issuer not allowed: ${payload.iss}`)
        ctx.status = 403
        ctx.body = 'Issuer not allowed'
        return
      }

      await next()
    } catch (error) {
      console.log(`[solidAuth] DENIED: Token verification failed: ${error}`)
      if (isIatTimestampError(error)) {
        logIatTimeDifference(authHeader)
      }
      const token = authHeader?.replace(/^DPoP\s+/i, '')
      const parsed = parseJwtPayload(token)
      console.log('[solidAuth] Parsed JWT header:', JSON.stringify(parsed?.header))
      console.log('[solidAuth] Parsed JWT payload:', JSON.stringify(parsed?.payload))
      const dpopParsed = parseJwtPayload(dpopValue)
      console.log('[solidAuth] Parsed DPoP header:', JSON.stringify(dpopParsed?.header))
      console.log('[solidAuth] Parsed DPoP payload:', JSON.stringify(dpopParsed?.payload))
      ctx.status = 401
      ctx.body = error instanceof Error ? error.message : 'Token verification failed'
    }
  }
}
