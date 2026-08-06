import { Parser, Store } from 'n3'
import type { SolidFetch, WebhookEvent } from '../types/index.js'

interface ChildResource {
  url: string
  types: string[]
}

async function fetchWithRetry(
  url: string,
  fetch: SolidFetch,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options)

      if (response.ok) {
        return response
      }

      if (response.status >= 400 && response.status < 500) {
        return response
      }

      throw new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries - 1) {
        const delay = (1000 * Math.pow(2, attempt)) + (Math.random() * 1000)
        console.log(`[processInbox] Fetch failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms: ${lastError.message}`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw lastError!
}

async function getChildResources(inboxUrl: string, fetch: SolidFetch): Promise<ChildResource[]> {
  const response = await fetchWithRetry(
    inboxUrl,
    fetch,
    {
      method: 'GET',
      headers: {
        accept: 'text/turtle',
      },
    }
  )

  if (!response.ok) {
    console.error(`[processInbox] Failed to fetch inbox ${inboxUrl}: ${response.status}`)
    return []
  }

  const text = await response.text()
  const parser = new Parser({ baseIRI: inboxUrl })
  const store = new Store()
  const quads = parser.parse(text)
  if (quads) {
    store.addQuads(quads)
  }

  const containsQuads = store.getQuads(
    inboxUrl,
    'http://www.w3.org/ns/ldp#contains',
    null,
    null
  )

  const children: ChildResource[] = []
  for (const quad of containsQuads) {
    const childUrl = quad.object.value
    const typeQuads = store.getQuads(
      childUrl,
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
      null,
      null
    )
    const types = typeQuads.map(t => t.object.value)
    children.push({ url: childUrl, types })
  }

  return children
}

export async function processExistingInboxItems(
  inboxUrl: string,
  fetch: SolidFetch,
  handleFn: (event: WebhookEvent, fetch: SolidFetch, context?: unknown) => void | Promise<void>
): Promise<{ processed: number; skipped: number }> {
  const children = await getChildResources(inboxUrl, fetch)

  if (children.length === 0) {
    return { processed: 0, skipped: 0 }
  }

  let processed = 0
  let skipped = 0

  for (const child of children) {
    const isContainer = child.types.some(t =>
      t === 'http://www.w3.org/ns/ldp#Container' ||
      t === 'http://www.w3.org/ns/ldp#BasicContainer' ||
      t === 'http://www.w3.org/ns/ldp#DirectContainer' ||
      t === 'http://www.w3.org/ns/ldp#IndirectContainer'
    )
    if (isContainer) {
      skipped++
      continue
    }

    try {
      await handleFn(
        {
          type: 'Add',
          object: child.url,
          topic: inboxUrl,
          raw: {},
        },
        fetch
      )
      processed++
    } catch (error) {
      console.error(`[processInbox] Error processing ${child.url}: ${error}`)
    }
  }

  return { processed, skipped }
}
