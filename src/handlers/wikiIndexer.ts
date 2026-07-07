import type { WebhookEvent, SolidFetch, HandlerContext, WikiIndexerWebhook } from '../types/index.js'

function basenameToTitle(filename: string): string {
  const name = filename.endsWith('.md') ? filename.slice(0, -3) : filename
  return name
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function buildInsertUpdate(fileUrl: string, title: string, indexUrl: string): string {
  return `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
INSERT DATA {
  <${fileUrl}> rdfs:label "${title}" .
}`
}

function buildDeleteUpdate(fileUrl: string, title: string, indexUrl: string): string {
  return `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
DELETE DATA {
  <${fileUrl}> rdfs:label "${title}" .
}`
}

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

  if (!event.object.endsWith('.md')) {
    console.log('[WikiIndexer] Not a markdown file, skipping')
    return false
  }

  const indexUrl = registration.indexUrl
  const fileUrl = event.object

  const urlParts = fileUrl.split('/')
  const filename = urlParts[urlParts.length - 1] || ''
  const title = basenameToTitle(filename)

  const sparqlBody = event.type === 'Remove'
    ? buildDeleteUpdate(fileUrl, title, indexUrl)
    : buildInsertUpdate(fileUrl, title, indexUrl)

  const patchResponse = await fetch(indexUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/sparql-update',
    },
    body: sparqlBody,
  })

  if (!patchResponse.ok) {
    console.error(`[WikiIndexer] Error: Failed to update index: ${patchResponse.status}`)
    return false
  }

  return true
}
