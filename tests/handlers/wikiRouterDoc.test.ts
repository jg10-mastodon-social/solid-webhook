import { describe, it, expect } from 'vitest'
import { WR, selectPending } from '../../src/handlers/wikiRouterDoc.js'

const DOC = 'https://pod.josephguillaume.id.au/pod/notes/wiki-router.ttl'
const OTHER_DOC = 'https://pod.josephguillaume.id.au/pod/notes/other.ttl'

const PREFIXES = `@prefix wr: <${WR}> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`

function turtle(body: string): string {
  return `${PREFIXES}${body}`
}

describe('WR', () => {
  it('exposes the wiki-router namespace', () => {
    expect(WR).toBe('https://pod.josephguillaume.id.au/ns/wiki-router#')
  })
})

describe('selectPending', () => {
  it('returns an empty scan for an empty document', () => {
    expect(selectPending('', DOC)).toEqual({ pending: [], invalid: [] })
  })

  it('returns one pending request with its requestId and url', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending).toEqual([{
      subject: `${DOC}#req-abc12345`,
      requestId: 'abc12345',
      url: 'https://example.com/a',
    }])
  })

  it('carries requestedAt and context through to the pending request', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:requestedAt "2026-11-08T09:00:00Z"^^xsd:dateTime ;
  wr:context "routing context" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending).toEqual([{
      subject: `${DOC}#req-abc12345`,
      requestId: 'abc12345',
      url: 'https://example.com/a',
      requestedAt: '2026-11-08T09:00:00Z',
      context: 'routing context',
    }])
  })

  it('ignores terminal requests that already have wr:routedAt', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:requestedAt "2026-11-08T09:00:00Z"^^xsd:dateTime ;
  wr:routedAt "2026-11-08T09:05:00Z"^^xsd:dateTime .
<#req-def12345> wr:url "https://example.com/b" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending.map(request => request.requestId)).toEqual(['def12345'])
  })

  it('keeps a request pending when it only has wr:status and no wr:routedAt', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:status "error" ;
  wr:reason "boom" ;
  wr:message "it failed" ;
  wr:reliability "low" ;
  wr:top "x" ;
  wr:payload "y" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending.map(request => request.requestId)).toEqual(['abc12345'])
  })

  it('orders pending requests ascending by requestedAt', () => {
    const scan = selectPending(turtle(`
<#req-slow1234> wr:url "https://example.com/slow" ;
  wr:requestedAt "2026-11-08T11:00:00Z"^^xsd:dateTime .
<#req-fast1234> wr:url "https://example.com/fast" ;
  wr:requestedAt "2026-11-08T09:00:00Z"^^xsd:dateTime .
<#req-mid12345> wr:url "https://example.com/mid" ;
  wr:requestedAt "2026-11-08T10:00:00Z"^^xsd:dateTime .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending.map(request => request.requestId)).toEqual([
      'fast1234',
      'mid12345',
      'slow1234',
    ])
  })

  it('places requests without requestedAt after dated requests, preserving document order', () => {
    const scan = selectPending(turtle(`
<#req-undated1> wr:url "https://example.com/undated-1" .
<#req-dated123> wr:url "https://example.com/dated" ;
  wr:requestedAt "2026-11-08T10:00:00Z"^^xsd:dateTime .
<#req-undated2> wr:url "https://example.com/undated-2" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending.map(request => request.requestId)).toEqual([
      'dated123',
      'undated1',
      'undated2',
    ])
  })

  it('keeps document order for requests with equal requestedAt', () => {
    const scan = selectPending(turtle(`
<#req-first123> wr:url "https://example.com/first" ;
  wr:requestedAt "2026-11-08T10:00:00Z"^^xsd:dateTime .
<#req-second12> wr:url "https://example.com/second" ;
  wr:requestedAt "2026-11-08T10:00:00Z"^^xsd:dateTime .
`), DOC)

    expect(scan.pending.map(request => request.requestId)).toEqual(['first123', 'second12'])
  })

  it('accepts an untyped literal that is an ISO 8601 instant', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:requestedAt "2026-11-08T09:00:00Z" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending[0].requestedAt).toBe('2026-11-08T09:00:00Z')
  })

  it('marks a malformed fragment (#request-abc) invalid as request_id_malformed', () => {
    const scan = selectPending(turtle(`
<#request-abc> wr:url "https://example.com/a" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid).toHaveLength(1)
    expect(scan.invalid[0].subject).toBe(`${DOC}#request-abc`)
    expect(scan.invalid[0].reason).toBe('request_id_malformed')
  })

  it('marks a too short fragment (#req-1) invalid as request_id_malformed', () => {
    const scan = selectPending(turtle(`
<#req-1> wr:url "https://example.com/a" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['request_id_malformed'])
  })

  it('marks a subject in a different document invalid as not_in_document', () => {
    const scan = selectPending(turtle(`
<${OTHER_DOC}#req-abc12345> wr:url "https://example.com/a" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid).toHaveLength(1)
    expect(scan.invalid[0].subject).toBe(`${OTHER_DOC}#req-abc12345`)
    expect(scan.invalid[0].reason).toBe('not_in_document')
  })

  it('marks a url longer than 2048 characters invalid as url_too_long', () => {
    const url = `https://example.com/${'x'.repeat(2048)}`

    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "${url}" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['url_too_long'])
  })

  it('accepts a url of exactly 2048 characters', () => {
    const url = `https://example.com/${'x'.repeat(2048 - 'https://example.com/'.length)}`

    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "${url}" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending).toHaveLength(1)
    expect(scan.pending[0].url).toBe(url)
  })

  it('marks a request with two wr:url values invalid as url_duplicate', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:url "https://example.com/b" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['url_duplicate'])
  })

  it('ignores a repeated identical wr:url triple (RDF set semantics)', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" .
<#req-abc12345> wr:url "https://example.com/a" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending).toHaveLength(1)
  })

  it('marks a non-literal wr:url invalid as url_not_literal', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url <https://example.com/target> .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['url_not_literal'])
  })

  it('marks an empty wr:url invalid as url_empty', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['url_empty'])
  })

  it('marks a context longer than 500 characters invalid as context_too_long', () => {
    const context = 'c'.repeat(501)

    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:context "${context}" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['context_too_long'])
  })

  it('accepts a context of exactly 500 characters', () => {
    const context = 'c'.repeat(500)

    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:context "${context}" .
`), DOC)

    expect(scan.invalid).toEqual([])
    expect(scan.pending[0].context).toBe(context)
  })

  it('marks multiple wr:context values invalid as context_too_long', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:context "one" ;
  wr:context "two" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['context_too_long'])
  })

  it('marks an unparseable requestedAt invalid as requested_at_invalid', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:requestedAt "yesterday" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['requested_at_invalid'])
  })

  it('marks a requestedAt with a non-dateTime datatype invalid as requested_at_invalid', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:requestedAt "2026-11-08"^^xsd:date .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['requested_at_invalid'])
  })

  it('marks a date-only untyped requestedAt invalid as requested_at_invalid', () => {
    const scan = selectPending(turtle(`
<#req-abc12345> wr:url "https://example.com/a" ;
  wr:requestedAt "2026-11-08" .
`), DOC)

    expect(scan.pending).toEqual([])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['requested_at_invalid'])
  })

  it('collects valid and invalid requests in one scan', () => {
    const scan = selectPending(turtle(`
<#req-valid123> wr:url "https://example.com/ok" ;
  wr:requestedAt "2026-11-08T09:00:00Z"^^xsd:dateTime .
<#req-bad12345> wr:url "" .
<#nope> wr:url "https://example.com/nope" .
`), DOC)

    expect(scan.pending.map(request => request.requestId)).toEqual(['valid123'])
    expect(scan.invalid.map(entry => entry.reason)).toEqual(['url_empty', 'request_id_malformed'])
  })

  it('throws for invalid Turtle', () => {
    expect(() => selectPending('not valid turtle {', DOC))
      .toThrow(/^document is not valid Turtle/)
    expect(() => selectPending('not valid turtle {', DOC)).toThrow(Error)
  })
})
