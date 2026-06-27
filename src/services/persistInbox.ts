import jsonld from 'jsonld'
import type { SolidFetch } from '../types/index.js'
import { skolemizeBlankNodes } from './activityToRdf.js'
import { buildInsertDeletePatch } from './buildPatch.js'

export async function persistInboxItem(
  activity: Record<string, unknown>,
  pageUrl: string,
  fetch: SolidFetch,
  options: { skolemizeBase: string }
): Promise<void> {
  const { skolemizeBase } = options

  const activityWithContext = {
    ...activity,
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
  }

  const expanded = await jsonld.expand(activityWithContext)

  const nquads = await jsonld.toRDF(expanded, { format: 'application/n-quads' }) as string

  const turtle = skolemizeBlankNodes(nquads, skolemizeBase)

  const itemId = typeof activity.id === 'string' ? activity.id : `${skolemizeBase}${Date.now()}`

  const patchBody = buildInsertDeletePatch(turtle, itemId, pageUrl)

  const response = await fetch(pageUrl, {
    method: 'PATCH',
    headers: {
      'content-type': 'text/n3',
    },
    body: patchBody,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to persist inbox item: ${response.status} ${text}`)
  }
}