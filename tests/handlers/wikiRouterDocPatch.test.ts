import { describe, it, expect } from 'vitest'
import { Parser } from 'n3'
import type { Quad } from 'n3'
import { WR, resultPatch } from '../../src/handlers/wikiRouterDoc.js'
import type { ResultInput } from '../../src/handlers/wikiRouterDoc.js'

const SUBJECT = 'https://pod.josephguillaume.id.au/pod/notes/wiki-router.ttl#req-abc12345'
const TOP = 'https://pod.josephguillaume.id.au/pod/notes/pages/best-page'
const ROUTED_AT = '2026-11-08T02:50:07.000Z'

const SOLID_INSERTS = 'http://www.w3.org/ns/solid/terms#inserts'
const SOLID_INSERT_DELETE_PATCH = 'http://www.w3.org/ns/solid/terms#InsertDeletePatch'
const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

function done(extra: Partial<ResultInput> = {}): ResultInput {
  return { status: 'done', routedAt: ROUTED_AT, ...extra }
}

function parse(patch: string): Quad[] {
  return new Parser({ format: 'N3' }).parse(patch)
}

function insertsQuads(patch: string): Quad[] {
  const quads = parse(patch)
  const formula = quads.find(quad => quad.predicate.value === SOLID_INSERTS)

  if (formula === undefined) {
    throw new Error('patch has no solid:inserts formula')
  }

  return quads.filter(quad => quad.graph.equals(formula.object))
}

function predicates(patch: string): string[] {
  return insertsQuads(patch).map(quad => quad.predicate.value)
}

function objects(patch: string): Array<{ termType: string; value: string; datatype?: string; language?: string }> {
  return insertsQuads(patch).map(quad => ({
    termType: quad.object.termType,
    value: quad.object.value,
    datatype: quad.object.termType === 'Literal' ? quad.object.datatype.value : undefined,
    language: quad.object.termType === 'Literal' ? quad.object.language : undefined,
  }))
}

