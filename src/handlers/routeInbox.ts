import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { WebhookEvent, SolidFetch, HandlerContext, RouteInboxWebhook } from '../types/index.js'

/**
 * Version of the request/result contract understood by this handler.
 * Bump only on an incompatible change to the payload the router emits.
 */
export const ROUTER_CONTRACT = 1

const MAX_REQUEST_BYTES = 8192
const MAX_URL_LENGTH = 2048
const MAX_CONTEXT_LENGTH = 500
const ROUTER_TIMEOUT_MS = 30_000
const ROUTER_MAX_BUFFER = 4 * 1024 * 1024
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/
const ALLOWED_FIELDS = new Set(['requestId', 'url', 'requestedAt', 'context', 'status'])

type FailureReason =
  | 'invalid_request'
  | 'url_rejected'
  | 'router_not_configured'
  | 'router_busy'
  | 'router_failed'
  | 'router_timeout'
  | 'router_contract_mismatch'

interface RouteRequest {
  requestId: string
  url: string
  requestedAt?: string
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

  let outboxBase: string
  try {
    outboxBase = outboxFor(registration.topic)
  } catch (error) {
    console.error(`[RouteInbox] Error: ${(error as Error).message}`)
    return false
  }

  const pathId = requestIdFromPath(event.object)
  if (!pathId) {
    console.error(`[RouteInbox] Error: cannot derive a request id from ${event.object}`)
    return false
  }

  const resultUrl = `${outboxBase}${pathId}.json`

  const parsed = await readRequest(event.object, fetch)
  if (!parsed.ok) {
    await writeResult(fetch, resultUrl, {
      requestId: pathId,
      url: null,
      status: 'error',
      reason: 'invalid_request',
      message: parsed.message,
      routedAt: new Date().toISOString(),
    })
    return true
  }

  const request = parsed.request
  if (request.requestId !== pathId) {
    await writeResult(fetch, resultUrl, {
      requestId: pathId,
      url: request.url,
      status: 'error',
      reason: 'invalid_request',
      message: 'requestId does not match the inbox resource name',
      routedAt: new Date().toISOString(),
    })
    return true
  }

  if (await hasTerminalResult(resultUrl, fetch)) {
    console.log(`[RouteInbox] ${request.requestId} already has a result, skipping`)
    return false
  }

  const routerBin = process.env.WIKI_ROUTER_BIN
  if (!routerBin) {
    console.error('[RouteInbox] Error: WIKI_ROUTER_BIN is not set')
    await fail(fetch, resultUrl, event.object, request, 'router_not_configured', {
      message: 'WIKI_ROUTER_BIN is not set on this host',
    })
    return true
  }

  if (inFlight !== null) {
    console.log(`[RouteInbox] router busy with ${inFlight}, rejecting ${request.requestId}`)
    await fail(fetch, resultUrl, event.object, request, 'router_busy', {
      message: 'another route is in progress; retry shortly',
    })
    return true
  }

  inFlight = request.requestId
  try {
    const target = await checkTarget(request.url)
    if (!target.ok) {
      console.log(`[RouteInbox] rejected ${request.url}: ${target.message}`)
      await fail(fetch, resultUrl, event.object, request, 'url_rejected', { message: target.message })
      return true
    }

    const outcome = await runRouter(routerBin, request)
    if (!outcome.ok) {
      await fail(fetch, resultUrl, event.object, request, outcome.reason, {
        message: outcome.message,
      })
      return true
    }
    if (outcome.payload.contract !== ROUTER_CONTRACT) {
      const actual = outcome.payload.contract
      console.error(
        `[RouteInbox] router contract mismatch: expected ${ROUTER_CONTRACT}, got ${actual}`
      )
      await fail(fetch, resultUrl, event.object, request, 'router_contract_mismatch', {
        contract: typeof actual === 'number' ? actual : null,
        message: `router speaks contract ${String(actual)}, this handler expects ${ROUTER_CONTRACT}`,
      })
      return true
    }

    await writeResult(fetch, resultUrl, {
      ...outcome.payload,
      requestId: request.requestId,
      url: request.url,
      status: 'done',
      routedAt: new Date().toISOString(),
    })
    await markInboxItem(fetch, event.object, request, 'done')
    console.log(`[RouteInbox] completed: true`)
    return true
  } finally {
    inFlight = null
  }
}

function findRegistration(event: WebhookEvent, context?: HandlerContext): RouteInboxWebhook | undefined {
  const topic = normaliseTopic(event.topic)
  return context?.registrations?.find(
    (r): r is RouteInboxWebhook => r.handler === 'RouteInbox' && normaliseTopic(r.topic) === topic
  )
}

function normaliseTopic(topic: string): string {
  return topic.endsWith('/') ? topic : `${topic}/`
}

