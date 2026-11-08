import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Parser } from 'n3'
import type { Quad, Term } from 'n3'
import type { HandlerContext, SolidFetch, WebhookEvent } from '../../src/types/index.js'
import { WR } from '../../src/handlers/wikiRouterDoc.js'
import {
  MAX_DOCUMENT_BYTES,
  ensureQueueDocument,
  handleRouteInbox,
  resetRouteInboxState,
} from '../../src/handlers/routeInbox.js'

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

const DOC = 'https://pod.josephguillaume.id.au/pod/notes/wiki-router.ttl'
const ROUTER = '/opt/url-to-wiki/bin/wiki_route.py'
const REQUEST_ID = 'req-a1b2c3d4'
const SUBJECT = `${DOC}#${REQUEST_ID}`
const ARTICLE = 'https://example.com/article'
const TOP = 'https://pod.josephguillaume.id.au/pod/notes/pages/solar'

const SOLID_INSERTS = 'http://www.w3.org/ns/solid/terms#inserts'
const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

const ROUTER_STDOUT = JSON.stringify(
  {
    contract: 1,
    reliability: 'ok',
    candidates: [
      { subject: TOP, score: 1.0873, matched: ['solar power'] },
      { subject: 'urn:isbn:9780000000000', score: 0.2 },
    ],
    fetched: { ok: true, title: 'An "Article"', description: 'A description' },
  },
  null,
  2
)

function turtle(body: string): string {
  return `@prefix wr: <${WR}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
${body}
`
}

function pending(overrides: { subject?: string; url?: string; extra?: string } = {}): string {
  const subject = overrides.subject ?? `<#${REQUEST_ID}>`
  const url = overrides.url ?? ARTICLE
  return turtle(`${subject} wr:url "${url}"${overrides.extra ?? ''} .`)
}

const context = (topic = DOC): HandlerContext => ({
  registrations: [{ handler: 'RouteInbox', topic, callback: () => {} }],
})

const event = (overrides: Partial<WebhookEvent> = {}): WebhookEvent => ({
  type: 'Add',
  object: DOC,
  topic: DOC,
  raw: {},
  ...overrides,
})

function succeedWith(stdout = ROUTER_STDOUT): void {
  mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
    callback(null, stdout, '')
  })
}

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
    headers: { get: () => 'text/turtle' },
    text: async () => body,
  }
}

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

interface PodOptions {
  document?: string
  documentStatus?: number
  patchStatus?: number
  putStatus?: number
  /**
   * Accept PATCHes with a 2xx but leave the document unchanged, so the handler's
   * re-read still sees the request pending. Real pods can do this: an accepted
   * write is not a visible write.
   */
  applyPatches?: boolean
}

function literalToTurtle(value: string): string {
  let escaped = ''

  for (const character of value) {
    if (character === '\\') escaped += '\\\\'
    else if (character === '"') escaped += '\\"'
    else if (character === '\n') escaped += '\\n'
    else if (character === '\r') escaped += '\\r'
    else if (character === '\t') escaped += '\\t'
    else {
      const code = character.codePointAt(0) ?? 0
      escaped += code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : character
    }
  }

  return escaped
}

function termToTurtle(term: Term): string {
  if (term.termType === 'NamedNode') {
    return `<${term.value}>`
  }

  if (term.termType === 'Literal') {
    return `"${literalToTurtle(term.value)}"^^<${term.datatype.value}>`
  }

  throw new Error(`fake pod cannot serialise a ${term.termType}`)
}

/** Applies a solid:inserts patch to the in-memory document the way a server would. */
function applyPatch(documentBody: string, patch: string): string {
  const quads = new Parser({ format: 'N3' }).parse(patch)
  const formula = quads.find(quad => quad.predicate.value === SOLID_INSERTS)

  if (formula === undefined) {
    throw new Error('patch has no solid:inserts formula')
  }

  const inserted = quads
    .filter(quad => quad.graph.equals(formula.object))
    .map(quad => `${termToTurtle(quad.subject)} ${termToTurtle(quad.predicate)} ${termToTurtle(quad.object)} .`)

  return `${documentBody}\n${inserted.join('\n')}\n`
}

/**
 * In-memory document. GET serves the current body; PATCH records the body and
 * applies it so the handler's re-read sees the terminal triples it wrote.
 */
