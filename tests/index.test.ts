import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SolidFetch, TrackedSubscription, WebhookRegistration } from '../src/types/index.js'

const mockFetch = vi.fn()

vi.mock('@soid/koa', () => ({
  getAuthenticatedFetch: vi.fn().mockResolvedValue(mockFetch),
}))

const mockSocketList = `
@prefix notifications: <http://www.w3.org/ns/solid/notifications#> .

<https://pod.example.com/.well-known/solid-storage> notifications:channelType notifications:WebhookChannel2023 .
`

let nextSubId = 1
function nextSubscriptionResponse() {
  const id = `https://pod.example.com/webhook/sub-${nextSubId++}`
  return JSON.stringify({
    '@context': 'https://www.w3.org/ns/solid/notification/v1',
    type: 'http://www.w3.org/ns/solid/notifications#WebhookChannel2023',
    id,
    receiveFrom: `https://pod.example.com/webhook/receive/${id.split('/').pop()}`,
  })
}

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
      return new Response(nextSubscriptionResponse(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 })
    }

    throw new Error(`Unexpected URL: ${urlStr}`)
  })
}

describe('subscribeAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextSubId = 1
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

describe('renewSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextSubId = 1
  })

  const buildReg = (topic: string): WebhookRegistration => ({
    handler: 'InboxModified',
    topic,
    callback: async () => {},
  })

  function setupSubscribeAndDelete() {
    const deleteCalls: string[] = []
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
        return new Response(nextSubscriptionResponse(), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (init?.method === 'DELETE') {
        deleteCalls.push(urlStr)
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected URL: ${urlStr}`)
    })
    return deleteCalls
  }

  it('should create a new subscription, delete the old one, and update tracking', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewSubscription } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    const originalId = subs[0].id
    const originalEndAt = subs[0].endAt

    vi.clearAllMocks()
    const deleteCalls = setupSubscribeAndDelete()

    const result = await renewSubscription(
      subs,
      originalId,
      'https://pod.example.com/webhook/',
      mockFetch as unknown as SolidFetch
    )

    expect(result).toBeDefined()
    expect(result!.id).not.toBe(originalId)
    expect(result!.topic).toBe('https://pod.example.com/inbox/')
    expect(result!.status).toBe('active')
    expect(result!.endAt).toBeInstanceOf(Date)
    expect((result!.endAt as Date).getTime()).toBeGreaterThan(originalEndAt!.getTime())

    expect(deleteCalls).toEqual([originalId])

    const updated = subs.find((s) => s.id === result!.id)
    expect(updated).toBeDefined()
    expect(subs.find((s) => s.id === originalId)).toBeUndefined()
  })

  it('should throw if subscription id is not found', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewSubscription } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    await expect(
      renewSubscription(
        subs,
        'https://pod.example.com/webhook/does-not-exist',
        'https://pod.example.com/webhook/',
        mockFetch as unknown as SolidFetch
      )
    ).rejects.toThrow('Subscription not found')
  })

  it('should mark subscription as failed if new subscribe fails', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewSubscription } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    const originalId = subs[0].id

    vi.clearAllMocks()
    mockFetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString()

      if (init?.method === 'HEAD') {
        return new Response(null, { status: 500 })
      }

      throw new Error(`Unexpected URL: ${urlStr}`)
    })

    await expect(
      renewSubscription(
        subs,
        originalId,
        'https://pod.example.com/webhook/',
        mockFetch as unknown as SolidFetch
      )
    ).rejects.toThrow()

    const failed = subs.find((s) => s.id === originalId)
    expect(failed).toBeDefined()
    expect(failed!.status).toBe('failed')
    expect(failed!.error).toBeTruthy()
  })
})

describe('renewAllSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nextSubId = 1
  })

  const buildReg = (topic: string): WebhookRegistration => ({
    handler: 'InboxModified',
    topic,
    callback: async () => {},
  })

  it('should renew subscriptions expiring within 1 day', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewAllSubscriptions } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    const originalId = subs[0].id
    subs[0].endAt = new Date(Date.now() + 60 * 60 * 1000)

    vi.clearAllMocks()
    setupSubscribeAndDeleteGlobal()

    const renewed = await renewAllSubscriptions(
      subs,
      'https://pod.example.com/webhook/',
      mockFetch as unknown as SolidFetch
    )

    expect(renewed).toContain(subs[0].id)
    expect(subs[0].id).not.toBe(originalId)
  })

  it('should skip subscriptions with more than 1 day until expiry', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewAllSubscriptions } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    subs[0].endAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    vi.clearAllMocks()
    setupSubscribeAndDeleteGlobal()

    const renewed = await renewAllSubscriptions(
      subs,
      'https://pod.example.com/webhook/',
      mockFetch as unknown as SolidFetch
    )

    expect(renewed).toEqual([])
  })

  it('should skip failed subscriptions', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewAllSubscriptions } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    subs[0].status = 'failed'
    subs[0].error = 'previous failure'
    subs[0].endAt = new Date(Date.now() + 60 * 60 * 1000)

    vi.clearAllMocks()
    setupSubscribeAndDeleteGlobal()

    const renewed = await renewAllSubscriptions(
      subs,
      'https://pod.example.com/webhook/',
      mockFetch as unknown as SolidFetch
    )

    expect(renewed).toEqual([])
  })

  it('should skip subscriptions without endAt', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewAllSubscriptions } = await import('../src/index.js')

    const subs = await subscribeAll(
      [buildReg('https://pod.example.com/inbox/')],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    subs[0].endAt = undefined

    vi.clearAllMocks()
    setupSubscribeAndDeleteGlobal()

    const renewed = await renewAllSubscriptions(
      subs,
      'https://pod.example.com/webhook/',
      mockFetch as unknown as SolidFetch
    )

    expect(renewed).toEqual([])
  })

  it('should continue renewing other subscriptions when one fails', async () => {
    setupSuccessfulSubscribeMock()

    const { subscribeAll, renewAllSubscriptions } = await import('../src/index.js')

    const subs = await subscribeAll(
      [
        buildReg('https://pod.example.com/inbox/1/'),
        buildReg('https://pod.example.com/inbox/2/'),
      ],
      mockFetch as unknown as SolidFetch,
      'https://pod.example.com/webhook/'
    )

    subs[0].endAt = new Date(Date.now() + 60 * 60 * 1000)
    subs[1].endAt = new Date(Date.now() + 60 * 60 * 1000)

    const failingId = subs[0].id
    const survivingId = subs[1].id

    vi.clearAllMocks()
    let callCount = 0
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
        callCount += 1
        if (callCount === 1) {
          return new Response(null, { status: 500 })
        }
        return new Response(nextSubscriptionResponse(), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }

      throw new Error(`Unexpected URL: ${urlStr}`)
    })

    const renewed = await renewAllSubscriptions(
      subs,
      'https://pod.example.com/webhook/',
      mockFetch as unknown as SolidFetch
    )

    expect(renewed).toContain(subs.find((s) => s.topic === 'https://pod.example.com/inbox/2/')!.id)
    expect(renewed).not.toContain(failingId)
    expect(subs.find((s) => s.id === survivingId)).toBeUndefined()
    expect(subs.find((s) => s.id === failingId)).toBeDefined()
    expect(subs.find((s) => s.id === failingId)!.status).toBe('failed')
  })
})

function setupSubscribeAndDeleteGlobal() {
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
      return new Response(nextSubscriptionResponse(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 })
    }

    throw new Error(`Unexpected URL: ${urlStr}`)
  })
}
