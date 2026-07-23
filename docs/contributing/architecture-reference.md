# Architecture Quick Reference

Compact reference for locked contracts and key decisions. For detailed explanations, see the full architecture docs in `docs/architecture/`.

## Authority Order

1. `docs/architecture/*` — Reference docs (authoritative)
2. `docs/contributing/best-practices.md` — Implementation standards
3. `AGENTS.md` — Process protocol

Conflict rule: more specific reference wins (e.g. `docs/architecture/streaming.md` over a general statement in `overview.md`).

## Locked Contracts (Phase 1)

- Block kinds only: `handler`, `generator`, `sequencer`, `router` → [Blocks](../architecture/blocks.md)
- Actions are flow-level only (`defineFlow({ actions })`) → [Flows](../architecture/flows-and-actions.md)
- Required caller input: `userId`
- Stream model: item/content lifecycle; no part-envelope model → [Streaming](../architecture/streaming.md)
- Stream cursor: `${requestId}:${sequence_number}`
- Resume paths: both `Last-Event-ID` and `starting_after`
- Generator provider boundary: Vercel AI SDK in Phase 1
- `@flow-state-dev/client` required; `@flow-state-dev/react` wraps client (no transport logic)
- Inbound transport contract: `InboundTransportAdapter`, `InboundRequestEnvelope`, `RequestRecord.source`
  → [Inbound Transports](../architecture/inbound-transports.md)
- MCP transport routes: shared mode (default) uses `/api/flows/:kind/mcp`;
  `dedicatedBasePath: true` uses `<basePath>/:kind` with `/mcp` as its implicit
  base. An adapter registers one layout, and outer hosts must forward that
  prefix to the Flow State router.
  → [MCP Server Adapter](../architecture/mcp-server.md)
