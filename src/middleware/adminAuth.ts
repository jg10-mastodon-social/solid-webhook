import type { Context, Next } from 'koa'

export function createAdminAuthMiddleware(
  adminWebId: string
): (ctx: Context, next: Next) => Promise<void> {
  return async (ctx: Context, next: Next): Promise<void> => {
    const webId = ctx.state.webId

    console.log(`[adminAuth] Request to /subscriptions`)
    console.log(`[adminAuth] webId from token: ${webId}`)
    console.log(`[adminAuth] expected adminWebId: ${adminWebId}`)

    if (!webId) {
      console.log(`[adminAuth] DENIED: No webId in state`)
      ctx.status = 403
      ctx.body = 'Access denied'
      return
    }

    if (webId !== adminWebId) {
      console.log(`[adminAuth] DENIED: webId mismatch`)
      ctx.status = 403
      ctx.body = 'Access denied'
      return
    }

    console.log(`[adminAuth] GRANTED`)
    await next()
  }
}