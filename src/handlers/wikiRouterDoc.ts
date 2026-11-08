import { Parser, Store } from 'n3'
import type { Quad, Term } from 'n3'

export const WR = 'https://pod.josephguillaume.id.au/ns/wiki-router#'

const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime'
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'
const SOLID_INSERTS = 'http://www.w3.org/ns/solid/terms#inserts'
const LITERAL_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}
const REQUEST_ID_PATTERN = /^req-[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const MAX_URL_LENGTH = 2048
const MAX_CONTEXT_LENGTH = 500
const REQUEST_PREFIX = 'req-'

export interface PendingRequest {
  subject: string
  requestId: string
  url: string
  requestedAt?: string
  context?: string
}

export interface InvalidEntry {
  subject: string
  reason: string
  message: string
}

export interface ResultInput {
  status: 'done' | 'error'
  routedAt: string
  reliability?: 'ok' | 'low'
  top?: string
  payload?: string
  reason?: string
  message?: string
}

interface ResultTriple {
  predicate: string
  object: string
}

export interface DocumentScan {
  pending: PendingRequest[]
  invalid: InvalidEntry[]
}

type Evaluation =
  | { kind: 'pending'; request: PendingRequest; timestamp?: number }
  | { kind: 'invalid'; entry: InvalidEntry }
  | { kind: 'skip' }

type UrlResult = { ok: true; url: string } | { ok: false; entry: InvalidEntry }
type ContextResult = { ok: true; context?: string } | { ok: false; entry: InvalidEntry }
type RequestedAtResult =
  | { ok: true; requestedAt?: string; timestamp?: number }
  | { ok: false; entry: InvalidEntry }

interface Candidate {
  request: PendingRequest
  timestamp?: number
  order: number
}

function parseDocument(body: string, documentUrl: string): Store {
  try {
    return new Store(new Parser({ baseIRI: documentUrl }).parse(body))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`document is not valid Turtle: ${detail}`)
  }
}

function objectsFor(quads: Quad[], predicate: string): Term[] {
  return quads
    .filter(quad => quad.predicate.value === predicate)
    .map(quad => quad.object)
}

function isInstant(value: string): boolean {
  return ISO_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
}

function evaluateUrl(subject: string, quads: Quad[]): UrlResult {
  const urls = objectsFor(quads, `${WR}url`)

  // Unreachable while candidates require at least one wr:url, kept as a guard.
  if (urls.length === 0) {
    return {
      ok: false,
      entry: { subject, reason: 'url_missing', message: 'Request has no wr:url value.' },
    }
  }

  if (urls.length > 1) {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'url_duplicate',
        message: 'Request has more than one wr:url value.',
      },
    }
  }

  const url = urls[0]

  if (url.termType !== 'Literal') {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'url_not_literal',
        message: 'Request wr:url must be a literal string.',
      },
    }
  }

  if (url.value.trim() === '') {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'url_empty',
        message: 'Request wr:url must not be empty.',
      },
    }
  }

  if (url.value.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'url_too_long',
        message: `Request wr:url exceeds ${MAX_URL_LENGTH} characters.`,
      },
    }
  }

  return { ok: true, url: url.value }
}

function evaluateContext(subject: string, quads: Quad[]): ContextResult {
  const contexts = objectsFor(quads, `${WR}context`)

  if (contexts.length === 0) {
    return { ok: true }
  }

  if (contexts.length > 1) {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'context_too_long',
        message: 'Request has more than one wr:context value.',
      },
    }
  }

  const context = contexts[0]

  if (context.termType !== 'Literal') {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'context_too_long',
        message: 'Request wr:context must be a literal string.',
      },
    }
  }

  if (context.value.length > MAX_CONTEXT_LENGTH) {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'context_too_long',
        message: `Request wr:context exceeds ${MAX_CONTEXT_LENGTH} characters.`,
      },
    }
  }

  return { ok: true, context: context.value }
}

function evaluateRequestedAt(subject: string, quads: Quad[]): RequestedAtResult {
  const values = objectsFor(quads, `${WR}requestedAt`)

  if (values.length === 0) {
    return { ok: true }
  }

  if (values.length > 1) {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'requested_at_invalid',
        message: 'Request has more than one wr:requestedAt value.',
      },
    }
  }

  const requestedAt = values[0]

  if (requestedAt.termType !== 'Literal') {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'requested_at_invalid',
        message: 'Request wr:requestedAt must be a literal.',
      },
    }
  }

  const datatype = requestedAt.datatype.value
  const parsed = Date.parse(requestedAt.value)
  const valid = datatype === XSD_DATE_TIME
    ? !Number.isNaN(parsed)
    : datatype === XSD_STRING && isInstant(requestedAt.value)

  if (!valid) {
    return {
      ok: false,
      entry: {
        subject,
        reason: 'requested_at_invalid',
        message: 'Request wr:requestedAt must be an xsd:dateTime or an ISO 8601 instant.',
      },
    }
  }

  return { ok: true, requestedAt: requestedAt.value, timestamp: parsed }
}

