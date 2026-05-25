import type { WebhookEvent, SolidFetch } from '../types/index.js'
import { derivePageUrl } from '../services/derivePageUrl.js'
import { persistInboxItem } from '../services/persistInbox.js'

export async function handleInboxModified(
  event: WebhookEvent,
  fetch: SolidFetch,
  _context?: unknown
): Promise<boolean> {
  if (event.type === 'Remove') {
    return false
  }

  const activityResponse = await fetch(event.object, {
    method: 'GET',
    headers: {
      accept: 'application/activity+json, application/ld+json, application/json',
    },
  })

  if (!activityResponse.ok) {
    console.error(`Failed to fetch activity: ${activityResponse.status}`)
    return false
  }

  const contentType = activityResponse.headers.get('content-type') || ''
  if (!contentType.includes('activity+json') && !contentType.includes('ld+json')) {
    console.error('Activity is not JSON-LD')
    return false
  }

  const activity = await activityResponse.json() as Record<string, unknown>
  console.log('Processing activity:', activity)

  const inboxUrl = event.topic
  let pageUrl: string
  try {
    pageUrl = await derivePageUrl(inboxUrl, fetch)
    await persistInboxItem(activity, pageUrl, fetch)
  } catch (error) {
    console.error(`Failed to persist inbox item: ${error}`)
  }

  const deleteResponse = await fetch(event.object, {
    method: 'DELETE',
  })

  if (!deleteResponse.ok) {
    console.error(`Failed to delete activity: ${deleteResponse.status}`)
  }

  return true
}

export function createInboxHandler(fetchFactory: () => Promise<SolidFetch>) {
  return async (event: WebhookEvent): Promise<void> => {
    const fetch = await fetchFactory()
    await handleInboxModified(event, fetch)
  }
}
