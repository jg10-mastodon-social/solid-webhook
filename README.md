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

**Optional:**
- `WIKI_ROUTER_BIN` - Path to the router CLI used by `RouteInbox`. No default;
  the handler stays disabled when unset. Relative paths resolve from the working
  directory.

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

### Offline reindex

`reindex-wiki` rebuilds `label-index.ttl` from local files instead of webhook
events. It never uses the network: pass either a pod URL or a local path plus
its pod URL.

```bash
npm run reindex-wiki -- --wiki https://pod.example.com/pod/notes/wiki/ --check
npm run reindex-wiki -- --wiki /path/to/notes/wiki \
  --pod-url https://pod.example.com/pod/notes/wiki/ --write --json
```

The default is a dry run. `--check` exits `1` when the index has drifted;
`--write` updates it atomically. Run with `--help` for all options.

## Route Inbox

`RouteInbox` lets a client ask this server where a URL belongs without running
the scoring logic itself. It is the async half of a two-part arrangement: the
router CLI (a separate checkout, configured with `WIKI_ROUTER_BIN`) owns the
index and the scoring; this handler owns the request lifecycle.

The `:topic` must be an **inbox container ending in `/inbox/`**. Requests are
JSON documents created in that container; results are written to the sibling
`outbox/` container under the same name. A request is one object:

```json
{
  "requestId": "req-a1b2c3d4",
  "url": "https://example.com/article",
  "requestedAt": "2026-11-07T00:00:00.000Z",
  "context": "optional extra context"
}
```

The `requestId` must match the resource name. Unknown fields, bodies over 8 KiB,
and non-http(s) URLs are refused. Before anything is fetched, the target host is
resolved and rejected if it names or resolves to a loopback, private,
link-local, or otherwise non-public address. At most one route runs at a time.

The result carries `status` plus, on success, the router's candidates and the
router's contract and index versions; on failure, a `reason`:

| `status` | `reason` |
|---|---|
| `done` | — |
| `error` | `invalid_request`, `url_rejected`, `router_not_configured`, `router_busy`, `router_failed`, `router_timeout`, `router_contract_mismatch` |

A request whose outbox item already holds a terminal result is ignored, so
duplicate notifications are harmless. The handler never writes outside the two
containers and never edits index or wiki content.

The router's JSON `contract` must equal the `ROUTER_CONTRACT` constant in
`src/handlers/routeInbox.ts`; a mismatch fails the request rather than
mis-reading the payload. See `docs/webhooks.ttl.example` for a registration.

## Identity Endpoints

The server uses solidIdentity from @soid/koa to provide identity routes. Custom endpoints:
- `/.well-known/openid-configuration` - OIDC configuration (no jwks_uri)
- `/webid` - Turtle WebID document with OIDC issuer


