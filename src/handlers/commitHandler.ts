import type { WebhookEvent, SolidFetch } from '../types/index.js'

export async function handleCommitHandler(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: { gitDir?: string }
): Promise<boolean> {
  if (event.type === 'Remove') {
    return true
  }

  if (!context?.gitDir) {
    console.error('No gitDir provided')
    return false
  }

  const commitMsgUrl = event.topic
  console.log(`Fetching commit message from: ${commitMsgUrl}`)

  const response = await fetch(commitMsgUrl)
  if (!response.ok) {
    console.error(`Failed to fetch commit message: ${response.status}`)
    return false
  }

  return true
}