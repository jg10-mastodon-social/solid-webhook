import { getAuthenticatedFetch } from '@soid/koa'
import type { SolidFetch } from '../types/index.js'

export async function createSolidFetch(
  webId: string,
  issuer: string
): Promise<SolidFetch> {
  if (!webId) {
    throw new Error('webId is required')
  }
  if (!issuer) {
    throw new Error('issuer is required')
  }

  const webIdUrl = new URL(webId)
  const issuerUrl = new URL(issuer)

  if (webIdUrl.origin !== issuerUrl.origin) {
    throw new Error('Issuer origin must match webId origin')
  }

  const loggedFetch: SolidFetch = async (url, init) => {
    const fetchFn = await getAuthenticatedFetch(webId, issuer)
    return await fetchFn(url, init)
  }

  return loggedFetch
}

export function createSolidFetchSync(
  webId: string,
  issuer: string
): () => Promise<SolidFetch> {
  return () => createSolidFetch(webId, issuer)
}
