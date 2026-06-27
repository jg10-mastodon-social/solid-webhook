import jsonld from 'jsonld'
import { Parser, Store, Writer } from 'n3'
import type { SolidFetch } from '../types/index.js'
import { activityToTurtle, skolemizeBlankNodes } from './activityToRdf.js'
import { buildUpdatePatch } from './buildPatch.js'
import { derivePageUrl } from './derivePageUrl.js'
import { persistInboxItem } from './persistInbox.js'

async function getObjectQuads(pageUrl: string, objectId: string, fetch: SolidFetch): Promise<string | null> {
  const response = await fetch(pageUrl, {
    method: 'GET',
    headers: {
      accept: 'text/turtle',
    },
  })

  if (!response.ok) {
    return null
  }

  const text = await response.text()
  const parser = new Parser({ baseIRI: pageUrl })
  const store = new Store()
  const quads = parser.parse(text)
  if (quads) {
    store.addQuads(quads)
  }

  const objectQuads = store.getQuads(objectId, null, null, null)
  if (objectQuads.length === 0) {
    return null
  }

  const writer = new Writer({ format: 'Turtle' })
  for (const quad of objectQuads) {
    writer.addQuad(quad)
  }

  return new Promise((resolve, reject) => {
    writer.end((error: Error | null, result: string) => {
      if (error) reject(error)
      else resolve(result)
    })
  })
}

async function findPageWithObject(inboxUrl: string, objectId: string, fetch: SolidFetch): Promise<string | null> {
  const collection = await getInboxCollection(inboxUrl, fetch)
  if (!collection || !collection.first) {
    return null
  }

  let currentPage: string | null = collection.first
  while (currentPage) {
    const pageResponse = await fetch(currentPage, {
      method: 'GET',
      headers: {
        accept: 'text/turtle',
      },
    })

    if (!pageResponse.ok) {
      return null
    }

    const text = await pageResponse.text()
    const parser = new Parser({ baseIRI: currentPage })
    const store = new Store()
    const quads = parser.parse(text)
    if (quads) {
      store.addQuads(quads)
    }

    const objectQuads = store.getQuads(objectId, null, null, null)
    if (objectQuads.length > 0) {
      return currentPage
    }

    const nextQuads = store.getQuads(currentPage, 'https://www.w3.org/ns/activitystreams#next', null, null)
    currentPage = nextQuads && nextQuads.length > 0 ? nextQuads[0].object.value : null
  }

  return null
}

interface InboxCollection {
  id: string
  type: string
  first?: string
  last?: string
  totalItems?: number
}

async function getInboxCollection(inboxUrl: string, fetch: SolidFetch): Promise<InboxCollection | null> {
  const response = await fetch(inboxUrl, {
    method: 'GET',
    headers: {
      accept: 'text/turtle',
    },
  })

  if (!response.ok) {
    return null
  }

  const text = await response.text()
  const parser = new Parser({ baseIRI: inboxUrl })
  const store = new Store()
  const quads = parser.parse(text)
  if (quads) {
    store.addQuads(quads)
  }

  const firstQuads = store.getQuads(inboxUrl, 'https://www.w3.org/ns/activitystreams#first', null, null)
  if (firstQuads.length === 0) {
    return null
  }

  return {
    id: inboxUrl,
    type: 'OrderedCollection',
    first: firstQuads[0].object.value,
  }
}

export async function updateInboxItem(
  newObject: Record<string, unknown>,
  objectId: string,
  inboxUrl: string,
  fetch: SolidFetch,
  options: { skolemizeBase: string }
): Promise<void> {
  const { skolemizeBase } = options

  const pageUrl = await findPageWithObject(inboxUrl, objectId, fetch)

  if (!pageUrl) {
    const page = await derivePageUrl(inboxUrl, fetch)
    await persistInboxItem(newObject, page, fetch, { skolemizeBase })
    return
  }

  const oldTurtle = await getObjectQuads(pageUrl, objectId, fetch)

  const activityWithContext = {
    ...newObject,
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
  }

  const expanded = await jsonld.expand(activityWithContext)
  const nquads = await jsonld.toRDF(expanded, { format: 'application/n-quads' }) as string

  const newTurtle = skolemizeBlankNodes(nquads, skolemizeBase)

  const patchBody = buildUpdatePatch(oldTurtle || '', newTurtle, objectId, pageUrl)

  const response = await fetch(pageUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'text/n3',
    },
    body: patchBody,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to update inbox item: ${response.status} ${text}`)
  }
}