describe('resultPatch', () => {
  it('emits exactly the status and routedAt triples for a minimal done result', () => {
    const patch = resultPatch(SUBJECT, done())

    expect(patch).toBe(
      `_:p a <${SOLID_INSERT_DELETE_PATCH}> ;\n` +
      `    <${SOLID_INSERTS}> {\n` +
      `  <${SUBJECT}> <${WR}status> "done" ;\n` +
      `    <${WR}routedAt> "${ROUTED_AT}"^^<${XSD_DATE_TIME}> .\n` +
      `} .\n`
    )

    expect(insertsQuads(patch)).toHaveLength(2)
    expect(predicates(patch)).toEqual([`${WR}status`, `${WR}routedAt`])
  })

  it('declares the patch resource as solid:InsertDeletePatch, which the Solid server requires', () => {
    const quads = parse(resultPatch(SUBJECT, done()))
    const formula = quads.find(quad => quad.predicate.value === SOLID_INSERTS)
    const typeQuad = quads.find(quad =>
      quad.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' &&
      quad.object.value === SOLID_INSERT_DELETE_PATCH)

    expect(typeQuad).toBeDefined()
    expect(typeQuad?.subject.equals(formula!.subject)).toBe(true)
  })

  it('emits all five done triples in the fixed order', () => {
    const patch = resultPatch(SUBJECT, done({
      reliability: 'ok',
      top: TOP,
      payload: '{"contract":1}',
    }))

    expect(predicates(patch)).toEqual([
      `${WR}status`,
      `${WR}routedAt`,
      `${WR}reliability`,
      `${WR}top`,
      `${WR}payload`,
    ])
    expect(objects(patch).map(object => object.value)).toEqual([
      'done',
      ROUTED_AT,
      'ok',
      TOP,
      '{"contract":1}',
    ])
  })

  it('emits an error result with reason and message after routedAt', () => {
    const patch = resultPatch(SUBJECT, {
      status: 'error',
      routedAt: ROUTED_AT,
      reason: 'router_failed',
      message: 'The router failed.',
    })

    expect(predicates(patch)).toEqual([
      `${WR}status`,
      `${WR}routedAt`,
      `${WR}reason`,
      `${WR}message`,
    ])
    expect(objects(patch).map(object => object.value)).toEqual([
      'error',
      ROUTED_AT,
      'router_failed',
      'The router failed.',
    ])
  })

  it('round-trips quotes, backslashes and newlines in the payload', () => {
    const payload = 'a "quoted" \\ backslash\nnew line'
    const patch = resultPatch(SUBJECT, done({ payload }))

    expect(patch).toContain('\\"')
    expect(patch).toContain('\\\\')
    expect(patch).toContain('\\n')

    const literals = objects(patch).filter(object => object.value.includes('quoted'))
    expect(literals).toHaveLength(1)
    expect(literals[0].value).toBe(payload)
  })

  it('escapes C0 control characters and round-trips them', () => {
    const payload = 'before\u0001after'
    const patch = resultPatch(SUBJECT, done({ payload }))

    expect(patch).toContain('\\u0001')

    const literals = objects(patch).filter(object => object.value.startsWith('before'))
    expect(literals).toHaveLength(1)
    expect(literals[0].value).toBe(payload)
  })

  it('leaves non-ASCII payload text unescaped and round-trips it', () => {
    const payload = 'café 日本語'
    const patch = resultPatch(SUBJECT, done({ payload }))

    expect(patch).toContain('café 日本語')
    expect(patch).not.toContain('\\u00e9')

    const literals = objects(patch).filter(object => object.value.includes('café'))
    expect(literals).toHaveLength(1)
    expect(literals[0].value).toBe(payload)
  })

  it('renders top as an IRI and emits the remaining values as plain literals', () => {
    const patch = resultPatch(SUBJECT, done({ reliability: 'low', top: TOP }))
    const result = objects(patch)

    expect(result[2]).toEqual({
      termType: 'Literal',
      value: 'low',
      datatype: XSD_STRING,
      language: '',
    })
    expect(result[3]).toEqual({
      termType: 'NamedNode',
      value: TOP,
      datatype: undefined,
      language: undefined,
    })
  })

  it('throws for a relative top', () => {
    expect(() => resultPatch(SUBJECT, done({ top: 'pages/best-page' })))
      .toThrow(/^top must be an absolute http\(s\) IRI$/)
  })

  it('throws for a non-http top', () => {
    expect(() => resultPatch(SUBJECT, done({ top: 'urn:example:page' })))
      .toThrow(/^top must be an absolute http\(s\) IRI$/)
  })

  it('throws for a subject without a fragment', () => {
    const subject = 'https://pod.josephguillaume.id.au/pod/notes/wiki-router.ttl'

    expect(() => resultPatch(subject, done()))
      .toThrow(/^result subject must be/)
  })

  it('throws for a non-http subject', () => {
    expect(() => resultPatch('urn:example:doc#req-abc12345', done()))
      .toThrow(/^result subject must be/)
    expect(() => resultPatch('#req-abc12345', done()))
      .toThrow(/^result subject must be/)
  })

  it('is deterministic for the same input', () => {
    const input = done({ reliability: 'ok', top: TOP, payload: '{"contract":1}' })

    expect(resultPatch(SUBJECT, input)).toBe(resultPatch(SUBJECT, input))
  })

  it('parses into exactly the expected quads inside the solid:inserts formula', () => {
    const patch = resultPatch(SUBJECT, done({
      reliability: 'ok',
      top: TOP,
      payload: '{"contract":1}',
    }))
    const quads = insertsQuads(patch)

    const actual = quads.map(quad => [
      quad.subject.value,
      quad.predicate.value,
      quad.object.termType,
      quad.object.value,
      quad.object.termType === 'Literal' ? quad.object.datatype.value : '',
    ])

    expect(actual).toEqual([
      [SUBJECT, `${WR}status`, 'Literal', 'done', XSD_STRING],
      [SUBJECT, `${WR}routedAt`, 'Literal', ROUTED_AT, XSD_DATE_TIME],
      [SUBJECT, `${WR}reliability`, 'Literal', 'ok', XSD_STRING],
      [SUBJECT, `${WR}top`, 'NamedNode', TOP, ''],
      [SUBJECT, `${WR}payload`, 'Literal', '{"contract":1}', XSD_STRING],
    ])

    const all = parse(patch)
    const outer = all.filter(quad => quad.predicate.value === SOLID_INSERTS)

    expect(outer).toHaveLength(1)
    expect(outer[0].subject.termType).toBe('BlankNode')
    expect(outer[0].object.termType).toBe('BlankNode')
    expect(patch.startsWith('_:p a <')).toBe(true)
  })
})
