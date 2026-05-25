import type { SolidFetch, PageInfo, InboxPage } from '../types/index.js'

export const PAGE_SIZE_LIMIT = 200

export async function getPageInfo(pageUrl: string, fetch: SolidFetch): Promise<PageInfo> {
  const response = await fetch(pageUrl, {
    method: 'GET',
    headers: {
      accept: 'application/ld+json, application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return { itemCount: 0, isFull: false }
    }
    throw new Error(`Failed to fetch page ${pageUrl}: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || ''
  const body = await response.text()
  const data = JSON.parse(body)

  let itemCount = 0

  if (contentType.includes('application/ld+json') || contentType.includes('application/json')) {
    const page = data as InboxPage
    if (page.items) {
      itemCount = Array.isArray(page.items) ? page.items.length : 0
    } else if (page.orderedItems) {
      itemCount = Array.isArray(page.orderedItems) ? page.orderedItems.length : 0
    }
  }

  return {
    itemCount,
    isFull: itemCount >= PAGE_SIZE_LIMIT,
  }
}