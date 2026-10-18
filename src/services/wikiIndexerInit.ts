import { discoverWikiContainers } from './wikiContainers.js'
import { subscribeTracked } from './subscriptions.js'
import { applyIndexInsert } from '../handlers/wikiIndexer.js'
import type { HandlerContext, SolidFetch, TrackedSubscription } from '../types/index.js'

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export async function initializeWikiIndexers(
  context: HandlerContext,
  fetch: SolidFetch
): Promise<void> {
  const registrations = context.registrations ?? []
  const subscriptions = context.subscriptions ?? (context.subscriptions = [])

  for (const registration of registrations) {
    if (registration.handler !== 'WikiIndexer') continue

    try {
      const maxDepth = registration.maxDepth ?? 1
      const { containers, markdownFiles } = await discoverWikiContainers(
        registration.topic,
        maxDepth,
        fetch
      )

      const files = dedupe(markdownFiles)
      let subscribed = 0

      if (!context.sendToUrl) {
        console.error(
          `[wikiIndexerInit] Error: Missing sendToUrl, cannot subscribe for ${registration.topic}`
        )
      } else {
        const sendToUrl = context.sendToUrl
        const activeTopics = new Set(
          subscriptions
            .filter((sub: TrackedSubscription) => sub.status === 'active')
            .map((sub) => sub.topic)
        )

        for (const container of dedupe(containers)) {
          if (activeTopics.has(container)) continue

          try {
            const tracked = await subscribeTracked(container, sendToUrl, fetch)
            subscriptions.push(tracked)
            activeTopics.add(container)
            subscribed++
          } catch (error) {
            console.error(`[wikiIndexerInit] Error: Failed to subscribe to ${container}: ${error}`)
          }
        }
      }

      await applyIndexInsert(registration.indexUrl, files, fetch)

      console.log(
        `[wikiIndexerInit] ${registration.topic}: subscribed ${subscribed} container(s), indexed ${files.length} file(s)`
      )
    } catch (error) {
      console.error(`[wikiIndexerInit] Error: Failed to initialize ${registration.topic}: ${error}`)
    }
  }
}
