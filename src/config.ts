import { Parser, Store } from 'n3'
import type { Config, WebhookRegistration } from './types/index.js'

export interface ParsedWebhook {
  topic: string
  handler: string
  actor?: string
}

export function loadConfig(): Config {
  const webId = process.env.WEBID
  const issuer = process.env.ISSUER
  const whitelistedIssuersStr = process.env.WHITELISTED_ISSUERS
  const webhookConfigUrl = process.env.WEBHOOK_CONFIG_URL
  const handlerBaseUrl = process.env.HANDLER_BASE_URL
  const baseUrl = process.env.BASE_URL

  if (!webId) {
    throw new Error('WEBID is required')
  }
  if (!issuer) {
    throw new Error('ISSUER is required')
  }
  if (!whitelistedIssuersStr) {
    throw new Error('WHITELISTED_ISSUERS is required')
  }
  if (!webhookConfigUrl) {
    throw new Error('WEBHOOK_CONFIG_URL is required')
  }
  if (!handlerBaseUrl) {
    throw new Error('HANDLER_BASE_URL is required')
  }
  if (!baseUrl) {
    throw new Error('BASE_URL is required')
  }

  const whitelistedIssuers = whitelistedIssuersStr.split(',').map((s) => s.trim())

  return {
    webId,
    issuer,
    baseUrl,
    webhookEndpoint: process.env.WEBHOOK_ENDPOINT || '/webhook',
    port: parseInt(process.env.PORT || '8081', 10),
    sendToUrl: process.env.SEND_TO_URL || '',
    whitelistedIssuers,
    webhookConfigUrl,
    handlerBaseUrl,
  }
}

export async function parseWebhooksFromRDF(
  rdfContent: string,
  handlerBaseUrl: string
): Promise<ParsedWebhook[]> {
  if (!rdfContent.trim()) {
    return []
  }

  const parser = new Parser()
  const store = new Store()
  
  return new Promise((resolve, reject) => {
    parser.parse(rdfContent, (error, quad, prefixes) => {
      if (error) {
        reject(new Error(`RDF parse error: ${error.message}`))
        return
      }
      if (quad) {
        store.addQuad(quad)
      } else {
        const webhooks: ParsedWebhook[] = []
        const webhookQuads = store.getQuads(null, null, null, null)
        const typePredicate = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
        const webHookType = `${handlerBaseUrl}WebHook`
        const topicPredicate = `${handlerBaseUrl}topic`
        const handlerPredicate = `${handlerBaseUrl}handler`
        const actorPredicate = `${handlerBaseUrl}actor`
        
        for (const quad of webhookQuads) {
          if (
            quad.predicate.value === typePredicate &&
            quad.object.value === webHookType
          ) {
            const webhookUri = quad.subject.value
            const topicQuads = store.getQuads(webhookUri, topicPredicate, null, null)
            const handlerQuads = store.getQuads(webhookUri, handlerPredicate, null, null)
            const actorQuads = store.getQuads(webhookUri, actorPredicate, null, null)

            if (topicQuads.length > 0 && handlerQuads.length > 0) {
              const topic = topicQuads[0].object.value
              const handlerUri = handlerQuads[0].object.value
              const hashIndex = handlerUri.lastIndexOf('#')
              const handlerName = hashIndex !== -1 ? handlerUri.slice(hashIndex + 1) : handlerUri
              const actor = actorQuads.length > 0 ? actorQuads[0].object.value : undefined

              webhooks.push({ topic, handler: handlerName, actor })
            }
          }
        }
        resolve(webhooks)
      }
    })
  })
}

export function createWebhookRegistrations(
  parsedWebhooks: ParsedWebhook[],
  handlers: Record<string, (event: import('./types/index.js').WebhookEvent) => void | Promise<void>>
): WebhookRegistration[] {
  return parsedWebhooks.map((pw) => ({
    topic: pw.topic,
    callback: handlers[pw.handler] || (() => { throw new Error(`Unknown handler: ${pw.handler}`) }),
    actor: pw.actor,
  }))
}