function evaluateSubject(subject: Term, quads: Quad[], documentUrl: string): Evaluation {
  const subjectValue = subject.value

  if (objectsFor(quads, `${WR}routedAt`).length > 0) {
    return { kind: 'skip' }
  }

  if (subject.termType !== 'NamedNode' || !subjectValue.startsWith(`${documentUrl}#`)) {
    return {
      kind: 'invalid',
      entry: {
        subject: subjectValue,
        reason: 'not_in_document',
        message: `Request subject is not in ${documentUrl}.`,
      },
    }
  }

  const fragment = subjectValue.slice(documentUrl.length + 1)

  if (!REQUEST_ID_PATTERN.test(fragment)) {
    return {
      kind: 'invalid',
      entry: {
        subject: subjectValue,
        reason: 'request_id_malformed',
        message: 'Request fragment must look like #req-<8 to 64 characters>.',
      },
    }
  }

  const urlResult = evaluateUrl(subjectValue, quads)
  if (!urlResult.ok) {
    return { kind: 'invalid', entry: urlResult.entry }
  }

  const contextResult = evaluateContext(subjectValue, quads)
  if (!contextResult.ok) {
    return { kind: 'invalid', entry: contextResult.entry }
  }

  const requestedAtResult = evaluateRequestedAt(subjectValue, quads)
  if (!requestedAtResult.ok) {
    return { kind: 'invalid', entry: requestedAtResult.entry }
  }

  const request: PendingRequest = {
    subject: subjectValue,
    requestId: fragment.slice(REQUEST_PREFIX.length),
    url: urlResult.url,
  }

  if (requestedAtResult.requestedAt !== undefined) {
    request.requestedAt = requestedAtResult.requestedAt
  }

  if (contextResult.context !== undefined) {
    request.context = contextResult.context
  }

  return { kind: 'pending', request, timestamp: requestedAtResult.timestamp }
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.timestamp !== undefined && b.timestamp !== undefined) {
    return a.timestamp - b.timestamp || a.order - b.order
  }

  if (a.timestamp === undefined && b.timestamp === undefined) {
    return a.order - b.order
  }

  return a.timestamp === undefined ? 1 : -1
}

export function selectPending(body: string, documentUrl: string): DocumentScan {
  const store = parseDocument(body, documentUrl)
  const candidates: Candidate[] = []
  const invalidEntries: InvalidEntry[] = []
  const seen = new Set<string>()

  for (const quad of store.getQuads(null, `${WR}url`, null, null)) {
    if (seen.has(quad.subject.value)) continue
    seen.add(quad.subject.value)

    const quads = store.getQuads(quad.subject, null, null, null)
    const evaluation = evaluateSubject(quad.subject, quads, documentUrl)

    if (evaluation.kind === 'pending') {
      candidates.push({
        request: evaluation.request,
        timestamp: evaluation.timestamp,
        order: candidates.length,
      })
    } else if (evaluation.kind === 'invalid') {
      invalidEntries.push(evaluation.entry)
    }
  }

  candidates.sort(compareCandidates)

  return {
    pending: candidates.map(candidate => candidate.request),
    invalid: invalidEntries,
  }
}

function assertHttpIri(value: string, label: string): URL {
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${label} must be an absolute http(s) IRI`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must be an absolute http(s) IRI`)
  }

  return parsed
}

function assertResultSubject(subject: string): string {
  const parsed = assertHttpIri(subject, 'result subject')

  if (parsed.hash.length <= 1) {
    throw new Error('result subject must be an absolute http(s) IRI with a fragment')
  }

  return subject
}

function escapeLiteral(value: string): string {
  let escaped = ''

  for (const character of value) {
    const replacement = LITERAL_ESCAPES[character]

    if (replacement !== undefined) {
      escaped += replacement
      continue
    }

    const code = character.codePointAt(0) ?? 0
    escaped += code < 0x20
      ? `\\u${code.toString(16).padStart(4, '0')}`
      : character
  }

  return escaped
}

function resultTriples(result: ResultInput): ResultTriple[] {
  const triples: ResultTriple[] = [
    { predicate: `${WR}status`, object: `"${escapeLiteral(result.status)}"` },
    {
      predicate: `${WR}routedAt`,
      object: `"${escapeLiteral(result.routedAt)}"^^<${XSD_DATE_TIME}>`,
    },
  ]

  if (result.reliability !== undefined) {
    triples.push({
      predicate: `${WR}reliability`,
      object: `"${escapeLiteral(result.reliability)}"`,
    })
  }

  if (result.top !== undefined) {
    triples.push({ predicate: `${WR}top`, object: `<${result.top}>` })
  }

  for (const [predicate, value] of [
    ['payload', result.payload],
    ['reason', result.reason],
    ['message', result.message],
  ] as const) {
    if (value !== undefined) {
      triples.push({ predicate: `${WR}${predicate}`, object: `"${escapeLiteral(value)}"` })
    }
  }

  return triples
}

export function resultPatch(subject: string, result: ResultInput): string {
  const subjectIri = assertResultSubject(subject)

  if (result.top !== undefined) {
    assertHttpIri(result.top, 'top')
  }

  const triples = resultTriples(result)
  const body = triples
    .map((triple, index) =>
      `${index === 0 ? `  <${subjectIri}> ` : '    '}<${triple.predicate}> ${triple.object}`)
    .join(' ;\n')

  return `_:p <${SOLID_INSERTS}> {\n${body} .\n} .\n`
}
