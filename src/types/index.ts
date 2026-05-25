export interface WebhookRegistration {
  topic: string
  callback: WebhookHandler
  actor?: string
}

export interface SubscriptionInfo {
  id: string
  receiveFrom: string
  topic: string
}

export interface TrackedSubscription {
  id: string
  receiveFrom: string
  topic: string
  status: 'active' | 'failed'
  error?: string
}

export interface WebhookEvent {
  type: 'Add' | 'Remove' | 'Update'
  object: string
  topic: string
  raw: unknown
}

export type SolidFetch = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

export interface HandlerContext {
  registrations?: WebhookRegistration[]
  subscriptions?: TrackedSubscription[]
  sendToUrl?: string
  handlerBaseUrl?: string
  handlers?: Record<string, WebhookHandler>
}

export type WebhookHandler = (
  event: WebhookEvent,
  fetch: SolidFetch,
  context?: HandlerContext
) => void | Promise<void>

export interface Config {
  webId: string
  issuer: string
  baseUrl: string
  webhookEndpoint: string
  port: number
  sendToUrl: string
  whitelistedIssuers: string[]
  webhookConfigUrl: string
  handlerBaseUrl: string
  adminWebId: string
  skolemizeBase?: string
}

export interface InboxCollection {
  id: string
  type: string
  first?: string
  last?: string
  totalItems?: number
}

export interface InboxPage {
  id: string
  type: string
  partOf: string
  items?: string[]
  orderedItems?: unknown[]
}

export interface ActivityStreamsObject {
  type: string | string[]
  id?: string
  actor?: string | string[]
  object?: unknown
  [key: string]: unknown
}

export interface PageInfo {
  itemCount: number
  isFull: boolean
}

declare module 'koa' {
  interface DefaultState {
    webId?: string
    clientId?: string
  }
  interface DefaultContext {
    registrations?: WebhookRegistration[]
    subscriptions?: TrackedSubscription[]
    sendToUrl?: string
    handlerBaseUrl?: string
  }
}
