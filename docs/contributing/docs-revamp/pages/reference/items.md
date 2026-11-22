---
title: Items and the stream
type: reference
description: "Every item type and its fields, how an item moves from added to done, who sees it, what is saved, the event stream and how to resume it by sequence number, the heartbeats, and the trace events."
---

import Figure from "@site/src/components/Figure";
import ItemsLife from "./figures/items-life.svg";

# Items and the stream

A request, one run of an action, produces more than an answer. It writes a reply that grows as the model produces it, runs tools, sets a status line, hands the browser a card to draw, changes state. Flow State records each of these as an item and sends every item to the caller as the request makes it, so a screen can draw a reply while it is being written.

For each item, the tables below say whether the client receives it, whether the model sees it on the next turn, and whether it is saved. Every event in a request also has a sequence number, so a client that loses its connection names the last number it applied and asks for everything after it.

The examples use the `support` flow. Its `handleTicket` action runs `showOrder`, which draws an order card, then `draftReply`, which answers the user and may call the `lookUpOrder` tool.

```ts title="src/flows/support/blocks/show-order.ts"
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { findOrder } from "../../../lib/orders";

export const showOrder = handler({
  name: "show-order",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async (input, ctx) => {
    ctx.emit.status("Looking up the order");
    const order = await findOrder(input.orderId);
    if (!order) return { shown: false };
    ctx.emit.data("order-card", { orderId: input.orderId, status: order.status }, { key: input.orderId });
    return { shown: true };
  },
});
```

```ts title="src/flows/support/blocks/draft-reply.ts"
import { z } from "zod";
import { generator } from "@flow-state-dev/core";
import { lookUpOrder } from "../tools/look-up-order";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Be brief and specific.",
  inputSchema: z.string(),
  user: (input) => input,
  tools: [lookUpOrder],
  itemVisibility: { client: true, history: true },
});
```

```ts title="src/flows/support/tools/look-up-order.ts"
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import { findOrder } from "../../../lib/orders";

export const lookUpOrder = handler({
  name: "look-up-order",
  description: "Look up where an order is. Use it when the customer gives an order id.",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.string(),
  execute: async (input) => (await findOrder(input.orderId))?.status ?? "No order with that id.",
});
```

