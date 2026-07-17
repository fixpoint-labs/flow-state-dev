# @flow-state-dev/knowledge-hub (incubation lab)

The Knowledge Hub: an owner's personal knowledge system that captures whatever's on their mind, files it into long-term memory, and puts a standing workforce of specialist agents to work on it. This lab is the incubation slot for that concept (FIX-882–884).

The **capture layer** is now in place (FIX-882): a single `logActivity` MCP tool hands a piece of the owner's mental activity — a thought, journal fragment, task, memory, goal, decision, or topic of interest — into an **inbox** (a user-scoped resource collection). A deterministic, non-LLM **mailroom** pass stamps a wall-clock capture time and computes a sha256 fingerprint over the full capture tuple so an accidental double-submit is recognized rather than filed twice. No model runs at capture time. A `listInbox` read-back inspects what's pending. The follow-on issues build on this inbox:

- **FIX-882** ✅ — `logActivity` capture into the inbox with fast, deterministic triage (this).
- **FIX-883** — a cron sweeper + manager that batch-reviews the inbox and routes items into long-term OKF memory and workforce agent work.
- **FIX-884** — a personal workforce roster (project manager, researcher, editor, and more) that claims routed work by acceptance criteria.

> The hub's **inbox** is durable, user-scoped, and wall-clock aged — deliberately not the framework's `@flow-state-dev/memory` working-memory tier, which is session-scoped and decays/evicts over a turn counter. A sweep-later staging area must never silently drop a pending item, so it is a plain lab-local collection.

## What's here

| Piece | Where | Status |
| -- | -- | -- |
| Inbox collection (`inbox/**`, user-scoped) + record schema + key helpers | `src/inbox.ts` | FIX-882 |
| Mailroom pure helpers (normalize, fingerprint) | `src/mailroom.ts` | FIX-882 |
| `createContext` action (opens a conversation/topic, returns a `contextId`) | `src/flow.ts` | FIX-897 |
| `logActivity` capture action (now takes a required `contextId`) | `src/flow.ts` | FIX-882 / FIX-897 |
| `listInbox` inspection action | `src/flow.ts` | FIX-882 |
| Config (filesystem stores; MCP adapter mounted only when `KH_MCP_SECRET` is set) | `fsdev.config.ts` | FIX-882 |
| Real-path goal check (MCP HTTP: open context → group captures) | `scripts/goal-check-fix-897.mts` | FIX-897 |

## Run it

Capture is CLI-only by default — see the auth note below.

```bash
# Capture a piece of mental activity into the inbox. `contextId` is required —
# it groups related captures into one conversation (see "Grouping captures").
pnpm fsdev run knowledge-hub logActivity \
  -i '{"contextId":"ctx_demo","kind":"task","content":"Book dentist appointment","context":"Mentioned while planning the week in a Claude conversation"}'

# Inspect the pending inbox (items, counts, oldest age).
pnpm fsdev run knowledge-hub listInbox -i '{}'

# Tests.
pnpm test
```

The filesystem store persists across local runs (under `.fsdev/data`); remove it for a clean inbox. Re-running an identical capture returns the same id with `deduplicated: true` and does not add a second record.

### Grouping captures into a context (FIX-897)

MCP is sessionless, so by default every capture lands in its own throwaway
session. A **context** groups related captures under one conversation. A client
calls `createContext` once with a short topic description and gets back a
`contextId`, then passes that id on every `logActivity`:

```bash
# Over MCP: create_context mints a fresh ctx_… id and stores the description;
# log_activity with { session: { fromInput: "contextId" } } routes each capture
# into that same flow session, and the contextId is stamped on every inbox row.
```

This uses the framework's per-action `mcp.session` directive: `createContext`
declares `mcp: { session: "ctx_*" }` (mint a fresh id) and `logActivity`
declares `mcp: { session: { fromInput: "contextId" } }` (reuse the caller's id).
The session record *is* the context record — its state holds the description,
and the FIX-883 sweeper groups inbox rows by `contextId`. An unknown `contextId`
still succeeds (auto-vivified, no description); no capture is lost to a missing
`createContext`.

> The directive is only consulted on the MCP HTTP path. `fsdev run` supplies its
> own `--session`, so a CLI `logActivity` stores the `contextId` on the record
> but does not route the flow session by it. The real-path grouping is verified
> end-to-end by `scripts/goal-check-fix-897.mts`
> (`KH_MCP_SECRET=test-secret pnpm tsx scripts/goal-check-fix-897.mts`).

### Auth: HTTP access requires `KH_MCP_SECRET`

The flow **fails closed**. `logActivity` / `listInbox` are reachable over the CLI (`fsdev run`, which supplies its built-in `cli-user` principal in-process) with no secret. Every HTTP transport is closed until `KH_MCP_SECRET` is set: the per-flow principal resolver throws without it, and the MCP adapter (`POST /mcp/knowledge-hub`) is not even mounted. With the secret set, the MCP endpoint authenticates via a bearer token.

```bash
KH_MCP_SECRET=... pnpm serve       # fsdev serve: authenticated MCP endpoint (POST /mcp/knowledge-hub), no DevTool UI
KH_MCP_SECRET=... pnpm fsdev dev   # same endpoint plus the DevTool UI, for local inspection
```

With the secret set, `pnpm fsdev dev` also drives the flow's own `logActivity` /
`listInbox` actions **from DevTool** — the config's `devtool` block
(`{ userId: "owner", bearerToken: process.env.KH_MCP_SECRET }`) makes DevTool
create its session as `owner` and forward the secret as a bearer token, so the
flow's real resolver accepts it. No secret means no token is sent and the flow
stays CLI-only, unchanged.

Both hosts serve the dedicated `/mcp/*` route: `serve()` from `@flow-state-dev/node`
(which `fsdev serve` and `fsdev dev` both wrap) mounts dedicated adapter paths
automatically, so no extra host wiring is needed.

Hosted deployment and a durable shared store land with FIX-883, when a second process (the cron sweeper) actually needs them.

### Tagging the source per installation

`source` (the provenance of a capture) is wired as an **installation-level** value, not something the model fills in per call. The config passes `forwardQueryParams: ["source"]` to `createMcpTransportAdapter`, so each client points at its own tagged endpoint URL:

```
https://<host>/mcp/knowledge-hub?source=claude-desktop
```

Every `logActivity` from that installation then carries `source: "claude-desktop"`, authoritatively — the model can't override it. Omit the query param and `source` stays `null`. It remains part of the mailroom fingerprint, so the same capture from two different installations is two records (different provenance). See the [MCP Server docs](../../apps/docs/docs/server/mcp.md#installation-level-values-from-the-url) for the transport mechanics.

## Predecessor

The finished simple-wiki that used to hold this slot is now a frozen reference app at [`examples/knowledge-base`](../../examples/knowledge-base) — OKF import/export, concept CRUD, and a secured MCP server. The Knowledge Hub reuses that same OKF concept graph as its long-term-memory layer; the OKF code is extracted into a shared package when the first hub issue consumes it (FIX-883 — FIX-882 never touches the concept graph).
