import { subscribeWebhookChannel } from './webhookChannel.js'
import type { SolidFetch, TrackedSubscription } from '../types/index.js'

export async function subscribeTracked(
  topic: string,
  sendToUrl: string,
  fetch: SolidFetch
): Promise<TrackedSubscription> {
  const durationMinutes = parseInt(process.env.SUBSCRIPTION_DURATION_MINUTES || '10080', 10)
  const durationMs = durationMinutes * 60 * 1000
  const createdAt = new Date()
  const endAt = new Date(createdAt.getTime() + durationMs)

  const subscriptionInfo = await subscribeWebhookChannel(
    topic,
    sendToUrl,
    fetch,
    endAt
  )

  return {
    ...subscriptionInfo,
    status: 'active',
    createdAt,
    endAt,
  }
}