One run of `handleTicket` sends a status item, a keyed `data` item, a `tool_output` item for `lookUpOrder`, and a `message` item for the reply. The status item is live only, because `status` is not saved by default (see [What persists](#what-persists)).

## An item's life

<Figure svg={ItemsLife} caption="An item is added, grows, and is finished once" description={"Three boxes in a row. The first is the item.added event, status in_progress, where the draftReply message starts empty. The second is the content.delta event, status in_progress, where the message gains text. The third, highlighted, is the item.done event, status completed or incomplete or failed, which carries the whole item. Solid arrows run from the first box to the second and from the second to the third. Two dashed arrows apply in one case each. The first runs from the first box straight to the third, for a message, data or status item that a block emits, which skips the middle. The second runs from the third back to the first, for a keyed data item emitted again. A note says item.updated can arrive at any point, even after item.done, and replaces the top-level keys it names."} />

How each kind of item moves:

| Item | Events, in order |
| --- | --- |
| A generator's `message` or `reasoning` | `item.added` (`in_progress`, text empty), `content.added`, any number of `content.delta`, `content.done`, `item.done` (the whole item, with a terminal status). A `reasoning` item is done when the message text begins. |
| A `message`, `data` or `status` item a block emits | `item.added` and `item.done` together, both `completed`. There is no `in_progress` phase. |
| A keyed `data` item emitted again | Takes the same `id`, and arrives again as `item.added` and `item.done`, both `completed`. The saved copy is one entry per `(requestId, key)`. The event log keeps each emission. |
| `tool_output` | `item.added` before the tool runs, with `toolCall` and `in_progress`. `item.updated` with `status` and `output` when the tool settles. It ends `completed` or `failed`, and a failed one carries `error`. |
| `block_trace` | `item.added` (`in_progress`, `input` known), any number of `item.updated` patches (connected input, the generator's model call, model usage), then `item.done` with `output` and timing. The `id` stays the same. |
| `container` | `item.added` when the scope opens, `item.updated` with `status`, `completedAt`, `duration` and `error` when it closes, then `item.done`. |

Rules for `item.updated`:

| Rule | Detail |
| --- | --- |
| Merge | A shallow, top-level merge. Each key in `patch` replaces that key on the consumer's copy. Re-send a nested object whole. |
| Keys that never apply | `id`, `type`, `provenance`, `itemVisibility`, `transient`. They are stripped from every patch. Exported as `ITEM_UPDATE_INVARIANT_KEYS`. |
| Unknown id | An update for an id the emitter never saw is dropped. |
| After `item.done` | Applies. A done item is not frozen. |

## What every item has

| Field | Meaning |
| --- | --- |
| `id` | Unique within one request, not within a session. Two requests can keep items with the same `id`, and a keyed item derives its `id` from its key. Use `requestId` plus `id` as a list key. |
| `type` | One of the types below. |
| `status` | `in_progress`, `completed`, `incomplete` or `failed`. The last three are terminal. A `block_trace` also takes `planned`. |
| `requestId` | The request that made the item. A session shows the items of all its requests as one timeline. |
| `itemIndex` | The item's place in its request, in the order the request reserved it. |
| `provenance` | The block that made it: `blockName`, `blockInstanceId`, `phase` (`"main"` or `"sideChain"`), and optionally `blockDefinitionId`, `parentBlockInstanceId`, `stepIndex`, `sideChainGroupId`, `attempt`. |
| `ts` | Creation time in milliseconds. |
| `transient` | Optional. The item is sent live and not saved. See [What persists](#what-persists). |
| `ownedBy` | Optional. The `blockInstanceId` of the sequencer or router whose `container` the item was emitted inside. |
| `taskId` | Optional. The task a task-board worker marked active when it emitted the item. |
| `itemVisibility`, `agentName` | Optional. Stamped by the generator that made the item, or by an emitter option. `agentName` defaults to the generator's block name when `itemVisibility` is set. |
| Display order | `ts`, then `itemIndex`, then `requestId`, then `id`, on the server and the client, so a live view and a reload agree. `compareItemOrder` exports it. |

## Every item type

The public union, `OutputItem`, has the first thirteen rows. The trace types in [Trace events](#trace-events) are not in `OutputItem`. `tool_call_progress` arrives on the stream and is in no item union.

| Type | Made by | Fields beyond the common ones |
| --- | --- | --- |
| `message` | A generator that sets `itemVisibility`; `ctx.emit.message`; the user's own message, echoed by the action's `userMessage` | `role` (`assistant`, `user`, `system`, `developer`, `tool`; the framework writes `user` and `assistant`), `content: Content[]`, `model?`, `metadata?` (set by a handler, never sent to a model) |
| `reasoning` | A generator whose model reasons | `summary: Content[]`, `model?` |
| `tool_output` | A generator's tool loop; a block wrapped with `.asTool()` and run from a sequencer step | `blockName`, `output`, `modelOutput?` (only when the tool declares `mapModelOutput`), `outputOmitted?`, `toolCall { callId, name, alias?, arguments, generatorBlock, stepNumber? }` (`arguments` is a JSON string), `error? { message, code?, details? }`, `cached?`, `cacheAgeMs?`, `sourceTask?`, `model?` |
| `data` | `ctx.emit.data(dataType, value, options?)`; packages that emit their own | `dataType`, `value` (an object), `key?` |
| `container` | A sequencer or router that declares `container` | `blockName`, `component?`, `label?`, `metadata?`, `startedAt?`, `completedAt?`, `duration?`, `error? { message }` |
| `source` | A provider-native tool such as web search | `sourceType: "url"`, `sourceId`, `url`, `title?`, `providerMetadata?`, `model?` |
| `status` | `ctx.emit.status` | `message`, `detail?`, `blocked?` (`false` lets the client send new actions while the stream is open), `sideChainTasks?` |
| `error` | The runtime, when the request fails | `message`, `code?`, `details?` |
| `state_change` | A state write in the request, session, user, org or block scope | `scope` (`request`, `session`, `user`, `org`, `block_instance`), `operation` (`patch`, `set`, `increment`, `push`, `delete_key`, `atomic`), `path?`, `version`, `delta?`, `blockInstanceId?` |
| `resource_change` | A resource write | `scope` (`request`, `session`, `user`, `org`), `resourcePath`, `changeType` (`created`, `updated`, `deleted`), `delta?`, `version?` |
| `suspension` | A block that calls `ctx.suspend()` | `suspensionId`, `suspensionStatus`, `reason` (`user_approval`, `user_input`, `external_event`, or a string you choose), `message`, `kind?` (`approval`, `review`, `input`), `title?`, `expiresAt?`, `data?`, `resumeSchema?`, `render? { component, props? }`, `resumeData?`, `allow?` (`approve`, `reject`, `submit`, `skip`), `blockInstanceId?` |
| `suspension_resume` | The runtime, when a suspension is resolved and the same request continues | `suspensionId`, `resolution` (`pending`, `approved`, `rejected`, `submitted`, `skipped`, `timed_out`, `expired`, `stopped`, `cancelled`), `resolvedBy?`, `resumeData?`, `resolvedAt` |
| `continuation` | The runtime, when a request interrupted by a crash re-enters through `/continue` | `trigger: "recovery"`, `priorItemCount`, `resumedAtPath?`, `continuedAt` |
| `tool_call_progress` | A generator that sets `itemVisibility`, while a tool call streams, or after it when the model call is not streamed. Sent as `item.added` then `item.done`. | `toolCallId`, `toolName`, and `argsDelta` (on the call chunk) or `result` (on the result chunk). Always `transient: true`, and carries the generator's `itemVisibility`, `agentName` and `model`. |

[Pause, resume and replay](./durable-execution.md) defines a pending suspension and what resolves one.

| Across one pause | Order |
|---|---|
| Items on the request | Items made before the pause, then `suspension` with `suspensionStatus: "pending"`, then `suspension_resume`, directly after the `suspension` it resolves, then items made after the block resumed. It is one log: `sequence_number` and `itemIndex` keep counting. |
| A crash continuation | Resolves no suspension, so it writes a `continuation` item instead of a `suspension_resume`. |

### Values on items

| Case | What you get |
| --- | --- |
| `message.content`, `reasoning.summary` | `Content[]`: `output_text`, `reasoning_text`, `refusal`, `file`, `output_audio`. |
| `output_audio` | Streamed to the client and never saved. Content marked `ephemeral: true` is stripped before a request's items are saved. |
| A `tool_output` for a tool that suspended | Saved as a `failed` item with `error.code === "SUSPENSION"`. Its real result replaces it when the answer resumes the run. `isSuspensionWait(item)` tests for it. |
| A `tool_output` or `block_trace` value over the record limit | `output` and `modelOutput` are absent, and `outputOmitted` (or the trace's `output`) holds `{ kind: "omitted", bytes, preview }`. The limit is 256 KiB serialized, set per server with `maxRecordedValueBytes`. `preview` is the first 512 characters. `bytes` is `null` when the value could not be serialized. |
| A resume that must hand on an omitted value | Fails with `RECORDED_VALUE_OMITTED`, naming the block. The run keeps the full value. The record, the stream and later prompts see the placeholder. |
| A `data` item with no renderer | On the stream and in the session, and draws nothing. Code reads it back by `dataType`. |

### Emitting from a block

| Call | Saved by default | Reaches |
| --- | --- | --- |
| `ctx.emit.message(text \| Content[], { itemVisibility?, agentName?, transient?, metadata? })` | Yes. Role `assistant`. | The client and model history. Inside a generator's scope, an emit with no `itemVisibility` of its own takes the generator's. |
| `ctx.emit.data(dataType, value, { key?, itemVisibility?, agentName?, transient? })` | Yes | The client, not model history, unless `itemVisibility` says otherwise. An enclosing generator's `itemVisibility` is not inherited. With `key`, the latest `value` replaces the earlier one. Without it, each call is its own item. |
| `ctx.emit.status(message \| undefined, { blocked?, sideChainTasks?, transient? })` | No. Pass `{ transient: false }` to save it. | The client, as one request-wide slot. A repeated identical message is dropped. `undefined` keeps the text and updates only `blocked` and `sideChainTasks`. |

### Items other packages emit

| Item | Emitted by | Carries |
| --- | --- | --- |
| `data` `task-change` | A task board, and every pattern built on one | `{ collectionId, taskId, kind, task, prevStatus? }`, keyed `${collectionId}/${taskId}`, visibility `{ client: true, history: false }`. `task` is the task after the change, without `claimedBy`, `createdBy`, `filer` and `filedUnder`. `kind` is one of `added`, `claimed`, `completed`, `errored`, `retried`, `retry_requested`, `held`, `released`, `settings_changed`, `resumed`, `cancelled`, `label_changed`, `metadata_changed`, `priority_changed`, `assignee_changed`, `run_linked`, `progress_reported`, `resume_settled`, `steered`, `cancel_owed`, `wait_changed`, `asked`, `answered`. |
| `data` `task-board-meta` | A task board | `{ collectionId, status, counts?, terminationReason?, maxTotalRetries? }`, keyed `collectionId`, same visibility. `status` is `active` at the top of a pass and `completed` at its end, with `counts` (`total`, `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`, `retries?`) and `terminationReason`. Reasons include `all-completed`, `blocked-by-failures`, `retry-budget-exhausted`, `dispatched`, `waiting-on-a-user` and `waiting-on-an-event`. Plan and Execute also writes `planning` at plan start, and `replanning` when `enableReplanning` is on and its evaluator returns replan. The type allows `synthesizing`, and no pattern writes it. |
| `data` `task-board-recorder-failure` | A task board | Reports that a task write was saved but the board could not send the `task-change` item for it. Visibility `{ client: false, history: false }`, so it reaches no client and no model. |
| `data` `goal-seek-loop-termination` | The goal-seek loop | `{ collectionId, reason, iterations }`, keyed `${collectionId}:goalSeekLoop-termination`, visibility `{ client: false, history: false }`. It is on the request's items and never on a client stream. `reason` is the judge's own string on `done`, `converged` when the judge gave none, `max-iterations`, `judge-error`, `waiting-on-a-user` or `waiting-on-an-event`. `iterations` counts the passes the loop completed; a pass that stopped to wait is not counted. |
| `data` `info-card`, `link-card` | The generative UI tools in `@flow-state-dev/ui` | The shape's fields, keyed from the input. `generativeRenderers` supplies the matching renderers. |

[UI components](./ui-components.md) lists the `task-plan` component that draws `task-change` and `task-board-meta`.

## Visibility

Visibility is two flags, `{ client, history }`. `client` means the item is sent to the client. `history` means it enters conversation history for later model calls. `resolveItemVisibility(item)`, exported from `@flow-state-dev/core/items`, is a pure function of the item's type and its `itemVisibility`.

| Item types | Resolved visibility |
| --- | --- |
| `message`, `reasoning`, `tool_output` | The item's `itemVisibility`, or `{ client: true, history: true }` with none. |
| `data` | The item's `itemVisibility`, or `{ client: true, history: false }` with none. |
| `status`, `error`, `container`, `source`, `state_change`, `resource_change`, `suspension`, `suspension_resume`, `continuation`, `tool_call_progress` | `{ client: true, history: false }`. Any `itemVisibility` stamp is ignored. |
| `block_trace`, `router_decision`, `state_snapshot`, `generator_step` | `{ client: false, history: false }`, whatever stamp they carry. |

A generator stamps its items with its `itemVisibility`:

| Value | Meaning |
| --- | --- |
| `{ client: true, history: true }` | The user-facing agent. The reply is shown and kept. |
| `{ client: true, history: false }` | Observable work, such as a sub-agent. |
| `{ client: false, history: true }` | Private context. |
| `{ client: false, history: false }` | Trace only. |
| Unset | **The generator emits no message, reasoning, tool progress or source items.** Each tool call emits its `tool_output` item all the same, visible to the client and to history, and the block emits its `block_trace`. The model and its tools run, and the typed output reaches parent blocks. |

[Flows and actions](./flows.md) covers the development warning for an action whose block is a generator with no `itemVisibility`.

Where visibility is applied:

| Where | What it drops |
| --- | --- |
| The HTTP stream, for a client connection | Every item whose resolved `client` is false, the `content.*` events of a dropped item, and `item.updated` for an item that connection never saw as client-visible. |
| The session snapshot (`GET /sessions/:id/state`) and the session stream | Show the same set: the request's items collapsed to their [canonical log](#what-persists), then those whose resolved `client` is true, or the types the caller names with `item_types`. |
| `<ItemsRenderer>` in React | Hides trace types, and a conversational item with `history: false` (sub-agent output) unless `showSubAgents` is set. `session.items` holds every client-visible item. |
| `useClientData` | Nothing is dropped on the wire: state changes for keys a flow does not expose arrive in the browser. `useClientData` applies a `state_change` only for keys the initial snapshot carries, ignores atomic operations, and holds changes that arrive before the first snapshot until it lands. |

### What a browser draws

| Rule | Detail |
| --- | --- |
| Renderers | `FlowProvider` takes a `renderers` registry. A `data` item resolves through `renderers.data[dataType]`, a container through `renderers.container[component]`, any other type through `renderers[type]`. A value of `false` suppresses the type. |
| Unregistered `data` | Draws nothing. |
| Suspensions | Fall back to a built-in approval, question, selection or form card. |
| Never drawn as a line | `state_change`, `resource_change`, `suspension_resume`, `continuation`. |
| Keyed items | `<ItemsRenderer>` shows only the latest item per key, at that item's place, within one request. `deduplicateByKey={false}` turns it off. Items with no key always show. |

## What persists

A request's record keeps its items, except every item with `transient: true` and every ephemeral content part. A transient item never appears in a saved record, including the copies saved while the request runs. While it runs, items are saved as they finish and as streamed text grows, so a saved in-progress message carries the text so far.

### Which items are stored

| Items | Stored? |
| --- | --- |
| `resource_change`, `state_snapshot`, `tool_call_progress` | Never. Always `transient: true`. |
| `status` | Only with `{ transient: false }`. |
| `state_change` | Transient when `NODE_ENV` is `production`. Stored otherwise. |
| `block_trace` | Unless its block is declared `transient: true`. Such a block streams its trace live and keeps none in the items. |
| `message`, `reasoning`, `tool_output`, `data`, `container`, `source`, `error`, `suspension`, `suspension_resume`, `continuation`, `router_decision` | Stored, unless emitted with `transient: true`. |
| Any item emitted with `transient: true` | Never. |

[Blocks](./blocks.md) covers the `transient` block option.

`transient` and `key` are independent:

| | No `key` | `key` |
| --- | --- | --- |
| Stored | Append-only. | One entry per `(requestId, key)`. The latest replays on reload. |
| `transient: true` | A one-shot. | Live only. The client replaces in place. |

[Client configuration](./client.md) covers how a client you write replaces a re-sent item by `id`. The `onItem` option of `runAction` is on the [engine API](./api/engine.md).

### What a resumed request shows

A request that suspended and resumed, or re-entered after a crash, can hold superseded copies of items. Every read that shows a history drops them: the session snapshot, `useSession`, the stream's seed and model history.

| Rule | Result |
| --- | --- |
| A block that suspended and was resumed | Only its post-resume emissions. `suspension` and `suspension_resume` items always stay. |
| Repeated `block_trace` items for the same block run | Only the last `completed` one. |
| A block re-run after a crash | Only the surviving run's items. |
| `tool_output` | One per call id. A `completed` one beats the earlier `failed` `SUSPENSION` one. A completed sibling with no re-run copy stays. |

[Pause, resume and replay](./durable-execution.md) covers what else a resumed request keeps.

### Where each stored part lives

| Part | Owned by | Visible to | Stored in | How many |
| --- | --- | --- | --- | --- |
| A request's items | The request record, so the user who made the request (and the tenant and org when it carries them) | The owner, through the session snapshot, the request stream and the status route. Others get a `404`. A client sees the items whose resolved `client` is true. | The request store's `items` array on the record: memory, filesystem, SQLite or Postgres | One entry per saved item. A keyed `data` item is one per `(requestId, key)`. Nothing caps a request's items. |
| A request's event log | The same record | The same owner. `starting_after` and `Last-Event-ID` read from it. | The request store, beside the record | One event per replayable emission: every event except `ping`, `debug`, `content.delta` and `content.audio.delta`. Events of transient items are included. Deleting the request deletes its events. |
| A request's trace | The request, by id | The DevTool, and any client that asks with `?include=trace`. The session snapshot never shows it. | A separate trace store, `stores.traces` | See [Stores](./stores.md). |
| The live stream buffer | The running request | The connection that holds it | Process memory | The newest 10,000 events, set per server with `maxResponseBufferSize`. |
| The session timeline | The session | Whoever may read the session | Assembled from the session's request records | One per session, with all its requests' items. |

How long request records last is set by `flow.session.retention`, covered with the [stores](./stores.md).

## Which items does the model see on the next turn?

| Step | Rule |
| --- | --- |
| Whether history loads | A generator reads history only when it sets `history`: `true`, an `ItemQuery`, or a slot function. With none, no earlier turns are assembled. `history: true` is `ctx.session.items.history()`. |
| Which types are eligible | `message`, `reasoning`, `tool_output`, `data`. A query can narrow with `itemTypes`. |
| Which eligible items enter | Those whose resolved visibility has `history: true`. By default `message`, `reasoning` and `tool_output` enter, and `data` does not unless its emitter set `itemVisibility.history: true`. |
| Never | `status`, `error`, trace and state records, and every transient item. |
| Window | History is read per earlier turn, oldest first, from at most `flow.session.historyWindow.turns` turns (default 50). A turn is a completed request, or one interrupted when its server stopped, which counts only the items it finished. The running request's own items are appended whatever the limit, unless the query sets `includeInFlight: false`. |
| `limit` | Turn-aligned. A number or `{ turns: N }` is N turns. `{ tokens: N }` packs whole turns from the newest, never splits one, and always includes the newest earlier turn even when it alone is over budget. |

How a history item reaches the model:

| Item | Becomes |
| --- | --- |
| `message` | One message with its text. A user message with files keeps them as references. A message with no text adds nothing. |
| `reasoning` | An assistant message. Reasoning with no text adds nothing. |
| `tool_output` | Two protocol messages: an assistant tool call and a tool result. The result is the failure text for a failed tool, `[The result of <tool> (<n> bytes) was too large to keep in the conversation history.]` for an omitted one, otherwise the output as text or JSON. |
| `data`, when opted in | One assistant line, `[<dataType>] <value as JSON>`. |

The views on the session timeline, `ctx.session.items`, each take an `ItemQuery`:

| View | Returns |
| --- | --- |
| `all(query?)` | Every session item. |
| `client(query?)` | Items whose visibility has `client: true`. |
| `history(query?)` | The LLM messages above. Async. |
| `selectForContext(query?)` | Raw `SessionItem[]` with no history filtering. Honors `itemTypes`, `includeTransient`, `itemVisibility`, `agentName`. |
| `turns(query?)` | Past turns. |

`ItemQuery` fields: `limit`, `includeTransient`, `itemTypes`, `roles`, `itemVisibility` (exact match on resolved visibility), `agentName` (a string or an array), `includeInFlight` (default `true`), and, for history only, `afterRequestId` and `earlierDocuments` (`"window"` or `"named"`).

## The wire format

| Call | Answer |
| --- | --- |
| `POST /api/flows/:kind/actions/:action` | `202` with `{ status: "in_progress", request: { id, flowKind, flowId, actionName, status }, session?: { id } }` and an `x-request-id` header. |
| The same `POST` with `Accept: text/event-stream` | `200` with the live stream as the response. Headers: `cache-control: no-cache, no-transform`, `x-accel-buffering: no`, `x-request-id`, `x-session-id`. |
| `GET /api/flows/:kind/requests/:requestId/stream` | The request's stream: `text/event-stream; charset=utf-8`, `cache-control: no-cache`, `connection: keep-alive`. |
| `GET /api/flows/:kind/requests/:requestId/status` | A `RequestStatusSnapshot`. `?include_result_output=true` adds the stored result. `404` when absent or not the caller's. |
| `POST /api/flows/:kind/requests/:requestId/abort` | Stops the request. Closing a stream does not. |

Each event is one frame:

```text
id: req_8:5
event: item.done
data: {"stream":"request","requestId":"req_8","sequence_number":5,"ts":1761000000000,"type":"item.done","item":{ ... }}
```

`sequence_number` is an integer that rises by one per event in a request. The first event is 1, `request.created`, and the second is `request.in_progress`.

| Event | Fields beyond `stream`, `requestId`, `sequence_number`, `ts`, `type` |
| --- | --- |
| `request.created` | Status `in_progress`. |
| `request.<status>` | `<status>` is `in_progress`, `completed`, `incomplete`, `failed`, `interrupted`, `aborted` or `suspended`. |
| `item.added`, `item.done` | `item`. |
| `item.updated` | `itemId`, `patch`. |
| `content.added`, `content.done` | `itemId`, `contentIndex`, `content`. |
| `content.delta` | `itemId`, `contentIndex`, `delta` (a string). |
| `content.audio.delta` | `itemId`, `contentIndex`, `audio` (base64), `isLast?`. |
| `resource.changed` | `scope: "request"`, `resourcePath`, `changeType`. Sent only for request-scoped resource changes, beside the `resource_change` item. |
| `session.metadata.changed` | `sessionId`, `title?`, `description?`, `tags?`, `metadata?`. |

`ping` exists in the event union and is never sent; the heartbeat is a comment frame. `debug` is not sent on the request stream route, but the event stream returned by the run call itself carries it, and the client passes it to `onDebug`.

[Pause, resume and replay](./durable-execution.md) lists the terminal events and what a `request.in_progress` after `request.suspended` means.

| Case | Behavior |
| --- | --- |
| Every frame | Every saved event can be replayed from the log. `content.delta`, `content.audio.delta` and `debug` take a sequence number but are never saved, so a replayed stream has gaps in its numbers. |
| A reader more than 4 MiB behind | Cut off. What was written is delivered, then the stream closes with no terminal event. Resume from the last id received and every remaining event arrives once. |
| Following an in-flight request | The saved events after the cursor, then new ones, until a terminal event. The stream stays open until the terminal event arrives, even when the status route already reports the request finished. |
| Following a terminal request | One response with the saved events past the cursor. If the log has no terminal event, the response ends with one made from the record's status, at last sequence plus 1, not saved. |
| An unknown request id, or one the caller does not own | `404`. A deleted request replays nothing. |
| A client disconnects | Its own stream closes. The request keeps running. |
| A proxy | The inline `POST` stream sets `no-transform` and `x-accel-buffering: no`. `@flow-state-dev/vercel` adds both to every SSE response it wraps, and `@flow-state-dev/node` serves the engine's response unbuffered. The plain `GET` stream sets neither `x-accel-buffering` nor `no-transform`. |

[HTTP API](./http-api.md) describes the frame fields and lists the other endpoints. Event names on the wire use dots; the [NDJSON `fsdev run` writes](#what-fsdev-run-streams) uses underscores.

## Resume by sequence number

### What does a client send to resume?

The last `sequence_number` it applied, in either form:

```text
GET /api/flows/support/requests/req_8/stream?starting_after=5
GET /api/flows/support/requests/req_8/stream
Last-Event-ID: req_8:5
```

| Case | Result |
| --- | --- |
| `starting_after=<n>` | Every event with a number greater than `n`. A non-negative integer; anything else is ignored. |
| `Last-Event-ID: <requestId>:<n>` | The same. It must name this request. A bare `5`, or another request's id, is ignored and the stream replays from the start. |
| Both | `starting_after` wins. |
| Neither | Replay from the first event. |
| A cursor at or past the last event | An empty body. |

### What replay holds

| Event or item | On replay |
| --- | --- |
| `content.delta`, `content.audio.delta` | Never replayed. Audio sent during a disconnect is lost, and the `content.added` and `content.done` snapshots replay. |
| `ping`, `debug` | Not saved, not replayed. |
| An in-progress message | No tokens replay. Its saved text is the text as of the last save while it streamed, and `item.done` carries the whole text. |
| A completed message | Replays exactly. |
| Events of a transient item | Replayed from the event log. |
| After a suspension | The request resumes under the same id, and numbering continues from the last saved event. A stream attached while the continuation runs follows through `request.suspended` and ends at the continuation's own end. A client that was at sequence N when the request paused reconnects with `Last-Event-ID: <requestId>:N` or `?starting_after=N` once the request is `in_progress` again, and receives N+1 onward. |
| After a crash and `/continue` | The same id and continued numbering. A `continuation` item marks the seam. |
| After a queued retry (BullMQ) | The retry keeps the request id and numbers after the last saved event. |
| A persistent store with 30 s of silence | For SQLite, filesystem and Postgres, with or without a live-tail pool, a tail with no new event for 30 s ends with `request.interrupted` at last plus 1. `LIVE_TAIL_LIVENESS_MS` changes the limit ([Environment variables](./environment.md)). The in-memory store ignores the timeout. |

### What the JS client does

```ts title="src/lib/follow-request.ts"
import { createClient } from "@flow-state-dev/client";

export function followRequest(
  userId: string,
  requestId: string,
  lastSeen: number,
  show: (item: unknown) => void,
) {
  const support = createClient({ userId, baseUrl: "" }).flow("support");
  return support.request(requestId).stream({
    startingAfter: lastSeen,
    reconnect: true,
    onItemDone: ({ item }) => show(item),
  });
}
```

`request(id)` is a method of the flow handle that `client.flow(...)` returns. [Client configuration](./client.md) lists the `stream` options and which cursor it sends.

| Setting | Behavior |
| --- | --- |
| `reconnect: true` | A failed connection opens again without limit, resuming after the last event. A connection that ends with no event counts toward a give-up after 5 in a row, `Request stream ended N times in a row with no event before the request ended`. Backoff is 1 s, doubling to 30 s, and resets when a connection delivers. A `401`, `403` or `404` ends it with `onError`. `close()` ends it. |
| No `reconnect` | The stream resumes after a connection that ended with no terminal event, such as a reader cut off at the byte limit or a host that caps response length. It resumes at once if the connection delivered an event or carried a heartbeat, and after backoff otherwise. After 5 connections in a row that delivered nothing and carried no heartbeat it gives up with `onError`. An error answer is reported with `onError` and not retried. |
| `dedupWindowSize` | The client drops events it already saw, by `requestId` and `sequence_number`, in a sliding window of 1000. |

### The session stream

`GET /api/flows/sessions/:sessionId/stream` follows a whole session, including requests this client did not send. It has no sequence numbers.

| Part | Detail |
| --- | --- |
| Query | `since` (server time), `session_created_at`, `item_types` (a comma list). |
| Events | `session.item` (`requestId`, `item`: a finished item any request kept), `session.runs` (`runs[]`, the session's unfinished runs, sent on open and on each change), `ping`. Each carries `stream: "session"`, `sessionId`, `at`. No `id:` line. |
| Reconnect | The client hands back the last `at` it heard as `since`. The server starts 5 s before it, so an item can arrive twice. Tell items apart by `requestId` and `item.id`, and keep the one that sorts later by `compareItemOrder`. |
| Cadence | The server reads about once a second. With no `since`, the first read reaches back 60 s. A connection closes after at most 15 minutes. |
| Stops for good | A `401`, `403`, `404`, `409` or `501` calls `onStop`, with no retries. Otherwise the client reconnects with backoff, 1 s doubling to 30 s. |

[UI components](./ui-components.md) covers the connection states a UI can read and the `ConnectionBanner` and `ConnectionScreen` that draw them.

### What a reload shows

| Hook option or call | Behavior |
| --- | --- |
| Reload | `useSession` reads the saved session snapshot: client-visible, non-transient items, collapsed to their canonical log. Transient items are absent. |
| `autoResume` (default `false`) | On mount, if the session's latest request is `in_progress`, attaches to its stream with no cursor and merges items by `id`. With `false`, the page holds one snapshot and starts no stream. |
| `live` (default `false`) | Opens one session stream after the first snapshot, so the view hears requests it did not send. Each finished item any request keeps joins `items` about a second later. It also re-reads child sessions when a run starts or ends. It costs an open connection and a server read about once a second. |
| `session.followRequest(requestId)` | Attaches the hook to a request's stream. It resumes after the last event the hook saw for that request only when the stream had dropped. Returns `false` for a request the user stopped or dismissed. |

## Heartbeat

| What | Default | Set with | Effect |
| --- | --- | --- | --- |
| Wire ping | 15,000 ms | `defaultSseHeartbeatMs` on `createFlowState`; `request.sseHeartbeatMs` on a flow, which wins. `0` turns it off. | The server writes the comment frame `: ping` on every live request stream, with no id and no sequence number. The client fires `onHeartbeat` and counts the connection alive. The session stream sends a `ping` event after a 15 s gap with no other event. |
| Client watchdog | 30,000 ms | `stuckThresholdMs` on `useSession`. At or below `0`, or not finite, disables it. | Records the time of the last event or heartbeat. Every `max(1000, floor(threshold / 4))` ms, if a request is in flight and the gap is over the threshold, `session.isStuck` becomes `true`. Keep the threshold at least twice the server heartbeat. |
| Executor heartbeat | 10,000 ms | `request.heartbeatIntervalMs`. `0` disables. | While a request runs, it reports itself alive at this interval, and an abort sent through another server reaches it within one interval. |

[Runtime configuration](./runtime.md) lists `staleSweepIntervalMs`, `staleSweepThresholdMs` and `queuedGraceMs`, the defaults, and the startup check. The [React API](./api/react.md) says when `isStuck` sets and clears, and what `dismissRequest()` and `sendAction` do while stuck. The [HTTP API](./http-api.md) lists the `check-interrupted` and `interrupted-requests` routes and the list they answer.

## Trace events

The trace types are `block_trace`, `router_decision`, `state_snapshot` and `generator_step`. They resolve to `{ client: false, history: false }`.

| Type | Made by | Fields |
| --- | --- | --- |
| `block_trace` | The runtime, once per block run | Below. |
| `router_decision` | A router | `routerName`, `selectedRoute`. |
| `state_snapshot` | A sequencer, at a step boundary. Always transient. | `key` (the sequencer's `blockInstanceId`), `stepName`, `stepIndex`, `state`, `version`, `durable`, `terminal?`, `suspensionId?`. |
| `generator_step` | A generator's tool loop, one per model step | `blockInstanceId`, `stepNumber`, `text?`, `toolCalls[]`, `prelude?`, `systemPrefixCount?`. Never client-visible, never in history, kept in the request's items. |

`block_trace` fields, beyond the common ones:

| Field | Type | Meaning |
| --- | --- | --- |
| `blockName` | string | The block's name. |
| `blockKind` | `generator`, `evaluator`, `handler`, `sequencer` or `router` | What kind of block ran. |
| `blockInstanceId` | string | The run of the block this trace describes. |
| `status` | `in_progress`, `completed`, `failed` or `planned` | Where the block run stands. |
| `input?` | `{ source, connected? }` | Where the input came from, and the connected input once known. |
| `output?` | descriptor | What the block returned. |
| `generator?` | `{ model, tools[], prompt, user?, history?, templateSource?, templateFrontmatter? }` | What the last model call was given. `templateSource` and `templateFrontmatter` are set when the prompt came from a prompt file. |
| `evaluator?` | `{ model, questions }` | The model and the questions an evaluator asked. |
| `model?` | identity | The model that ran, for a generator or evaluator, even when the generator emitted no item. |
| `modelUsage?` | `{ model, promptTokens, completionTokens, totalTokens, providerMetadata?, cacheReadTokens?, cacheCreationTokens? }` | Token counts for the block. |
| `harnessSpend?[]` | array | Each coding-harness run the block settled, as the harness reported it. |
| `resourceLoads?[]`, `declaredResources?[]` | arrays | Resource loads during the block, and the resources it declares. Present only when tracing is on. |
| `toolCall?` | `{ callId, arguments, generatorBlock }` | Set when the block ran as a tool. |
| `startedAt?`, `completedAt?`, `duration?` | number | Timing, in milliseconds. |
| `rescued?` | `true` | A `.rescue()` handler produced the output after the block threw. |
| `lean?` | `true` | The short record written when tracing is off. |
| `error?` | `{ message, code?, details? }` | Set on a failed block. |

| Case | Detail |
| --- | --- |
| A failed block | Its trace ends `status: "failed"` with `error { message, code?, details? }`. For a generator that fails output validation, `details` has `rawOutput`, `issues` and `phase` (`"stream"` or `"final"`). A `FlowError`'s `details` passes through. `tool_output.error` and the `error` item share the shape. |
| `input` and `output` | Descriptors: `inline { value }`, `structure { shape }`, `omitted { bytes, preview }`, and `ref { sourceItemId }` to an upstream trace. A downstream block's `input.source` is a `ref`. `stepAll`, `parallel` and `forEach` write a `structure`. |
| A block called as a tool | Its `block_trace.output` is a `ref` to the `tool_output` item, so the result is stored once. |
| The model call | The generator's trace update is an `item.updated` patch on the `block_trace` with `generator { model, tools, prompt, user?, history? }`. The last capture wins across a tool loop. |
| A reactive block | Traces under `__reactive__/<resourcePath>/<reactiveKind>#<n>`. `<n>` numbers the dispatches within one server process. The block nests under the block that made the mutation, and cascades form a tree. |

### Getting trace events

| Where | Behavior |
| --- | --- |
| A client stream | Drops trace types by default. `?include=trace` keeps them. The JS client sends it with `includeTrace: true`, `useRequestStream` takes `includeTrace`, the DevTool requests it, and the `/continue` route takes the same parameter. |
| `fsdev run` | Unfiltered. See [below](#what-fsdev-run-streams). |
| `FSDEV_TRACE_OBSERVABILITY` | Turns trace events on or off. [Environment variables](./environment.md) lists the values and the default. The `lean` row above says what a completed block leaves when it is off. |

### Where trace events are kept

Trace events are stored apart from the request record, in `stores.traces`. [Stores](./stores.md) lists the record shape, the backends, `maxRequests` and `maxBytesPerRequest`, and what a failed trace write does.

## What `fsdev run` streams

`fsdev run <flow> <action>` writes one JSON object per line to stdout. The stream is unfiltered: trace items and every other item appear.

| Line type | Fields |
| --- | --- |
| `item_added`, `item_done` | `item` |
| `item_updated` | `itemId`, `patch` |
| `content_delta` | `itemId`, `delta` |
| `state_change` | `scope`, `resourcePath`, `changeType`. Despite its name, this line carries the request-scoped `resource.changed` event, not a `state_change` item. A `state_change` item arrives as `item_added` and `item_done` with `item.type === "state_change"`. |
| `flow_complete` | `output`, `durationMs`, `items` |
| `suspended` | `requestId`, `sessionId`, `suspensionId`, `reason`, `title?`, `message?`, `answer` |
| `error` | `message` |

[CLI](./cli.md) lists the flags and the exit codes.

## Next

- [Sessions, items and streaming](../concepts/sessions-items-and-streaming.md) builds the model this page tabulates.
- [What the browser sees](../concepts/what-the-browser-sees.md) follows an item from the stream to a rendered screen.
- [Pause, resume and replay](./durable-execution.md) covers a suspended request and its sequence numbers.
- [React API](./api/react.md) lists the `useSession` fields and options, including `statusMessage`, `items.includeTransient` and `itemTypes`.
- [HTTP API](./http-api.md) lists every endpoint, not only the stream's.
