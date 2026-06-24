import type { SolidFetch } from '../types/index.js'

export async function updatePageNext(
  pageUrl: string,
  nextUrl: string,
  fetch: SolidFetch
): Promise<void> {
  const escapedPageUrl = pageUrl
  const escapedNextUrl = nextUrl
  const patch = `PREFIX as: <https://www.w3.org/ns/activitystreams#>
INSERT DATA {
  <${escapedPageUrl}> as:next <${escapedNextUrl}>.
}
`

  const response = await fetch(pageUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/sparql-update',
    },
    body: patch,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to update page next: ${response.status} ${text}`)
  }
}