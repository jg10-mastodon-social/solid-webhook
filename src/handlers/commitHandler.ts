import type { WebhookEvent, SolidFetch } from '../types/index.js'

export async function handleCommitHandler(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: { gitDir?: string }
): Promise<boolean> {
  console.log('CommitHandler called with event:', event)
  console.log('gitDir from context:', context?.gitDir)
  return true
}