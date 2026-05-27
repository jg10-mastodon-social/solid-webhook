import type { SolidFetch } from '../types/index.js'
import { discoverMetaResourceUrl } from './solidHelpers.js'

export async function updateInboxFirst(
  inboxUrl: string,
  newFirstUrl: string,
  fetch: SolidFetch
): Promise<void> {
  let targetUrl: string

  if (inboxUrl.endsWith('/')) {
    targetUrl = await discoverMetaResourceUrl(inboxUrl, fetch)
  } else {
    targetUrl = inboxUrl
  }

  const patch = `@prefix as: <https://www.w3.org/ns/activitystreams#>.
INSERT DATA {
  <${inboxUrl}> as:first <${newFirstUrl}>.
}.

DELETE DATA {
  <${inboxUrl}> as:first ?oldFirst.
} WHERE {
  <${inboxUrl}> as:first ?oldFirst.
}.
`

  const response = await fetch(targetUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/sparql-update',
    },
    body: patch,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to update inbox first: ${response.status} ${text}`)
  }
}