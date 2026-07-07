import type { WebhookEvent, SolidFetch, HandlerContext, WikiIndexerWebhook } from '../types/index.js'

export async function handleWikiIndexer(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: HandlerContext
): Promise<boolean> {
  console.log(`[WikiIndexer] ${event.type} event for ${event.object}`)

  const registration = context?.registrations?.find(
    (r): r is WikiIndexerWebhook => r.handler === 'WikiIndexer'
  )
  if (!registration) {
    console.error('[WikiIndexer] Error: No WikiIndexer registration found')
    return false
  }

  const indexUrl = registration.indexUrl

  const sparqlBody = event.type === 'Remove' ? 'DELETE DATA {}' : 'INSERT DATA {}'

  await fetch(indexUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/sparql-update',
    },
    body: sparqlBody,
  })

  return true
}
