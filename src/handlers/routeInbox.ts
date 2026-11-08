import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { WebhookEvent, SolidFetch, HandlerContext, RouteInboxWebhook } from '../types/index.js'
import { resultPatch, selectPending } from './wikiRouterDoc.js'
import type { DocumentScan, InvalidEntry, PendingRequest, ResultInput } from './wikiRouterDoc.js'

/**
 * Version of the request/result contract understood by this handler.
 * Bump only on an incompatible change to the payload the router emits.
 */
export const ROUTER_CONTRACT = 1

/** Largest document this handler will parse. Refuse anything bigger. */
export const MAX_DOCUMENT_BYTES = 1_048_576

/**
 * At most this many results are written per event; the next event drains the
 * rest. Each route loads a 15 MB index and takes seconds, and the delivery that
 * triggered this run stays open until it returns, so this is deliberately small.
 */
const MAX_ROUTING_PER_RUN = 3

const ROUTER_TIMEOUT_MS = 30_000
const ROUTER_MAX_BUFFER = 4 * 1024 * 1024

type FailureReason =
  | 'url_rejected'
  | 'router_not_configured'
  | 'router_failed'
  | 'router_timeout'
  | 'router_contract_mismatch'

interface RouterRequest {
  url: string
  context?: string
}

/**
 * Only one route process may run at a time. The scoring index is large and the
 * host is small; concurrent runs would both load it.
 */
let inFlight: string | null = null

/** Test seam only. */
export function resetRouteInboxState(): void {
  inFlight = null
}

/**
 * The registration topic is one wiki-router RDF document: the event object is
 * that document, and both requests and results are triples inside it.
 */
export async function handleRouteInbox(
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: HandlerContext
): Promise<boolean> {
  console.log(`[RouteInbox] ${event.type} event for ${event.object}`)

  if (event.type === 'Remove') {
    console.log('[RouteInbox] Remove event, skipping')
    return false
  }

  const registration = findRegistration(event, context)
  if (!registration) {
    console.error(`[RouteInbox] Error: no RouteInbox registration for topic ${event.topic}`)
    return false
  }

  const documentUrl = registration.topic
  if (event.object !== documentUrl) {
    console.error(
      `[RouteInbox] Error: event object ${event.object} is not the registered document ${documentUrl}`
    )
    return false
  }

  if (inFlight !== null) {
    console.log(`[RouteInbox] a run is already in progress for ${inFlight}; skipping ${documentUrl}`)
    return false
  }

  inFlight = documentUrl
  try {
    return await drainDocument(documentUrl, fetch)
  } finally {
    inFlight = null
  }
}

function findRegistration(
  event: WebhookEvent,
  context?: HandlerContext
): RouteInboxWebhook | undefined {
  return context?.registrations?.find(
    (r): r is RouteInboxWebhook => r.handler === 'RouteInbox' && r.topic === event.topic
  )
}

/**
 * Reads the document, reports unusable requests, then routes pending ones until
 * the document holds none or `MAX_ROUTING_PER_RUN` results have been written.
 * Every write is re-read, so the scan decides what is still pending.
 */
async function drainDocument(documentUrl: string, fetch: SolidFetch): Promise<boolean> {
  const initial = await readDocument(documentUrl, fetch)
  if (!initial.ok) {
    return false
  }

  let wrote = await writeInvalidResults(documentUrl, initial.scan.invalid, fetch)
  let scan = initial.scan

  for (let attempt = 0; attempt < MAX_ROUTING_PER_RUN; attempt += 1) {
    const request = scan.pending[0]
    if (request === undefined) {
      break
    }

    const step = await routeRequest(documentUrl, request, fetch)
    wrote = wrote || step.attempted

    // A failed write leaves the request pending so a later event retries it.
    if (!step.ok) {
      break
    }

    const next = await readDocument(documentUrl, fetch)
    if (!next.ok) {
      break
    }

    // A successful PATCH must make the subject terminal. If it is still pending
    // the pod did not take the write; stop rather than route the same request
    // again and add a second result.
    const nextRequest = next.scan.pending[0]
    if (nextRequest !== undefined && nextRequest.subject === request.subject) {
      console.error(
        `[RouteInbox] Error: ${request.subject} is still pending after a result was written; stopping`
      )
      break
    }

    scan = next.scan
  }

  return wrote
}

/**
 * Requests whose own triples cannot be routed get a terminal error so they are
 * not reported again. A subject outside this document is only logged: writing
 * triples about it would edit a document this handler does not own.
 */
