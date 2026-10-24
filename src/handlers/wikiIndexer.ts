import { Parser, Store } from 'n3'
import { discoverWikiContainers } from '../services/wikiContainers.js'
import { subscribeTracked } from '../services/subscriptions.js'
import { unsubscribeWebhookChannel } from '../services/webhookChannel.js'
import { basenameToTitle, filenameToTitle } from '../services/wikiLabels.js'
import type { WebhookEvent, SolidFetch, HandlerContext, WikiIndexerWebhook } from '../types/index.js'

export { basenameToTitle, filenameToTitle } from '../services/wikiLabels.js'

const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const BATCH_SIZE = 50

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

function selectRegistration(
  registrations: HandlerContext['registrations'],
  object: string
): WikiIndexerWebhook | undefined {
  let best: WikiIndexerWebhook | undefined

  for (const registration of registrations ?? []) {
    if (registration.handler !== 'WikiIndexer') continue
    if (!object.startsWith(registration.topic)) continue
    if (!best || registration.topic.length > best.topic.length) {
      best = registration
    }
  }

  return best
}

function containerDepth(topic: string, containerUrl: string): number | null {
  if (!containerUrl.startsWith(topic)) return null

  const relative = containerUrl.slice(topic.length)
  if (relative === '') return 0

  return relative.split('/').filter(segment => segment.length > 0).length
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

async function handleContainerAdd(
  event: WebhookEvent,
  registration: WikiIndexerWebhook,
  fetch: SolidFetch,
  context: HandlerContext
): Promise<boolean> {
  const maxDepth = registration.maxDepth ?? 1
  const depth = containerDepth(registration.topic, event.object)

  if (depth === null) {
    console.error('[WikiIndexer] Error: Container outside registration topic')
    return false
  }

  if (depth > maxDepth) {
    console.log(`[WikiIndexer] Container depth ${depth} exceeds maxDepth ${maxDepth}, skipping`)
    return false
  }

  const { containers, markdownFiles } = await discoverWikiContainers(
    event.object,
    maxDepth - depth,
    fetch
  )

  const files = dedupe(markdownFiles)

  if (!context.sendToUrl) {
    console.error('[WikiIndexer] Error: Missing sendToUrl, cannot subscribe to new containers')
    await applyIndexInsert(registration.indexUrl, files, fetch)
    return false
  }

  const subscriptions = context.subscriptions ?? (context.subscriptions = [])
  const activeTopics = new Set(
    subscriptions.filter(sub => sub.status === 'active').map(sub => sub.topic)
  )

  let subscribed = true

  for (const container of dedupe(containers)) {
    if (activeTopics.has(container)) continue

    try {
      const tracked = await subscribeTracked(container, context.sendToUrl, fetch)
      subscriptions.push(tracked)
      activeTopics.add(container)
    } catch (error) {
      console.error(`[WikiIndexer] Error: Failed to subscribe to ${container}: ${error}`)
      subscribed = false
    }
  }

  const backfilled = await applyIndexInsert(registration.indexUrl, files, fetch)

  return subscribed && backfilled
}

async function handleContainerRemove(
  event: WebhookEvent,
  registration: WikiIndexerWebhook,
  fetch: SolidFetch,
  context?: HandlerContext
): Promise<boolean> {
  const container = event.object
  const subscriptions = context?.subscriptions ?? []

  for (const sub of subscriptions) {
    if (sub.topic === container || sub.topic.startsWith(container)) {
      if (sub.id) {
        try {
          await unsubscribeWebhookChannel(sub.id, fetch)
        } catch (error) {
          console.error(`[WikiIndexer] Error: Failed to unsubscribe ${sub.id}: ${error}`)
        }
      }
    }
  }

  if (context?.subscriptions) {
    for (let i = context.subscriptions.length - 1; i >= 0; i--) {
      const topic = context.subscriptions[i].topic
      if (topic === container || topic.startsWith(container)) {
        context.subscriptions.splice(i, 1)
      }
    }
  }

  return deleteIndexSubtree(registration.indexUrl, container, fetch)
}

export async function handleWikiIndexer(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: HandlerContext
): Promise<boolean> {
  console.log(`[WikiIndexer] ${event.type} event for ${event.object}`)

  const registration = selectRegistration(context?.registrations, event.object)
  if (!registration) {
    console.error('[WikiIndexer] Error: No WikiIndexer registration found')
    return false
  }

  if (event.object.endsWith('.md')) {
    const files = [event.object]
    return event.type === 'Remove'
      ? applyIndexDelete(registration.indexUrl, files, fetch)
      : applyIndexInsert(registration.indexUrl, files, fetch)
  }

  if (event.object.endsWith('/')) {
    return event.type === 'Remove'
      ? handleContainerRemove(event, registration, fetch, context)
      : handleContainerAdd(event, registration, fetch, context!)
  }

  console.log('[WikiIndexer] Not a markdown file or container, skipping')
  return false
}
