import { Parser, Store } from 'n3'
import type { WebhookEvent, SolidFetch, HandlerContext, ItemListIndexerWebhook } from '../types/index.js'

const SCHEMA_ACTION = 'https://schema.org/Action'
const SCHEMA_NAME = 'https://schema.org/name'
const SCHEMA_ACTION_STATUS = 'https://schema.org/actionStatus'
const SCHEMA_POTENTIAL_ACTION_STATUS = 'https://schema.org/PotentialActionStatus'

interface ParsedTask {
  name: string
  taskUrl: string
}

export async function handleItemListIndexer(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: HandlerContext
): Promise<boolean> {
  if (event.type === 'Remove') {
    return false
  }

  const registration = context?.registrations?.find(
    (r): r is ItemListIndexerWebhook => r.handler === 'ItemListIndexer'
  )
  if (!registration) {
    console.error('No ItemListIndexer registration found')
    return false
  }

  const indexUrl = registration.indexUrl
  const taskUrl = event.object

  const response = await fetch(taskUrl, {
    headers: {
      accept: 'text/turtle, application/x-turtle',
    },
  })

  if (!response.ok) {
    console.error(`Failed to fetch task: ${response.status}`)
    return false
  }

  const turtle = await response.text()
  const task = await parseTask(turtle, taskUrl)

  if (!task) {
    return false
  }

  const sparqlUpdate = buildIndexUpdate(task, indexUrl)

  const patchResponse = await fetch(indexUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/sparql-update',
    },
    body: sparqlUpdate,
  })

  if (!patchResponse.ok) {
    console.error(`Failed to update index: ${patchResponse.status}`)
    return false
  }

  console.log(`Indexed task: ${task.name}`)
  return true
}

async function parseTask(turtle: string, baseUrl: string): Promise<ParsedTask | null> {
  return new Promise((resolve) => {
    const parser = new Parser({ baseIRI: baseUrl })
    const store = new Store()

    let name: string | null = null
    let isAction = false
    let hasPotentialActionStatus = false

    parser.parse(turtle, (error, quad) => {
      if (error) {
        console.error('RDF parse error:', error)
        resolve(null)
        return
      }
      if (quad) {
        store.addQuad(quad)
      } else {
        const quads = store.getQuads(null, null, null, null)
        for (const q of quads) {
          const pred = q.predicate.value
          const obj = q.object.value

          if (pred === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' && obj === SCHEMA_ACTION) {
            isAction = true
          }
          if (pred === SCHEMA_NAME) {
            name = obj
          }
          if (pred === SCHEMA_ACTION_STATUS && obj === SCHEMA_POTENTIAL_ACTION_STATUS) {
            hasPotentialActionStatus = true
          }
        }
        if (isAction && name && hasPotentialActionStatus) {
          resolve({ name, taskUrl: baseUrl })
        } else {
          resolve(null)
        }
      }
    })
  })
}

function buildIndexUpdate(task: ParsedTask, indexUrl: string): string {
  const taskIt = `${task.taskUrl}#it`
  const indexIt = `${indexUrl}#it`

  return `prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>
prefix schema: <https://schema.org/>
INSERT DATA {
  <${taskIt}> rdfs:label "${task.name}" .
  <${taskIt}> rdfs:comment "Focus task" .
  <${indexIt}> schema:itemListElement <${taskIt}> .
}
`
}