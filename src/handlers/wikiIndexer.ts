import { Parser, Store } from 'n3'
import type { WebhookEvent, SolidFetch, HandlerContext, WikiIndexerWebhook } from '../types/index.js'

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const BATCH_SIZE = 50

function decodePercentEncoding(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function basenameToTitle(filename: string): string {
  const name = filename.endsWith('.md') ? filename.slice(0, -3) : filename
  return decodePercentEncoding(name)
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function filenameToTitle(fileUrl: string): string {
  const urlParts = fileUrl.split('/')
  return basenameToTitle(urlParts[urlParts.length - 1] || '')
}

function buildBatchUpdate(operation: 'INSERT' | 'DELETE', files: string[]): string {
  const triples = files
    .map(file => `<${file}> rdfs:label "${filenameToTitle(file)}" .`)
    .join('\n  ')

  return `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
${operation} DATA {
  ${triples}
}`
}

async function applyIndexUpdate(
  operation: 'INSERT' | 'DELETE',
  indexUrl: string,
  files: string[],
  fetch: SolidFetch
): Promise<boolean> {
  if (files.length === 0) {
    return true
  }

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE)
    const response = await fetch(indexUrl, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/sparql-update',
      },
      body: buildBatchUpdate(operation, batch),
    })

    if (!response.ok) {
      console.error(`[WikiIndexer] Error: Failed to update index: ${response.status}`)
      return false
    }
  }

  return true
}

export function applyIndexInsert(
  indexUrl: string,
  files: string[],
  fetch: SolidFetch
): Promise<boolean> {
  return applyIndexUpdate('INSERT', indexUrl, files, fetch)
}

export function applyIndexDelete(
  indexUrl: string,
  files: string[],
  fetch: SolidFetch
): Promise<boolean> {
  return applyIndexUpdate('DELETE', indexUrl, files, fetch)
}

export async function deleteIndexSubtree(
  indexUrl: string,
  containerUrl: string,
  fetch: SolidFetch
): Promise<boolean> {
  let turtle: string

  try {
    const response = await fetch(indexUrl, {
      method: 'GET',
      headers: {
        accept: 'text/turtle',
      },
    })

    if (!response.ok) {
      console.error(`[WikiIndexer] Error: Failed to fetch index: ${response.status}`)
      return false
    }

    turtle = await response.text()
  } catch (error) {
    console.error(`[WikiIndexer] Error: Failed to fetch index: ${error}`)
    return false
  }

  let subjects: string[]

  try {
    const parser = new Parser({ baseIRI: indexUrl })
    const store = new Store()
    const quads = parser.parse(turtle)
    if (quads) {
      store.addQuads(quads)
    }

    subjects = [...new Set(
      store.getQuads(null, RDFS_LABEL, null, null)
        .map(quad => quad.subject.value)
        .filter(subject => subject.startsWith(containerUrl))
    )]
  } catch (error) {
    console.error(`[WikiIndexer] Error: Failed to parse index: ${error}`)
    return false
  }

  return applyIndexDelete(indexUrl, subjects, fetch)
}

export async function handleWikiIndexer(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: HandlerContext
): Promise<boolean> {
  console.log(`[WikiIndexer] ${event.type} event for ${event.object}`)

  const registration = context?.registrations?.find(
    (r): r is WikiIndexerWebhook => r.handler === 'WikiIndexer'
  )
  if (!registration) {
    console.error('[WikiIndexer] Error: No WikiIndexer registration found')
    return false
  }

  if (!event.object.endsWith('.md')) {
    console.log('[WikiIndexer] Not a markdown file, skipping')
    return false
  }

  const indexUrl = registration.indexUrl
  const files = [event.object]

  return event.type === 'Remove'
    ? applyIndexDelete(indexUrl, files, fetch)
    : applyIndexInsert(indexUrl, files, fetch)
}
