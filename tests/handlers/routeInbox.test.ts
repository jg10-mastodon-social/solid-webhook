import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HandlerContext, SolidFetch, WebhookEvent } from '../../src/types/index.js'

const { mockExecFile, mockLookup } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockLookup: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}))

vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}))

const INBOX = 'https://pod.example.com/private/wiki-router/inbox/'
const OUTBOX = 'https://pod.example.com/private/wiki-router/outbox/'
const REQUEST_ID = 'req-a1b2c3d4'
const ITEM = `${INBOX}${REQUEST_ID}.json`
const RESULT = `${OUTBOX}${REQUEST_ID}.json`
const ROUTER = '/opt/url-to-wiki/bin/wiki_route.py'

const VALID_REQUEST = {
  requestId: REQUEST_ID,
  url: 'https://example.com/article',
  requestedAt: '2026-11-07T00:00:00.000Z',
}

const ROUTER_OUTPUT = {
  contract: 1,
  index: { version: 5, pages: 534, generated: '2026-11-04T20:55:38+00:00' },
  url: VALID_REQUEST.url,
  final_url: 'https://example.com/article?utm_source=feed',
  fetched: {
    ok: true,
    title: 'An Article',
    description: 'A description',
    source: '',
    creator: '',
    date: '',
    isbn: '',
    canonical: '',
    title_noisy: false,
    error: '',
  },
  reliability: 'high',
  candidates: [
    {
      id: 'regionaldatabureau/topics/solar.md',
      wiki: 'regionaldatabureau',
      label: 'Solar',
      subject: 'https://pod.example.com/pod/notes/regionaldatabureau/topics/solar.md',
      local: '/srv/notes/regionaldatabureau/topics/solar.md',
      score: 1.0873,
      cosine: 0.7,
      boosts: { label_most: 0.15 },
      matched: ['solar power', 'canal solar'],
      already_linked: true,
      heading_match: false,
      suggested_section: null,
      headings: ['Unsorted'],
      summary: 'infrastructure energy usage energy sources Powertracer',
      enriched: false,
    },
  ],
}

const context = {
  registrations: [
    {
      handler: 'RouteInbox' as const,
      topic: INBOX,
      callback: vi.fn(),
    },
  ],
} as unknown as HandlerContext

const event = (overrides: Partial<WebhookEvent> = {}): WebhookEvent => ({
  type: 'Add',
  object: ITEM,
  topic: INBOX,
  raw: {},
  ...overrides,
})

interface FakeResponse {
  ok: boolean
  status: number
  headers: { get: (name: string) => string | null }
  text: () => Promise<string>
}

function response(body: string, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    text: async () => body,
  }
}

interface FetchCall {
  url: string
  method: string
  body?: string
}

/**
 * Fake pod: serves the inbox item and the outbox probe, records every call so
 * tests can assert the handler never writes outside the two containers.
 */
function createPod(options: {
  item?: string
  itemStatus?: number
  existingResult?: string
  existingResultStatus?: number
} = {}): { fetch: SolidFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url: target, method, body: init?.body as string | undefined })

    if (target === ITEM && method === 'GET') {
      return response(options.item ?? JSON.stringify(VALID_REQUEST), options.itemStatus ?? 200)
    }
    if (target === RESULT && method === 'GET') {
      if (options.existingResult) {
        return response(options.existingResult, options.existingResultStatus ?? 200)
      }
      return response('', 404)
    }
    if (target === RESULT && method === 'PUT') {
      return response('', 201)
    }
    if (target === ITEM && method === 'PUT') {
      return response('', 205)
    }
    return response('unexpected', 404)
  })

  return { fetch: fetchImpl as unknown as SolidFetch, calls }
}

function written(calls: FetchCall[], url: string): Record<string, unknown> {
  const put = calls.filter((c) => c.method === 'PUT' && c.url === url)
  expect(put).toHaveLength(1)
  return JSON.parse(put[0].body ?? '{}')
}

function succeedWith(payload: unknown = ROUTER_OUTPUT) {
  mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
    callback(null, JSON.stringify(payload), '')
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  process.env.WIKI_ROUTER_BIN = ROUTER
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  succeedWith()
  const { resetRouteInboxState } = await import('../../src/handlers/routeInbox.js')
  resetRouteInboxState()
})

