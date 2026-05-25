import { loadConfig, parseWebhooksFromRDF } from './config.js'
import { createSolidFetch } from './services/solidFetch.js'
import { handleInboxModified } from './handlers/inboxModified.js'
import { handleUpdateWebhooks } from './handlers/updateWebhooks.js'
import { createApp, startServer, subscribeAll, unsubscribeAll } from './index.js'
import type { SolidFetch, WebhookRegistration, UpdateWebhooksWebhook } from './types/index.js'

const handlers: Record<string, (event: import('./types/index.js').WebhookEvent, fetch: SolidFetch, context: any) => void | Promise<void>> = {
  InboxModified: async (event, fetch, ctx) => {
    await handleInboxModified(event, fetch, ctx)
  },
  UpdateWebhooks: handleUpdateWebhooks,
}

export async function main(): Promise<void> {
  console.log('Starting Solid Webhook server...')

  const config = loadConfig()
  console.log(`WebID: ${config.webId}`)
  console.log(`Issuer: ${config.issuer}`)
  console.log(`Base URL: ${config.baseUrl}`)
  console.log(`Webhook config: ${config.webhookConfigUrl}`)
  console.log(`Handler base: ${config.handlerBaseUrl}`)

  const app = await createApp(config)
  const server = await startServer(app, config.port)
  console.log(`Server accepting requests on port ${config.port}`)

  const fetchFn = await createSolidFetch(config.webId, config.issuer)

  console.log('Loading webhook configuration...')
  let webhooks: import('./config.js').ParsedWebhook[] = []

  try {
    const rdfResponse = await fetchFn(config.webhookConfigUrl, {
      headers: { accept: 'text/turtle,application/x-turtle' },
    })

    if (!rdfResponse.ok) {
      throw new Error(`Failed to fetch webhook config: ${rdfResponse.status} ${rdfResponse.statusText}`)
    }

    const rdfContent = await rdfResponse.text()
    console.log(`Loaded ${rdfContent.length} bytes of RDF configuration`)

    webhooks = await parseWebhooksFromRDF(rdfContent, config.handlerBaseUrl)
    console.log(`Found ${webhooks.length} webhook registrations`)
  } catch (error) {
    console.error(`Webhook configuration unavailable: ${error}`)
    console.error('Server will continue without webhook subscriptions')
  }

const validRegistrations: WebhookRegistration[] = []
  const failedSubscriptions: import('./types/index.js').TrackedSubscription[] = []

  for (const w of webhooks) {
    if (!handlers[w.handler]) {
      console.error(`Skipping subscription to ${w.topic}: Unknown handler '${w.handler}'`)
      failedSubscriptions.push({
        id: '',
        receiveFrom: '',
        topic: w.topic,
        status: 'failed',
        error: `Unknown handler: ${w.handler}`,
      })
    } else if (w.handler === 'InboxModified') {
      validRegistrations.push({
        handler: 'InboxModified' as const,
        topic: w.topic,
        callback: async (event, fetch) => {
          await handlers.InboxModified(event, fetch, app.context)
        },
        actor: w.actor,
      })
    } else if (w.handler === 'UpdateWebhooks') {
      validRegistrations.push({
        handler: 'UpdateWebhooks' as const,
        topic: w.topic,
        callback: async (event, fetch) => {
          await handlers.UpdateWebhooks(event, fetch, app.context)
        },
        actor: w.actor,
      })
    } else {
      console.error(`Skipping subscription to ${w.topic}: Handler '${w.handler}' not fully implemented`)
      failedSubscriptions.push({
        id: '',
        receiveFrom: '',
        topic: w.topic,
        status: 'failed',
        error: `Handler not implemented: ${w.handler}`,
      })
    }
  }

  // Also subscribe to the config URL itself so changes to it trigger re-parsing
  const configRegistration: UpdateWebhooksWebhook = {
    handler: 'UpdateWebhooks',
    topic: config.webhookConfigUrl,
    callback: async (event: import('./types/index.js').WebhookEvent, fetch: SolidFetch) => {
      await handlers.UpdateWebhooks(event, fetch, app.context)
    },
  }
  validRegistrations.unshift(configRegistration)

  app.context.registrations = validRegistrations
  app.context.handlers = handlers
  app.context.sendToUrl = config.sendToUrl
  app.context.handlerBaseUrl = config.handlerBaseUrl

  console.log('Subscribing to webhook channels...')
  const subscriptions = await subscribeAll(validRegistrations, fetchFn, config.sendToUrl)
  app.context.subscriptions = [...failedSubscriptions, ...subscriptions]
  const activeCount = subscriptions.filter(s => s.status === 'active').length
  console.log(`Subscribed to ${activeCount}/${subscriptions.length + failedSubscriptions.length} webhook channels`)

  console.log(`Solid Webhook server running on port ${config.port}`)

  const shutdown = async () => {
    console.log('Shutting down...')
    await unsubscribeAll(subscriptions, fetchFn)
    server.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await new Promise<void>(() => {})
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})