# solid-webhook

![No maintenance intended](https://img.shields.io/badge/no_maintenance_intended-orange) ![Code quality: TDD vibe coded](https://img.shields.io/badge/code_quality-TDD_vibe_coded-orange)

Solid pod webhook listener server built with Koa and @soid/koa.

## Features

- WebhookChannel2023 subscription to Solid pods
- DPoP authentication middleware
- RDF-based webhook configuration
- Inbox event handlers
- Solid OIDC identity via @soid/koa solidIdentity

## Prerequisites

- Node.js 18+

## Installation

```bash
npm install
npm run build
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

**Required:**
- `WHITELISTED_ISSUERS` - Comma-separated list of allowed OIDC issuers
- `WEBHOOK_CONFIG_URL` - URL to load webhook RDF configuration from
- `HANDLER_BASE_URL` - Namespace prefix for handler types (must end with #)
- `BASE_URL` - Base URL for this server (used as issuer, webid origin, and callback URL)

**Optional:**
- `WEBID` - Solid WebID of this server (default: `<BASE_URL>/webid`)
- `ISSUER` - OIDC issuer (default: `<BASE_URL>`)
- `ADMIN_WEBID` - WebID for /subscriptions admin access (default: empty = all access denied)
- `SEND_TO_URL` - URL where webhooks are received (default: `<BASE_URL><WEBHOOK_ENDPOINT>`)
- `WEBHOOK_ENDPOINT` - Webhook endpoint path (default: /webhook)
- `PORT` - Server port (default: 8081)

### Webhook Registration (RDF)

See `docs/webhooks.ttl.example` for the RDF schema format. Store your webhook configuration on a Solid pod and load it at runtime.

## Usage

```bash
npm start
```
## Testing

```bash
npm test        # Run all tests
npm run typecheck  # Check TypeScript
```

## Architecture

- `src/index.ts` - Koa server with identity endpoints and subscription management
- `src/middleware/solidAuth.ts` - DPoP token verification using @solid/access-token-verifier
- `src/services/webhookChannel.ts` - WebhookChannel2023 subscription/unsubscription
- `src/services/solidFetch.ts` - Authenticated fetch using @soid/koa
- `src/handlers/inboxModified.ts` - Inbox event processing
- `src/config.ts` - Environment variable loading and RDF webhook parsing
- `src/types/index.ts` - TypeScript interfaces

## Identity Endpoints

The server uses solidIdentity from @soid/koa to provide identity routes. Custom endpoints:
- `/.well-known/openid-configuration` - OIDC configuration (no jwks_uri)
- `/webid` - Turtle WebID document with OIDC issuer