describe('RouteInbox', () => {
  it('ignores Remove events', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()

    const result = await handleRouteInbox(event({ type: 'Remove' }), fetch, context)

    expect(result).toBe(false)
    expect(calls).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('routes the url and writes a terminal result to the outbox', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()

    const result = await handleRouteInbox(event(), fetch, context)

    expect(result).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [bin, args] = mockExecFile.mock.calls[0]
    expect(bin).toBe(ROUTER)
    expect(args).toEqual(['route', VALID_REQUEST.url, '--json'])

    const outbox = written(calls, RESULT)
    expect(outbox).toMatchObject({
      requestId: REQUEST_ID,
      url: VALID_REQUEST.url,
      status: 'done',
      contract: 1,
    })
    expect(outbox.candidates).toEqual(ROUTER_OUTPUT.candidates)
    expect(outbox.index).toEqual(ROUTER_OUTPUT.index)
    expect(String(outbox.routedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('passes the router payload through unchanged', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()

    await handleRouteInbox(event(), fetch, context)

    const outbox = written(calls, RESULT)
    for (const [key, value] of Object.entries(ROUTER_OUTPUT)) {
      expect(outbox[key]).toEqual(value)
    }
    expect(outbox.reliability).toBe('high')
    expect((outbox.fetched as Record<string, unknown>).title_noisy).toBe(false)
    expect((outbox.candidates as Record<string, unknown>[])[0].already_linked).toBe(true)
  })

  it('marks the inbox item done', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()

    await handleRouteInbox(event(), fetch, context)

    const item = written(calls, ITEM)
    expect(item).toMatchObject({ requestId: REQUEST_ID, status: 'done' })
  })

  it('never writes outside the inbox and outbox containers', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()

    await handleRouteInbox(event(), fetch, context)

    const writtenUrls = calls.filter((c) => c.method !== 'GET').map((c) => c.url)
    expect(writtenUrls.length).toBeGreaterThan(0)
    for (const url of writtenUrls) {
      expect(url.startsWith(INBOX) || url.startsWith(OUTBOX)).toBe(true)
    }
  })

  it('skips a duplicate request that already has a terminal result', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod({
      existingResult: JSON.stringify({ requestId: REQUEST_ID, status: 'done' }),
    })

    const result = await handleRouteInbox(event(), fetch, context)

    expect(result).toBe(false)
    expect(mockExecFile).not.toHaveBeenCalled()
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('rejects a second request while one route is in flight', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const release: { fn: () => void } = { fn: () => {} }
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      release.fn = () => callback(null, JSON.stringify(ROUTER_OUTPUT), '')
    })

    const first = createPod()
    const second = createPod()
    const inFlight = handleRouteInbox(event(), first.fetch, context)
    const busy = await handleRouteInbox(event(), second.fetch, context)

    expect(busy).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const outbox = written(second.calls, RESULT)
    expect(outbox).toMatchObject({ status: 'error', reason: 'router_busy' })

    release.fn()
    await inFlight
  })

  it('refuses non-JSON payloads', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod({ item: 'not json at all' })

    const result = await handleRouteInbox(event(), fetch, context)

    expect(result).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()
    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'invalid_request',
    })
  })

  it('refuses payloads that exceed the size cap', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const padded = JSON.stringify({ ...VALID_REQUEST, padding: 'x'.repeat(9000) })
    const { fetch, calls } = createPod({ item: padded })

    await handleRouteInbox(event(), fetch, context)

    expect(mockExecFile).not.toHaveBeenCalled()
    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'invalid_request',
    })
  })

  it('refuses unknown request fields', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod({
      item: JSON.stringify({ ...VALID_REQUEST, command: 'rm -rf /' }),
    })

    await handleRouteInbox(event(), fetch, context)

    expect(mockExecFile).not.toHaveBeenCalled()
    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'invalid_request',
    })
  })

  it.each([
    ['file:///etc/passwd'],
    ['ftp://example.com/x'],
    ['not a url'],
  ])('refuses a disallowed scheme or malformed url: %s', async (url) => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod({ item: JSON.stringify({ ...VALID_REQUEST, url }) })

    await handleRouteInbox(event(), fetch, context)

    expect(mockExecFile).not.toHaveBeenCalled()
    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'url_rejected',
    })
  })

  it.each([
    ['http://127.0.0.1/'],
    ['http://localhost/'],
    ['http://10.1.2.3/'],
    ['http://192.168.1.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[::1]/'],
    ['http://0.0.0.0/'],
    ['http://172.16.0.5/'],
  ])('refuses a private or loopback target: %s', async (url) => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod({ item: JSON.stringify({ ...VALID_REQUEST, url }) })

    await handleRouteInbox(event(), fetch, context)

    expect(mockExecFile).not.toHaveBeenCalled()
    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'url_rejected',
    })
  })

  it('refuses a public hostname that resolves to a private address', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()
    mockLookup.mockResolvedValue([{ address: '10.0.0.9', family: 4 }])

    await handleRouteInbox(event(), fetch, context)

    expect(mockExecFile).not.toHaveBeenCalled()
    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'url_rejected',
    })
  })

  it('records router failures without losing the request', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      callback(Object.assign(new Error('boom'), { code: 1 }), '', 'boom')
    })

    await handleRouteInbox(event(), fetch, context)

    expect(written(calls, RESULT)).toMatchObject({
      requestId: REQUEST_ID,
      status: 'error',
      reason: 'router_failed',
    })
  })

  it('records a router timeout', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      callback(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), '', '')
    })

    await handleRouteInbox(event(), fetch, context)

    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'router_timeout',
    })
  })

  it('refuses a router that speaks a different contract version', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()
    succeedWith({ ...ROUTER_OUTPUT, contract: 99 })

    await handleRouteInbox(event(), fetch, context)

    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'router_contract_mismatch',
      contract: 99,
    })
  })

  it('reports a clear error when the router is not configured', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()
    delete process.env.WIKI_ROUTER_BIN

    await handleRouteInbox(event(), fetch, context)

    expect(mockExecFile).not.toHaveBeenCalled()
    expect(written(calls, RESULT)).toMatchObject({
      status: 'error',
      reason: 'router_not_configured',
    })
  })

  it('refuses a registration whose topic is not an inbox container', async () => {
    const { handleRouteInbox } = await import('../../src/handlers/routeInbox.js')
    const { fetch, calls } = createPod()
    const badContext = {
      registrations: [
        { handler: 'RouteInbox' as const, topic: 'https://pod.example.com/elsewhere/', callback: vi.fn() },
      ],
    } as unknown as HandlerContext

    const result = await handleRouteInbox(
      event({ topic: 'https://pod.example.com/elsewhere/' }),
      fetch,
      badContext
    )

    expect(result).toBe(false)
    expect(calls).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})
