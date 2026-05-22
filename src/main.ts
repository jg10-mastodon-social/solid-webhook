import { loadConfig, parseWebhooksFromRDF } from './config.js'
import { createSolidFetch } from './services/solidFetch.js'
import { handleInboxModified } from './handlers/inboxModified.js'
import { run } from './index.js'
import type { SolidFetch, WebhookRegistration } from './types/index.js'

const handlers: Record<string, (event: import('./types/index.js').WebhookEvent, fetch: SolidFetch) => Promise<void>> = {
  InboxModified: async (event, fetch) => {
    await handleInboxModified(event, fetch)
  },
}

async function main(): Promise<void> {
  console.log('Starting Solid Webhook server...')

  const config = loadConfig()
  console.log(`WebID: ${config.webId}`)
  console.log(`Issuer: ${config.issuer}`)
  console.log(`Webhook config: ${config.webhookConfigUrl}`)
  console.log(`Handler base: ${config.handlerBaseUrl}`)

  const fetchFn = await createSolidFetch(config.webId, config.issuer)

  console.log('Loading webhook configuration...')
  const rdfResponse = await fetchFn(config.webhookConfigUrl, {
    headers: { accept: 'text/turtle,application/x-turtle' },
  })

  if (!rdfResponse.ok) {
    throw new Error(`Failed to fetch webhook config: ${rdfResponse.status} ${rdfResponse.statusText}`)
  }

  const rdfContent = await rdfResponse.text()
  console.log(`Loaded ${rdfContent.length} bytes of RDF configuration`)

  const webhooks = await parseWebhooksFromRDF(rdfContent, config.handlerBaseUrl)
  console.log(`Found ${webhooks.length} webhook registrations`)

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

  console.log(`Starting server on port ${config.port}...`)

  await run(config, registrations, () => Promise.resolve(fetchFn))
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})