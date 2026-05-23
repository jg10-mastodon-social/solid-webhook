import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import { solidIdentity } from '@soid/koa'
import { createSolidAuthMiddleware } from './middleware/solidAuth.js'
import { createAdminAuthMiddleware } from './middleware/adminAuth.js'
import { subscribeWebhookChannel, unsubscribeWebhookChannel } from './services/webhookChannel.js'
import type { Config, WebhookRegistration, TrackedSubscription } from './types/index.js'
import type { SolidFetch } from './types/index.js'

export async function createApp(config: Config): Promise<Koa> {
  const app = new Koa()

  app.keys = ['solid-webhook-secret']

  const router = new Router()

  router.use(solidIdentity(config.webId, config.baseUrl).routes())

  const solidAuthMiddleware = createSolidAuthMiddleware(
    config.sendToUrl,
    'POST'
  )

  const solidAuthMiddlewareForGet = createSolidAuthMiddleware(
    config.baseUrl + '/subscriptions',
    'GET'
  )

  const adminAuthMiddleware = createAdminAuthMiddleware(config.adminWebId)

  router.post(config.webhookEndpoint, solidAuthMiddleware, async (ctx) => {
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
        }, ctx.app.context.fetch as SolidFetch, ctx.app.context)
      }
    }

    ctx.status = 200
    ctx.body = 'ok'
  })

  router.get('/subscriptions', cors(), solidAuthMiddlewareForGet, adminAuthMiddleware, async (ctx) => {
    const subscriptions = ctx.app.context.subscriptions || []

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Webhook Subscriptions</title>
</head>
<body>
  <h1>Webhook Subscriptions</h1>
  <ul>
    ${subscriptions.map(sub => `
      <li>
        <strong>${sub.topic}</strong> - ${sub.status}
        ${sub.error ? ` (${sub.error})` : ''}
      </li>
    `).join('')}
  </ul>
</body>
</html>`

    ctx.type = 'text/html'
    ctx.body = html
  })

  router.options('/subscriptions', cors(), (ctx) => {
    ctx.status = 204
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
): Promise<TrackedSubscription[]> {
  const subscriptions: TrackedSubscription[] = []

  for (const reg of registrations) {
    try {
      const subscription = await subscribeWebhookChannel(
        reg.topic,
        sendToUrl,
        fetchFn
      )
      subscriptions.push({
        ...subscription,
        status: 'active',
      })
    } catch (error) {
      console.error(`Failed to subscribe to ${reg.topic}:`, error)
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: reg.topic,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return subscriptions
}

export async function unsubscribeAll(
  subscriptions: TrackedSubscription[],
  fetchFn: SolidFetch
): Promise<void> {
  for (const sub of subscriptions) {
    if (!sub.id) continue
    try {
      await unsubscribeWebhookChannel(sub.id, fetchFn)
    } catch (error) {
      console.error(`Failed to unsubscribe from ${sub.id}:`, error)
    }
  }
}
