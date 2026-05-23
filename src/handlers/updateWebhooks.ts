import { parseWebhooksFromRDF } from '../config.js'
import { subscribeWebhookChannel } from '../services/webhookChannel.js'
import type { WebhookEvent, SolidFetch } from '../types/index.js'

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
  if (event.type !== 'Update') return

  const subscriptions = context.subscriptions || []
  const registrations = context.registrations || []
  const handlers = context.handlers || {}
  const sendToUrl = context.sendToUrl || ''
  const handlerBaseUrl = context.handlerBaseUrl || ''

  const rdfResponse = await fetch(event.object, {
    headers: { accept: 'text/turtle,application/x-turtle' },
  })
  if (!rdfResponse.ok) {
    console.error(`Failed to fetch webhook config: ${rdfResponse.status}`)
    return
  }

  const rdfContent = await rdfResponse.text()
  const parsedWebhooks = await parseWebhooksFromRDF(rdfContent, handlerBaseUrl)

  for (const webhook of parsedWebhooks) {
    const exists = subscriptions.some((sub: any) => sub.topic === webhook.topic)
    if (exists) continue

    const handler = handlers[webhook.handler]
    if (!handler) {
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: webhook.topic,
        status: 'failed',
        error: `Unknown handler: ${webhook.handler}`,
      })
      continue
    }

    try {
      const subscription = await subscribeWebhookChannel(webhook.topic, sendToUrl, fetch)
      subscriptions.push({ ...subscription, status: 'active' })
      registrations.push({
        topic: webhook.topic,
        callback: async (evt: WebhookEvent, fet: SolidFetch) => handler(evt, fet, context),
        actor: webhook.actor,
      })
    } catch (error) {
      subscriptions.push({
        id: '',
        receiveFrom: '',
        topic: webhook.topic,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}