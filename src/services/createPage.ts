import type { SolidFetch } from '../types/index.js'

export async function createPage(
  pageUrl: string,
  inboxUrl: string,
  fetch: SolidFetch,
  prevPageUrl?: string
): Promise<void> {
  const page: Record<string, unknown> = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: pageUrl,
    type: 'OrderedCollectionPage',
    partOf: inboxUrl,
  }

  if (prevPageUrl) {
    page.prev = prevPageUrl
  }

  const response = await fetch(pageUrl, {
    method: 'PUT',
    headers: {
      'content-type': 'application/ld+json',
    },
    body: JSON.stringify(page),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to create page ${pageUrl}: ${response.status} ${text}`)
  }
}