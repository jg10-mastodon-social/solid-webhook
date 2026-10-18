import { parseWebhooksFromRDF } from '../config.js'
import { subscribeWebhookChannel } from '../services/webhookChannel.js'
import { initializeWikiIndexers } from '../services/wikiIndexerInit.js'
import type { WebhookEvent, SolidFetch, HandlerContext } from '../types/index.js'

interface KoaDefaultContext {
  subscriptions: any[]
  registrations: any[]
  handlers: Record<string, (event: WebhookEvent, fetch: SolidFetch, context: KoaDefaultContext) => void | Promise<void>>
  sendToUrl: string
  handlerBaseUrl: string
}

export async function handleUpdateWebhooks(
  event: WebhookEvent,
  fetch: SolidFetch,
  context: KoaDefaultContext
): Promise<void> {
  console.log(`[UpdateWebhooks] ${event.type} event for ${event.object}`)

  if (event.type !== 'Update') {
    console.log('[UpdateWebhooks] Non-Update event, skipping')
    return
  }

  const subscriptions = context.subscriptions || []
  const registrations = context.registrations || []
  const handlers = context.handlers || {}
  const sendToUrl = context.sendToUrl || ''
  const handlerBaseUrl = context.handlerBaseUrl || ''

  const rdfResponse = await fetch(event.object, {
    headers: { accept: 'text/turtle,application/x-turtle' },
  })
  if (!rdfResponse.ok) {
    console.error(`[UpdateWebhooks] Error: Failed to fetch webhook config: ${rdfResponse.status}`)
    console.log('[UpdateWebhooks] completed')
    return
  }

  const rdfContent = await rdfResponse.text()
  const parsedWebhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)
  console.log(`[UpdateWebhooks] Parsed ${parsedWebhooks.length} webhooks`)

  let wikiIndexerAdded = false

  for (const webhook of parsedWebhooks) {
    const exists = subscriptions.some((sub: any) => sub.topic === webhook.topic)
    if (exists) continue

    if (webhook.handler === 'WikiIndexer' && !webhook.indexUrl) {
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: webhook.topic,
        status: 'failed',
        error: 'WikiIndexer webhook is missing required :indexUrl',
      })
      console.error('[UpdateWebhooks] Error: WikiIndexer webhook is missing required :indexUrl')
      continue
    }

    if (webhook.handler === 'CommitHandler' && !webhook.gitDir) {
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: webhook.topic,
        status: 'failed',
        error: 'CommitHandler webhook is missing required :gitDir',
      })
      console.error('[UpdateWebhooks] Error: CommitHandler webhook is missing required :gitDir')
      continue
    }

    const handler = handlers[webhook.handler]
    if (!handler) {
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: webhook.topic,
        status: 'failed',
        error: `Unknown handler: ${webhook.handler}`,
      })
      console.error(`[UpdateWebhooks] Error: Unknown handler: ${webhook.handler}`)
      continue
    }

    try {
      const subscription = await subscribeWebhookChannel(webhook.topic, sendToUrl, fetch)
      subscriptions.push({ ...subscription, status: 'active' })
      const registration: Record<string, unknown> = {
        handler: webhook.handler,
        topic: webhook.topic,
        callback: async (evt: WebhookEvent, fet: SolidFetch) => handler(evt, fet, context),
        actor: webhook.actor,
      }
      if (webhook.handler === 'WikiIndexer') {
        registration.indexUrl = webhook.indexUrl
        registration.maxDepth = webhook.maxDepth ?? 1
        wikiIndexerAdded = true
      } else if (webhook.handler === 'CommitHandler') {
        registration.gitDir = webhook.gitDir
      }
      registrations.push(registration)
      console.log(`[UpdateWebhooks] Subscribed: ${webhook.topic}`)
    } catch (error) {
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: webhook.topic,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      console.error(`[UpdateWebhooks] Error: Failed to subscribe ${webhook.topic}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  if (wikiIndexerAdded) {
    await initializeWikiIndexers(context as unknown as HandlerContext, fetch)
  }
  console.log('[UpdateWebhooks] completed')
}