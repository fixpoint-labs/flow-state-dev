# personal-knowledge-mcp › it persists a concept across stateless calls

**Issue:** FIX-855
**Outcome:** From an MCP client, a concept created in one stateless `tools/call` is readable in a *separate* `tools/call` for the same bearer principal — a durable, user-scoped, secured personal wiki over MCP — and an unauthenticated call is refused rather than silently served.
**Input:** `fixtures/concept.json` — a concept `id`/`type`/`title`/`body` and a `passphrase` embedded in the body. Held-out: the runner reads all fields from the fixture and hardcodes none, so swapping in a different valid concept must still pass a correct implementation.
**Signal:** request A's `create_concept` succeeds; a *separate* HTTP request B (fresh ephemeral session, same bearer principal — MCP v1 is stateless) calls `read_concept` and the response text contains the fixture's held-out `passphrase`, and a `list_concepts` call in that same separate request contains the fixture's `id`. A request with no `Authorization` header gets HTTP 401. All four must hold.
**Anti-game:** the gameable pass is asserting request A's own response (its echo would pass even if nothing persisted), or reading the PGlite store directly instead of through a second `tools/call` (that would prove the store works but not that MCP's stateless-session model actually routes call N+1 to the same principal's corpus), or asserting only `res.ok`/200 without checking the response body carries the held-out passphrase (a handler that silently no-ops and returns 200 would still pass a status-only check). The check does none of these — it parses request B's own JSON-RPC response text and greps it for the passphrase, and separately confirms the 401 negative.
**Model:** none — model-free. CRUD needs no LLM; the `knowledge` flow has no generator actions. `neverResolvesAModel()` is passed as the resolver so an accidental generator would fail loudly rather than silently calling a real model.
**Run:** `pnpm tsx goals/personal-knowledge-mcp/persists-a-concept-across-stateless-calls/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-08 | 561d855a (pre-FIX-855 commit; run against the FIX-855 working tree) | N/A — model-free | PASS | Real `serve()` host (`@flow-state-dev/node`) + real MCP transport adapter (`@flow-state-dev/mcp`) + PGlite-executor `postgresStores` (durable `prod` profile, real schema init) over the loopback socket. `create_concept` in request A; a separate request B's `read_concept` carried the held-out passphrase and `list_concepts` carried the id; unauthenticated `tools/call` returned 401. |
