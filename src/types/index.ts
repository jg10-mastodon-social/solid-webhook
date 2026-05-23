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

export interface WebhookEvent {
  type: 'Add' | 'Remove'
  object: string
  topic: string
  raw: unknown
}

export type SolidFetch = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

export type WebhookHandler = (event: WebhookEvent) => void | Promise<void>

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
}

declare module 'koa' {
  interface DefaultState {
    webId?: string
    clientId?: string
  }
  interface DefaultContext {
    registrations?: WebhookRegistration[]
  }
}