async function writeInvalidResults(
  documentUrl: string,
  invalid: InvalidEntry[],
  fetch: SolidFetch
): Promise<boolean> {
  let wrote = false

  for (const entry of invalid) {
    if (entry.reason === 'not_in_document') {
      console.log(`[RouteInbox] ignoring ${entry.subject}: ${entry.message}`)
      continue
    }

    const outcome = await patchResult(documentUrl, entry.subject, {
      status: 'error',
      routedAt: nowIso(),
      reason: entry.reason,
      message: entry.message,
    }, fetch)
    wrote = wrote || outcome.attempted

    if (outcome.ok) {
      console.log(`[RouteInbox] wrote error ${entry.reason} for ${entry.subject}`)
    }
  }

  return wrote
}

interface RouteStep {
  /** A PATCH left the handler. */
  attempted: boolean
  /** The PATCH was accepted, so the request is terminal and the loop may continue. */
  ok: boolean
}

async function routeRequest(
  documentUrl: string,
  request: PendingRequest,
  fetch: SolidFetch
): Promise<RouteStep> {
  const target = await checkTarget(request.url)
  if (!target.ok) {
    console.log(`[RouteInbox] rejected ${request.url}: ${target.message}`)
    return patchResult(documentUrl, request.subject, {
      status: 'error',
      routedAt: nowIso(),
      reason: 'url_rejected',
      message: target.message,
    }, fetch)
  }

  const routerBin = process.env.WIKI_ROUTER_BIN
  if (!routerBin) {
    console.error('[RouteInbox] Error: WIKI_ROUTER_BIN is not set')
    return patchResult(documentUrl, request.subject, {
      status: 'error',
      routedAt: nowIso(),
      reason: 'router_not_configured',
      message: 'WIKI_ROUTER_BIN is not set on this host',
    }, fetch)
  }

  const outcome = await runRouter(routerBin, request)
  if (!outcome.ok) {
    return patchResult(documentUrl, request.subject, {
      status: 'error',
      routedAt: nowIso(),
      reason: outcome.reason,
      message: outcome.message,
    }, fetch)
  }

  if (outcome.payload.contract !== ROUTER_CONTRACT) {
    const actual = outcome.payload.contract
    console.error(
      `[RouteInbox] router contract mismatch: expected ${ROUTER_CONTRACT}, got ${String(actual)}`
    )
    return patchResult(documentUrl, request.subject, {
      status: 'error',
      routedAt: nowIso(),
      reason: 'router_contract_mismatch',
      message: `router speaks contract ${String(actual)}, this handler expects ${ROUTER_CONTRACT}`,
    }, fetch)
  }

  const result: ResultInput = {
    status: 'done',
    routedAt: nowIso(),
    payload: outcome.stdout,
  }

  const reliability = reliabilityOf(outcome.payload)
  if (reliability !== undefined) {
    result.reliability = reliability
  }

  const top = topCandidate(outcome.payload)
  if (top !== undefined) {
    result.top = top
  }

  return patchResult(documentUrl, request.subject, result, fetch)
}

interface DocumentRead {
  ok: true
  scan: DocumentScan
}

type DocumentReadResult = DocumentRead | { ok: false }

async function readDocument(documentUrl: string, fetch: SolidFetch): Promise<DocumentReadResult> {
  let body: string

  try {
    const response = await fetch(documentUrl, { headers: { accept: 'text/turtle' } })
    if (!response.ok) {
      console.error(`[RouteInbox] Error: cannot read ${documentUrl}: ${response.status}`)
      return { ok: false }
    }
    body = await response.text()
  } catch (error) {
    console.error(`[RouteInbox] Error: cannot read ${documentUrl}: ${messageOf(error)}`)
    return { ok: false }
  }

  if (Buffer.byteLength(body, 'utf8') > MAX_DOCUMENT_BYTES) {
    console.error(
      `[RouteInbox] Error: ${documentUrl} exceeds ${MAX_DOCUMENT_BYTES} bytes; refusing to parse it`
    )
    return { ok: false }
  }

  try {
    return { ok: true, scan: selectPending(body, documentUrl) }
  } catch (error) {
    console.error(`[RouteInbox] Error: ${messageOf(error)}`)
    return { ok: false }
  }
}

interface PatchOutcome {
  attempted: boolean
  ok: boolean
}