function outboxFor(inboxTopic: string): string {
  const topic = normaliseTopic(inboxTopic)
  if (!topic.endsWith('/inbox/')) {
    throw new Error(`RouteInbox topic must be an inbox container ending in /inbox/: ${inboxTopic}`)
  }
  return `${topic.slice(0, -'inbox/'.length)}outbox/`
}

function requestIdFromPath(objectUrl: string): string | null {
  let path: string
  try {
    path = new URL(objectUrl).pathname
  } catch {
    return null
  }
  const name = decodeURIComponent(path.split('/').pop() ?? '').replace(/\.json$/, '')
  return REQUEST_ID_PATTERN.test(name) ? name : null
}

interface RequestReadError {
  ok: false
  message: string
}

async function readRequest(
  objectUrl: string,
  fetch: SolidFetch
): Promise<{ ok: true; request: RouteRequest } | RequestReadError> {
  const response = await fetch(objectUrl, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) {
    return { ok: false, message: `cannot read inbox item: ${response.status}` }
  }

  const body = await response.text()
  if (body.length > MAX_REQUEST_BYTES) {
    return { ok: false, message: `request body exceeds ${MAX_REQUEST_BYTES} bytes` }
  }

  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return { ok: false, message: 'request body is not valid JSON' }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'request body must be a JSON object' }
  }

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, message: `unexpected field: ${key}` }
    }
  }

  const { requestId, url, requestedAt, context } = record
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return { ok: false, message: 'requestId is missing or malformed' }
  }
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) {
    return { ok: false, message: 'url is missing or too long' }
  }
  if (requestedAt !== undefined && typeof requestedAt !== 'string') {
    return { ok: false, message: 'requestedAt must be a string' }
  }
  if (context !== undefined && (typeof context !== 'string' || context.length > MAX_CONTEXT_LENGTH)) {
    return { ok: false, message: `context must be a string of at most ${MAX_CONTEXT_LENGTH} characters` }
  }

  return { ok: true, request: { requestId, url, requestedAt, context } }
}

async function hasTerminalResult(resultUrl: string, fetch: SolidFetch): Promise<boolean> {
  const response = await fetch(resultUrl, { method: 'GET', headers: { accept: 'application/json' } })
  if (!response.ok) {
    return false
  }
  try {
    const existing = JSON.parse(await response.text()) as { status?: string }
    return existing.status === 'done' || existing.status === 'error'
  } catch {
    return false
  }
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
  payload: {
    contract?: number
    [key: string]: unknown
  }
}

interface RouterFailure {
  ok: false
  reason: FailureReason
  message: string
}

function runRouter(bin: string, request: RouteRequest): Promise<RouterSuccess | RouterFailure> {
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
        try {
          const payload = JSON.parse(stdout) as RouterSuccess['payload']
          resolve({ ok: true, payload })
        } catch {
          resolve({
            ok: false,
            reason: 'router_failed',
            message: 'router output was not valid JSON',
          })
        }
      }
    )
  })
}

/**
 * Envelope fields the client depends on. Everything else in a success result is
 * the router's own `route --json` payload, passed through untouched so the
 * agent reads exactly what the CLI prints.
 */
interface ResultPayload {
  requestId: string
  url: string | null
  status: 'done' | 'error'
  reason?: FailureReason
  message?: string
  contract?: number | null
  routedAt: string
  [key: string]: unknown
}

async function writeResult(fetch: SolidFetch, resultUrl: string, payload: ResultPayload): Promise<void> {
  const response = await fetch(resultUrl, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    console.error(`[RouteInbox] Error: failed to write result: ${response.status}`)
    return
  }
  console.log(`[RouteInbox] wrote result ${payload.status}${payload.reason ? ` (${payload.reason})` : ''}`)
}

async function fail(
  fetch: SolidFetch,
  resultUrl: string,
  itemUrl: string,
  request: RouteRequest,
  reason: FailureReason,
  extra: { message?: string; contract?: number | null } = {}
): Promise<void> {
  await writeResult(fetch, resultUrl, {
    requestId: request.requestId,
    url: request.url,
    status: 'error',
    reason,
    message: extra.message,
    contract: extra.contract,
    routedAt: new Date().toISOString(),
  })
  await markInboxItem(fetch, itemUrl, request, 'error')
}

async function markInboxItem(
  fetch: SolidFetch,
  itemUrl: string,
  request: RouteRequest,
  status: 'done' | 'error'
): Promise<void> {
  const body = {
    ...request,
    status,
    routedAt: new Date().toISOString(),
  }
  try {
    const response = await fetch(itemUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      console.error(`[RouteInbox] Error: failed to update inbox item: ${response.status}`)
    }
  } catch (error) {
    console.error(`[RouteInbox] Error: failed to update inbox item: ${(error as Error).message}`)
  }
}
