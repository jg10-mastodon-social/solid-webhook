import { Parser, Store } from 'n3'
import type { SolidFetch, SubscriptionInfo } from '../types/index.js'

export async function subscribeWebhookChannel(
  topic: string,
  sendTo: string,
  fetch: SolidFetch
): Promise<SubscriptionInfo> {
  const headResponse = await fetch(topic, { method: 'HEAD' })

  if (!headResponse.ok) {
    if (headResponse.status === 401) throw new Error(`Unauthorized to access topic ${topic}: 401`)
    if (headResponse.status === 403) throw new Error(`Forbidden to access topic ${topic}: 403`)
    throw new Error(`Failed to fetch topic ${topic}: ${headResponse.status}`)
  }

  const linkHeader = headResponse.headers.get('link')
  if (!linkHeader) {
    throw new Error('No storage description link found')
  }

  const storageMatch = linkHeader.match(/<([^>]+)>;\s*rel="http:\/\/www\.w3\.org\/ns\/solid\/terms#storageDescription"/)
  if (!storageMatch) {
    throw new Error('No storage description link found')
  }

  const storageUrl = storageMatch[1]
  const storageResponse = await fetch(storageUrl)

  if (!storageResponse.ok) {
    if (storageResponse.status === 401) throw new Error(`Unauthorized to access storage description ${storageUrl}: 401`)
    if (storageResponse.status === 403) throw new Error(`Forbidden to access storage description ${storageUrl}: 403`)
    throw new Error(`Failed to fetch storage description ${storageUrl}: ${storageResponse.status}`)
  }

  const storageText = await storageResponse.text()

  const socketUrl = findWebhookSocketUrl(storageText, storageUrl)
  if (!socketUrl) {
    throw new Error('No WebhookChannel2023 socket found')
  }

  const subscriptionResponse = await fetch(socketUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/ld+json',
    },
    body: JSON.stringify({
      '@context': 'https://www.w3.org/ns/solid/notification/v1',
      type: 'http://www.w3.org/ns/solid/notifications#WebhookChannel2023',
      topic: topic,
      sendTo: sendTo,
    }),
  })

  if (!subscriptionResponse.ok) {
    if (subscriptionResponse.status === 401) throw new Error(`Unauthorized to subscribe to webhook: 401`)
    if (subscriptionResponse.status === 403) throw new Error(`Forbidden to subscribe to webhook: 403`)
    throw new Error(`Subscription failed: ${subscriptionResponse.status}`)
  }

  const subscriptionData = await subscriptionResponse.json() as {
    id: string
    receiveFrom: string
  }

  return {
    id: subscriptionData.id,
    receiveFrom: subscriptionData.receiveFrom,
    topic: topic,
  }
}

export async function unsubscribeWebhookChannel(
  subscriptionId: string,
  fetch: SolidFetch
): Promise<void> {
  const response = await fetch(subscriptionId, { method: 'DELETE' })
  
  if (!response.ok && response.status !== 204) {
    throw new Error('Failed to unsubscribe')
  }
}

function findWebhookSocketUrl(rdfContent: string, baseUrl: string): string | null {
  const parser = new Parser({ baseIRI: baseUrl })
  const store = new Store()
  
  const quads = parser.parse(rdfContent)
  if (quads) {
    store.addQuads(quads)
  }

  const webhookQuads = store.getQuads(
    null,
    'http://www.w3.org/ns/solid/notifications#channelType',
    'http://www.w3.org/ns/solid/notifications#WebhookChannel2023',
    null
  )

  if (webhookQuads.length > 0) {
    return webhookQuads[0].subject.value
  }

  return null
}
