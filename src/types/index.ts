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
