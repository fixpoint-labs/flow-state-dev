# @flow-state-dev/knowledge-base (incubation lab)

An incubation lab for **FIX-813**: an [Open Knowledge Format (OKF)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) v0.1 interchange adapter and a thin `knowledgeBase` capability over the resource graph — hardened by **FIX-855** into a secured, user-scoped personal MCP server: a small always-on wiki that Claude (or any MCP client) can read, search, create, update, delete, and link concepts on, over a bearer-secured network connection.

This is **not a published package** (`private: true`). OKF v0.1 is a one-day-old proof-of-concept, and the typed-edge primitive it maps onto has only one other consumer (memory relations), so the adapter and capability are validated here against a first consumer before any graduation to a public `@flow-state-dev/*` package. The agent-facing content-navigation tools the same issue depends on (`globResources` / `grepResourceContent` / `searchResources`) already shipped in `@flow-state-dev/core` — this lab consumes them, it does not redefine them.

## What's here

| Piece | Where | Status |
| -- | -- | -- |
| OKF import/export adapter (`parseOkfBundle` / `importOkf` / `exportOkf`) | `src/okf/` | Incubated |
| Concept collection (OKF frontmatter → state, links → edges; `scope: "user"`) | `src/concepts.ts` | Incubated |
| `createKnowledgeBaseCapability()` — nav tools + CRUD `fns` (`listConcepts` / `readConcept` / `createConcept` / `updateConcept` / `deleteConcept` / `relate` / `importBundle` / `exportBundle`) | `src/capability.ts` | Incubated |
| MCP server flow (`knowledge`) — 8 CRUD/search tools over MCP, bearer-secret auth, CLI-only import/export | `src/flow.ts` | Lab MCP server |
| Standalone server entry (`serve()`, no app wrapper) | `src/server.ts` | Lab MCP server |
| Sample OKF bundle | `sample-bundle/` | Fixture |

## Run it

```bash
# Serve the MCP endpoint locally (in-memory dev profile, no secret required locally).
pnpm fsdev dev

# Mount an OKF bundle into the corpus from the CLI (model-free).
pnpm fsdev run knowledge importBundle -i '{"dir":"'"$(pwd)"'/sample-bundle"}'

# Back the corpus up to a portable OKF bundle directory.
pnpm fsdev run knowledge exportBundle -i '{"dir":"/tmp/kb-backup"}'

# Round-trip the sample bundle and check OKF v0.1 conformance + the link graph.
pnpm okf:smoke

# Unit tests, including the export -> import -> export idempotency gate and the
# real end-to-end MCP round-trip check (see "Verify it works" below).
pnpm test
```

## Use it as an MCP server

The `knowledge` flow exposes 8 tools over MCP at `POST /api/flows/knowledge/mcp`: `list_concepts`, `read_concept`, `search_concepts`, `grep_concepts`, `create_concept`, `update_concept`, `delete_concept`, `relate_concepts`. OKF `import_bundle`/`export_bundle` are **not** MCP tools — they take server-side filesystem paths, so exposing them over a hosted endpoint would let a remote client read/write/prune arbitrary host paths; they stay CLI-only (`pnpm fsdev run knowledge importBundle|exportBundle ...`).

Auth is a single bearer secret, read from `KB_MCP_SECRET`. A request with no `Authorization` header, or the wrong one, is rejected (401) — there is no anonymous fallback. Every request that authenticates resolves to the same principal (`owner`), which is what makes the corpus durable and shared across calls: MCP v1 is **stateless** (every `tools/call` runs in a fresh session), so a `scope: "user"` corpus keyed by that one principal is what lets call N+1 read call N's write.

```bash
curl -X POST http://localhost:3000/api/flows/knowledge/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KB_MCP_SECRET" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -X POST http://localhost:3000/api/flows/knowledge/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KB_MCP_SECRET" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
        "name":"create_concept",
        "arguments":{"id":"topics/react","type":"concept","title":"React","body":"Notes on React."}
      }}'
```

`search_concepts`/`grep_concepts` return scope-qualified uris (`user/concepts/<id>`); every id-taking tool (`read`/`update`/`delete`/`relate_concepts`) accepts either that uri or the bare id, so pasting a search result straight into an update/delete call works. `GET`/`DELETE` on the endpoint return 405 (MCP v1 is POST-only, tools-only — no MCP resources, no streaming).

## Stand it up

The standalone entry (`src/server.ts`) calls `serve()` from `@flow-state-dev/node` — no Next.js, no `app/`, no React. Deploy it to a long-lived host (Railway, Render, Fly, a container, a VPS):

```bash
KB_MCP_SECRET=<a-strong-secret> DATABASE_URL=<postgres-url> pnpm serve
```

`fsdev.config.ts` picks the `prod` (Postgres) profile automatically once `FSD_DB_URL` or `DATABASE_URL` is set, and **fails closed at config load** if `KB_MCP_SECRET` is missing on that profile — a deploy can never silently fall back to an unauthenticated resolver. With no Postgres URL set, it runs the `dev` profile (in-memory, no secret required) for local iteration. Provisioning the Postgres database and the host's project/secrets is a manual operator step; the lab ships the deployable code, not a live deployment.

