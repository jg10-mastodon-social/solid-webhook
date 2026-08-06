import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SolidFetch, TrackedSubscription, WebhookRegistration } from '../src/types/index.js'

const mockFetch = vi.fn()

vi.mock('@soid/koa', () => ({
  getAuthenticatedFetch: vi.fn().mockResolvedValue(mockFetch),
}))

const mockStorageDescription = `
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix notifications: <http://www.w3.org/ns/solid/notifications#> .

<https://pod.example.com/> solid:storageDescription <https://pod.example.com/.well-known/solid-storage> .
`

const mockSocketList = `
@prefix notifications: <http://www.w3.org/ns/solid/notifications#> .

<https://pod.example.com/.well-known/solid-storage> notifications:channelType notifications:WebhookChannel2023 .
`

const mockSubscriptionResponse = JSON.stringify({
  '@context': 'https://www.w3.org/ns/solid/notification/v1',
  type: 'http://www.w3.org/ns/solid/notifications#WebhookChannel2023',
  id: 'https://pod.example.com/webhook/sub-id',
  receiveFrom: 'https://pod.example.com/webhook/receive/sub-id',
})

function setupSuccessfulSubscribeMock() {
  mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString()

    if (init?.method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: {
          'link': '<https://pod.example.com/.well-known/solid-storage>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
        },
      })
    }

    if (urlStr.includes('solid-storage') && init?.method === undefined) {
      return new Response(mockSocketList, {
        status: 200,
        headers: { 'content-type': 'text/turtle' },
      })
    }

    if (urlStr.includes('solid-storage') && init?.method === 'POST') {
      return new Response(mockSubscriptionResponse, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    throw new Error(`Unexpected URL: ${urlStr}`)
  })
}

describe('subscribeAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const buildReg = (topic: string): WebhookRegistration => ({
    handler: 'InboxModified',
    topic,
    callback: async () => {},
  })

  it('should record createdAt and endAt on each tracked subscription', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll } = await import('../src/index.js')

    const before = Date.now()
    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )
    const after = Date.now()

    expect(subs).toHaveLength(1)
    expect(subs[0].status).toBe('active')
    expect(subs[0].createdAt).toBeInstanceOf(Date)
    expect(subs[0].endAt).toBeInstanceOf(Date)

    const createdMs = (subs[0].createdAt as Date).getTime()
    expect(createdMs).toBeGreaterThanOrEqual(before)
    expect(createdMs).toBeLessThanOrEqual(after)

    const expectedEndMs = createdMs + 7 * 24 * 60 * 60 * 1000
    expect((subs[0].endAt as Date).getTime()).toBe(expectedEndMs)
  })

  it('should use SUBSCRIPTION_DURATION_MINUTES env var to compute endAt', async () => {
    setupSuccessfulSubscribeMock()
    process.env.SUBSCRIPTION_DURATION_MINUTES = '60'

    const { subscribeAll } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    expect(subs).toHaveLength(1)
    const createdMs = (subs[0].createdAt as Date).getTime()
    const expectedEndMs = createdMs + 60 * 60 * 1000
    expect((subs[0].endAt as Date).getTime()).toBe(expectedEndMs)

    delete process.env.SUBSCRIPTION_DURATION_MINUTES
  })
})