- MCP per-action session: `ActionMcpConfig.session?: string | { fromInput: string }` (`core`). Default (omitted) → stateless (fresh ephemeral session per `tools/call`). String = mint template (first `*` → random token, else appended); `{ fromInput }` = read the flow `sessionId` from that input field. The MCP adapter derives the dispatch `sessionId` from it (`deriveSessionId`). Flow session key, not protocol `Mcp-Session-Id`; principal still from `resolvePrincipal`. `fromInput` is caller-controlled → single-trusted-principal only until caller-supplied session keys are principal-namespaced (follow-up).
- Action forms: every action shares `ActionCore` (handler `block` + execution policy). Caller-addressed = `ActionConfig` in `flow.actions`; event-addressed (webhook/chat/scheduled) carries the core inline on its transport map and has no HTTP/MCP caller surface (no `internal` flag — the structural fact is the boundary). Resolution seam `resolveActionCore(flow, actionName, source, metadata)` reads a namespaced coordinate (`metadata.webhook` / `metadata.chat.eventKey` / `metadata.schedule.scheduleId`) gated on `source` (set only by adapters), else falls back to `flow.actions[name]`. Dynamic schedules carry the core on `InboundRequestEnvelope.resolvedActionCore` (transient — not persisted, so durable dynamic schedules don't recover).
  → [Action Forms](../architecture/action-forms.md)
- Scheduled actions: `schedules` config on `defineFlow` (`static` map + dynamic `resolve` hook). `ScheduleConfig = ActionCore & { cron; input?; principal?; ... }` — carries `block` inline (no `action: string`); `defineScheduleBinding` helper. Dynamic resolver via `createResourceCollectionScheduleResolver({ collection, blocks })` maps a persisted `kind` discriminator → block (`defineScheduleCollection` schema field renamed `action` → `kind`). Dispatch route `POST /api/flows/:kind/schedules/:scheduleId/dispatch`.
  → [Scheduled Actions](../architecture/scheduled-actions.md)
- Chat transport: `chat` config on `defineFlow` (`chat.on` map). `ChatEventBinding extends ActionCore` — carries `block` inline (no `action: string`); `defineChatBinding` helper. Adapter mount is bare `createChatTransportAdapter({ bot })`: the `route()`/`flowKind`/`action` mount options and `ChatRouteResult`/`ChatRouteFn` types are removed. Unmatched event = no-op ack. `source: "chat"`, namespaced `metadata.chat`.
  → [Chat Transport](../architecture/chat-transport.md)
- Webhook receivers: `webhooks` config on `defineFlow` (`WebhookConfig` = per-provider `{ on }`, `WebhookSubscriptionConfig`, `WebhookEventBinding extends ActionCore` — the handler lives on `flow.webhooks`, never `flow.actions`), framework-owned `WebhookInboundEvent` (`core`), host-side `WebhookProviderDefinition` (`engine`, carries `verify` + crypto), route `POST /api/flows/:kind/webhooks/:provider`, `source: "webhook"`
  → [Webhook Transport](../architecture/webhook-transport.md)
- Concurrency policy: `concurrency` config on `ActionConfig` (per-action) and `RequestConfig` (flow default, `flow.request.concurrency`). `ConcurrencyConfig = "allow" | "queue" | "reject" | { policy; key? }` (`core`); `ConcurrencyKey = "session" | "user" | "none" | (ctx) => string | undefined`; `validateConcurrencyConfig` rejects reserved `debounce`/`restart` at definition time. v1 policy set is `allow` (default) / `queue` / `reject`. Resolution `action.concurrency ?? flow.request.concurrency ?? "allow"`; default key `"session"` (tenant-namespaced; `undefined` ⇒ no arbitration ⇒ runs as `allow`). Enforced once at the shared `host.dispatch` seam (every transport inherits it): `reject` claims the key synchronously and throws `ConcurrencyRejectedError` (409, in-flight `requestId`) before any record exists; `queue` defers the run start FIFO behind the key (over-wait ⇒ `ConcurrencyQueueTimeoutError`, 503); the key is acquired+released within one `dispatch` lifecycle (no cross-call handoff). In-process / single-instance; generalizes scheduled `onOverlap` (`skip` ≡ `reject`, `allow` ≡ `allow`).
  → [Concurrency Policies](../../apps/docs/docs/advanced/concurrency-policies.md)

## Sequencer Surface (21 methods)

`step`, `stepIf`, `map`, `parallel`, `forEach`, `forEachBackground`, `doUntil`, `doWhile`, `loopBack`, `work`, `workIf`, `waitForWork`, `tap`, `tapIf`, `rescue`, `branch`, `stepAll`, `stepAny`, `race`, `exitIf`

- `.stepAll([...blocks])`: run array of blocks concurrently, collect all results as ordered array (like `Promise.all`)
- `.stepAny([...blocks])`: try blocks sequentially in order, return first successful result; throws `AggregateError` if all fail
- `.race([...blocks])`: run blocks concurrently, return first successful result, abort the rest; throws `AggregateError` if all fail
- `.exitIf(condition)`: break out of sequencer chain early when condition is true; auto-await of background work still runs

- `.work(...)`: non-aborting by default
- `.workIf(condition, block)`: conditional variant of `.work()` — dispatches sidechain only when condition is truthy; accepts static boolean or `(ctx) => boolean | Promise<boolean>`; complete no-op when falsy
- `.forEachBackground(...)`: fire-and-forget fan-out; dispatches each iteration as background work with configurable concurrency (default 16)
- `.waitForWork({ failOnError: true })`: promote background failures to terminal request error

→ [Sequencer DSL](../architecture/sequencer-dsl.md)

## Scopes and State

- Hierarchy: `request → session → user → project` → [State and Scopes](../architecture/state-and-scopes.md)
- State ops (atomic): `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`
- Session metadata: `ctx.session.setMetadata({ title?, description?, tags?, metadata? })` — first-class fields, emits `session.metadata.changed` SSE event
- CAS + bounded retries for concurrency safety
- `getTarget(name)`: state-only escape hatch; resolves nearest-first across dispatched siblings at the current execution level, then falls back to the ancestor parent chain; may return `undefined` or throw `AmbiguousBlockNameError` when multiple ancestors share the same name
- `targetStateSchemas`: typed declaration surface for `ctx.targets.<name>` state handles
- `getBlockOutput(blockDef)`: returns completed output from already-dispatched sibling blocks at the current execution level, otherwise `undefined`
- `getBlockResult(blockDef)`: returns `{status: not_started|running|completed|failed}` for already-dispatched sibling blocks at the current execution level (not ancestor chain), with output/error payload on terminal states

## Streaming

- SSE named events; deterministic ordering by `sequence_number`
- Replay correctness: persisted items + sequence ordering
- Event categories: request/item/content lifecycle, optional `resource.changed`, debug

→ [Streaming](../architecture/streaming.md)

## Middleware (internal-only)

- Block middleware is **not** a public extension point — no `middleware:` on
  `createFlowApiRouter`, `defineFlow`, or `BlockConfig`, and no `Middleware`
  export from `@flow-state-dev/core`.
- The engine keeps an internal composition seam (`composeMiddleware` +
  `executeBlock` wrap), fed only through `RuntimeConfig.middleware`.
- Framework-internal interception also flows through `InternalExecutionSeams`
  (`interceptBlockInput` / `interceptBlockOutput` / `interceptNormalizedError`
  / `onGeneratorLifecycle` / `onActionLifecycle`).
- App authors use lifecycle hooks, `.tap()`, capabilities, the trace system, or
  `errorCapture` instead.

→ [Internal Execution Seams](../architecture/internal-execution-seams.md)

## Lifecycle Hooks

| Hook | When |
|------|------|
| `onStarted` | Request begins |
| `onCompleted` | Terminal success only |
| `onErrored` | Terminal failure only |
| `onFinished` | Always |
| `onStepErrored` | Non-terminal step/work visibility |

→ [Execution and Errors](../architecture/execution-and-errors.md)

## Package Boundaries

| Package | Role | Key constraint |
|---------|------|----------------|
| `contracts` | Zero-dep shared layer (item taxonomy + leaf types) | Imports no workspace package; declares no dependencies (guarded). `core` re-exports it |
| `core` | Isomorphic builders/types/items | No platform-specific code; value-imports `contracts` |
| `engine` | Execution/runtime/stores/streaming/routes | No dependency on react or client |
| `client` | Transport + session/request APIs | No dependency on server or react |
| `react` | Hooks/renderers only | Wraps client; no transport logic |
| `testing` | Deterministic harnesses + mocks | Uses core + server |
| `cli` | Run/inspect/scaffold flows | Uses core + server + testing |
| `apps/devtool` | Inspector app | Public APIs only (client + react) |

→ [Architecture Overview](../architecture/overview.md)

## Utility Blocks

Ten pre-built utility factories wrapping generator/handler blocks:

| Utility | Kind | Purpose |
|---------|------|---------|
| `contextReducer` | generator | Context reduction (distill, denoise, compress) |
| `memoryExtractor` | generator | Extract durable memory candidates |
| `decomposer` | generator | Break requests into subtasks with dependency graph |
| `composer` | generator | Assemble coherent output from parts |
| `summarizer` | generator | Summarize at brief/detailed/executive granularity |
| `combiner` | handler | Deterministic artifact merge (no LLM) |
| `synthesizer` | generator | Reconcile overlapping/conflicting inputs |
| `analyzer` | generator | Evaluate artifacts against criteria |
| `intentClassifier` | generator | Classify input into bounded category set for routing |
| `intentRouter` | sequencer | Pre-wired classifier + router for classification-driven branching |

- Access via `utility.<name>(config)` — returns a standard `BlockDefinition`
- All generators default to `"preset/fast"` model
- All utilities accept optional `outputSchema` override
- Combiner is handler-based (deterministic, no model)

> [Utility Blocks](../architecture/utility-blocks.md)

## Resources and Client Data

- Concrete resources are persisted, attached to scopes
- `clientData` entries are derived views — every entry is client-visible (no `client: true/false` toggle)
- Each `clientData` compute function receives only its own scope's state and resources (single-scope context)
- Generator context uses `contextFn()` for typed scope access, not raw state dumps
- `defineResource()` for portable resource declarations
- Blocks declare resources via `sessionResources`, `userResources`, `projectResources` (using `defineResource()` values)
- Sequencers collect `declaredResources` from all child blocks automatically
- `defineFlow` merges block-declared resources into flow scope configs; flow-level wins over block-level
- Same `defineResource()` reference across blocks = no conflict; different references for same name = build-time error
- Collection snapshots emit `count` always and `prefetched` when `prefetchWindow > 0`; per-item `clientData` is gated by `client.state.read`. Lazy reads via `GET /sessions/:id/resources/:ref` and a flow-static manifest at `GET /sessions/:id/manifest` (FIX-427).

→ [Resources and Client Data](../architecture/resources-and-client-data.md)

## Definition of Done (Phase 1)

- All package contracts compile + match canonical docs
- Tests pass across packages
- Example flows run with item-first streams + explicit `userId`
- CLI commands work end-to-end
- Dev tool runs actions, streams live, replays with both resume modes
- No residual legacy part-model terminology
