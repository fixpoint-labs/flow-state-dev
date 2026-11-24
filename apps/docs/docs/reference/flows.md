---
title: Flows and actions
type: reference
description: "Every defineFlow field, action field and session setting, how to run several copies of one flow and what a request names to reach one, the isolation flags, and the lifecycle hooks."
---

# Flows and actions

A flow is a self-contained system inside your app: the actions clients can call, and the data and settings that belong to it. `defineFlow` declares one. A mistake in the declaration throws when the flow is defined, not when a request arrives. [Flows and actions](../concepts/flows-and-actions.md) builds the model. This page is the lookup.

The examples use a support desk. `support` is a flow with one action, `reply`, and it can run as several copies, one per region.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { auditReply } from "./blocks/audit-reply";
import { reply } from "./blocks/reply";

export const supportFlow = defineFlow({
  kind: "support",
  cardinality: "collection",
  configSchema: z.object({ region: z.string() }),
  actions: {
    reply: {
      block: reply,
      userMessage: (input) => input.message,
      concurrency: "queue",
      tokenBudget: { maxTotalTokens: 20_000, warnAt: 0.8, onExceeded: "stop" },
    },
  },
  session: {
    stateSchema: z.object({ replyCount: z.number().default(0) }),
    client: { expose: ["replyCount"] },
    historyWindow: { turns: 20 },
  },
  user: {
    stateSchema: z.object({ plan: z.string().default("free") }),
    client: { expose: ["plan"] },
  },
  request: { onFinished: auditReply },
  isolateUserState: true,
});
```

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { supportFlow } from "./src/flows/support/flow";

export default createFlowState({
  flows: [
    supportFlow({ id: "support-east", config: { region: "east" } }),
    supportFlow({ id: "support-west", config: { region: "west" } }),
  ],
});
```

```ts title="src/flows/support/blocks/reply.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { draftReplyFor } from "../../../lib/replies";

export const reply = handler({
  name: "reply",
  inputSchema: z.object({ message: z.string().min(1) }),
  outputSchema: z.object({ text: z.string(), priority: z.boolean() }),
  flowConfigSchema: z.object({ region: z.string() }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ replyCount: 1 });
    const text = await draftReplyFor(input.message);
    return {
      text: `${text}\n\nSupport desk, ${ctx.flow.config.region}`,
      priority: ctx.user.state.plan !== "free",
    };
  },
});
```

```ts title="src/flows/support/blocks/audit-reply.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const auditReply = handler({
  name: "auditReply",
  inputSchema: z.object({ requestId: z.string(), status: z.string() }),
  outputSchema: z.object({ recorded: z.boolean() }),
  execute: async (input) => {
    console.info(`request ${input.requestId} ended ${input.status}`);
    return { recorded: true };
  },
});
```

`reply` drafts an answer signed with its copy's `region`, adds one to the session's `replyCount`, and marks a paying customer's reply as priority. `auditReply` runs when each request ends. Calling the definition, `supportFlow({ ... })`, makes an instance, the copy the server registers.

## `defineFlow` fields

`defineFlow(definition)` returns a definition. Calling it with optional instance options returns an instance. Fields marked "definition only" throw if passed as instance options.

