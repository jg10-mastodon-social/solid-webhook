import type { SolidFetch } from '../types/index.js'

export async function updateInboxFirst(
  inboxUrl: string,
  newFirstUrl: string,
  fetch: SolidFetch
): Promise<void> {
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

  const response = await fetch(inboxUrl, {
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