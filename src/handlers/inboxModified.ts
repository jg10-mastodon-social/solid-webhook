import type { WebhookEvent, SolidFetch } from '../types/index.js'
import { derivePageUrl } from '../services/derivePageUrl.js'
import { persistInboxItem } from '../services/persistInbox.js'

export async function handleInboxModified(
  event: WebhookEvent,
  fetch: SolidFetch,
  _context?: unknown
): Promise<boolean> {
  console.log(`[InboxModified] ${event.type} event for ${event.object} on topic ${event.topic}`)

  if (event.type === 'Remove') {
    console.log('[InboxModified] Remove event, skipping')
    return false
  }
  if (event.type === 'Update') {
    console.log('[InboxModified] Update event, skipping')
    return false
  }

  const activityResponse = await fetch(event.object, {
    method: 'GET',
    headers: {
      accept: 'application/activity+json, application/ld+json, application/json, application/octet-stream',
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
      const url = new URL(pageUrl)
      const skolemizeBase = `${url.origin}/.well-known/genid/`
      await persistInboxItem(activity, pageUrl, fetch, { skolemizeBase })
      console.log(`[InboxModified] Persisted activity to inbox`)
    }
  } catch (error) {
    console.error(`[InboxModified] Error: Failed to persist inbox item: ${error}`)
  }

  const deleteResponse = await fetch(event.object, {
    method: 'DELETE',
  })

  if (!deleteResponse.ok) {
    console.error(`[InboxModified] Error: Failed to delete activity: ${deleteResponse.status}`)
  } else {
    console.log(`[InboxModified] Deleted activity from ${event.object}`)
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
