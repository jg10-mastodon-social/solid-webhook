import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  WikiIndexerWebhook,
  InboxModifiedWebhook,
  TrackedSubscription,
} from '../../src/types/index.js'
import { discoverWikiContainers } from '../../src/services/wikiContainers.js'
import { subscribeTracked } from '../../src/services/subscriptions.js'
import { applyIndexInsert } from '../../src/handlers/wikiIndexer.js'

vi.mock('../../src/services/wikiContainers.js', () => ({
  discoverWikiContainers: vi.fn(),
}))
vi.mock('../../src/services/subscriptions.js', () => ({
  subscribeTracked: vi.fn(),
}))
vi.mock('../../src/handlers/wikiIndexer.js', () => ({
  applyIndexInsert: vi.fn(),
}))

const ROOT = 'https://pod.example.com/wiki/'
const CHILD = `${ROOT}notes/`
const GRANDCHILD = `${ROOT}notes/deep/`
const INDEX = 'https://pod.example.com/wiki/index.ttl'
const SEND_TO = 'https://app.example.com/webhook'

function wikiRegistration(overrides: Partial<WikiIndexerWebhook> = {}): WikiIndexerWebhook {
  return {
    handler: 'WikiIndexer',
    topic: ROOT,
    indexUrl: INDEX,
    maxDepth: 1,
    callback: vi.fn(),
    ...overrides,
  }
}

function tracked(id: string, topic: string): TrackedSubscription {
  return { id, receiveFrom: `${topic}receive`, topic, status: 'active' }
}

const mockFetch = vi.fn()

describe('initializeWikiIndexers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('discovers at maxDepth, subscribes non-active containers into the same array, and backfills files', async () => {
    const { initializeWikiIndexers } = await import('../../src/services/wikiIndexerInit.js')

    vi.mocked(discoverWikiContainers).mockResolvedValueOnce({
      containers: [ROOT, CHILD],
      markdownFiles: [`${CHILD}page.md`],
    })
    vi.mocked(subscribeTracked).mockResolvedValueOnce(tracked('sub-child', CHILD))
    vi.mocked(applyIndexInsert).mockResolvedValueOnce(true)

    const subscriptions: TrackedSubscription[] = [tracked('sub-root', ROOT)]
    const context = {
      registrations: [wikiRegistration({ topic: ROOT, indexUrl: INDEX, maxDepth: 2 })],
      subscriptions,
      sendToUrl: SEND_TO,
    }
    const subscriptionsRef = context.subscriptions

    await initializeWikiIndexers(context as any, mockFetch)

    expect(discoverWikiContainers).toHaveBeenCalledWith(ROOT, 2, mockFetch)
    expect(subscribeTracked).toHaveBeenCalledTimes(1)
    expect(subscribeTracked).toHaveBeenCalledWith(CHILD, SEND_TO, mockFetch)
    expect(context.subscriptions).toBe(subscriptionsRef)
    expect(context.subscriptions.map(sub => sub.topic)).toEqual([ROOT, CHILD])
    expect(applyIndexInsert).toHaveBeenCalledWith(INDEX, [`${CHILD}page.md`], mockFetch)
  })

  it('does not subscribe already-active container topics', async () => {
    const { initializeWikiIndexers } = await import('../../src/services/wikiIndexerInit.js')

    vi.mocked(discoverWikiContainers).mockResolvedValueOnce({
      containers: [ROOT, CHILD, GRANDCHILD],
      markdownFiles: [],
    })
    vi.mocked(subscribeTracked).mockResolvedValueOnce(tracked('sub-deep', GRANDCHILD))
    vi.mocked(applyIndexInsert).mockResolvedValueOnce(true)

    const context = {
      registrations: [wikiRegistration()],
      subscriptions: [tracked('sub-root', ROOT), tracked('sub-child', CHILD)],
      sendToUrl: SEND_TO,
    }

    await initializeWikiIndexers(context as any, mockFetch)

    expect(subscribeTracked).toHaveBeenCalledTimes(1)
    expect(subscribeTracked).toHaveBeenCalledWith(GRANDCHILD, SEND_TO, mockFetch)
    expect(context.subscriptions).toHaveLength(3)
  })

  it('ignores non-WikiIndexer registrations', async () => {
    const { initializeWikiIndexers } = await import('../../src/services/wikiIndexerInit.js')

    const inboxRegistration: InboxModifiedWebhook = {
      handler: 'InboxModified',
      topic: ROOT,
      callback: vi.fn(),
    }
    const context = {
      registrations: [inboxRegistration],
      subscriptions: [] as TrackedSubscription[],
      sendToUrl: SEND_TO,
    }

    await initializeWikiIndexers(context as any, mockFetch)

    expect(discoverWikiContainers).not.toHaveBeenCalled()
    expect(subscribeTracked).not.toHaveBeenCalled()
    expect(applyIndexInsert).not.toHaveBeenCalled()
  })

  it('continues to the next registration when one fails discovery or subscribe', async () => {
    const { initializeWikiIndexers } = await import('../../src/services/wikiIndexerInit.js')

    const goodTopic = 'https://pod.example.com/other/'
    const goodIndex = 'https://pod.example.com/other/index.ttl'
    const goodFile = `${goodTopic}file.md`

    vi.mocked(discoverWikiContainers)
      .mockRejectedValueOnce(new Error('discovery boom'))
      .mockResolvedValueOnce({ containers: [goodTopic], markdownFiles: [goodFile] })
    vi.mocked(subscribeTracked).mockRejectedValueOnce(new Error('subscribe boom'))
    vi.mocked(applyIndexInsert).mockResolvedValueOnce(true)

    const context = {
      registrations: [
        wikiRegistration({ topic: 'https://pod.example.com/broken/' }),
        wikiRegistration({ topic: goodTopic, indexUrl: goodIndex }),
      ],
      subscriptions: [] as TrackedSubscription[],
      sendToUrl: SEND_TO,
    }

    await initializeWikiIndexers(context as any, mockFetch)

    expect(discoverWikiContainers).toHaveBeenCalledTimes(2)
    expect(applyIndexInsert).toHaveBeenCalledWith(goodIndex, [goodFile], mockFetch)
  })

  it('backfills files but skips subscriptions when sendToUrl is missing', async () => {
    const { initializeWikiIndexers } = await import('../../src/services/wikiIndexerInit.js')

    const file = `${CHILD}page.md`
    vi.mocked(discoverWikiContainers).mockResolvedValueOnce({
      containers: [ROOT, CHILD],
      markdownFiles: [file],
    })
    vi.mocked(applyIndexInsert).mockResolvedValueOnce(true)

    const context = {
      registrations: [wikiRegistration()],
      subscriptions: [] as TrackedSubscription[],
    }

    await initializeWikiIndexers(context as any, mockFetch)

    expect(discoverWikiContainers).toHaveBeenCalledWith(ROOT, 1, mockFetch)
    expect(subscribeTracked).not.toHaveBeenCalled()
    expect(context.subscriptions).toHaveLength(0)
    expect(applyIndexInsert).toHaveBeenCalledWith(INDEX, [file], mockFetch)
  })
})
