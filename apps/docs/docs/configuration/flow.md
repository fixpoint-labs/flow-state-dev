---
title: Flow options
sidebar_label: Flow options
description: Every field on defineFlow, actions, scopes, and inbound transports.
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
| `requireUser` | `boolean` | `true` | Shorthand for `authentication.requireUser`. If both are set, `authentication.requireUser` wins. |
| `authentication` | `AuthenticationConfig` | — | Per-flow principal resolution. See [Authentication](#authentication). |
| `session` | `SessionConfig` | — | Session state, client projection, retention, history window. |
| `request` | `RequestConfig` | — | Request-scoped state, lifecycle hooks, heartbeats, concurrency default. |
| `user` | `UserConfig` | — | User-scoped state and client projection. |
| `org` | `OrgConfig` | — | Org-scoped state and client projection. |
| `resources` | resource map | — | Flat map of `defineResource` / collection declarations. Each resource's own `scope` decides where it persists. |
| `tools` | `ToolsConfig` | — | Default timeout, concurrency, retry, and lifecycle hooks for tools. |
| `voice` | `VoiceConfig` | — | Flow-level TTS provider and speak defaults. |
| `mcp` | `McpConfig` | off | Opt-in MCP exposure for this flow. Definition-only: you cannot override it on the instance. |
| `chat` | `ChatConfig` | — | Chat-transport event bindings. Definition-only. |
| `webhooks` | `WebhookConfig` | — | Webhook event bindings. Definition-only. |
| `schedules` | `SchedulesConfig` | — | Static and dynamic scheduled actions. Definition-only. |
| `tokenCounter` | `TokenCounter` | — | Custom token accounting. |
| `costEstimator` | `CostEstimator` | — | Custom USD cost estimate from model usage. |
| `isolateUserState` | `boolean` | `false` | Key user state (and the default for user resources) per flow kind. A resource's own `flowIsolation` always wins. |
| `isolateOrgState` | `boolean` | `false` | Org-scope equivalent of `isolateUserState`. |
| `defaultBlockRenderer` | renderer or `false` | — | Default UI renderer for blocks in this flow. |

`mcp`, `chat`, `webhooks`, and `schedules` belong on the definition. Passing them to the factory call (`defineFlow({ ... })({ mcp: ... })`) is rejected.

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
| `metadata` | Zod schema | — | Session metadata schema (`title`, tags, and so on). |
| `retention` | `{ maxItems?, maxAge? }` | unbounded | Bounds the persisted item log. `maxAge` is milliseconds or a duration string (`"7d"`). Oldest completed requests evict first. |
| `historyWindow` | `{ turns: number }` | `50` | Caps cross-turn history loaded per request. `0` or a negative number disables it. Per-call `history({ limit })` can only shrink this window. |
| `cas` | `CASOptions` | — | Optimistic-concurrency options for this scope. |

`clientData` on a scope still works and logs a deprecation warning. Use `client.derived`.

### `request`

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `stateSchema` | Zod object | — | Request-scoped state. |
| `onStarted` / `onCompleted` / `onErrored` / `onFinished` / `onStepErrored` | `BlockDefinition` | — | Request lifecycle hooks. |
| `heartbeatIntervalMs` | `number` | `10000` | Active-request heartbeat. `0` disables the heartbeat *and* cross-process abort delivery. |
| `sseHeartbeatMs` | `number` | `15000` | SSE `: ping` cadence. `0` disables. |
| `concurrency` | `ConcurrencyConfig` | `"allow"` | Default for actions that omit `concurrency`. |
| `mutationTimeoutMs` | `number` | `30000` | Budget for in-memory state writes. `Infinity` disables. Persistent stores use CAS retries instead. |
| `cleanupCheckpointsOnTerminal` | `boolean` | `false` | Delete durable sequencer checkpoints when the request finishes. |

## Tools defaults

`tools.defaults` applies to tools on generators in this flow.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `defaults.timeoutMs` | `number` | — | Tool timeout. |
| `defaults.concurrency` | `"parallel"` \| `"serial"` | — | Whether tools in a step run together or one at a time. |
| `defaults.retry` | `RetryPolicy` | — | `{ maxAttempts?, baseDelayMs?, maxDelayMs?, retryableErrors? }`. |
| `onToolStarted` / `onToolCompleted` / `onToolErrored` | hook or block | — | Observe tool lifecycle. Cache hits still fire started/completed; errors are never cached. |

A generator can override these with `flowTools`.

## Inbound transports

These maps live on the flow definition. The matching adapter has to be mounted on the runtime for anything to listen. See [Server](/docs/server/setup) and the transport pages linked below.

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

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `provider` | `VoiceProvider` | — | TTS/STT implementation used by this flow. |
| `tts.model` | `string` | provider default | Speak model id. |
| `tts.voice` | `string` | — | Voice id. |
| `tts.speed` | `number` | — | Playback speed. |

See [Voice](/docs/advanced/voice).

## Resources

Declare resources on the flow (or on a block / capability). `scope` on `defineResource` decides the storage layer.

| Field | Type | Default | What it does |
|-------|------|---------|--------------|
| `scope` | `"session"` \| `"user"` \| `"org"` | required | Where state and content persist. |
| `stateSchema` | Zod object | required | Resource state shape. |
| `ref` | `string` | accessor key | Storage namespace id. |
| `default` | JSON value | — | Initial state. |
| `flowIsolation` | `boolean` | `false` | Per-flow keying for user/org resources. Rejected on session scope. |
| `sharedToWorkstream` | `boolean` | `false` | Session resources resolve against the lineage root so child workstreams share them. Session-scope only. |
| `prefetchMode` | `"eager"` \| `"lazy"` | `"eager"` | When the runtime loads the resource. |
| `llmReadable` / `llmWritable` | `boolean` | — | Whether generators may read or write the resource. |
| `client` | `ResourceClientConfig` | full state to the client | `expose` / `exclude` / `data` are mutually exclusive. Omit all three to send the full state. |
| `content` / `contentFile` / `contentTemplate` | content source | — | Mutually exclusive ways to supply a body. |

Collections add `pattern`, `maxInstances`, `eviction` (`"none"` \| `"lru"` \| `"oldest"`), and create/delete hooks. See [Resources](/docs/resources/overview) and [Collections](/docs/resources/collections).

## See also

- [Block options](./blocks) — generator, handler, sequencer, router fields
- [Runtime options](./runtime) — `createFlowState`
- [Concurrency policies](/docs/advanced/concurrency-policies)
- [Flow isolation](/docs/advanced/flow-isolation)
- [Durable execution](/docs/advanced/durable-execution)
