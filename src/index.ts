import Koa from 'koa'
import Router from '@koa/router'
import cors from '@koa/cors'
import bodyParser from 'koa-bodyparser'
import { solidIdentity } from '@soid/koa'
import { createSolidAuthMiddleware } from './middleware/solidAuth.js'
import { createAdminAuthMiddleware } from './middleware/adminAuth.js'
import { subscribeWebhookChannel, unsubscribeWebhookChannel } from './services/webhookChannel.js'
import type { Config, WebhookRegistration, TrackedSubscription } from './types/index.js'
import type { SolidFetch } from './types/index.js'

export async function createApp(config: Config): Promise<Koa> {
  const app = new Koa()

  app.use(bodyParser({
    enableTypes: ['json'],
    extendTypes: {
      json: [
        'application/ld+json',
        'application/json',
        'application/activity+json',
      ],
    },
    encoding: 'utf-8',
    jsonLimit: '1mb',
  }))

  app.keys = ['solid-webhook-secret']

  app.context.whitelistedIssuers = config.whitelistedIssuers || []

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
      } else if (registrations && registrations.length > 0) {
        if (body.object === undefined) {
          console.error(`[Webhook] Error: object is undefined.\n> ${ctx.request.rawBody}`)
        } else {
          console.error(`[Webhook] Error: No handler found for object ${body.object}`)
        }
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
  const durationMinutes = parseInt(process.env.SUBSCRIPTION_DURATION_MINUTES || '10080', 10)
  const durationMs = durationMinutes * 60 * 1000

  for (const reg of registrations) {
    const createdAt = new Date()
    const endAt = new Date(createdAt.getTime() + durationMs)
    try {
      const subscription = await subscribeWebhookChannel(
        reg.topic,
        sendToUrl,
        fetchFn,
        endAt
      )
      subscriptions.push({
        ...subscription,
        status: 'active',
        createdAt,
        endAt,
      })
    } catch (error) {
      console.error(`Failed to subscribe to ${reg.topic}:`, error)
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: reg.topic,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        createdAt,
        endAt,
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

export async function renewSubscription(
  subscriptions: TrackedSubscription[],
  subscriptionId: string,
  sendToUrl: string,
  fetchFn: SolidFetch
): Promise<TrackedSubscription> {
  const index = subscriptions.findIndex((s) => s.id === subscriptionId)
  if (index === -1) {
    throw new Error(`Subscription not found: ${subscriptionId}`)
  }

  const existing = subscriptions[index]
  const durationMinutes = parseInt(process.env.SUBSCRIPTION_DURATION_MINUTES || '10080', 10)
  const durationMs = durationMinutes * 60 * 1000
  const newCreatedAt = new Date()
  const newEndAt = new Date(newCreatedAt.getTime() + durationMs)

  let newSubscriptionInfo
  try {
    newSubscriptionInfo = await subscribeWebhookChannel(
      existing.topic,
      sendToUrl,
      fetchFn,
      newEndAt
    )
  } catch (error) {
    existing.status = 'failed'
    existing.error = error instanceof Error ? error.message : 'Unknown error'
    throw error
  }

  try {
    await unsubscribeWebhookChannel(existing.id, fetchFn)
  } catch (error) {
    console.error(`Failed to delete old subscription ${existing.id}:`, error)
  }

  const renewed: TrackedSubscription = {
    id: newSubscriptionInfo.id,
    receiveFrom: newSubscriptionInfo.receiveFrom,
    topic: existing.topic,
    status: 'active',
    createdAt: newCreatedAt,
    endAt: newEndAt,
  }

  subscriptions[index] = renewed
  return renewed
}

const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000

export async function renewAllSubscriptions(
  subscriptions: TrackedSubscription[],
  sendToUrl: string,
  fetchFn: SolidFetch
): Promise<string[]> {
  const now = Date.now()
  const renewed: string[] = []

  for (const sub of subscriptions) {
    if (sub.status === 'failed') continue
    if (!sub.endAt) continue
    if (sub.endAt.getTime() - now > RENEWAL_THRESHOLD_MS) continue

    try {
      const result = await renewSubscription(subscriptions, sub.id, sendToUrl, fetchFn)
      renewed.push(result.id)
    } catch (error) {
      console.error(`Failed to renew subscription ${sub.id}:`, error)
    }
  }

  return renewed
}
