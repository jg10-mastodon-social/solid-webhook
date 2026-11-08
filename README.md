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
- `WIKI_ROUTER_NOTES`, `WIKI_ROUTER_HOME`, `WIKI_ROUTER_POD_BASE` - Read by the
  router CLI itself, which inherits this process's environment. `NOTES` and
  `HOME` are required by the CLI; `POD_BASE` is optional.

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

The `:topic` is **one RDF document**, not a container. Requests and results both
live in it: a caller adds request triples, this handler adds result triples to
the same subject. One document is one queue, and a caller can read the whole
queue in a single GET.

The document uses the `wiki-router` namespace,
`https://pod.josephguillaume.id.au/ns/wiki-router#` (`wr:` below). A request is a
subject inside the document, named `<#req-…>`, with a URL and optionally a
timestamp and some context:

```turtle
@prefix wr: <https://pod.josephguillaume.id.au/ns/wiki-router#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<#req-a1b2c3d4> wr:url "https://example.com/article" ;
  wr:requestedAt "2026-11-07T00:00:00.000Z"^^xsd:dateTime ;
  wr:context "optional extra context" .
```

The fragment must look like `#req-` followed by 8 to 64 characters of
`[A-Za-z0-9_-]`, the first of them a letter or digit. `wr:url` is required and
must be a single literal of at most 2048 characters; `wr:requestedAt` must be an
`xsd:dateTime` or an ISO 8601 instant and decides the order requests are routed
in; `wr:context` must be a single literal of at most 500 characters.

**Pending means `wr:url` present and `wr:routedAt` absent.** A caller writes
only the request, never a status, so there is nothing for the server to replace
or to disagree about: once `wr:routedAt` is on the subject, it is terminal and
is never routed again. That also makes duplicate notifications harmless.

The handler answers by inserting result triples on the same subject:

- `wr:status` — `"done"` or `"error"`
- `wr:routedAt` — the write time, as `xsd:dateTime`; this is what makes the
  subject terminal
- `wr:reliability` — `"ok"` or `"low"`, only when the router reports one of those
- `wr:top` — the first candidate's subject, only when it is an absolute http(s) IRI
- `wr:payload` — the router's `route --json` stdout, verbatim, with its own
  newlines and quoting. A caller reads exactly what the CLI printed.
- on error, `wr:reason` and `wr:message` instead of `wr:reliability`/`wr:top`/`wr:payload`

The answer is an N3 Patch insert sent as `text/n3`:

```n3
@prefix wr: <https://pod.josephguillaume.id.au/ns/wiki-router#> .

_:p <http://www.w3.org/ns/solid/terms#inserts> {
  <#req-a1b2c3d4> wr:status "done" ;
    wr:routedAt "2026-11-07T00:00:03.120Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> ;
    wr:reliability "ok" ;
    wr:top <https://pod.example.com/pod/notes/pages/solar> ;
    wr:payload "…the router's route --json stdout, verbatim…" .
} .
```

Writes are insert-only. Nothing is ever replaced or deleted, so a PATCH cannot
clobber a concurrent writer: another client adding a request, or the handler
adding a second result, both just add triples. After each accepted PATCH the
handler re-reads the document and only continues if that subject is no longer
pending; an accepted write that does not show up stops the run.

At most one route runs at a time — the scoring index is large and each route
loads it. A run routes at most three requests and stops there; the remaining
pending requests are left alone and drained by the next notification, which
finds them by the same rule. Unusable subjects are answered with one error each
before any routing, so a document full of malformed requests gets all of its
errors in a single pass. A document over 1 MiB is refused unparsed rather than
loaded.

Before anything is fetched, the target host is resolved and rejected if it names
or resolves to a loopback, private, link-local, or otherwise non-public address,
and anything that is not http(s) is refused. The router's JSON `contract` must
equal the `ROUTER_CONTRACT` constant in `src/handlers/routeInbox.ts` (1 today); a
mismatch fails the request rather than mis-reading the payload.

Reasons written on an error:

| `wr:status` | `wr:reason` |
|---|---|
| `done` | none |
| `error`, routing failure | `url_rejected`, `router_not_configured`, `router_failed`, `router_timeout`, `router_contract_mismatch` |
| `error`, request shape | `request_id_malformed`, `url_too_long`, `url_duplicate`, `url_not_literal`, `url_empty`, `context_too_long`, `requested_at_invalid` |

A request-shape error is written once so the same broken subject is not reported
again. A subject that is not inside the topic document is only logged
(`not_in_document`) and never written about, because that would edit a document
this handler does not own. There is also a defensive `url_missing` entry in the
parser; it is unreachable, since a subject only becomes a request when it has a
`wr:url`.

Retention is the consumer's job. The handler never deletes triples: applied
subjects stay in the document until the consumer removes them, or someone prunes
the file. Removing a subject and its results is safe at any time — a subject
without `wr:url` is not pending, and a subject without `wr:routedAt` is simply
routed again. The handler never edits index or wiki content.

See `docs/webhooks.ttl.example` for a registration.

## Identity Endpoints

The server uses solidIdentity from @soid/koa to provide identity routes. Custom endpoints:
- `/.well-known/openid-configuration` - OIDC configuration (no jwks_uri)
- `/webid` - Turtle WebID document with OIDC issuer


