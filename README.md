# solid-webhook

Solid pod webhook listener server built with Koa and @soid/koa.

## Features

- WebhookChannel2023 subscription to Solid pods
- DPoP authentication middleware
- RDF-based webhook configuration
- Inbox event handlers

## Prerequisites

- Node.js 18+

## Installation

```bash
npm install
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `WEBID` - Your Solid WebID
- `ISSUER` - OIDC issuer (must be in WHITELISTED_ISSUERS)
- `WHITELISTED_ISSUERS` - Comma-separated list of allowed issuers

Optional variables:
- `WEBHOOK_ENDPOINT` - Webhook endpoint path (default: /webhook)
- `PORT` - Server port (default: 8081)
- `SEND_TO_URL` - URL where webhooks are received

### Webhook Registration (RDF)

See `docs/webhooks.ttl.example` for the RDF schema format. Store your webhook configuration on a Solid pod and load it at runtime.

## Usage

### Basic Server

```typescript
import { createApp, subscribeAll, startServer } from './src/index.js'
import { createSolidFetch } from './src/services/solidFetch.js'
import { handleInboxModified } from './src/handlers/inboxModified.js'
import { parseWebhooksFromRDF } from './src/config.js'
import { loadConfig } from './src/config.js'

const config = loadConfig()

const fetchFn = await createSolidFetch(config.webId, config.issuer)

// Load webhook registrations from RDF
const webhooks = await parseWebhooksFromRDF(rdfContent, 'https://example.com/handlers')
const registrations = webhooks.map(w => ({
  topic: w.topic,
  callback: (event) => handleInboxModified(event, fetchFn),
}))

// Create and start server
const app = await createApp(config, registrations)
const subscriptions = await subscribeAll(registrations, fetchFn, config.sendToUrl)

await startServer(app, config.port)
```

### Command Line

```bash
node --env-file=.env dist/index.js
```

## Testing

```bash
npm test        # Run all tests
npm run typecheck  # Check TypeScript
```

## Architecture

- `src/index.ts` - Koa server with identity endpoints and subscription management
- `src/middleware/dpopAuth.ts` - DPoP token verification with JTI replay protection
- `src/services/webhookChannel.ts` - WebhookChannel2023 subscription/unsubscription
- `src/services/solidFetch.ts` - Authenticated fetch using @soid/koa
- `src/handlers/inboxModified.ts` - Inbox event processing
- `src/config.ts` - Environment variable loading and RDF webhook parsing
- `src/types/index.ts` - TypeScript interfaces

## Identity Endpoints

The server automatically serves:
- `/.well-known/openid-configuration` - OIDC configuration
- `/jwks` - JSON Web Key Set for token verification
- `/webid` - Turtle WebID document with OIDC issuer

## Security

- DPoP tokens are validated for htu (target URL), htm (HTTP method), and issuer
- JTI values are tracked to prevent replay attacks
- Only whitelisted issuers are accepted