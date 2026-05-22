import Koa from 'koa'
import Router from '@koa/router'
import { solidIdentity } from '@soid/koa'
import { createDpopMiddleware } from './middleware/dpopAuth.js'
import { subscribeWebhookChannel, unsubscribeWebhookChannel } from './services/webhookChannel.js'
import type { Config, WebhookRegistration, SubscriptionInfo } from './types/index.js'
import type { SolidFetch } from './types/index.js'

export async function createApp(config: Config): Promise<Koa> {
  const app = new Koa()
  
  app.keys = ['solid-webhook-secret']
  
  const router = new Router()
  
  router.use(solidIdentity(config.webId, config.baseUrl).routes())
  
  const dpopMiddleware = createDpopMiddleware(
    config.whitelistedIssuers,
    config.sendToUrl,
    'POST'
  )

  router.post(config.webhookEndpoint, dpopMiddleware, async (ctx) => {
    const body = (ctx.request as { body?: Record<string, unknown> }).body || {}
    const registrations = ctx.app.context.registrations
    
    if (registrations) {
      const matchingReg = registrations.find((reg) => {
        return typeof body.object === 'string' && body.object.startsWith(reg.topic)
      })
      
      if (matchingReg) {
        await matchingReg.callback({
          type: body.type as 'Add' | 'Remove',
          object: body.object as string,
          topic: matchingReg.topic,
          raw: body,
        })
      }
    }
    
    ctx.status = 200
    ctx.body = 'ok'
  })

  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}

export async function startServer(
  app: Koa,
  port: number
): Promise<import('http').Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      resolve(server)
    })
  })
}

export async function subscribeAll(
  registrations: WebhookRegistration[],
  fetchFn: SolidFetch,
  sendToUrl: string
): Promise<SubscriptionInfo[]> {
  const subscriptions: SubscriptionInfo[] = []
  
  for (const reg of registrations) {
    try {
      const subscription = await subscribeWebhookChannel(
        reg.topic,
        sendToUrl,
        fetchFn
      )
      subscriptions.push(subscription)
    } catch (error) {
      console.error(`Failed to subscribe to ${reg.topic}:`, error)
    }
  }
  
  return subscriptions
}

export async function unsubscribeAll(
  subscriptions: SubscriptionInfo[],
  fetchFn: SolidFetch
): Promise<void> {
  for (const sub of subscriptions) {
    try {
      await unsubscribeWebhookChannel(sub.id, fetchFn)
    } catch (error) {
      console.error(`Failed to unsubscribe from ${sub.id}:`, error)
    }
  }
}
