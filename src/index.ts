import Koa from 'koa'
import Router from '@koa/router'
import { solidIdentity, getAuthenticatedFetch } from '@soid/koa'
import { createDpopMiddleware } from './middleware/dpopAuth.js'
import { subscribeWebhookChannel, unsubscribeWebhookChannel } from './services/webhookChannel.js'
import type { Config, WebhookRegistration, SubscriptionInfo } from './types/index.js'
import type { SolidFetch } from './types/index.js'

export async function createApp(
  config: Config,
  registrations?: WebhookRegistration[],
  fetchFactory?: () => Promise<SolidFetch>
): Promise<Koa> {
  const app = new Koa()
  
  app.keys = ['solid-webhook-secret']
  
  const router = new Router()
  
  router.get('/.well-known/openid-configuration', (ctx) => {
    ctx.body = {
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/authorize`,
      token_endpoint: `${config.issuer}/token`,
      jwks_uri: `${config.issuer}/.well-known/jwks`,
      token_endpoint_auth_methods_supported: ['DPoP'],
      token_endpoint_auth_signing_alg_values_supported: ['ES256'],
      dpop_signing_alg_values_supported: ['ES256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    }
  })

  router.get('/jwks', (ctx) => {
    ctx.body = {
      keys: []
    }
  })

  router.get('/webid', (ctx) => {
    ctx.set('Content-Type', 'text/turtle')
    ctx.body = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix as: <https://www.w3.org/ns/activitystreams#> .

<${config.webId.split('#')[0]}> a solid:PersonalOwnerDocument;
  solid:oidcIssuer <${config.issuer}> .
`
  })

  const dpopMiddleware = createDpopMiddleware(
    config.whitelistedIssuers,
    config.sendToUrl,
    'POST'
  )

  router.post(config.webhookEndpoint, dpopMiddleware, async (ctx) => {
    const body = (ctx.request as { body?: Record<string, unknown> }).body || {}
    
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
  port: number,
  subscriptions?: SubscriptionInfo[],
  fetchFn?: SolidFetch
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

export async function run(
  config: Config,
  registrations: WebhookRegistration[],
  fetchFactory: () => Promise<SolidFetch>
): Promise<void> {
  const fetchFn = await fetchFactory()
  const app = await createApp(config, registrations, fetchFactory)
  
  const subscriptions = await subscribeAll(registrations, fetchFn, config.sendToUrl)
  
  const server = await startServer(app, config.port, subscriptions, fetchFn)
  
  console.log(`Solid Webhook server running on port ${config.port}`)
  
  const shutdown = async () => {
    console.log('Shutting down...')
    await unsubscribeAll(subscriptions, fetchFn)
    server.close()
    process.exit(0)
  }
  
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
