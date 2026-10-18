import { Parser, Store } from 'n3'
import type { SolidFetch } from '../types/index.js'

const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

const LDP_CONTAINER_TYPES = new Set([
  'http://www.w3.org/ns/ldp#Container',
  'http://www.w3.org/ns/ldp#BasicContainer',
  'http://www.w3.org/ns/ldp#DirectContainer',
  'http://www.w3.org/ns/ldp#IndirectContainer',
])

export function parseContainer(
  containerUrl: string,
  turtle: string
): { containers: string[]; resources: string[] } {
  const parser = new Parser({ baseIRI: containerUrl })
  const store = new Store()

  const quads = parser.parse(turtle)
  if (quads) {
    store.addQuads(quads)
  }

  const containsQuads = store.getQuads(containerUrl, LDP_CONTAINS, null, null)

  const containers: string[] = []
  const resources: string[] = []

  for (const quad of containsQuads) {
    const childUrl = quad.object.value
    const typeQuads = store.getQuads(childUrl, RDF_TYPE, null, null)
    const types = typeQuads.map(t => t.object.value)

    if (childUrl.endsWith('/') || types.some(t => LDP_CONTAINER_TYPES.has(t))) {
      containers.push(childUrl)
    } else {
      resources.push(childUrl)
    }
  }

  return { containers, resources }
}

function isSkipped(url: string): boolean {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }

  return pathname.split('/').some(segment => {
    if (segment === 'node_modules') return true
    return segment.length > 1 && segment !== '..' && segment.startsWith('.')
  })
}

export async function discoverWikiContainers(
  rootUrl: string,
  maxDepth: number,
  fetch: SolidFetch
): Promise<{ containers: string[]; markdownFiles: string[] }> {
  const containers: string[] = [rootUrl]
  const markdownFiles: string[] = []
  const seen = new Set<string>([rootUrl])

  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl, depth: 0 }]

  while (queue.length > 0) {
    const { url, depth } = queue.shift()!

    let turtle: string
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'text/turtle' },
      })

      if (!response.ok) {
        console.error(`[wikiContainers] Failed to fetch container ${url}: ${response.status}`)
        continue
      }

      turtle = await response.text()
    } catch (error) {
      console.error(`[wikiContainers] Failed to fetch container ${url}: ${error}`)
      continue
    }

    let parsed: { containers: string[]; resources: string[] }
    try {
      parsed = parseContainer(url, turtle)
    } catch (error) {
      console.error(`[wikiContainers] Failed to parse container ${url}: ${error}`)
      continue
    }

    for (const resource of parsed.resources) {
      if (isSkipped(resource) || !resource.startsWith(rootUrl)) continue
      if (resource.endsWith('.md') && !markdownFiles.includes(resource)) {
        markdownFiles.push(resource)
      }
    }

    if (depth + 1 > maxDepth) continue

    for (const child of parsed.containers) {
      if (isSkipped(child) || !child.startsWith(rootUrl)) continue
      if (seen.has(child)) continue
      seen.add(child)
      containers.push(child)
      queue.push({ url: child, depth: depth + 1 })
    }
  }

  return { containers, markdownFiles }
}