function createPod(options: PodOptions = {}): {
  fetch: SolidFetch
  calls: FetchCall[]
  document: () => string
} {
  let documentBody = options.document ?? pending()
  const calls: FetchCall[] = []

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = typeof init?.body === 'string' ? init.body : undefined
    calls.push({ url, method, headers, body })

    if (url !== DOC) {
      return response('not found', 404)
    }

    if (method === 'GET') {
      return response(documentBody, options.documentStatus ?? 200)
    }

    if (method === 'PATCH') {
      if (options.patchStatus !== undefined && options.patchStatus >= 400) {
        return response('', options.patchStatus)
      }
      if (body === undefined) {
        return response('no body', 400)
      }
      if (options.applyPatches === false) {
        return response('', 200)
      }
      documentBody = applyPatch(documentBody, body)
      return response('', 205)
    }

    if (method === 'PUT') {
      if (options.putStatus !== undefined) {
        return response('', options.putStatus)
      }
      if (body !== undefined) {
        documentBody = body
      }
      return response('', 201)
    }

    return response('method not allowed', 405)
  })

  return {
    fetch: fetchImpl as unknown as SolidFetch,
    calls,
    document: () => documentBody,
  }
}

function getCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter(call => call.method === 'GET')
}

function patches(calls: FetchCall[]): FetchCall[] {
  return calls.filter(call => call.method === 'PATCH')
}

function insertedQuads(patch: string): Quad[] {
  const quads = new Parser({ format: 'N3' }).parse(patch)
  const formula = quads.find(quad => quad.predicate.value === SOLID_INSERTS)

  if (formula === undefined) {
    throw new Error('patch has no solid:inserts formula')
  }

  return quads.filter(quad => quad.graph.equals(formula.object))
}

interface Triple {
  subject: string
  predicate: string
  termType: string
  value: string
  datatype?: string
}

function triples(patch: string): Triple[] {
  return insertedQuads(patch).map(quad => ({
    subject: quad.subject.value,
    predicate: quad.predicate.value,
    termType: quad.object.termType,
    value: quad.object.value,
    datatype: quad.object.termType === 'Literal' ? quad.object.datatype.value : undefined,
  }))
}

function singlePatch(calls: FetchCall[]): FetchCall {
  const written = patches(calls)
  expect(written).toHaveLength(1)
  return written[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WIKI_ROUTER_BIN = ROUTER
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  succeedWith()
  resetRouteInboxState()
})

