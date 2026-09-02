---
title: Flow options
sidebar_label: Flow options
description: Every field on defineFlow, actions, internal and task entries, scopes, inbound transports, and the dispatcher block.
---

# Flow options

`defineFlow({ ... })` returns a factory. Call the factory (`defineFlow({ ... })()` or `defineFlow({ ... })({ id: "default" })`) to get a registerable instance. The definition is the contract; the instance is what you pass to `createFlowState`.

```ts
import { defineFlow, generator } from "@flow-state-dev/core";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

export default defineFlow({
  kind: "support",
  requireUser: true,
  actions: {
    chat: {
      inputSchema,
      block: generator({
        name: "chat",
        model: "intent/chat",
        prompt: "You answer support questions.",
        inputSchema,
        history: true,
        user: (input) => input.message,
        itemVisibility: { client: true, history: true },
      }),
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({ ticketId: z.string().nullable().default(null) }),
    client: { expose: ["ticketId"] },
    historyWindow: { turns: 50 },
  },
})();
```

Narrative: [Flows](/docs/fundamentals/flows), [Actions](/docs/fundamentals/actions), [State and scopes](/docs/fundamentals/state-and-scopes).

## `defineFlow` fields

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `kind` | `string` | required | Flow type id. Becomes the URL segment `/api/flows/:kind`. |
| `actions` | `Record<string, ActionConfig>` | required | Caller-addressed entry points (HTTP and, when enabled, MCP). |
| `internal` | `Record<string, InternalEntry>` | — | Entries only a `dispatcher()` block in one of this flow's own requests can reach. Definition-only. See [Internal entries](#internal-entries). |
| `tasks` | `Record<string, TaskEntry>` | — | Entries a task board produces for the seats it hands off, declared as `tasks: board.tasks`. Definition-only. See [Task entries](#task-entries). |
| `requireUser` | `boolean` | `true` | Shorthand for `authentication.requireUser`. If both are set, `authentication.requireUser` wins. |
| `authentication` | `AuthenticationConfig` | — | Per-flow principal resolution. See [Authentication](#authentication). |
| `session` | `SessionConfig` | — | Session state, client projection, retention, history window. |
| `request` | `RequestConfig` | — | Request-scoped state, lifecycle hooks, heartbeats, concurrency default. |
| `user` | `UserConfig` | — | User-scoped state and client projection. |
| `org` | `OrgConfig` | — | Org-scoped state and client projection. |
| `resources` | resource map | — | Flat map of `defineResource` / collection declarations. Each resource's own `scope` decides where it persists. |
| `tools` | `ToolsConfig` | — | Default timeout, retry, and lifecycle hooks for tools. |
| `voice` | `VoiceConfig` | — | Flow-level TTS provider and speak defaults. |
| `mcp` | `McpConfig` | off | Opt-in MCP exposure for this flow. Definition-only: you cannot override it on the instance. |
| `chat` | `ChatConfig` | — | Chat-transport event bindings. Definition-only. |
| `webhooks` | `WebhookConfig` | — | Webhook event bindings. Definition-only. |
| `schedules` | `SchedulesConfig` | — | Static and dynamic scheduled actions. Definition-only. |
| `tokenCounter` | `TokenCounter` | — | Custom token accounting. |
| `costEstimator` | `CostEstimator` | — | Custom USD cost estimate from model usage. |
| `isolateUserState` | `boolean` | `false` | Key user state (and the default for user resources) per flow kind. A resource's own `flowIsolation` always wins. |
| `isolateOrgState` | `boolean` | `false` | Org-scope equivalent of `isolateUserState`. |

`mcp`, `chat`, `webhooks`, `schedules`, `internal`, and `tasks` belong on the definition. Passing any of them to the factory call (`defineFlow({ ... })({ mcp: ... })`) is rejected.

Each map holds entries of one message type: `actions` for `user` messages, `internal` for `internal`, `tasks` for `task`, and the transport maps for `chat`, `webhook`, and `schedule`. A message resolves only its own type's map. An `internal` message named `wake` resolves `internal.wake` or is refused; `actions.wake` never stands in for it.

## Actions

Each key in `actions` is a public name. Clients call it with `sendAction("chat", { message })` or `POST /api/flows/:kind/actions/chat`.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `block` | `BlockDefinition` | required | The block that runs. |
| `inputSchema` | Zod schema | the block's schema | Public input surface. Set this when the HTTP/MCP contract should differ from the block (richer `.describe()`, a narrower public shape). |
| `description` | `string` | — | Required when the action is MCP-exposed. DevTool uses it for tooltips either way. |
| `userMessage` | `(input) => string` | — | User-visible message recorded for the turn. |
| `concurrency` | `ConcurrencyConfig` | flow `request.concurrency`, else `"allow"` | What happens if another request on the same key is in flight. See [Concurrency policies](/docs/advanced/concurrency-policies). |
| `durable` | `boolean` | `false` | Checkpoint at step boundaries and allow `ctx.suspend()`. Needs `durable: true` on `createFlowState`. |
| `tokenBudget` | `{ maxTotalTokens, warnAt?, onExceeded? }` | — | Cap tokens for the action. `onExceeded` is `"error"`, `"stop"`, or `"warn"`. |
| `onCompleted` / `onErrored` | `BlockDefinition` | — | Action-level hooks after the root block finishes or throws. |
| `mcp` | `ActionMcpConfig` | exposed when the flow enables MCP | Per-action MCP overrides. |

Every entry type accepts `concurrency`, and the ladder is the same for all of them: `entry.concurrency ?? request.concurrency ?? "allow"`. An `internal` entry, a task entry, and a chat, webhook, or schedule binding declare it exactly as an action does.

### `action.mcp`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `enabled` | `boolean` | `true` | Set `false` to keep the action off the MCP surface. |
| `name` | `string` | derived from the action key (`recordPayment` → `record_payment`) | MCP tool name. Must match `[A-Za-z0-9_.-]{1,128}`. |
| `session` | `string` or `{ fromInput: string }` | fresh ephemeral session per `tools/call` | How the adapter picks a flow `sessionId`. A string is a mint template (`*` → random token). `{ fromInput }` reads a field from the tool input. The principal still comes from `resolvePrincipal`. |

## Authentication

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `resolvePrincipal` | `(ctx) => principal \| null` | — | Map the inbound request to `{ userId, orgId? }`. Throw a `PrincipalResolutionError` to pick the HTTP status (401/403). |
| `defaultUserId` | `string` | — | Used when the resolver returns no `userId`. Typical for schedules and webhooks. |
| `requireUser` | `boolean` | `true` | Reject requests that still have no `userId` after the fallback. `false` forbids user-scoped state, client projections, and resources at registration. |
| `requireOrg` | `boolean` | — | Reserved. No runtime effect today. |

The host verifies credentials. The framework applies `defaultUserId` and `requireUser` after your resolver returns. See [Authentication](/docs/server/authentication).

## Session, user, and org

`user` and `org` accept `stateSchema`, `cas`, and `client` (same shape as session, minus retention and history).

### `session`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `stateSchema` | Zod object | — | Session state shape. Use `.nullable().default(null)` for fields that start empty. |
| `client` | `{ expose?, derived? }` | private | What crosses to the browser under `clientData.session`. `expose` copies named fields verbatim. `derived` computes named projections from `{ state, resources }`. Names must not collide. |
| `metadata` | Zod schema | — | Declares the session metadata shape (`title`, tags, and so on) for typing. Not enforced at runtime today: neither the session-metadata route nor `ctx.session.setMetadata()` parses against it, so a value outside the schema is persisted unchanged. |
| `retention` | `{ maxItems?, maxAge? }` | unbounded | Bounds the persisted item log. `maxAge` is milliseconds or a duration string (`"7d"`). Oldest completed requests evict first. |
| `historyWindow` | `{ turns: number }` | `50` | Caps cross-turn history loaded per request. `0` or a negative number disables it. Per-call `history({ limit })` can only shrink this window. |
| `cas` | `CASOptions` | — | Optimistic-concurrency options for this scope. |

`clientData` on a scope was removed. `defineFlow` throws if it is still set — use `client.derived` (or `expose` for verbatim passthrough).

### `request`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `stateSchema` | Zod object | — | Request-scoped state. |
| `onStarted` / `onCompleted` / `onErrored` / `onFinished` / `onStepErrored` | `BlockDefinition` | — | Request lifecycle hooks. |
| `heartbeatIntervalMs` | `number` | `10000` | Active-request heartbeat. `0` disables the heartbeat *and* cross-process abort delivery. |
| `sseHeartbeatMs` | `number` | `15000` | SSE `: ping` cadence. `0` disables. |
| `concurrency` | `ConcurrencyConfig` | `"allow"` | Default for every entry that omits `concurrency` — actions, `internal` and task entries, and the chat, webhook, and schedule bindings. |
| `mutationTimeoutMs` | `number` | `30000` | Budget for in-memory state writes. `Infinity` disables. Scopes that persist — request, session, user, org — are not covered by it. |
| `cleanupCheckpointsOnTerminal` | `boolean` | `false` | Delete durable sequencer checkpoints when the request finishes. |

## Tools defaults

`tools.defaults` applies to tools on generators in this flow.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `defaults.timeoutMs` | `number` | — | Tool timeout. |
| `defaults.retry` | `RetryPolicy` | — | `{ maxAttempts?, baseDelayMs?, maxDelayMs?, retryableErrors? }`. |
| `onToolStarted` / `onToolCompleted` / `onToolErrored` | hook or block | — | Observe tool lifecycle. Cache hits still fire started/completed; errors are never cached. |

A generator can override these with `flowTools`.

## Inbound transports

These maps live on the flow definition. The matching adapter has to be mounted on the runtime for anything to listen. See [Engine setup](/docs/server/setup) and the transport pages linked below.

### `mcp`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `enabled` | `boolean` | `false` | Mount MCP for this flow. |
| `exposeResources` | `boolean` | `true` | Include flow resources in `resources/list` and `resources/read`, honoring `client.content.read`. |

See [MCP](/docs/server/mcp).

### `schedules`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `static` | `Record<id, ScheduleConfig>` | — | Cron entries looked up by id first. |
| `resolve` | `(id, ctx) => ScheduleConfig \| null` | — | Dynamic lookup when `static[id]` is missing. Return `null` to 404. |

Each `ScheduleConfig` extends the action core (`block`, `inputSchema`, hooks, `durable`, …) plus:

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `cron` | POSIX 5-field string | required | Display-only. The host scheduler fires; the framework does not. |
| `input` | value or `() => input` | — | Passed to the handler. |
| `principal` | `{ userId, orgId? }` | gateway principal | Who the action runs as. |
| `timezone` | IANA string | `"UTC"` | Metadata for the host scheduler. |
| `onOverlap` | `"skip"` \| `"allow"` | `"skip"` | What to do if the same schedule id is already running. |
| `description` | `string` | — | Listing and DevTool. |
| `enabled` | `boolean` | `true` | Disabled static schedules list but 404 on dispatch. |

See [Scheduled actions](/docs/server/scheduled).

### `chat` and `webhooks`

`chat.on` and each provider's `webhooks.<provider>.on` map event keys to a binding that extends the action core (`block` plus execution policy). They are not entries in `actions`. See [Chat](/docs/server/chat) and [Webhooks](/docs/server/webhooks).

### `voice`

`voice.provider` sets the TTS/STT implementation for this flow, and `voice.tts` carries the speak defaults (`model`, `voice`, `speed`). Those three are catalogued with the rest of the voice surface on [Voice](/docs/advanced/voice#tts-options).

## Internal entries

`internal` maps a name to an entry only the flow itself can reach. A `dispatcher()` block running in one of the flow's own requests sends it an `internal` message; no HTTP, MCP, chat, webhook, or schedule caller can name it. Use it for work a request starts for itself or for a sibling session: a background job in a child session, a wake sent to a coordinator, a follow-up delivered into a session that already exists.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `block` | `BlockDefinition` | required | The block that runs. |
| `inputSchema` | Zod schema | the block's schema | Validates the dispatched payload on arrival. |
| `concurrency` | `ConcurrencyConfig` | flow `request.concurrency`, else `"allow"` | Same as on an action. A child session that receives several messages wants `"queue"`. |
| `durable`, `tokenBudget`, `onCompleted`, `onErrored`, `userMessage` | as on an action | — | The rest of the action core. `description` and `mcp` do not apply. |

`defineFlow` throws on an entry with no `block`, and on a `concurrency` value it would refuse on an action.

## Task entries

`tasks` holds the entries a [task board](/docs/orchestration/task-board#handing-tasks-off-to-child-sessions) produces for each worker seat it hands off to a child session. Declare them as `tasks: board.tasks`, or spread several boards together: `tasks: { ...issues.tasks, ...reviews.tasks }`. Each entry wraps the seat's worker in the board's claim gate, so a `task` message reaches the worker only after the claim it names has been re-read and verified.

`defineFlow` refuses a task entry written by hand (`{ block }` with no board behind it), a board hand-off whose entry is not declared, and two boards whose seats share a name and shadow each other in `tasks`.

A task entry accepts the same execution policy as an action. Spread to override it. A child session shared by several rows wants `queue`:

```ts
tasks: { implement: { ...board.tasks.implement, concurrency: "queue" } },
```

## Dispatching to another session

`dispatcher()` builds a block that sends one message to one declared entry instead of doing the work itself. The message runs in a child session derived from a key, or in a session that already exists, and the dispatching request returns as soon as the runtime has accepted it. The block is a handler underneath, so it goes anywhere a handler goes: an action's root block, a sequencer step, a generator's tool.

```ts
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { z } from "zod";

const summarize = handler({
  name: "summarize",
  inputSchema: z.object({ documentId: z.string() }),
  execute: async (input) => {
    // runs in the child session, on its own request
  },
});

const summarizeInBackground = dispatcher({
  name: "summarize-in-background",
  type: "internal",
  target: "summarize",
  inputSchema: z.object({ documentId: z.string() }),
  session: { key: (input) => input.documentId },
});

export default defineFlow({
  kind: "documents",
  actions: {
    upload: { block: summarizeInBackground },
  },
  internal: {
    summarize: { block: summarize },
  },
})();
```

Calling `upload` returns `{ sessionId, requestId, adopted }`: the child session the message runs in, the request it became, and whether that child already existed. The same `documentId` from the same parent session lands on the same child with `adopted: true`; a different parent gets a different child.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `name` | `string` | required | Block name. |
| `type` | `"internal"` | required | The message type. Only `internal` can be authored; `task` messages are sent by a task board. |
| `target` | `string` | required | The entry name, resolved as `internal[target]`. Checked when the flow is defined. |
| `inputSchema` | Zod schema | `z.unknown()` | What the block accepts. |
| `session` | `{ key: (input, ctx) => string }` \| `{ id: (input, ctx) => string }` | required | Which session runs the message. See below. |
| `payload` | `(input, ctx) => unknown` | the input itself | The entry's input. Validated by the entry's own `inputSchema` on arrival. |
| `transient` | `boolean` | `false` | Hide the block's trace from clients. |
| `description` | `string` | — | Block description. |

### Choosing the session

**`{ key }`** derives a child of the running session from the key together with the running request's principal, tenant, and parent session. The child is created on first use and reused after, so a retry re-enters the work it started. Use a value that names the unit of work: a document id, an issue key. The child's record carries `parentSessionId`, `topic` (the key), and `coordinate` (`"internal:summarize"`), and the parent's [children route](/docs/server/setup#api-endpoints) lists it.

**`{ id }`** delivers into a session that already exists. It has to belong to this flow kind and this principal, in this tenant, and not be bound to a different org. An unknown id is refused, never created.

```ts
const wakeCoordinator = dispatcher({
  name: "wake-coordinator",
  type: "internal",
  target: "wake",
  inputSchema: z.object({ coordinatorSessionId: z.string(), reason: z.string() }),
  session: { id: (input) => input.coordinatorSessionId },
  payload: (input) => ({ reason: input.reason }),
});
```

### When it is refused

`defineFlow` walks every block it can reach (sequencer steps, rescue handlers, a generator's `tools`, the blocks behind `internal` and `tasks` entries) and throws if a dispatcher names an entry the flow does not declare. The error names the block and the address. Because the address is fixed on the block, a target chosen from data is a [router](/docs/fundamentals/blocks) over declared dispatchers, not a dynamic string.

At run time the block throws `DispatchRefusedError` (`code: "dispatch-refused"`), carrying `blockName`, `address`, `detail`, and `refused`:

| `refused` | Meaning |
|---|---|
| `no-entry` | The flow declares no entry at `(type, target)`. |
| `session-not-found` | An `id` names a session that does not exist. |
| `session-not-addressable` | An `id` names a session on another flow, another principal, another tenant, or a different org. |
| `key-occupied` | A `key` derived a child id already held by a record that is not this request's child. |
| `no-dispatch-operation` | This process runs requests but was not wired to dispatch one. |
| `dispatch-rejected` | The host refused before starting: a `reject` concurrency policy whose key is held. |

Every refusal is decided before anything is dispatched, so a `.rescue()` on the dispatcher can branch on `refused` knowing nothing started. A `key` or `id` function that returns an empty string throws a plain `Error` naming the block. On a context with no dispatch seam (a hand-built test context, or [the CLI running without a config](/docs/cli/overview#without-a-config-background-work-cant-start)), the block throws `NoDispatchSeamError` (`code: "no-dispatch-seam"`).

### What it won't do

- **Wait for the child.** The dispatcher returns once the runtime has accepted the request, and nothing on it reports the child's outcome. Read the child session's own requests, or share a resource marked [`sharedToLineage`](/docs/resources/storage#session-scope-and-background-work).
- **Send a `user`, `chat`, `webhook`, or `schedule` message.** A block can send `internal` messages, and `task` messages only through a task board.
- **Reach another flow.** An `id` on a different flow kind is refused as `session-not-addressable`.
- **Share session state.** The child has its own session scope. Hand values over as `payload`, or through a `sharedToLineage` resource.

## Resources

Declare resources on the flow (or on a block / capability). `scope` on `defineResource` decides the storage layer.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `scope` | `"session"` \| `"user"` \| `"org"` | required | Where state and content persist. |
| `stateSchema` | Zod object | required | Resource state shape. |
| `ref` | `string` | accessor key | Storage namespace id. |
| `default` | JSON value | — | Initial state. |
| `flowIsolation` | `boolean` | `false` | Per-flow keying for user/org resources. Rejected on session scope. |
| `sharedToLineage` | `boolean` | `false` | Session resources resolve against the lineage root so child sessions share them. Session-scope only. |
| `prefetchMode` | `"eager"` \| `"lazy"` | `"eager"` | When the runtime loads the resource. |
| `llmReadable` / `llmWritable` | `boolean` | — | Whether generators may read or write the resource. |
| `client` | `ResourceClientConfig` | omitted — state stays private | Opens the resource to clients. For a single resource, declaring `expose`, `exclude`, or `data` (mutually exclusive) is the opt-in; a `client` carrying only `content` keeps state private. Collections gate state on `state.read` and ship the full item state when no projection is set. See [Client access](/docs/resources/client-access). |
| `content` / `contentFile` / `contentTemplate` | content source | — | Mutually exclusive ways to supply a body. |

Collections add `pattern`, `maxInstances`, `eviction` (`"none"` \| `"lru"` \| `"oldest"`), and create/delete hooks. See [Resources](/docs/resources/overview) and [Collections](/docs/resources/collections).

## See also

- [Block options](./blocks) — generator, handler, sequencer, router fields
- [Runtime options](./runtime) — `createFlowState`
- [Concurrency policies](/docs/advanced/concurrency-policies)
- [Task board → Handing tasks off to child sessions](/docs/orchestration/task-board#handing-tasks-off-to-child-sessions)
- [Detached work](/docs/server/background-work) — reading a session's children over HTTP
- [Flow isolation](/docs/advanced/flow-isolation)
- [Durable execution](/docs/advanced/durable-execution)
