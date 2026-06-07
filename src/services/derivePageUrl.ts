import { Parser, Store } from 'n3'
import type { SolidFetch, InboxCollection } from '../types/index.js'
import { createPage } from './createPage.js'
import { updateInboxFirst } from './updateInbox.js'
import { getPageInfo } from './getPageInfo.js'

function generatePageUrl(inboxUrl: string): string {
  const timestamp = Date.now()
  return `${inboxUrl}pages/${timestamp}`
}

export async function getInboxCollection(
  inboxUrl: string,
  fetch: SolidFetch,
): Promise<InboxCollection | null> {
  const response = await fetch(inboxUrl, {
    method: 'GET',
    headers: {
      accept: 'text/turtle,application/x-turtle',
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return null
    }
    throw new Error(`Failed to fetch inbox ${inboxUrl}: ${response.status}`)
  }

  const text = await response.text()
  const parser = new Parser({ baseIRI: inboxUrl })
  const store = new Store()
  const quads = parser.parse(text)
  if (quads) {
    store.addQuads(quads)
  }

  const firstQuads = store.getQuads(
    inboxUrl,
    'https://www.w3.org/ns/activitystreams#first',
    null,
    null
  )

  if (firstQuads.length === 0) {
    return null
  }

  return {
    id: inboxUrl,
    type: 'OrderedCollection',
    first: firstQuads[0].object.value,
  }
}

export async function derivePageUrl(
  inboxUrl: string,
  fetch: SolidFetch
): Promise<string> {
  if (!inboxUrl.endsWith('/')) throw new Error('Inbox url should end with /')

  let firstPageUrl: string | null = null

  try {
    const collection = await getInboxCollection(
      inboxUrl,
      fetch
    )
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

  const newPageUrl = generatePageUrl(inboxUrl)

  try {
    await createPage(newPageUrl, inboxUrl, fetch)
  } catch (error) {
    if (error instanceof Error && error.message.includes('Already exists')) {
      return newPageUrl
    }
    throw error
  }

  try {
    await updateInboxFirst(inboxUrl, newPageUrl, fetch)
  } catch (error) {
    console.warn(`Could not update inbox first link: ${error}`)
  }

  return newPageUrl
}