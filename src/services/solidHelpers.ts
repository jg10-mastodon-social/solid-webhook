import type { SolidFetch } from '../types/index.js'

export async function discoverMetaResourceUrl(
  containerUrl: string,
  fetch: SolidFetch
): Promise<string> {
  const response = await fetch(containerUrl, {
    method: 'HEAD',
  })

  if (!response.ok) {
    throw new Error(`Failed to discover meta resource for ${containerUrl}: ${response.status}`)
  }

  const linkHeader = response.headers.get('link') || ''
  const match = linkHeader.match(/<([^>]+)>;\s*rel="describedby"/)
  if (match) {
    return match[1]
  }

  return `${containerUrl}.meta`
}