describe('RouteInbox', () => {
  it('ignores Remove events and never touches the pod', async () => {
    const pod = createPod()

    const result = await handleRouteInbox(event({ type: 'Remove' }), pod.fetch, context())

    expect(result).toBe(false)
    expect(pod.calls).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('returns false when no registration matches the topic', async () => {
    const pod = createPod()

    const result = await handleRouteInbox(
      event(),
      pod.fetch,
      context('https://pod.josephguillaume.id.au/pod/notes/other.ttl')
    )

    expect(result).toBe(false)
    expect(pod.calls).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('matches the registration topic exactly, without a trailing-slash normalisation', async () => {
    const pod = createPod()

    const result = await handleRouteInbox(
      event({ topic: `${DOC}/` }),
      pod.fetch,
      context()
    )

    expect(result).toBe(false)
    expect(pod.calls).toHaveLength(0)
  })

  it('returns false when the event object is not the registered document', async () => {
    const pod = createPod()

    const result = await handleRouteInbox(event({ object: SUBJECT }), pod.fetch, context())

    expect(result).toBe(false)
    expect(pod.calls).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('returns false for an empty document without writing', async () => {
    const pod = createPod({ document: turtle('') })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(false)
    expect(getCalls(pod.calls)).toHaveLength(1)
    expect(patches(pod.calls)).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('returns false when the document is not valid Turtle', async () => {
    const pod = createPod({ document: 'not valid turtle {' })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(false)
    expect(patches(pod.calls)).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('returns false and writes nothing when the document read fails', async () => {
    const pod = createPod({ documentStatus: 404 })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(false)
    expect(patches(pod.calls)).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('returns false when the document exceeds the size cap', async () => {
    const pod = createPod({ document: `${pending()}\n# ${'x'.repeat(MAX_DOCUMENT_BYTES)}` })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(false)
    expect(patches(pod.calls)).toHaveLength(0)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('reads the document as Turtle, routes one request and patches a done result', async () => {
    const pod = createPod()

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [bin, args] = mockExecFile.mock.calls[0]
    expect(bin).toBe(ROUTER)
    expect(args).toEqual(['route', ARTICLE, '--json'])

    const read = getCalls(pod.calls)[0]
    expect(read.url).toBe(DOC)
    expect(read.headers.accept).toBe('text/turtle')

    const patch = singlePatch(pod.calls)
    expect(patch.url).toBe(DOC)
    expect(patch.headers['content-type']).toBe('text/n3')
    expect(patch.headers.accept).toBe('text/turtle')

    const written = triples(patch.body ?? '')
    expect(written.map(triple => triple.predicate)).toEqual([
      `${WR}status`,
      `${WR}routedAt`,
      `${WR}reliability`,
      `${WR}top`,
      `${WR}payload`,
    ])
    for (const triple of written) {
      expect(triple.subject).toBe(SUBJECT)
    }
    expect(written[0]).toMatchObject({ termType: 'Literal', value: 'done', datatype: XSD_STRING })
    expect(written[1].value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(written[1].datatype).toBe(XSD_DATE_TIME)
    expect(written[2]).toMatchObject({ value: 'ok', datatype: XSD_STRING })
    expect(written[3]).toMatchObject({ termType: 'NamedNode', value: TOP })
    expect(written[4]).toMatchObject({ value: ROUTER_STDOUT, datatype: XSD_STRING })
  })

  it('passes the router stdout through verbatim as the payload literal', async () => {
    const pod = createPod()

    await handleRouteInbox(event(), pod.fetch, context())

    const payload = triples(singlePatch(pod.calls).body ?? '')
      .find(triple => triple.predicate === `${WR}payload`)

    expect(payload?.value).toBe(ROUTER_STDOUT)
    expect(payload?.value).toContain('\n  "reliability": "ok"')
    expect(payload?.value).toContain('An \\"Article\\"')
  })

  it('omits reliability and top when the payload values do not qualify', async () => {
    const pod = createPod()
    succeedWith(JSON.stringify({
      contract: 1,
      reliability: 'high',
      candidates: [{ subject: 'urn:isbn:9780000000000' }],
    }))

    await handleRouteInbox(event(), pod.fetch, context())

    const written = triples(singlePatch(pod.calls).body ?? '')
    expect(written.map(triple => triple.predicate)).toEqual([
      `${WR}status`,
      `${WR}routedAt`,
      `${WR}payload`,
    ])
  })

  it('passes wr:context to the router', async () => {
    const pod = createPod({
      document: pending({ extra: ' ;\n  wr:context "routing context"' }),
    })

    await handleRouteInbox(event(), pod.fetch, context())

    const [, args] = mockExecFile.mock.calls[0]
    expect(args).toEqual(['route', ARTICLE, '--json', '--context', 'routing context'])
  })

  it('routes every pending request in the document', async () => {
    const pod = createPod({
      document: turtle(`<#req-first123> wr:url "https://example.com/first" .
<#req-second12> wr:url "https://example.com/second" .`),
    })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(2)
    const subjects = patches(pod.calls).map(
      patch => triples(patch.body ?? '')[0].subject
    )
    expect(subjects).toEqual([`${DOC}#req-first123`, `${DOC}#req-second12`])
  })

  it('patches an error for an invalid request inside the document and skips the router', async () => {
    const longUrl = `https://example.com/${'x'.repeat(2100)}`
    const pod = createPod({ document: pending({ url: longUrl }) })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()

    const written = triples(singlePatch(pod.calls).body ?? '')
    expect(written.map(triple => triple.predicate)).toEqual([
      `${WR}status`,
      `${WR}routedAt`,
      `${WR}reason`,
      `${WR}message`,
    ])
    expect(written[0]).toMatchObject({ subject: SUBJECT, value: 'error' })
    expect(written[2]).toMatchObject({ value: 'url_too_long' })
    expect(written[3].value).toContain('2048')
  })

  it('never writes triples about a subject from another document', async () => {
    const foreign = 'https://other.example.com/notes/elsewhere.ttl#req-abc12345'
    const pod = createPod({ document: pending({ subject: `<${foreign}>` }) })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(false)
    expect(patches(pod.calls)).toHaveLength(0)
    expect(pod.document()).not.toContain('routedAt')
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('patches url_rejected for a target that is not publicly routable', async () => {
    const pod = createPod({ document: pending({ url: 'http://127.0.0.1/admin' }) })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()
    expect(triples(singlePatch(pod.calls).body ?? '')).toEqual([
      expect.objectContaining({ subject: SUBJECT, predicate: `${WR}status`, value: 'error' }),
      expect.objectContaining({ predicate: `${WR}routedAt` }),
      expect.objectContaining({ predicate: `${WR}reason`, value: 'url_rejected' }),
      expect.objectContaining({ predicate: `${WR}message` }),
    ])
  })

  it('patches router_not_configured when WIKI_ROUTER_BIN is unset', async () => {
    const pod = createPod()
    delete process.env.WIKI_ROUTER_BIN

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()
    const written = triples(singlePatch(pod.calls).body ?? '')
    expect(written.find(triple => triple.predicate === `${WR}reason`)?.value)
      .toBe('router_not_configured')
  })

  it('patches router_contract_mismatch when the router speaks another contract', async () => {
    const pod = createPod()
    succeedWith(JSON.stringify({ contract: 99, reliability: 'ok', candidates: [] }))

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    const written = triples(singlePatch(pod.calls).body ?? '')
    expect(written.find(triple => triple.predicate === `${WR}reason`)?.value)
      .toBe('router_contract_mismatch')
    expect(written.find(triple => triple.predicate === `${WR}message`)?.value)
      .toContain('99')
  })

  it('patches router_failed when the router exits non-zero', async () => {
    const pod = createPod()
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      callback(Object.assign(new Error('boom'), { code: 2 }), '', 'boom')
    })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    const written = triples(singlePatch(pod.calls).body ?? '')
    expect(written.find(triple => triple.predicate === `${WR}reason`)?.value)
      .toBe('router_failed')
  })

  it('patches router_timeout when the router is killed', async () => {
    const pod = createPod()
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      callback(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), '', '')
    })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    const written = triples(singlePatch(pod.calls).body ?? '')
    expect(written.find(triple => triple.predicate === `${WR}reason`)?.value)
      .toBe('router_timeout')
  })

  it('stops the loop after a failed patch and leaves the request pending', async () => {
    const pod = createPod({
      document: turtle(`<#req-first123> wr:url "https://example.com/first" .
<#req-second12> wr:url "https://example.com/second" .`),
      patchStatus: 500,
    })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(patches(pod.calls)).toHaveLength(1)
    expect(pod.document()).not.toContain('routedAt')
  })

  it('stops after one route when an accepted patch leaves the request pending', async () => {
    const pod = createPod({ applyPatches: false })

    const result = await handleRouteInbox(event(), pod.fetch, context())

    expect(result).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(patches(pod.calls)).toHaveLength(1)
    expect(getCalls(pod.calls)).toHaveLength(2)
    expect(pod.document()).not.toContain('routedAt')
  })

  it('refuses a second concurrent run while one is in flight', async () => {
    const releases: Array<(stdout: string) => void> = []
    mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
      releases.push(stdout => callback(null, stdout, ''))
    })

    const firstPod = createPod()
    const secondPod = createPod()

    const first = handleRouteInbox(event(), firstPod.fetch, context())
    const busy = await handleRouteInbox(event(), secondPod.fetch, context())

    expect(busy).toBe(false)
    expect(secondPod.calls).toHaveLength(0)

    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases[0](ROUTER_STDOUT)

    await expect(first).resolves.toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    expect(patches(firstPod.calls)).toHaveLength(1)
  })
})

const QUEUE_BODY =
  `@prefix wr: <${WR}> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n`

describe('ensureQueueDocument', () => {
  it('reports an existing queue document and writes nothing', async () => {
    const pod = createPod()

    const ready = await ensureQueueDocument(DOC, pod.fetch)

    expect(ready).toBe(true)
    expect(pod.calls.map(call => call.method)).toEqual(['GET'])
    expect(getCalls(pod.calls)[0].url).toBe(DOC)
    expect(getCalls(pod.calls)[0].headers.accept).toBe('text/turtle')
  })

  it('creates a missing queue document with the namespace prefixes', async () => {
    const pod = createPod({ documentStatus: 404 })

    const ready = await ensureQueueDocument(DOC, pod.fetch)

    expect(ready).toBe(true)
    const puts = pod.calls.filter(call => call.method === 'PUT')
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toBe(DOC)
    expect(puts[0].headers['content-type']).toBe('text/turtle')
    expect(puts[0].body).toBe(QUEUE_BODY)
  })

  it('reports failure when the create is refused', async () => {
    const pod = createPod({ documentStatus: 404, putStatus: 500 })

    const ready = await ensureQueueDocument(DOC, pod.fetch)

    expect(ready).toBe(false)
    expect(pod.calls.filter(call => call.method === 'PUT')).toHaveLength(1)
  })

  it('reports failure without writing when the read is forbidden', async () => {
    const pod = createPod({ documentStatus: 403 })

    const ready = await ensureQueueDocument(DOC, pod.fetch)

    expect(ready).toBe(false)
    expect(pod.calls.filter(call => call.method === 'PUT')).toHaveLength(0)
  })

  it('reports failure without writing when the read throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })

    const ready = await ensureQueueDocument(DOC, fetchImpl as unknown as SolidFetch)

    expect(ready).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

