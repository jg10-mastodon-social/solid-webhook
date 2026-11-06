import { loadConfig, parseWebhooksFromRDF } from './config.js'
import { createSolidFetch } from './services/solidFetch.js'
import { handleInboxModified } from './handlers/inboxModified.js'
import { handleUpdateWebhooks } from './handlers/updateWebhooks.js'
import { createApp, startServer, subscribeAll, unsubscribeAll, startRenewalJob } from './index.js'
import { processExistingInboxItems } from './services/processInbox.js'
import { initializeWikiIndexers } from './services/wikiIndexerInit.js'
import type { SolidFetch, WebhookRegistration, UpdateWebhooksWebhook } from './types/index.js'

const handlers: Record<string, (event: import('./types/index.js').WebhookEvent, fetch: SolidFetch, context: any) => void | Promise<void>> = {
  InboxModified: async (event, fetch, ctx) => {
    await handleInboxModified(event, fetch, ctx)
  },
  UpdateWebhooks: handleUpdateWebhooks,
  CommitHandler: async (event, fetch, ctx) => {
    const { handleCommitHandler } = await import('./handlers/commitHandler.js')
    await handleCommitHandler(event, fetch, ctx)
  },
  ItemListIndexer: async (event, fetch, ctx) => {
    const { handleItemListIndexer } = await import('./handlers/itemListIndexer.js')
    await handleItemListIndexer(event, fetch, ctx)
  },
  WikiIndexer: async (event, fetch, ctx) => {
    const { handleWikiIndexer } = await import('./handlers/wikiIndexer.js')
    await handleWikiIndexer(event, fetch, ctx)
  },
  RouteInbox: async (event, fetch, ctx) => {
    const { handleRouteInbox } = await import('./handlers/routeInbox.js')
    await handleRouteInbox(event, fetch, ctx)
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
  const fetchFn = await createSolidFetch(config.webId, config.issuer)
  app.context.fetch = fetchFn

  const server = await startServer(app, config.port)

  console.log('Loading webhook configuration...')
  let webhooks: import('./config.js').ParsedWebhook[] = []

  if (config.webhookConfigUrl && config.handlerBaseUrl) {
    try {
      const rdfResponse = await fetchFn(config.webhookConfigUrl, {
        headers: { accept: 'text/turtle,application/x-x-turtle' },
      })

      if (rdfResponse.ok) {
        const rdfContent = await rdfResponse.text()
        console.log(`Loaded ${rdfContent.length} bytes of RDF configuration`)
        webhooks = await parseWebhooksFromRDF(rdfContent, config.handlerBaseUrl)
        console.log(`Found ${webhooks.length} webhook registrations`)
      } else {
        console.error(`Failed to fetch webhook config: ${rdfResponse.status} ${rdfResponse.statusText}`)
      }
    } catch (error) {
      console.error(`Webhook configuration unavailable: ${error}`)
    }
  }

  if (!process.env.WHITELISTED_ISSUERS && webhooks.length > 0) {
    const origins = new Set<string>()
    for (const webhook of webhooks) {
      try {
        const url = new URL(webhook.topic)
        origins.add(url.origin)
      } catch {
        // Skip invalid URLs
      }
    }
    if (origins.size > 0) {
      app.context.whitelistedIssuers = Array.from(origins)
      console.log(`Derived whitelistedIssuers from webhook topics: ${app.context.whitelistedIssuers.join(', ')}`)
    }
  }

  const validRegistrations: WebhookRegistration[] = []
  const failedSubscriptions: import('./types/index.js').TrackedSubscription[] = []

  for (const w of webhooks) {
    try {
      if (!handlers[w.handler]) {
        throw new Error(`Unknown handler '${w.handler}'`)
      }
      if (w.handler === 'InboxModified') {
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
      } else if (w.handler === 'CommitHandler') {
        if (!w.gitDir) {
          throw new Error("CommitHandler webhook is missing required :gitDir")
        }
        validRegistrations.push({
          handler: 'CommitHandler' as const,
          topic: w.topic,
          callback: async (event, fetch) => {
            await handlers.CommitHandler(event, fetch, { ...app.context, gitDir: w.gitDir })
          },
          gitDir: w.gitDir,
          actor: w.actor,
        })
      } else if (w.handler === 'ItemListIndexer') {
        if (!w.indexUrl) {
          throw new Error("ItemListIndexer webhook is missing required :indexUrl")
        }
        validRegistrations.push({
          handler: 'ItemListIndexer' as const,
          topic: w.topic,
          callback: async (event, fetch) => {
            await handlers.ItemListIndexer(event, fetch, app.context)
          },
          indexUrl: w.indexUrl,
          actor: w.actor,
        })
      } else if (w.handler === 'WikiIndexer') {
        if (!w.indexUrl) {
          throw new Error("WikiIndexer webhook is missing required :indexUrl")
        }
        validRegistrations.push({
          handler: 'WikiIndexer' as const,
          topic: w.topic,
          callback: async (event, fetch) => {
            await handlers.WikiIndexer(event, fetch, app.context)
          },
          indexUrl: w.indexUrl,
          maxDepth: w.maxDepth ?? 1,
          actor: w.actor,
        })
      } else {
        throw new Error(`Handler '${w.handler}' not fully implemented`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`Skipping subscription to ${w.topic}: ${errorMsg}`)
      failedSubscriptions.push({
        id: '',
        receiveFrom: '',
        topic: w.topic,
        status: 'failed',
        error: errorMsg,
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
  app.context.inboxPageSize = config.inboxPageSize

  console.log('Subscribing to webhook channels...')
  const subscriptions = await subscribeAll(validRegistrations, fetchFn, config.sendToUrl)
  app.context.subscriptions = [...failedSubscriptions, ...subscriptions]
  const activeCount = subscriptions.filter(s => s.status === 'active').length
  console.log(`Subscribed to ${activeCount}/${subscriptions.length + failedSubscriptions.length} webhook channels`)

  console.log('Initializing WikiIndexer subscriptions...')
  await initializeWikiIndexers(app.context, fetchFn)

  const stopRenewalJob = startRenewalJob(
    app.context.subscriptions,
    config.sendToUrl,
    fetchFn
  )
  console.log(`Renewal job started (interval: ${process.env.RENEWAL_CHECK_INTERVAL_MINUTES || 15} minutes)`)

  console.log(`Solid Webhook server running on port ${config.port}`)

  console.log('Processing existing inbox items in background...')
  const inboxRegistrations = validRegistrations.filter((reg) => reg.handler === 'InboxModified')
  for (const reg of inboxRegistrations) {
    processExistingInboxItems(reg.topic, fetchFn, handlers.InboxModified)
      .then(({ processed, skipped, total }) => {
        console.log(`Processed ${processed} existing items from ${reg.topic} (${skipped} skipped, ${total} total)`)
      })
      .catch((error) => {
        console.error(`Failed to process existing inbox items for ${reg.topic}: ${error}`)
      })
  }

  const shutdown = async () => {
    console.log('Shutting down...')
    stopRenewalJob()
    await unsubscribeAll(app.context.subscriptions ?? [], fetchFn)
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