async function patchResult(
  documentUrl: string,
  subject: string,
  result: ResultInput,
  fetch: SolidFetch
): Promise<PatchOutcome> {
  let body: string

  try {
    body = resultPatch(subject, result)
  } catch (error) {
    console.error(`[RouteInbox] Error: cannot build a result patch for ${subject}: ${messageOf(error)}`)
    return { attempted: false, ok: false }
  }

  try {
    const response = await fetch(documentUrl, {
      method: 'PATCH',
      headers: { 'content-type': 'text/n3', accept: 'text/turtle' },
      body,
    })
    if (!response.ok) {
      console.error(`[RouteInbox] Error: failed to write a result for ${subject}: ${response.status}`)
      return { attempted: true, ok: false }
    }
    return { attempted: true, ok: true }
  } catch (error) {
    console.error(`[RouteInbox] Error: failed to write a result for ${subject}: ${messageOf(error)}`)
    return { attempted: true, ok: false }
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Copies the router's reliability only when this handler understands the value. */
function reliabilityOf(payload: Record<string, unknown>): 'ok' | 'low' | undefined {
  const value = payload.reliability
  return value === 'ok' || value === 'low' ? value : undefined
}

/**
 * Copies the first candidate subject only when it is an absolute http(s) IRI:
 * `resultPatch` writes it as a named node and refuses anything else.
 */
function topCandidate(payload: Record<string, unknown>): string | undefined {
  const candidates = payload.candidates
  if (!Array.isArray(candidates)) {
    return undefined
  }

  const first: unknown = candidates[0]
  if (typeof first !== 'object' || first === null) {
    return undefined
  }

  const subject = (first as Record<string, unknown>).subject
  if (typeof subject !== 'string') {
    return undefined
  }

  try {
    const parsed = new URL(subject)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined
    }
  } catch {
    return undefined
  }

  return subject
}

interface TargetRejected {
  ok: false
  message: string
}

interface TargetAllowed {
  ok: true
}

/**
 * Refuses targets the router must not fetch: anything that is not http(s), and
 * anything that names or resolves to a non-public address.
 */
async function checkTarget(raw: string): Promise<TargetAllowed | TargetRejected> {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, message: 'url is not parseable' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: `scheme ${parsed.protocol} is not allowed` }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) {
    return { ok: false, message: 'url has no host' }
  }
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    return { ok: false, message: `host ${host} is not routable on the public internet` }
  }

  if (isIP(host)) {
    return isBlockedAddress(host)
      ? { ok: false, message: `address ${host} is not public` }
      : { ok: true }
  }

  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    return { ok: false, message: `cannot resolve ${host}` }
  }
  if (!addresses.length) {
    return { ok: false, message: `cannot resolve ${host}` }
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return { ok: false, message: `${host} resolves to non-public address ${address}` }
    }
  }

  return { ok: true }
}

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) {
    return isBlockedAddress(mapped[1])
  }

  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 198 && (b === 18 || b === 19)) return true
    if (a === 192 && b === 0) return true
    if (a >= 224) return true
    return false
  }

  if (isIP(address) === 6) {
    const host = address.toLowerCase()
    if (host === '::' || host === '::1') return true
    if (host.startsWith('fc') || host.startsWith('fd')) return true
    if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true
    if (host.startsWith('ff')) return true
    return false
  }

  return false
}

interface RouterSuccess {
  ok: true
  /** The parsed contract envelope, used only to check the contract and pick fields. */
  payload: Record<string, unknown>
  /** The router's raw stdout, stored as the payload literal untouched. */
  stdout: string
}

interface RouterFailure {
  ok: false
  reason: FailureReason
  message: string
}

function runRouter(bin: string, request: RouterRequest): Promise<RouterSuccess | RouterFailure> {
  const args = ['route', request.url, '--json']
  if (request.context) {
    args.push('--context', request.context)
  }

  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: ROUTER_TIMEOUT_MS, maxBuffer: ROUTER_MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error) {
          const timedOut = Boolean((error as { killed?: boolean }).killed) ||
            (error as { code?: unknown }).code === 'ETIMEDOUT'
          resolve({
            ok: false,
            reason: timedOut ? 'router_timeout' : 'router_failed',
            message: timedOut
              ? `router did not finish within ${ROUTER_TIMEOUT_MS} ms`
              : `router exited with ${(error as { code?: unknown }).code ?? 'an error'}: ${String(stderr).trim().slice(0, 500)}`,
          })
          return
        }

        let payload: unknown
        try {
          payload = JSON.parse(stdout)
        } catch {
          resolve({
            ok: false,
            reason: 'router_failed',
            message: 'router output was not valid JSON',
          })
          return
        }

        if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
          resolve({
            ok: false,
            reason: 'router_contract_mismatch',
            message: 'router output must be a JSON object',
          })
          return
        }

        resolve({ ok: true, payload: payload as Record<string, unknown>, stdout })
      }
    )
  })
}
