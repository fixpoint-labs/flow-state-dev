# Architecture Overview

These docs record what **can't be recovered by reading the code or the user docs**: invariants, contracts between packages, security boundaries, and why a design is the way it is. How to use the framework is in [`apps/docs`](../../apps/docs/docs/intro.md); signatures are the published types. If a section here only restates either, it belongs there instead.

## Package boundaries

Locked. `scripts/validate-package-boundaries.mjs` enforces the per-package allow/deny lists; it is the source of truth when this table and it disagree.

| Package | Rule |
|---|---|
| `contracts` | Imports no workspace package, declares no dependencies. Holds the item taxonomy, its pure helpers and leaf types. `core` re-exports every symbol from its original path |
| `core` | Isomorphic; no platform code (e.g. no Node `crypto`, which is why webhook verification lives in `engine`). Value-imports `contracts` |
| `engine` | Never depends on `client` or `react` |
| `client` | Never depends on `engine` or `react`; works in any JS environment. Value-imports `contracts` helpers rather than hand-mirroring them; type-only on `core` |
| `react` | No transport logic: wraps `client` |
| `fsdev` (`packages/cli`) | Leaf consumer on an allow-list (`engine`, `testing`, stores, `workforce`, …); never `client` or `react` |
| `apps/devtool` | Public `client` and `react` APIs only |

The rest of the packages are listed in the root `CLAUDE.md`.

## Request path

1. `POST` returns `202` immediately; execution is async (in-process hosts may stream inline instead).
2. Items stream over SSE as blocks run; the request stream resumes from a sequence cursor (`Last-Event-ID` or `starting_after`), the session stream from a time cursor (`?since=`).
3. **On `request.completed` the client refetches the state snapshot.** The stream is live; the snapshot is authoritative.

Execution order and hook timing: [Flows and Actions](./flows-and-actions.md#request-execution-order). Stream contracts: [Streaming](./streaming.md).

## Locked contracts

Changing any of these needs architecture review:

- Block kinds are exactly `handler`, `generator`, `evaluator`, `sequencer`, `router`.
- Actions are flow-level (`defineFlow({ actions })`); other entry forms are in [Action Forms](./action-forms.md).
- Required caller input: `userId`.
- Stream model: item/content lifecycle, no part-envelope model.
- Request-stream cursor `${requestId}:${sequence_number}`, resumable by both `Last-Event-ID` and `starting_after`. Session-stream cursor is the event's `at`, as `?since=`, with no sequence number.
- Generator provider: Vercel AI SDK (Phase 1).
- Observational hooks are past tense (`onStarted`, `onCompleted`, `onErrored`, `onFinished`).
- No block middleware ([Internal Execution Seams](./internal-execution-seams.md)).

## Map

| Doc | Read before touching |
|---|---|
| [Blocks](./blocks.md) | block execution, context resolution, generator text joining, evaluators |
| [Capabilities](./capabilities.md) | capability merging, the tools fence, config resolvers |
| [Sequencer DSL](./sequencer-dsl.md) | per-step options, background work lifetime, output schemas |
| [Flows and Actions](./flows-and-actions.md) | flow identity, instance config, execution order |
| [Action Forms](./action-forms.md) | entry resolution, dispatch targets, public re-entry |
| [State and Scopes](./state-and-scopes.md) | state verbs under concurrency, CAS, tenancy, isolation, lineage |
| [Resources and Client Data](./resources-and-client-data.md) | resource storage, writers, owner-private collections, client exposure |
| [Resource Collections](./resource-collections.md) | collection patterns, identity, the post-mutation seam |
| [Items](./items.md) | item types, visibility, persistence, task attribution |
| [Streaming](./streaming.md) | event durability, resume, session stream, live tail |
| [Execution and Errors](./execution-and-errors.md) | loop ownership, resume, abort signals, drains, durability, liveness |
| [Dispatched Work](./dispatched-work.md) | child sessions, claim gate, topology, shutdown, recovery |
| [Authentication](./authentication.md) | resolvers, route guards, owner pins |
| [Server and Client](./server-and-client.md) | instance routing, retention, child-session reads |
| [Inbound Transports](./inbound-transports.md) | the host, admission, concurrency arbitration |
| [MCP](./mcp-server.md) · [Webhooks](./webhook-transport.md) · [Scheduled](./scheduled-actions.md) · [Voice](./voice.md) | those transports |
| [Utility Blocks](./utility-blocks.md) | utility factories |
| [Workforce worker kind](./workforce-default-worker-kind.md) | the built-in `agent` kind and the hire step |

When docs conflict, the more specific one wins. Where code and these docs disagree and nothing disambiguates, surface it (`audit-coherence`) rather than routing around it.
