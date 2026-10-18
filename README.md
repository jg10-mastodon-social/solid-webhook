# solid-webhook

![No maintenance intended](https://img.shields.io/badge/no_maintenance_intended-orange) ![Code quality: TDD vibe coded](https://img.shields.io/badge/code_quality-TDD_vibe_coded-orange)

Solid pod webhook listener server built with Koa and @soid/koa.

Fetches a webhook configuration specifying resources to subscribe to and handlers to dispatch when a notification is received.

Permissions need to be granted to the agent's webid.

## Features

- WebhookChannel2023 subscription to Solid pods
- Agent-hosted webid - grant permissions rather than logging in
- RDF-based webhook configuration
- Only accepts notifications from whitelisted pods
- DPoP authentication middleware
- Inbox event handlers
- Solid OIDC identity via @soid/koa solidIdentity
- Admin summary page /subscriptions
- Listens to additions to webhook configuration

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
- `BASE_URL` - Base URL for this server (used for issuer, webid origin, and callback URL)
- `WEBHOOK_CONFIG_URL` - URL to load webhook RDF configuration from
- `WHITELISTED_ISSUERS` - Comma-separated list of allowed OIDC issuers
- `HANDLER_BASE_URL` - Namespace prefix for handler types (must end with #)

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

- `src/main.ts` - CLI entry point and startup sequence (createApp → startServer → createSolidFetch → fetch config → subscribe)
- `src/index.ts` - Koa server with identity endpoints and subscription management
- `src/config.ts` - Environment variable loading and RDF webhook parsing
- `src/middleware/solidAuth.ts` - DPoP token verification using @solid/access-token-verifier
- `src/services/webhookChannel.ts` - WebhookChannel2023 subscription/unsubscription
- `src/services/solidFetch.ts` - Authenticated fetch using @soid/koa
- `src/handlers/` - Webhook event handlers
- `src/types/index.ts` - TypeScript interfaces

## Wiki Indexer

`WikiIndexer` writes page labels to an RDF index. Solid notifications only cover
direct children of a subscribed container, so the server discovers descendant
containers at startup and subscribes to new ones as they are added.

`:maxDepth` controls how deep the indexer watches: `0` indexes root-level pages
only, `1` (the default) includes immediate subfolders, and higher values add
more levels. See `docs/webhooks.ttl.example` for a configuration example.

## Identity Endpoints

The server uses solidIdentity from @soid/koa to provide identity routes. Custom endpoints:
- `/.well-known/openid-configuration` - OIDC configuration (no jwks_uri)
- `/webid` - Turtle WebID document with OIDC issuer


