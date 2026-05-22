# solid-webhook

## Commands

```bash
npm run build      # Compile TypeScript to dist/src/
npm run typecheck  # TypeScript check (no emit)
npm start          # Run server (requires .env with all required vars)
npm run dev        # build + start
npm test           # Watch mode (vitest)
npm run test:run   # Single run
```

## Required Environment Variables

- `WEBID` - Solid WebID
- `ISSUER` - OIDC issuer
- `WHITELISTED_ISSUERS` - Comma-separated issuers
- `WEBHOOK_CONFIG_URL` - URL to load RDF webhook config from
- `HANDLER_BASE_URL` - Base URL for handler namespace (e.g., `https://example.com/handlers#`)

## Build Output

TypeScript compiles to `dist/src/` (not `dist/`). The entry point is `dist/src/main.js`.

## TDD Approach

Tests live alongside source in `tests/` directory, mirroring `src/` structure. Run `npm test` for watch mode, `npm run test:run` for CI.

## Key Files

- `src/main.ts` - CLI entry point (blocks forever after server start)
- `src/index.ts` - `run()` blocks with never-resolving promise
- `src/config.ts` - `loadConfig()` reads all env vars, `parseWebhooksFromRDF()` parses Turtle RDF
- `src/middleware/dpopAuth.ts` - DPoP verification (htu, htm, iss, jti dedup)
- `src/services/webhookChannel.ts` - WebhookChannel2023 subscribe/unsubscribe

## Testing Notes

- Mock `@soid/koa` to avoid real network calls in tests
- n3 `Parser.parse()` returns array synchronously, but callback mode is used for `Store.addQuad()`
- Config tests use `vi.resetModules()` to reload env vars between tests