## The OKF ↔ FSD mapping

| OKF (SPEC §3–§5) | FSD |
| -- | -- |
| Bundle directory | one resource collection (`conceptCollection`) |
| Concept `.md` (bundle-relative path) | collection instance, key = path |
| YAML frontmatter | instance state (Zod-validated, YAML 1.2) |
| required `type` | `state.type` |
| recommended `title` / `description` / `resource` / `tags` / `timestamp` | nullable state fields |
| unknown frontmatter keys | `state.extra` (preserved, re-emitted) |
| markdown body | content body (verbatim) |
| markdown link (untyped) | typed edge; import infers `type: "references"`, export emits a plain link |
| `index.md` | generated on export (with `okf_version`), reserved on import |
| `log.md` | reserved (excluded as a concept); not round-tripped in v0 |

Frontmatter is parsed as **YAML 1.2** (gray-matter on the eemeli `yaml` engine) so the "Norway problem" doesn't bite: `country: NO` stays the string `"NO"` and `enabled: on` stays `"on"` — values that YAML 1.1 would silently turn into booleans. Frontmatter that isn't a YAML mapping (a bare scalar or list) is treated as "no recognized fields" rather than crashing, per OKF's best-effort consumption rule.

## Verify it works

`pnpm test` (from this directory) runs the CI specs, including a real MCP round-trip against `createFlowApiRouter` (no real HTTP socket). For a stronger, real-path proof — the actual `serve()` host, over the loopback socket, backed by a real (PGlite) Postgres store — run the goal check:

```bash
pnpm tsx goals/personal-knowledge-mcp/persists-a-concept-across-stateless-calls/run.mts
```

It creates a concept in one HTTP request and reads it back in a genuinely separate request (MCP v1 is stateless — every `tools/call` is a fresh session), and confirms an unauthenticated request is refused. Model-free — no LLM credentials required. See `goals/personal-knowledge-mcp/persists-a-concept-across-stateless-calls/goal.md` for the outcome, signal, and verdict log.

## v0 scope and known limitations

These are deliberate for the incubation; each is a follow-up, not a bug:

- **Interchange only.** Import hydrates the split state/content model; export emits a bundle. No single-file-backed collection variant.
- **Import is sync, not merge.** Mounting a bundle makes the collection mirror it — concepts not in the incoming bundle are pruned, so a re-mount or a later export matches the mounted bundle rather than unioning prior mounts. This is why OKF import/export stay CLI-only, not MCP tools — a remote client calling them would prune the live corpus.
- **Edge metadata is lossy on export.** OKF links are untyped, so confidence / temporality / provenance on an edge are dropped. The round-trip idempotency gate asserts content + frontmatter + link structure, **not** edge metadata.
- **Links are body-resident.** Import projects body links into edges for navigation; the verbatim body still carries them, so export does not re-emit body links. A *programmatic* edge (added via `relate`, not present in the body) is materialized once into a trailing `# Related` section — which a re-import reads back, so a second export is byte-identical.
- **`log.md` is not round-tripped.** It is parsed and surfaced by `parseOkfBundle`, but not persisted on import or synthesized on export.
- **Lexical only.** Navigation is glob/grep/ranked-keyword. No embeddings — semantic recall is the memory / RAG job.
- **Concurrency is naive last-write-wins.** No optimistic locking on concept writes; acceptable for a single-owner personal wiki.
- **Auth is a single static bearer secret.** No rotation, no per-client keys, no sign-up/OAuth — the personal-use floor over the host's TLS. A leaked key exposes the whole corpus until manually rotated.
- **Isolation is native to `scope: "user"`, not yet exercised by a second key.** A second bearer principal would get an isolated corpus automatically (storage keys by `userId`), but v0 wires exactly one (`owner`); multi-user is a later config flip, not a redesign.
- **No MCP resources, no streaming.** v1 is tools-only, single-JSON results (`resources/list` is empty; `GET`/`DELETE` return 405). Fine for synchronous CRUD.
- **The Vercel/Next.js serverless posture is documented, not shipped.** The standalone `serve()` host is the only serving path this lab actually builds; a Vercel route handler is a viable alternative (stateless MCP + the same Postgres store work on either host) but is left for a future pass if a serverless deploy is wanted.

## Decision records

The two evaluation questions FIX-813 asked are answered in the [implementation spec](https://linear.app/fixpoint-labs/document/fix-813-portable-knowledge-base-format-okf-over-the-resource-graph-fd644e5eaa51) §11:

- **#4** — OKF is an external *interchange boundary*, not a new internal authoring surface. It does not merge or replace the SKILL.md / generator-prompt / resource-template `.md` surfaces.
- **#5** — Curated KB navigation reduces but does not eliminate vector RAG; they are complements routed by corpus shape. The RAG roadmap (FIX-72 / FIX-71) stays, scoped toward large/uncurated/fuzzy corpora.

## Graduation criteria

Promote the adapter + capability to a published package once there is a **second consumer** (Storyteller / FIX-759 is the intended one) **and** OKF has stabilized past v0.1.
