import type { SolidFetch, InboxCollection } from '../types/index.js'
import { createPage } from './createPage.js'
import { updateInboxFirst } from './updateInbox.js'
import { getPageInfo, PAGE_SIZE_LIMIT } from './getPageInfo.js'

function normalizeInboxUrl(inboxUrl: string): string {
  return inboxUrl.endsWith('/') ? inboxUrl : `${inboxUrl}/`
}

function generatePageUrl(inboxUrl: string): string {
  const normalized = normalizeInboxUrl(inboxUrl)
  const timestamp = Date.now()
  return `${normalized}pages/${timestamp}`
}

export async function getInboxCollection(
  inboxUrl: string,
  fetch: SolidFetch
): Promise<InboxCollection | null> {
  const response = await fetch(inboxUrl, {
    method: 'GET',
    headers: {
      accept: 'application/ld+json, application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return null
    }
    throw new Error(`Failed to fetch inbox ${inboxUrl}: ${response.status}`)
  }

  const body = await response.text()
  const data = JSON.parse(body) as InboxCollection
  return data
}

export async function derivePageUrl(
  inboxUrl: string,
  fetch: SolidFetch
): Promise<string> {
  const normalizedInbox = normalizeInboxUrl(inboxUrl)

  let firstPageUrl: string | null = null

  try {
    const collection = await getInboxCollection(normalizedInbox, fetch)
    if (collection && collection.first) {
      firstPageUrl = collection.first
    }
  } catch (error) {
    console.warn(`Could not fetch inbox collection: ${error}`)
  }

  if (firstPageUrl) {
    try {
      const pageInfo = await getPageInfo(firstPageUrl, fetch)
      if (!pageInfo.isFull) {
        return firstPageUrl
      }
    } catch (error) {
      console.warn(`Could not check page info: ${error}`)
    }
  }

  const newPageUrl = generatePageUrl(normalizedInbox)

  try {
    await createPage(newPageUrl, normalizedInbox, fetch)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Already exists')) {
      return newPageUrl
    }
    throw error
  }

  try {
    await updateInboxFirst(normalizedInbox, newPageUrl, fetch)
  } catch (error) {
    console.warn(`Could not update inbox first link: ${error}`)
  }

  return newPageUrl
}