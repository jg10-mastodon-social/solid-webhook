import { loadConfig, parseWebhooksFromRDF } from './config.js'
import { createSolidFetch } from './services/solidFetch.js'
import { handleInboxModified } from './handlers/inboxModified.js'
import { createApp, startServer, subscribeAll, unsubscribeAll } from './index.js'
import type { SolidFetch, WebhookRegistration } from './types/index.js'

const handlers: Record<string, (event: import('./types/index.js').WebhookEvent, fetch: SolidFetch) => Promise<void>> = {
  InboxModified: async (event, fetch) => {
    await handleInboxModified(event, fetch)
  },
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

  const registrations: WebhookRegistration[] = webhooks.map(w => ({
    topic: w.topic,
    callback: async (event) => {
      const handler = handlers[w.handler]
      if (!handler) {
        throw new Error(`Unknown handler: ${w.handler}`)
      }
      await handler(event, fetchFn)
    },
    actor: w.actor,
  }))

  app.context.registrations = registrations

  console.log('Subscribing to webhook channels...')
  const subscriptions = await subscribeAll(registrations, fetchFn, config.sendToUrl)
  console.log(`Subscribed to ${subscriptions.length} webhook channels`)

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