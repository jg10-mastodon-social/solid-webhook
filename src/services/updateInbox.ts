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

  const escapedInboxUrl = inboxUrl
  const escapedNewFirstUrl = newFirstUrl
  const patch = `PREFIX as: <https://www.w3.org/ns/activitystreams#>
DELETE {
  <${escapedInboxUrl}> as:first ?oldFirst.
} WHERE {
  <${escapedInboxUrl}> as:first ?oldFirst.
};
INSERT DATA {
  <${escapedInboxUrl}> as:first <${escapedNewFirstUrl}>.
}
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

