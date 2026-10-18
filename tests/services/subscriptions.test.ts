import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SolidFetch, SubscriptionInfo } from '../../src/types/index.js'

const { subscribeWebhookChannelMock } = vi.hoisted(() => ({
  subscribeWebhookChannelMock: vi.fn(),
}))

vi.mock('../../src/services/webhookChannel.js', () => ({
  subscribeWebhookChannel: subscribeWebhookChannelMock,
}))

const mockFetch = vi.fn() as unknown as SolidFetch

const baseSubscription: SubscriptionInfo = {
  id: 'https://pod.example.com/webhook/sub-1',
  receiveFrom: 'https://pod.example.com/webhook/receive/sub-1',
  topic: 'https://pod.example.com/inbox/',
}

describe('subscribeTracked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subscribeWebhookChannelMock.mockResolvedValue(baseSubscription)
  })

  afterEach(() => {
    delete process.env.SUBSCRIPTION_DURATION_MINUTES
  })

  it('returns an active subscription with createdAt and endAt defaulting to 7 days', async () => {
    const { subscribeTracked } = await import('../../src/services/subscriptions.js')

    const before = Date.now()
    const result = await subscribeTracked(
      'https://pod.example.com/inbox/',
      'https://pod.example.com/webhook/',
      mockFetch
    )
    const after = Date.now()

    expect(result.status).toBe('active')
    expect(result.id).toBe(baseSubscription.id)
    expect(result.receiveFrom).toBe(baseSubscription.receiveFrom)
    expect(result.topic).toBe(baseSubscription.topic)
    expect(result.createdAt).toBeInstanceOf(Date)
    expect(result.endAt).toBeInstanceOf(Date)

    const createdMs = (result.createdAt as Date).getTime()
    expect(createdMs).toBeGreaterThanOrEqual(before)
    expect(createdMs).toBeLessThanOrEqual(after)

    const expectedEndMs = createdMs + 7 * 24 * 60 * 60 * 1000
    expect((result.endAt as Date).getTime()).toBe(expectedEndMs)
  })

  it('uses SUBSCRIPTION_DURATION_MINUTES when set', async () => {
    process.env.SUBSCRIPTION_DURATION_MINUTES = '60'

    const { subscribeTracked } = await import('../../src/services/subscriptions.js')

    const result = await subscribeTracked(
      'https://pod.example.com/inbox/',
      'https://pod.example.com/webhook/',
      mockFetch
    )

    const createdMs = (result.createdAt as Date).getTime()
    const expectedEndMs = createdMs + 60 * 60 * 1000
    expect((result.endAt as Date).getTime()).toBe(expectedEndMs)
  })

  it('passes the computed endAt to subscribeWebhookChannel', async () => {
    const { subscribeTracked } = await import('../../src/services/subscriptions.js')

    const result = await subscribeTracked(
      'https://pod.example.com/inbox/',
      'https://pod.example.com/webhook/',
      mockFetch
    )

    expect(subscribeWebhookChannelMock).toHaveBeenCalledTimes(1)
    const [topic, sendTo, fetchArg, endAt] = subscribeWebhookChannelMock.mock.calls[0]
    expect(topic).toBe('https://pod.example.com/inbox/')
    expect(sendTo).toBe('https://pod.example.com/webhook/')
    expect(fetchArg).toBe(mockFetch)
    expect(endAt).toBeInstanceOf(Date)
    expect(endAt).toBe(result.endAt)
  })
})