| Field | Type | Default | What it does |
|---|---|---|---|
| `kind` | `string` | required | The definition's id. A singleton's instance id is its kind. An instance option `kind` overrides it for that instance. |
| `cardinality` | `"singleton" \| "collection"` | `"singleton"` | How many copies the flow runs as. See [Running several copies](#running-several-copies-of-one-flow). Definition only. |
| `configSchema` | Zod object | none | The settings a copy is created with. Definition only. |
| `actions` | `Record<string, entry>` | required | The entries a caller can name over HTTP, MCP and voice. An entry is a bare block or `{ block, ...fields }`. `{}` is accepted. See [Action fields](#action-fields). |
| `internal` | `{ actions }` | none | Entries no caller can name. See [Entries no caller names](#entries-no-caller-names). Definition only. |
| `task` | `{ actions }` | none | Entries a task board dispatches a claimed row to. Definition only. |
| `views` | `Record<string, view>` | none | Blocks a screen watches, each made with `defineView`. A value that is not a `defineView` result throws. Definition only. |
| `session` | `SessionConfig` | none | See [Session settings](#session-settings). |
| `request` | `RequestConfig` | none | See [Request settings](#request-settings) and [Lifecycle hooks](#lifecycle-hooks). |
| `user`, `org` | `{ stateSchema?, cas?, client? }` | none | The state record kept per user and per organization. See [User and org records](#user-and-org-records). |
| `resources` | map | none | Resources and collections, one flat map. A resource's own `scope` decides where it is stored. Resources a block declares reach the flow without being repeated here. A single resource declared here with `prefetchMode: "lazy"` throws. See [Resources](./resources.md). |
| `tools` | `ToolsConfig` | none | `defaults.timeoutMs`, `defaults.retry`, and the hooks `onToolStarted`, `onToolCompleted`, `onToolErrored` (a function or a block). Applies to every generator action block, internal and task entry, webhook handler and static schedule block. A cache hit fires started and completed with `cached: true`, and never fires `onToolErrored`. |
| `voice` | `VoiceConfig` | none | Text-to-speech provider and speak defaults. An instance value replaces the definition's value whole. |
| `mcp` | `{ enabled?, exposeResources? }` | off | `enabled` defaults to `false`, `exposeResources` to `true`. With `enabled: true`, every action not opted out needs a non-empty `description`, its own or its block's, or `defineFlow` throws. Definition only. See [MCP server](./mcp-server.md). |
| `webhooks` | `WebhookConfig` | none | Event bindings per provider. Each binding is an action in webhook form and is not an entry of `actions`. Definition only. See [Webhooks](./webhooks.md). |
| `schedules` | `SchedulesConfig` | none | `static`, `resolve`, `index`. Definition only. See [Schedules in a flow](#schedules-in-a-flow). |
| `resourceVisibility` | `(ctx, resource) => "visible" \| "read-only" \| "hidden"` | every resource reachable as its own `llmReadable` and `llmWritable` flags allow | Which resources the model's resource tools reach each turn. It only narrows. `"hidden"` answers like a resource that is not registered; `"read-only"` refuses a write as a resource that is not `llmWritable` does. Block code that names a resource directly is not narrowed. Definition only. |
| `requireUser` | `boolean` | `true` | Shorthand for `authentication.requireUser`. The order the value is taken in, and what a flow with `false` may not declare, are on [Authentication](./authentication.md#requireuser-and-defaultuserid). |
| `authentication` | `AuthenticationConfig` | none | `resolvePrincipal`, `defaultUserId`, `requireUser`. On an instance, each of the three comes from the instance when it sets it, else from the definition. See [Authentication](./authentication.md). |
| `tokenCounter` | `TokenCounter` | `estimateTokenCounter` | Counts tokens when history is packed. Blocks read it as `ctx.tokenCounter`. |
| `costEstimator` | `{ estimate(usage, model) => number }` | none | Custom USD cost from model usage. |
| `isolateUserState` | `boolean` | `false` | See [Isolation flags](#isolation-flags). |
| `isolateOrgState` | `boolean` | `false` | See [Isolation flags](#isolation-flags). |

Import `defineFlow`, `defineView`, `dispatcher`, `defineResource` and `estimateTokenCounter` from `@flow-state-dev/core`, and the types (`FlowDefinition`, `FlowInstance`, `ActionConfig`, `SessionConfig`, `RequestConfig` and the rest) from `@flow-state-dev/core/types`.

### Instance options

The argument to the factory, `supportFlow({ ... })`.

| Option | What it does |
|---|---|
| `id` | A singleton defaults to its kind. A collection member needs a non-empty `id`. |
| `kind` | Overrides the definition's kind for this instance. |
| `config` | The copy's settings, checked against `configSchema`. |
| `requireUser`, `authentication` | As above. |
| `actions` | Per-instance overrides. For a name the definition has, the entry is spread over the definition's, so `{ block }` keeps the definition's `userMessage`, `concurrency` and the rest. A new name adds an action. |
| `session`, `request`, `user`, `org` | Merged one level over the definition's: a key the instance sets replaces that key, other keys stay. |
| `resources` | Replaces the definition's flow-level `resources` map whole. Resources blocks declare are merged in as well. |
| `tools` | `defaults` merged one level; each hook comes from the instance when set. |
| `voice`, `tokenCounter`, `costEstimator` | Instance value, else the definition's. |
| `isolateUserState`, `isolateOrgState` | Instance value, else the definition's, else `false`. |
| `ownerPin` | `{ orgId, userId? }` for an instance only one owner can reach. A caller outside the pin gets the `404` an unregistered address gets, and the instance is left out of that caller's `GET /api/flows`. Omitted, the instance is shared. See [Authentication](./authentication.md). |

### What `defineFlow` refuses

Each of these throws at definition, or at the factory call for the per-instance checks. None is a request-time refusal.

| Check | Throws when |
|---|---|
| Cardinality | `cardinality` is not one of the two values. |
| Client exposure | `session.client.expose`, or `user` or `org`, names a key the scope's `stateSchema` does not have. |
| Client config | A scope's `client` carries a `derived` key. Declare a view instead. |
| Entry maps | An `internal` or `task` entry has no block or an invalid `concurrency`, or the map is written without `actions`. |
| Dispatchers | A `dispatcher()` the flow reaches names an entry of its own flow that the flow does not declare. |
| Resource flags | A session-scoped resource sets `flowIsolation: true`, or a resource outside session scope sets `sharedToLineage: true`. |
| Concurrency | A request-level or action `concurrency` is an unknown policy. |
| `reads` | The flow declares `reads`. Declare each as a view. |

## Action fields

An action is a bare block, or an object. Only `block` is required. `internal` and `task` entries take the same fields except `description` and `mcp`.

| Field | Type | Default | What it does |
|---|---|---|---|
| `block` | `BlockDefinition` | required | The block that runs. |
| `inputSchema` | Zod schema | the block's `inputSchema` | The input is parsed against this before the block runs, and the block gets the parsed value, defaults applied. A failure ends the request `failed` with code `validation_error` and the message `Action input validation failed at "<path>": <issue message>`. Over HTTP the call answers `202` and the request settles `failed`; it is not a `400`. |
| `description` | `string` | the block's `description` | Required and non-empty when the action is exposed over MCP. Shown in DevTool tooltips. |
| `mcp` | `{ enabled?, name?, session? }` | exposed when the flow enables MCP | `enabled: false` keeps the action off MCP. `name` matches `[A-Za-z0-9_.-]{1,128}` and defaults to the key in snake case. `session` decides which session a call runs in. See [MCP server](./mcp-server.md). |
| `userMessage` | `(input) => string \| { text, metadata?, attachments? }` | none | Writes the input as a `user` message item when the request starts. `metadata` rides on the item for a client and is never sent to a model. `attachments` are file references the flow itself kept. One taken from the action's input is written as given, and reading it from a run whose session or person does not own the file throws `AttachmentUnavailableError`. Files sent in the HTTP body's `attachments` are the ones checked and claimed. Skipped when a request continues after a suspend or crash, and when the input fails validation. |
| `taskOf` | `(input) => string \| undefined` | none | Names the task the request is for. A non-empty id is stamped as `taskId` on the `userMessage` item and every item the request emits, unless a nearer scope marks another task. `undefined` or `""` stamps nothing. The id is a label, never used to route or authorize. |
| `tokenBudget` | `{ maxTotalTokens, warnAt?, onExceeded? }` | none | See [Token budgets](#token-budgets). |
| `durable` | `boolean` | `false` | Has no effect. Every request suspends, resumes and recovers from a crash whether or not it is set. See [Pause, resume and replay](./durable-execution.md). |
| `concurrency` | `ConcurrencyConfig` | `request.concurrency`, else `"allow"` | What a second request on the same key does. See [Concurrency policies](./concurrency.md). |
| `autoResume` | `boolean` | `true` | Whether a request on this entry becomes the session's auto-resume target, the request a client that attaches to the session reattaches to. With `false` the request is recorded and listed, and the target remains on the request before it. For a control action sent beside a running request. |
| `onCompleted`, `onErrored` | `BlockDefinition` | none | Hooks for this action. They are blocks, not functions. See [Lifecycle hooks](#lifecycle-hooks). |

### Token budgets

The budget is checked once, after the block returns, against the tokens counted across the request's model calls. Generator and evaluator results, tool-loop steps, an evaluator a generator calls as a tool and schema-repair calls count. Runs of a coding-agent block (Claude Code, Codex, Cursor) do not count toward it. A request that suspends and resumes keeps one count.

| Setting | Result |
|---|---|
| `maxTotalTokens` | The limit. Over means consumed is greater than this. |
| `warnAt` | A fraction of the limit. At or past it, and not over, a transient `status` item reads `Token budget warning: consumed <n> of <max>` and the request completes. The item has `detail.code` `system.token_budget_warning`. |
| `onExceeded: "error"` (default) | The request fails with a `validation_error`: `Token budget exceeded: consumed <n> > <max>`. |
| `onExceeded: "stop"` | A transient `status` item reads `Token budget exceeded: consumed <n> of <max>`. The request ends `incomplete`. `onCompleted` hooks do not run; `onFinished` does, with status `incomplete`. |
| `onExceeded: "warn"` | The same one `status` item, and the request completes. |

### A generator action with no `itemVisibility`

`defineFlow` calls `console.warn`, prefixed `[flow-state-dev]`, for an entry of `actions` whose block is itself a generator and sets no `itemVisibility`. Such a generator emits no items, so a chat on the action renders nothing. Set `itemVisibility: { client: true, history: true }` to show the reply, or `{ client: false, history: false }` to keep it headless. It is a warning, never a throw.

| It fires | It does not fire |
|---|---|
| Once per process for each flow kind and action, when the flow is built, including an action an instance override adds. | A generator that sets `itemVisibility` in any form. A handler action. `internal`, `task`, webhook and schedule entries. A sequencer whose generator steps are silent. `NODE_ENV=production`. `FSD_QUIET_WARNINGS=1`. |

## Entries no caller names

| Map | Declared as | Reached by |
|---|---|---|
| `internal.actions` | `internal: { actions: { name: block \| { block, ...fields } } }` | A `dispatcher()` block. No HTTP, MCP, webhook or schedule caller reaches one: the way in decides the kind of dispatch, never the request body. |
| `task.actions` | `task: { actions: { name: ... } }` | A `dispatcher({ action, session })` placed as a worker on a task board. Each entry sits behind the board's claim gate. An entry no board addresses throws at definition unless it declares `from`. See [Task board](./task-board.md). |

A flat `internal: { name: ... }` without `actions` throws. Both maps are definition only. A dispatch resolves one map and never falls through to the other, so an entry of the same name in `actions` does not stand in.

A `dispatcher()` with no `flowKind` resolves on its own flow's `internal.actions`, checked when the flow is defined. With `flowKind` it resolves on another registered instance's, checked when it runs. How a dispatch resolves, what it returns and the `DispatchRefusedError` it throws are in [Background work](./background-work.md#dispatch).

### Schedules in a flow

`schedules` takes `static`, `resolve` and `index`. What each key does, which flows the tick reaches and the fields of a `ScheduleConfig` are in [Schedules](./schedules.md#the-flows-schedules-option) and [What calls the tick?](./schedules.md#what-calls-the-tick).

## Session settings

`session` takes these fields.

| Field | Type | Default | What it does |
|---|---|---|---|
| `stateSchema` | Zod object | none | The session state shape. A new session's initial state is parsed through it, so every declared key starts at its default. A top-level `.readonly()` field is set when the session is created and never changes. A write that would change it fails with `ReadonlySessionStateError`, code `readonly-session-state`, whoever writes and through every write path. Readonly fields are also the only fields the session listing filters by (`?state.<field>=` over HTTP, `listSessions({ state })` in the client). Only a plain `z.object` at the top is read for readonly fields. |
| `client` | `{ expose?: string[] }` | exposes nothing | See [Client exposure](#client-exposure). |
| `metadata` | Zod schema | none | Declares the shape of session metadata for typing only. `ctx.session.setMetadata()` and the metadata route do not check against it, so a value outside the schema is stored. `setMetadata` shallow-merges into the stored metadata. |
| `retention` | `{ maxItems?, maxAge? }` | unbounded | See [Retention](#retention). |
| `historyWindow` | `{ turns: number }` | `50` | How many of the most recent past turns load as cross-turn history for each request. Counts completed requests and requests cut short when their server died. Interrupted requests that were retried, and requests parked on a gate, take a slot in the window but are not shown, so a full window can show fewer than `turns` turns. It limits the default generator's in-prompt history; the full session stays readable through the state endpoint. `history({ limit })` refines within the window and cannot widen it. `0` or a negative number gives no cross-turn history. |
| `cas` | `{ maxRetries?, baseDelayMs? }` | `3` retries, `10` ms | Retry budget for session writes that collide. The same option exists on `user` and `org`, not on `request`. |
| `createCheck` | `(input) => { ok: true } \| { ok: false, message, status? }` | none | Runs before a session of this flow is written, on every path that creates one. See [Creating a session](#creating-a-session). |
| `serverOwned` | `string[]` | none | Session-state fields only the flow's own code writes. A create that carries a value for one is refused `400` with `{ error: "Session state field \"<field>\" is written only by flow \"<kind>\"; a caller cannot set it.", field }`. State a dispatching block names for its child session is not caller state and is not refused. |

### Client exposure

State is private by default. A field reaches a client only when its scope's `client.expose` names it.

| Scope | `client` config | What a client can read |
|---|---|---|
| `session` | `{ expose? }` | The names in `expose`, and every top-level `.readonly()` field. |
| `user` | `{ expose? }` | The names in `expose`. |
| `org` | `{ expose? }` | The names in `expose`. |
| `request` | none | Nothing. |

A scope with no `client`, or an empty `expose`, sends nothing, and `clientData.<scope>` is left out of the state read. `expose` copies each value after the schema's defaults apply. The state read takes `?clientData=session.foo,user.bar` to choose names. A `client` config that names a key the schema lacks throws at definition. A resource has its own `client` config and is not governed by these. See [Resources](./resources.md).

### Creating a session

`createCheck` receives `{ principal: { userId, orgId, tenantId? }, sessionId, flow: { kind, id }, state, via, readCollectionResource(ref, topic) }`. `state` is the initial state after `stateSchema` parsed it. `via` is `"create"`, `"action"`, `"webhook"`, `"cli"` or `"dispatch"`. `readCollectionResource` reads one item of a user- or org-scoped collection of this flow at the creating principal's own scope, and throws for any other ref. A refusal answers with its `status` (`400`, `403` or `404`, default `400`) and `{ error: <message> }`, and writes nothing.

| Case | What happens |
|---|---|
| A turn on an existing session | `createCheck` does not run. |
| A create that lost a race | It does not run again. The create route answers `409 { error: "Session \"<id>\" already exists" }`. The action, webhook and CLI paths adopt the winner. |
| The initial state does not fit `stateSchema`, on a flow that binds its sessions (it declares a top-level `.readonly()` field or a `createCheck`) | Refused `400` with `{ error: "The initial state of a session of flow \"<kind>\" doesn't fit its stateSchema at \"<path>\": <issue>", field }`, nothing written. |
| The same, on any other flow | The state is kept as sent and validated when the actions run. |
| An action sent to a session id that does not exist | It carries no initial state, so state is `{}`. On a flow whose sessions need state, a required readonly field or a check that reads it, it is refused `400` with the field named. Start such a session with the create route or `fsdev run --seed-session`. A webhook delivery for a missing session is refused the same way. |
| `fsdev run --seed-session <json\|file>` | Passes the initial state. A refusal exits `2` with the message, plus the hint `Pass the session's initial state with --seed-session.` when a `createCheck` exists and no seed was given. A seed may not set a `serverOwned` field or change a readonly one. |
| A session id that was deleted | Creating it again starts with only what that create names. |
| A dispatch into a key-derived child session | The child's state comes from the dispatching block. The same `createCheck` and readonly rules apply. An existing child is adopted only when its readonly state matches what the dispatch names. |

### Retention

Retention runs only when a request on the session ends `completed`, so a session nothing is written to does not shrink.

| Rule | Detail |
|---|---|
| Settings | `{ maxItems?, maxAge? }`. Neither set means no retention. `maxAge` is milliseconds or a string `<number><ms\|s\|m\|h\|d>` such as `"30s"`, `"2h"` or `"7d"`. Anything else throws `Invalid duration string` when the request starts. |
| When it runs | After a request ends `completed`, on that session. |
| What is evicted | Whole past turns, oldest first by when each ended. A past turn is a `completed` request, or an `interrupted` one whose server died. A `failed` request is never evicted. |
| Order | `maxAge` first: turns that ended more than `maxAge` ago. Then `maxItems`: walking newest first, turns are kept while the running item total, counting the current request and every protected request, stays within `maxItems`. `maxItems: 0` evicts every prior turn. |
| Never evicted | The current request. A request that is running, or whose run finished within the grace window (60 seconds by default). An interrupted request waiting at a pending gate, or one the server will run again after a crash ([Pause, resume and replay](./durable-execution.md)). A protected request counts toward `maxItems`, so a busy session can briefly exceed its limits. |
| A run's end | When it has finished writing, including `onFinished` and the background work it started. |
| Deleting a request | Removes its record, items, event log and cached step results, and ends live streams of it. |

## Request settings

| Field | Type | Default | What it does |
|---|---|---|---|
| `stateSchema` | Zod object | none | Request-scoped state. |
| `onStarted`, `onCompleted`, `onErrored`, `onFinished` | `BlockDefinition` | none | Lifecycle hooks. See [Lifecycle hooks](#lifecycle-hooks). |
| `heartbeatIntervalMs` | `number` | `10000` | How often a running request reports that it is alive, and how often it looks for a cancel sent from another process. `0` turns both off. A cancel sent from another process then never reaches the run, and a run longer than 60 seconds (the default stale threshold) can be marked `interrupted` while it is running. Each run checks for a cancel once as it starts. |
| `sseHeartbeatMs` | `number` | `15000` | How often a `: ping` comment frame goes down this flow's streams. `0` turns it off. A flow value beats the host default. |
| `concurrency` | `ConcurrencyConfig` | `"allow"` | The default for every entry that sets none. |
| `mutationTimeoutMs` | `number` | `30000` | Budget for writes to block state held in memory for the request, the state `ctx.targets` and `ctx.sequencer` address. A write past it rejects with `ScopeMutationTimeoutError`. `Infinity` turns it off. Does not apply to `request`, `session`, `user` or `org`. |
| `cleanupCheckpointsOnTerminal` | `boolean` | `false` | Delete durable sequencer checkpoints when the request ends. |

## User and org records

`user` and `org` take `stateSchema`, `cas` and `client`. They have no retention, history window or metadata. Each is one record, shared by every flow on the server unless the flow sets an isolation flag.

Who owns each stored part, who can see it, where it is stored and how many exist are in [Stores](./stores.md#what-each-stored-part-is). A copy's `config` is never stored: see [Settings a copy carries](#settings-a-copy-carries).

## State a block declares

A block can declare session, user and org state fields (`sessionStateSchema`, `userStateSchema`, `orgStateSchema`). `defineFlow` merges every declaration of each scope, from the flow, each block it reaches and each capability they use, and throws when two disagree on a field. A capability counts by its top-level schemas when the block lists it statically, and so do the capabilities it depends on; a preset, a config resolver, a dynamic entry and `requestStateSchema` contribute none ([Capabilities](./capabilities.md#what-a-preset-can-declare)). A read of the scope's state fills in the merged schema's defaults. The merged schema does not check writes.

The error is `ScopeStateSchemaConflictError`, exported from `@flow-state-dev/core/helpers`.

| Field | Holds |
|---|---|
| `conflict` | `"type"` or `"default"` |
| `path` | The field, such as `session.state.mode` |
| `first`, `second` | The two declarers |
| `detail` | How they disagree, naming both |

```text
Flow "support": session.state.mode is declared twice with different defaults: block "planner" defaults it to "plan" and block "writer" to "write". Declare one default, or share one schema for the field.
```

A type conflict reads `... is declared twice with different types: block "a" types it as string and block "b" as number. Declare one type, or share one schema for the field.` It applies at any depth, and to a field typed `.nullable()` on one side only.

Two declarations agree, and do not conflict, when:

- they are the same schema object;
- only one of them names the field, at any depth, and the fields are merged;
- one adds outer wrappers (`.default()`, `.optional()`, `.readonly()`) to the other;
- both give the same static default.

They are refused when they give two different types (`.nullable()` is part of the type), two different static defaults, or wrappers that differ any other way. Two declarations agree on a default factory only when it is the same function.

A block or capability may declare a default factory only when it restates the flow's own session factory. In user and org scope, use a static default.

## Running several copies of one flow

`cardinality` decides how many copies a definition runs as.

| Value | Instances | Id |
|---|---|---|
| `"singleton"` (default) | One. | Its `kind`. The factory takes no id, or the kind spelled out. Registering it under any other id is refused. |
| `"collection"` | Several. | An explicit non-empty `id` on every instance, and that id is the only address it answers to. The bare kind never selects a member. |

A collection definition is readable without an id (`supportFlow.cardinality`, `supportFlow.actions`). Calling it with no id throws `Flow "<kind>" has cardinality "collection", so every instance needs an explicit id`. An empty id throws `Flow "<kind>" instance id must be a non-empty string`.

Registration refuses with `FlowIdentityConflictError`, naming a `reason`, and leaves the registry as it was.

| `reason` | When |
|---|---|
| `duplicate-id` | Any instance, of any kind, already holds the id. |
| `singleton-id-mismatch` | A singleton under a custom id. Declare `cardinality: "collection"`. |
| `mixed-cardinality` | One kind registered under both policies. |
| `invalid-cardinality`, `invalid-id` | The value is not valid. |
| `unminted-config` | A definition, not an instance, whose `configSchema` does not parse `{}`. Register `supportFlow({ config })`, not the `defineFlow` result. |

`createFlowState({ flows })` takes a list of instances and serves each under its own `flow.id`. The option itself, and `register` and `unregister` while the server runs, are in [Runtime](./runtime.md).

### Settings a copy carries

`configSchema` is what a copy may be created with, and blocks read it as `ctx.flow.config`. Anything a copy is given goes in `config`. Anything a copy learns goes in its own isolated state.

| Rule | Detail |
|---|---|
| Shape | A plain `z.object({ ... })`. A union, an intersection, an object wrapped in `.refine()`, or a `.catchall(...)` throws where the flow is defined. Put open-ended data in one declared key whose schema is a record. |
| Parsing | The factory's `config` is parsed against it and frozen one level deep, so a nested object is mutable. Omitting `config` parses `{}`: defaults apply, and a required setting throws at the factory call. |
| Closed keys | A top-level key the schema does not declare throws: `"<key>" is not a declared setting`. A nested object is closed only if written `.strict()`. Otherwise an undeclared nested key is dropped. |
| No schema | `config` on a flow with no `configSchema` throws. `configSchema` passed as an instance option throws. |
| Storage | Never persisted, never on the wire, no part of any storage key. A request that resumes after a deploy runs on the settings the process started with. |
| Block requirements | A block's `flowConfigSchema` declares what it needs of any flow it is installed on. A flow with no `configSchema` that reaches such a block throws at definition. A bag the block cannot read throws at the factory call, naming the flow, instance and block. A `flowConfigSchema` that would change the bag (a default, a transform, a coercion) throws. Put the default on the flow's `configSchema`. |

A definition carries `kind`, `cardinality`, `requireUser`, `config`, `requiresConfig` and `actions`. `requiresConfig` is `true` when its `configSchema` does not parse `{}`. An instance carries `id`, `kind`, `cardinality`, `requireUser` and `config`, which is a frozen empty object when there is no `configSchema`.

### What a request names to reach one copy

Every way in names an instance by its id. For a singleton the id is its kind.

| Way in | The id goes |
|---|---|
| HTTP action routes | In the segment after `/api/flows`: `POST /api/flows/support-east/actions/reply`. See [HTTP API](./http-api.md#reaching-one-copy-of-a-flow). |
| CLI | `fsdev run support-east reply`. See [CLI](./cli.md). |
| Client | `createClient(...).flow("support-east")`. A session listing filters by `flowKind` (the definition) and `flowId` (the exact instance). |
| Queue job | `flowKind` is the instance's id. See [Background work](./background-work.md#queued-runs). |
| Webhooks, schedules, MCP | The instance the binding, schedule or server belongs to. |

The kind of a collection is not an address. With only `support-east` and `support-west` registered, naming `support` reaches no copy, and no fallback picks one.

A session, and every request under it, records the instance that created it as `flowId` and the definition's kind as `flowKind`.

### Which flow governs a record

The instance a stored record names governs it, never the one the caller addressed. A session or request another instance owns is refused, and nothing is written. Over HTTP that is `409 wrong-instance-session` or `409 wrong-instance-request`, and another user's session answers `404` before the instance is checked. Every status and body is in [HTTP API](./http-api.md#what-a-wrong-session-returns). A `runAction` call from code rejects with `FlowInstanceBindingMismatchError` (`record: "session" | "request"`, `recordId`, `addressedFlowId`, optional `reason`).

## Isolation flags

By default every flow on the server shares one user record per user and organization, and one org record per organization. The flags give a flow records of its own. "Isolated" is per instance id. For a singleton the instance id is its kind, so isolating it gives it one record per user.

| Flag | Value | What it does |
|---|---|---|
| `isolateUserState` | omitted or `false` | The flow's `user` record is the one every flow shares for that user in that organization. Its `stateSchema` joins a check at registration. Two flows declaring the same field with a different type, or a different default, are refused with `CrossFlowSchemaConflictError`. Identical schemas merge. A field only one of the flows declares merges with a `console.warn`. User-scoped resources with no `flowIsolation` of their own are shared too. |
| `isolateUserState` | `true` | The `user` record is keyed to the instance, so no other flow sees it and its `stateSchema` drops out of the check. Two copies of a collection are isolated from each other as well. User-scoped resources that do not set `flowIsolation` default to isolated. |
| `isolateOrgState` | omitted, `false`, `true` | The same three states for the `org` record and org-scoped resources. Independent of `isolateUserState`. |
| resource `flowIsolation` | `true`, `false` or omitted | Beats the flow flag for that resource, in both directions. Omitted follows the flag for its scope. The flag itself governs the scope record (`ctx.user.state`, `ctx.org.state`). Rules, and the throw on session scope, are in [Resources](./resources.md#scopes-and-sharing). |

`CrossFlowSchemaConflictError` fires when a flow is registered, at startup for `createFlowState({ flows })` and at the call for a runtime `register`. It names the flows, the scope (`user` or `org`), the field (`stateSchema` or `resources.<ref>`) and a reason: `incompatible-shape`, `incompatible-types`, `secret-mismatch` or `incompatible-default`. The message ends with the remedy, `Set isolateUserState: true on one of the flows to opt out of cross-flow sharing, or reconcile the schemas.`, or the `flowIsolation: true` or distinct `ref` fix for a resource. A failed registration leaves the registry as it was.

Turning the flag on, or renaming an instance, points the flow at a different record. The earlier one stays in the store and nothing reads it.

Limits of the check: a collection pattern that overlaps a concrete ref is not caught, and two instances of one kind with different per-instance `resources` overrides are not compared.

## Lifecycle hooks

Hooks are blocks, not functions. `request.onStarted`, `onCompleted`, `onErrored`, `onFinished` and the action's `onCompleted` and `onErrored` each take a `BlockDefinition`. Each runs as its own block beside the action's block, and what the action's block emitted stays in the session's items. They observe: nothing they return changes the request's result. Each takes one input object. A block's own `onCompleted` and the tool hooks are set on a block, and are in [Blocks](./blocks.md).

| Hook | Fires | Input | If it throws |
|---|---|---|---|
| `request.onStarted` | When the request starts, before the action's block. | `{ requestId, actionName }` | The failure propagates and `runAction` rejects with it. |
| `action.onCompleted` | After the block returns, when the request ends `completed`. Not for `incomplete`, `failed`, `aborted` or `interrupted`. Runs before the request hook. | `{ requestId, actionName, output }` | Propagates as a failure of the request. |
| `request.onCompleted` | The same condition, after `action.onCompleted`. | `{ requestId, actionName, output }` | The same. |
| `action.onErrored` | When the request fails. | `{ requestId, actionName, error }` | Swallowed. The primary failure is kept. |
| `request.onErrored` | When the request fails, after `action.onErrored`. | The same. | Swallowed. |
| `request.onFinished` | Once when a request's run ends, whatever the ending: `completed`, `incomplete`, `failed`, `aborted` or `interrupted`. After the terminal status is recorded and emitted, and after `onCompleted` or `onErrored` where those run. | `{ requestId, actionName, status, output? }` for `completed` and `incomplete`; `status: "failed"` with `error`; `status: "aborted"`; `status: "interrupted"`. | Swallowed on `failed`, `aborted` and `interrupted`. |

On success the order is `onStarted`, the block, `action.onCompleted`, `request.onCompleted`, `onFinished`. On failure it is `onStarted`, the block, `action.onErrored`, `request.onErrored`, `onFinished`.

- A request that suspends at a gate (`ctx.suspend`) ends the run as `suspended`. `onCompleted`, `onErrored` and `onFinished` do not run then, and none runs until a resumed run ends.
- A token budget with `onExceeded: "stop"` ends the request `incomplete`: `onCompleted` hooks are skipped and `onFinished` reports `incomplete`.
- A cancel accepted before the completion hooks ends the request `aborted`, skips `onCompleted`, and `onFinished` reports `aborted` once.
- Work a hook queues as a side chain is waited for before the request settles. The request's record is not evictable until `onFinished` and that work have finished.
- `request.onStepErrored` is accepted by the type and nothing runs it. Do not rely on it.
- A plain function in a `request` hook throws a `TypeError` when the flow is defined.

## How a module counts as a flow

| Where | Rule |
|---|---|
| `createFlowState({ flows: [...] })` | A list of instances, each made by calling the factory (`export default supportFlow({ ... })`). Two with one id throw `FlowIdentityConflictError` with reason `duplicate-id`. A bare `defineFlow(...)` result is admitted only when it is a singleton whose `configSchema`, if any, parses `{}`. |
| Directory discovery (`fsdev run` and `fsdev dev` with no config) | Where it looks is in [CLI](./cli.md#flow-discovery). A module counts when its default export is an object with a string `kind` and an object `actions`. A callable `defineFlow(...)` does not. A module that exports no flow is skipped silently. Duplicates are dropped by instance id, first discovered wins, silently. |
| `fsdev.config.*` | Default-exports a `FlowState`. Its registry is used and discovery does not run. |
| A single flow file | A default export that is not a flow instance fails with `Default export is not a valid FlowInstance (must have kind and actions)` and exit `4`. |

## Next

- [Flows and actions](../concepts/flows-and-actions.md) builds the model this page tabulates.
- [State and scopes](../concepts/state-and-scopes.md) explains the session, user and org records the flags move.
- [Concurrency policies](./concurrency.md) lists what `concurrency` on an action does.
- [HTTP API](./http-api.md) lists every route a request reaches a flow through.
