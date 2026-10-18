# solid-webhook

See `README.md` for architecture, key files, and usage.

## Working Agreement

- For non-trivial changes, agree on the design before writing code. Update
  `README.md` or `docs/` when user-facing behaviour changes.
- Follow TDD: write the failing test first, implement the minimum needed to pass,
  then verify.
- Never commit a knowingly failing test. Keep a test and its implementation in
  the same commit.
- Keep changes scoped to the requested behaviour. Do not refactor unrelated code
  in the same cycle. Behaviour-preserving refactors may be committed separately.
- Never commit secrets or generated artifacts. `.env`, `dist/`, and `coverage/`
  are ignored; `package-lock.json` is tracked intentionally.
- Commit once per verified cycle, after review.

## Cycle Workflow

1. **Design.** For a sizeable change, describe the target behaviour and get
   agreement before coding.
2. **Red.** Write the failing test for the cycle and confirm it fails for the
   intended reason.
3. **Green.** Implement the minimum needed to pass without unrelated changes.
4. **Verify.** Run `npm run typecheck`, the targeted test file, then
   `npm run test:run` and `npm run build`.
5. **Review.** Inspect the diff. Optionally use the `review` subagent for a
   second opinion.
6. **Commit.** One logical conventional commit after verification and review.

## Subagent Delegation

- Delegate each implementation cycle to the `general` subagent via the Task
  tool. Use `explore` for codebase discovery and `review` for the review step
  when useful.
- The delegation prompt must include:
  - the cycle goal and the context already present in the repo;
  - the exact red test(s) to write first and why they fail;
  - the files in bounds (and files that are off limits);
  - the commands to observe red then green;
  - the constraints (no commit, no unrelated edits, repo style);
  - the required report format (files, test results, typecheck, deviations).
- Subagents must not commit. The orchestrating agent reviews the result and
  commits.
- Fall back to implementing directly only if the subagent is unavailable, and
  note the fallback in the final summary.

## Commit Conventions

`type(scope): subject`, imperative, lower case, no trailing period.

- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
- **Scopes used here:** `wikiIndexer`, `config`, `subscriptions`, `handlers`,
  `inbox`, `auth`, `build`, `deps`.

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
- `WHITELISTED_ISSUERS` - Comma-separated issuers; enforced in `solidAuth.ts` (403 if token `iss` not in list)
- `WEBHOOK_CONFIG_URL` - URL to load RDF webhook config from
- `HANDLER_BASE_URL` - Base URL for handler namespace (e.g., `https://example.com/handlers#`)

## Build Output

TypeScript compiles to `dist/src/` (not `dist/`). The entry point is `dist/src/main.js`.

## Testing Notes

Tests live alongside source in `tests/` directory, mirroring `src/` structure. Run
`npm test` for watch mode, `npm run test:run` for CI.

- Mock `@soid/koa` to avoid real network calls in tests
- n3 `Parser.parse()` returns array synchronously, but callback mode is used for `Store.addQuad()`
- Config tests use `vi.resetModules()` to reload env vars between tests
