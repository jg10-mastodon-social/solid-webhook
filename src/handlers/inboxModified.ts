import type { WebhookEvent, SolidFetch } from '../types/index.js'
import { derivePageUrl } from '../services/derivePageUrl.js'
import { persistInboxItem } from '../services/persistInbox.js'

export async function handleInboxModified(
  event: WebhookEvent,
  fetch: SolidFetch,
  _context?: unknown
): Promise<boolean> {
  console.log(`[InboxModified] ${event.type} event for ${event.object}`)

  if (event.type === 'Remove') {
    console.log('[InboxModified] Remove event, skipping')
    return false
  }
  if (event.type === 'Update') {
    console.log('[ItemListIndexer] Update event, skipping')
    return false
  }

  const activityResponse = await fetch(event.object, {
    method: 'GET',
    headers: {
      accept: 'application/activity+json, application/ld+json, application/json',
    },
  })

  if (!activityResponse.ok) {
    console.error(`[InboxModified] Error: Failed to fetch activity: ${activityResponse.status}`)
    console.log(`[InboxModified] completed: false`)
    return false
  }

  const contentType = activityResponse.headers.get('content-type') || ''
  if (!contentType.includes('activity+json') && !contentType.includes('ld+json')) {
    console.error('[InboxModified] Error: Activity is not JSON-LD')
    console.log('[InboxModified] completed: false')
    return false
  }

  const activity = await activityResponse.json() as Record<string, unknown>
  console.log('[InboxModified] Processing activity:', activity)

  const inboxUrl = event.topic
  let pageUrl: string | undefined
  try {
    pageUrl = await derivePageUrl(inboxUrl, fetch)
    if (pageUrl) {
      await persistInboxItem(activity, pageUrl, fetch)
    }
  } catch (error) {
    console.error(`[InboxModified] Error: Failed to persist inbox item: ${error}`)
  }

  const deleteResponse = await fetch(event.object, {
    method: 'DELETE',
  })

  if (!deleteResponse.ok) {
    console.error(`[InboxModified] Error: Failed to delete activity: ${deleteResponse.status}`)
  }

  console.log('[InboxModified] completed: true')
  return true
}

export function createInboxHandler(fetchFactory: () => Promise<SolidFetch>) {
  return async (event: WebhookEvent): Promise<void> => {
    console.log(`[InboxHandlerFactory] Handling event for ${event.topic}`)
    const fetch = await fetchFactory()
    await handleInboxModified(event, fetch)
  }
}
