# Fact sheet: Items and the stream (R-06, reference, `reference/items`)

Pass 1. Cites only: the existing pages on the topic (`apps/docs/docs/streaming/{items,overview,trace-channel,emitting-items}.md` and `apps/docs/docs/server/connection-resilience.md`, "OLD" below), exported surface and doc comments, tests, `goals/`, and one example. No spec was read. Where an existing page and the code disagree, the code is what this sheet states, and §16 lists each disagreement.

Evidence tags: **[read]** read from source, **[test]** a test asserts it, **[run]** I executed it (none this pass: every fact is read or test-backed), **[?]** not verified; the page must leave it out or the later pass must settle it.

Source abbreviations (all under `packages/`):

- `ct` = `contracts/src/items/types.ts`
- `ce` = `contracts/src/items/events.ts`
- `crv` = `contracts/src/items/resolve-visibility.ts`
- `cl` = `contracts/src/items/canonical-log.ts`
- `ci` = `contracts/src/items/index.ts`
- `cp` = `contracts/src/items/predicates.ts`
- `eng` = `engine/src`, `et` = `engine/test`
- `re` = `engine/src/streaming/response-emitter.ts`
- `sr` = `engine/src/routes/stream-routes.ts`
- `ru` = `engine/src/routes/route-utils.ts`
- `cec` = `engine/src/context/createExecutionContext.ts`
- `hist` = `engine/src/context/history.ts`
- `us` = `react/src/hooks/useSession.ts`
- `cs` = `client/src/stream-client/streams.ts`
- `cl-lines` = `react/src/components/conversation-lines.ts`

Page shape from the sitemap (R-06): tables for every item type and its fields, item lifecycle, visibility, what persists, the wire format, resume by sequence number, heartbeat, trace events; a state figure "An item's life"; three lookups: *Which items are never stored?*, *What does a client send to resume?*, *Which items does the model see on the next turn?* No narrative.

---

## 1. What an item is, and the fields every item has

| # | Fact | Source |
|---|------|--------|
| 1.1 | Everything a request produces for its caller is an item: a message, a tool result, a status line, a record of a state change. Items belong to the request that made them; the session shows the items of all its requests as one timeline. | OLD overview:7-9; `ct:29-85`; `hist` (`outputItemToSessionItem`) |
| 1.2 | Every item carries: `id`, `type`, `status`, `requestId`, `itemIndex`, `provenance`, `ts`. Optional on every item: `transient`, `ownedBy`, `taskId`, `itemVisibility`, `agentName`. | `ct:29-85` [read] |
| 1.3 | `status` is one of `in_progress`, `completed`, `incomplete`, `failed`. (`block_trace` also takes `planned`.) | `ct:7`, `ct:228` |
| 1.4 | `itemIndex` is the item's place in its request, in the order the request reserved it. `ts` is the creation time in ms. | `ct:48`, `ct:50`; `cec` (`nextItemIndex`) [read] |
| 1.5 | `provenance` names the block that produced the item: `blockName`, `blockInstanceId`, `phase` (`"main"` or `"sideChain"`), and optionally `blockDefinitionId`, `parentBlockInstanceId`, `stepIndex`, `sideChainGroupId`, `attempt`. | `ct:18-27` |
| 1.6 | `ownedBy` is the `blockInstanceId` of the sequencer or router whose `container` the item was emitted inside. | `ct:51-53` |
| 1.7 | `taskId` is the id of the task the item was emitted under, when a task-board worker marked its active task. Absent otherwise. | `ct:55-63` |
| 1.8 | `itemVisibility` (`{ client, history }`) and `agentName` are stamped by the producing generator, or by an emitter option. `agentName` defaults to the generator's block name when `itemVisibility` is set. | `ct:64-84`; `core/src/blocks/generator.ts:570-592` |
| 1.9 | **An item `id` is unique within one request, not within a session.** Two requests can keep items with the same id (keyed items derive the id from the key, so the same key in two requests gives the same id). A list key is `requestId` plus `id`. | `ce:175-182` ("Items are told apart by `requestId` and `item.id` together: two requests can keep items with the same id"); `cec` `buildDataItem` (`item_data_keyed:<key>`) |
| 1.10 | The one display order, on server and client: `ts`, then `itemIndex`, then `requestId`, then `id`. A live view and a reload show the same order. Exported as `compareItemOrder`. | `contracts/src/items/order.ts:12-23` |
| 1.11 | The public item union, `OutputItem`, has 13 members: `message`, `reasoning`, `tool_output`, `data`, `container`, `source`, `status`, `error`, `state_change`, `resource_change`, `suspension`, `suspension_resume`, `continuation`. | `ct:820-833` |
| 1.12 | The runtime union, `RuntimeItem`, adds four trace types: `block_trace`, `router_decision`, `state_snapshot`, `generator_step`. | `contracts/src/items/internal.ts:88-93` |
| 1.13 | One more type travels the stream and is not in either union: `tool_call_progress` (transient; see 2.14). | `core/src/blocks/generator.ts:2360-2400` |

---

## 2. Every item type and its fields

Fields below are the type-specific ones; add the §1.2 fields to each. "Made by" is who produces it.

| # | Type | Made by | Type-specific fields | Source |
|---|------|---------|----------------------|--------|
| 2.1 | `message` | A generator that sets `itemVisibility` (assistant text); `ctx.emit.message`; the action's `userMessage` echo (role `user`; `runAction.ts:1825-1830`) | `role` (`assistant`, `user`, `system`, `developer`, `tool`; the framework writes `user` and `assistant` only), `content: Content[]`, `model?` (generator-made only), `metadata?` (handler-attached, never sent to a model, absent on generator messages) | `ct:449-480`; `core/src/types/scope.ts:42-47` (SessionItem.role doc) |
| 2.2 | `reasoning` | A generator whose model emits reasoning | `summary: Content[]`, `model?` | `ct:482-492` |
| 2.3 | `tool_output` | A generator's tool loop; any block wrapped with `.asTool()` run from a sequencer step | `blockName`, `output`, `modelOutput?` (only when the tool declares `mapModelOutput`), `outputOmitted?`, `toolCall { callId, name, alias?, arguments (JSON string), generatorBlock, stepNumber? }`, `error? { message, code?, details? }`, `cached?`, `cacheAgeMs?`, `sourceTask?`, `model?` | `ct:339-441` |
| 2.4 | `data` | `ctx.emit.data(dataType, value, options?)`; framework data such as `task-change` | `dataType` (string), `value` (object), `key?` | `ct:506-523`; `core/src/types/block.ts:143-153`, `:497-523` |
| 2.5 | `container` | A sequencer or router that declares `container` | `blockName`, `component?`, `label?`, `metadata?`, `startedAt?`, `completedAt?`, `duration?`, `error? { message }` | `ct:533-547` |
| 2.6 | `source` | A provider-native tool such as web search | `sourceType: "url"`, `sourceId`, `url`, `title?`, `providerMetadata?`, `model?` | `ct:604-613` |
| 2.7 | `status` | `ctx.emit.status` | `message`, `detail?`, `blocked?` (when `false`, the client may send new actions while the stream is open), `sideChainTasks?` | `ct:549-557` |
| 2.8 | `error` | The runtime, when the request fails | `message`, `code?`, `details?` | `ct:589-601`; `eng/execution/runAction.ts:513-523`, `:912-924` |
| 2.9 | `state_change` | A state write in the request, session, user, org or block scope | `scope` (`request`, `session`, `user`, `org`, `block_instance`), `operation` (`patch`, `set`, `increment`, `push`, `delete_key`, `atomic`), `path?`, `version`, `delta?`, `blockInstanceId?` | `ct:567-579` |
| 2.10 | `resource_change` | A resource write | `scope` (`request`, `session`, `user`, `org`), `resourcePath`, `changeType` (`created`, `updated`, `deleted`), `delta?`, `version?` | `ct:581-587` |
| 2.11 | `suspension` | A block that calls `ctx.suspend()` | `suspensionId`, `suspensionStatus`, `reason` (`user_approval`, `user_input`, `external_event`, or a custom string), `message`, `kind?` (`approval`, `review`, `input`), `title?`, `expiresAt?`, `data?`, `resumeSchema?`, `render? { component, props? }`, `resumeData?`, `allow?` (`approve`, `reject`, `submit`, `skip`), `blockInstanceId?` | `ct:726-766`; `contracts/src/types/suspension.ts:43-60` |
| 2.12 | `suspension_resume` | The runtime, when a suspension is resolved and the same request continues | `suspensionId`, `resolution` (a `SuspensionStatus`: `pending`, `approved`, `rejected`, `submitted`, `skipped`, `timed_out`, `expired`, `stopped`, `cancelled`), `resolvedBy?`, `resumeData?`, `resolvedAt` | `ct:783-795`; `contracts/src/types/suspension.ts:10-30` |
| 2.13 | `continuation` | The runtime, when a crash-interrupted request re-enters through `/continue` | `trigger: "recovery"`, `priorItemCount`, `resumedAtPath?`, `continuedAt` | `ct:807-818` |
| 2.14 | `tool_call_progress` | A generator, while a tool call streams | `toolCallId`, `toolName`, and `argsDelta` (on the call chunk) or `result` (on the result chunk); `transient: true`; stamped with the generator's `itemVisibility`, `agentName`, `model`. Sent as `item.added` then `item.done`. Emitted only by a generator that sets `itemVisibility` (streaming or not; `generator.ts:2212`, `:3487`); an unset one emits none. | `core/src/blocks/generator.ts:2360-2400`; `core/test/generator.test.ts:1014-1100` |
| 2.15 | `block_trace` | The runtime, once per block run | See §12. | `ct:223-336` |
| 2.16 | `router_decision` | A router | `routerName`, `selectedRoute` | `ct:443-447`; `cec:3814-3832` |
| 2.17 | `state_snapshot` | A sequencer, at a step boundary | `key` (the sequencer's `blockInstanceId`), `stepName`, `stepIndex`, `state`, `version`, `durable`, `terminal?`, `suspensionId?`. Always `transient: true`. | `ct:637-655`; `core/src/blocks/sequencer.ts:362-386` |
| 2.18 | `generator_step` | A generator's tool loop (one per model step, read when a resumed run resumes the loop) | `blockInstanceId`, `stepNumber`, `text?`, `toolCalls[]`, `prelude?`, `systemPrefixCount?`. Never client-visible, never in history. | `ct:685-717`; `crv:34-39` |

Further per-type facts:

| # | Fact | Source |
|---|------|--------|
| 2.19 | `message.content` and `reasoning.summary` are `Content[]`: `output_text`, `reasoning_text`, `refusal`, `file`, `output_audio`. `output_audio` is streamed to the client, not stored (content with `ephemeral: true` is stripped before a request's items are saved). | `contracts/src/items/content.ts:1-53`; `eng/execution/runAction.ts:431-470` |
| 2.20 | A `tool_output` for a tool that suspended is recorded as a `failed` item with `error.code === "SUSPENSION"`; its real result replaces it when the answer resumes the run. `isSuspensionWait(item)` is the exported test for it. | `cp:127-136`; `ct:399-413` |
| 2.21 | A `tool_output` over the record limit: `output` and `modelOutput` are absent and `outputOmitted` holds `{ kind: "omitted", bytes, preview }`. Same object as a `block_trace.output` over the limit. Limit 256 KiB serialized, set per server with `maxRecordedValueBytes` on the router. `preview` is the first 512 characters; `bytes` is `null` when the value could not be serialized. | `ct:107-129`, `ct:364`; `eng/runtime-config.ts:45-52` (limit option), `ct:112-121`; OLD items:147-163 |
| 2.22 | A resume that would have to hand on an omitted value fails with the error code `RECORDED_VALUE_OMITTED`, naming the block. The run itself keeps the full value; only the record, the stream and later prompts see the placeholder. | `ct:112-121`; OLD items:157-159 |
| 2.23 | `data` items: code reads one back by `dataType`; a client draws one only when it registers a renderer for that `dataType`. A data item with no renderer is on the stream and in the session and draws nothing. | `ct:494-505`; `react/src/components/ItemRenderer.ts:251-262` |
| 2.24 | `ctx.emit.message(text \| Content[], { itemVisibility?, agentName?, transient?, metadata? })`: persisted by default (`transient` false), role `assistant`. | `core/src/types/block.ts:130-141`; `cec:340-366` |
| 2.25 | `ctx.emit.data(dataType, value, { key?, itemVisibility?, agentName?, transient? })`: persisted by default; with `key`, one entry per `(requestId, key)` and the latest `value` replaces the earlier one (replace, not merge); without `key`, each call is its own item. Reaches the client and not model history unless `itemVisibility` says otherwise; an enclosing generator's `itemVisibility` is **not** inherited. | `core/src/types/block.ts:143-153`, `:497-523`; `cec:368-420`; `et/emit-data.test.ts:62-122` [test] |
| 2.26 | `ctx.emit.status(message \| undefined, { blocked?, sideChainTasks?, transient? })`: a request-wide single slot; a repeated identical message is dropped; `undefined` keeps the slot and updates only `blocked`/`sideChainTasks`. Live-only by default (`transient: true`); `{ transient: false }` stores it. | `core/src/types/block.ts:524-537`; `cec:480-520` |
| 2.27 | `useSession().statusMessage` is the most recent `ctx.emit.status` text of the in-flight request; empty string when none, and reset when the request ends. | `us:350-358` |
| 2.28 | `ctx.emit.trace.*` (`blockTrace`, `routerDecision`, `stateSnapshot`) is marked internal; user code rarely calls it. | `core/src/types/block.ts:484-486`, `:544-550` |
| 2.29 | Task boards emit three `data` items: `task-change` (value `{ collectionId, taskId, kind, task, prevStatus? }`, key `${collectionId}/${taskId}`, `itemVisibility { client: true, history: false }` unless the board sets another), `task-board-meta` (value `TaskBoardMeta { collectionId, status, counts?, terminationReason?, maxTotalRetries? }`, key = `collectionId`, `{ client: true, history: false }`), and `task-board-recorder-failure`. A board-backed pattern emits them too. | `orchestration/src/tasks/collection/get-or-create.ts:200-222`; `orchestration/src/task-board/blocks/board-meta.ts:75-115`, `:312-318`; `orchestration/src/tasks/board-meta-value.ts:12-35` |
| 2.30 | `task-change.task` is the post-mutation task with the server-only fields removed: `claimedBy`, `createdBy`, `filer`, `filedUnder`. | `orchestration/src/tasks/collection/change-event.ts:140-166` |
| 2.31 | `task-change.kind` values: `added`, `claimed`, `completed`, `errored`, `retried`, `retry_requested`, `held`, `released`, `settings_changed`, `resumed`, `cancelled`, `label_changed`, `metadata_changed`, `priority_changed`, `assignee_changed`, `run_linked`, `progress_reported`, `resume_settled`, `steered`, `cancel_owed`, `wait_changed`, `asked`, `answered`. | `orchestration/src/tasks/collection/change-event.ts:16-70` |
| 2.32 | `task-board-meta.status`: `active` (top of a pass), `completed` (end of a pass, with `counts` and `terminationReason`). A pattern writes its own words: Plan and Execute writes `planning` at plan start and `replanning` when its evaluator returns replan (only when `enableReplanning` is on). **It does not write `synthesizing`** (the type allows it; the pattern deliberately emits nothing at synthesis). | `orchestration/src/task-board/blocks/board-meta.ts:104-118`; `patterns/src/shared/planning-entry.ts:370-376`; `patterns/src/plan-and-execute/blocks/evaluate-progress.ts:266-285`, `blocks/synthesize.ts:140-152`; `patterns/src/plan-and-execute/schemas.ts:57-70` |
| 2.33 | `task-board-meta.counts`: `{ total, pending, in_progress, held, completed, errored, cancelled, retries? }`. `terminationReason` values include `all-completed`, `blocked-by-failures`, `retry-budget-exhausted`, `dispatched`, `waiting-on-a-user`, `waiting-on-an-event`. | `orchestration/src/tasks/board-meta-value.ts:12-35`; `board-meta.ts:295-318` |
| 2.34 | Goal-seek loop writes a `data` item `goal-seek-loop-termination`, value `{ collectionId, reason, iterations }`, key `${collectionId}:goalSeekLoop-termination`, `itemVisibility { client: false, history: false }`. It is on the request's items and not on the client stream. | `orchestration/src/task-board/goal-seek-loop.ts:535-556` |
| 2.35 | Both a task board's `task-change` and `task-board-meta` are drawn by the `task-plan` component in `@flow-state-dev/ui`, which reads them from the session items, latest per key. | `ui/registry/components/task-plan.tsx:1-20`, `:197-200`; `ui/registry/components/task-plan-state.ts:139-140` |
| 2.36 | Generative UI tools in `@flow-state-dev/ui` emit `data` items whose `dataType` is the shape name (`info-card`, `link-card`) and whose `key` derives from the input; `generativeRenderers` supplies the matching renderers. | `ui/src/generative/info-card/tool.ts:27`; `ui/src/generative/link-card/tool.ts:26`; `ui/src/generative/renderers.ts` |

---

## 3. Item lifecycle (figure "An item's life")

States and transitions, for the state figure.

| # | Fact | Source |
|---|------|--------|
| 3.1 | A streamed item (a generator's message or reasoning) is `item.added` with `status: "in_progress"` and empty text, then `content.added`, then `content.delta` events that append text, then `content.done`, then `item.done` carrying the whole item with a terminal status. A reasoning item is finished (`item.done`) when the message text begins. | `core/src/blocks/generator.ts:2258-2350` |
| 3.2 | The terminal `status` is `completed`, `incomplete` or `failed`. | `ct:7`; OLD overview:119-120 |
| 3.3 | A handler-emitted message, data item or status item has no `in_progress` phase: the emitter sends `item.added` and `item.done` back to back, both with `status: "completed"`. | `cec:340-366` (message), `:368-420` (data), `:480-520` (status) |
| 3.4 | `tool_output`: `item.added` before the tool runs, with `toolCall` and `status: "in_progress"`; `item.updated` with `status` and `output` once the tool settles; ends `completed` or `failed` (a failed result carries `error`). | OLD items:114-141; `et/tool-output-item-updated.test.ts` [?, not opened] |
| 3.5 | `block_trace`: `item.added` (`in_progress`, `input` known), zero or more `item.updated` patches (connected input, generator bundle, model usage), then `item.done` (terminal status, `output`, timing). Same `id` throughout. | OLD items:57-110, :165-167; `cec:3853-3925`; `et/block-trace-lifecycle.test.ts` [?, not opened] |
| 3.6 | `container`: `item.added` (`in_progress`) when the scope opens, `item.updated` patching `status`, `completedAt`, `duration` (and `error`) when it closes, then `item.done`. | `ct:525-532` |
| 3.7 | `item.updated` is a shallow top-level merge: each key in `patch` replaces the key on the consumer's copy; nested objects must be re-sent whole. The keys `id`, `type`, `provenance`, `itemVisibility`, `transient` are stripped from every patch and never apply. Exported as `ITEM_UPDATE_INVARIANT_KEYS`. | `ce:36-62`; `re:490-520` |
| 3.8 | An `item.updated` for an id the emitter never saw is dropped (a debug event is recorded). An update after `item.done` applies normally. | `re:497-512` |
| 3.9 | A keyed item emitted again takes the same id and goes back to in progress, then done again. The persisted copy is one entry per `(requestId, key)`; the event log still gets each emission. | `re:446`; `core/src/types/block.ts:512-523`; `et/emit-data.test.ts:73-84` [test] |
| 3.10 | **Not "immutable once done"** (OLD says terminal and immutable): an update after done applies, and a keyed re-emission reopens the id. | `re:497-512`, `re:446` |
| 3.11 | A client folds a request's events into a live item list with `createRequestStreamStore`; React reaches it through `useSession` and `useRequestStream`. | OLD overview:19; `react/src/hooks/useRequestStream.ts` |

---

## 4. Visibility

| # | Fact | Source |
|---|------|--------|
| 4.1 | Visibility is `{ client, history }`: `client` means the item is sent to the client, `history` means it enters conversation history for later model calls. | `ct:9-16` |
| 4.2 | It is a pure function of `(item.type, item.itemVisibility)`, `resolveItemVisibility(item)`, exported from `@flow-state-dev/core/items`. | `crv:45-55` |
| 4.3 | Trace types (`block_trace`, `router_decision`, `state_snapshot`, `generator_step`) always resolve to `{ client: false, history: false }`, whatever stamp they carry. | `crv:34-46`; `et/item-visibility.test.ts:107-146` [test] |
| 4.4 | Conversational types (`message`, `reasoning`, `tool_output`) use their `itemVisibility`; with none, `{ client: true, history: true }`. | `crv:48-50`; `et/item-visibility.test.ts:36-105` [test] |
| 4.5 | `data` uses its `itemVisibility` when present, else `{ client: true, history: false }`. | `crv:52`; `et/item-visibility.test.ts:149-166` [test] |
| 4.6 | Every other type is `{ client: true, history: false }` and ignores any `itemVisibility` stamp. This covers `status`, `error`, `container`, `source`, `state_change`, `resource_change`, `suspension`, `suspension_resume`, `continuation`, and `tool_call_progress` (it is not named, so it falls through). | `crv:54`; `et/item-visibility.test.ts:168-209` [test]. `tool_call_progress` falling through is [read]; the effect (a `client: false` generator's progress items reach the client) is [?]. |
| 4.7 | Default per kind, as a table: | |
| | `message`, `reasoning`, `tool_output`: client yes, history yes (when unset). | `crv:48-50` |
| | `data`: client yes, history no. | `crv:52` |
| | `container`, `source`, `status`, `error`, `state_change`, `resource_change`, `suspension`, `suspension_resume`, `continuation`: client yes, history no. | `crv:54` |
| | `block_trace`, `router_decision`, `state_snapshot`, `generator_step`: neither. | `crv:34-46` |
| 4.8 | Generator `itemVisibility` values and what they mean: `{ client: true, history: true }` user-facing agent; `{ client: true, history: false }` observable work (a sub-agent); `{ client: false, history: true }` private context; `{ client: false, history: false }` trace-only. | `core/src/blocks/generator.ts:570-583`; `ct:64-77` |
| 4.9 | **A generator with no `itemVisibility` emits no items at all** (no message, reasoning, tool progress or source). The model still runs, tools run, and the typed output reaches parent blocks through the graph. There is no position-inferred default. | `core/src/blocks/generator.ts:570-583`, `:1265-1275`, `:2212` (`emit: itemVisibility !== undefined`) |
| 4.10 | In development, `defineFlow` warns once per flow kind and action when a caller action's block **is** a generator with no `itemVisibility`: the message names the flow, the action and both fixes (`{ client: true, history: true }` to show the reply, `{ client: false, history: false }` to stay headless). It does not fire in production, or for a sequencer whose generator steps are silent, or for non-caller entries (internal, task, webhook, schedule). | `core/src/flow/defineFlow.ts:547-575`; `core/test/silent-generator-action.test.ts:1-60` [test] |
| 4.11 | The HTTP stream filter drops, for a client connection, every item whose resolved `client` is false, plus the `content.*` events of a suppressed item, plus `item.updated` for an item that connection never saw as client-visible (fail closed). | `eng/streaming/client-filter.ts:76-125`; `et/streaming/client-filter.test.ts:90-150` [test] |
| 4.12 | The session snapshot (`GET /sessions/:id/state`) and the session stream show the same set: the request's items collapsed to their canonical log, then those whose resolved `client` is true (or, when the caller passes an `item_types` filter, those types). | `ru:538-556` |
| 4.13 | In React, `<ItemsRenderer>` also hides items with `history: false` on a conversational type (sub-agent output) unless `showSubAgents` is set, and trace types. `session.items` holds all client-visible items. | `cl-lines:157-178`, `:92-93` |
| 4.14 | Renderers: `FlowProvider` takes a `renderers` registry; `data` items resolve through `renderers.data[dataType]`, containers through `renderers.container[component]`, other types through `renderers[type]`. A value of `false` suppresses the type. An unregistered `data` item renders nothing. Suspensions fall back to a built-in approval, question, selection or form card. | `react/src/registry/block-renderers.ts:33-95`; `react/src/components/ItemRenderer.ts:226-300` |
| 4.15 | These types never draw a line in the conversation: `state_change`, `resource_change`, `suspension_resume`, `continuation`. | `react/src/components/ItemRenderer.ts:75-90`; `cl-lines:104` |
| 4.16 | Keyed `data` items: `deduplicateByKey` (default `true`, a prop of `<ItemsRenderer>`) shows only the latest snapshot per key, at that snapshot's place, **within one request** (key scoped by `requestId`); items with no key always show. | `cl-lines:88-139`; `react/src/components/ItemsRenderer.ts:25-33` |
| 4.17 | State changes for keys a flow does not expose are sent; `useClientData` merges a `state_change` into `clientData` only for keys the initial snapshot already carries, so unexposed keys never reach `useClientData`. Atomic operations carry no delta and are ignored by `useClientData`. Until the first snapshot lands, `state_change` items are held and replayed. | `react/src/internal/mergeStateChangeIntoSnapshot.ts:1-90`; `us:819-830`, `:1125-1140` |

---

## 5. What persists

The four questions, for each stored part, are answered in §14. This section is the table.

| # | Fact | Source |
|---|------|--------|
| 5.1 | A request record keeps the request's items (`record.items`), minus every item with `transient: true` and minus ephemeral content parts. The same rule applies to every write of the items, including the saves made while the request is still running. | `eng/execution/runAction.ts:431-446`, `:1741-1755`; `et/in-flight-items.test.ts:20-106` [test] |
| 5.2 | While a request runs, its items are saved as they finish and as streamed text grows. The saved copy of an in-progress message carries the text so far. | `eng/execution/runAction.ts:1744-1755`; `re:915-954` (`applyDelta` mutates the tracked item then calls `onItemUpdate`) |
| 5.3 | Persistence by type (this is what the old "Transient" column listed): | |
| | **Stored:** `message`, `reasoning`, `tool_output`, `data`, `container`, `source`, `error`, `suspension`, `suspension_resume`, `continuation`, `router_decision`, `block_trace`. | `cec:340-420` (message and data default `transient` false); `crv`; `cec:3862-3872` |
| | **Never stored (always `transient: true`):** `resource_change`, `state_snapshot`, `tool_call_progress`. | `re:705` (`emitResourceChange` default `transient ?? true`), `cec:2900-2905`; `core/src/blocks/sequencer.ts:362-368`; `core/src/blocks/generator.ts:2360-2400` |
| | **Stored only when asked:** `status` (live-only by default, `{ transient: false }` stores it). | `cec:500-510` |
| | **Not stored in production:** `state_change` (transient unless `NODE_ENV` is not `production` or the flow sets `persistStateChanges: true`, an untyped flag read off the flow instance and not a `defineFlow` option, so kept off the page). | `eng/context/scope-emit.ts:18-27`; `cec:664` |
| | **Stored unless the block is `transient`:** `block_trace` inherits the block's `transient` flag. A `transient: true` block streams its trace live and keeps no trace in the items. | `cec:3862-3872`; OLD emitting-items:212 |
| 5.4 | `transient` can also be set on a single emission: `ctx.emit.message(text, { transient: true })`, `ctx.emit.data(type, value, { transient: true })`. A block declared `transient: true` does **not** make its explicit emissions transient; it affects the framework's own bookkeeping items for that block. | `core/src/types/block.ts:130-153`; OLD emitting-items:212-214 |
| 5.5 | `transient` and `key` are independent: persisted+unkeyed is append-only; persisted+keyed is a keyed snapshot (one stored entry per key, latest replays on reload); transient+unkeyed is a one-shot; transient+keyed is live-only with replace-in-place on the client. | `ct:38-45`, `:506-523`; OLD emitting-items:174-186 |
| 5.6 | A keyed item's stored entry is one per `(requestId, key)`; the event log still holds one `item.added` and `item.done` per emission. A client that is not the React hooks must overwrite by item id, not append. | `core/src/types/block.ts:512-523`; OLD emitting-items:156-160 |
| 5.7 | `onItem` (an option of `runAction`) fires for every item added, updated and done, **transient items included**; a listener that throws never fails the run. A transient message appears in `onItem` and is absent from the stored record. | `eng/execution/types.ts:162-173`; `eng/execution/runAction.ts:1195-1201`; `et/run-action-manual.test.ts:68-130` [test]; `re:330-345` (listener isolation, snapshot fan-out) |
| 5.8 | Legacy: a stored item of `type: "component"` (`component`, `data`, `key?`) reads back as a `data` item (`dataType`, `value`, `key?`); a keyed legacy item's id becomes `item_data_keyed:<key>`. Nothing is rewritten in the store. | `eng/stores/legacy-component-items.ts:1-66`; `et/legacy-component-items.test.ts` [test] |
| 5.9 | A resumed request's record can hold superseded copies of items the suspending block re-emitted. `collapseToCanonicalLog` drops them on every read that shows a history (session snapshot, `useSession`, the stream's seed, model history): see 5.10. | `cl:1-60` |
| 5.10 | Canonical-log rules (what a reader sees after a resume or a crash re-entry): (1) a block that suspended and was resumed shows its post-resume emissions only; the `suspension` and `suspension_resume` items always stay. (2) among repeated `block_trace` items for the same block run, only the `completed` one with the highest index stays. (3) a block re-run after a crash (more than one trace) keeps the surviving run's items only. (4) `tool_output` keeps one per call id (a `completed` one beats the earlier `failed` `SUSPENSION` one); a completed sibling with no re-run copy stays. `generator_step` is kept. A request that never suspended is unchanged. | `cl:61-239` |

---

## 6. Which items the model sees on the next turn

| # | Fact | Source |
|---|------|--------|
| 6.1 | A generator reads history only when it sets `history`: `true`, an `ItemQuery`, or a slot function. With no `history`, no prior turns are assembled. | `core/src/blocks/generator.ts:364-367`, `:610`, `:779-797`; OLD generator-context:271 |
| 6.2 | `history: true` is `ctx.session.items.history()`. An `ItemQuery` is passed to `history(query)`. | `core/src/blocks/generator.ts:779-797` |
| 6.3 | The item types eligible for history by default: `message`, `reasoning`, `tool_output`, `data`. Anything else is never in history. A query can narrow with `itemTypes`. | `hist:47-52`, `:383-387` |
| 6.4 | An eligible item enters only if its resolved visibility has `history: true` (4.2 to 4.6). So by default `message`, `reasoning`, `tool_output` enter and `data` does not, unless the emitter set `itemVisibility.history: true`. `status`, `error`, `component`-style records, traces never enter. | `hist:91-93`, `:165-171`; `et/emit-data.test.ts:113-122` [test] |
| 6.5 | How each type is replayed: `message` becomes one message with its text (a user message with files keeps the files as references); a `message` or `reasoning` with no text adds nothing; `reasoning` becomes an assistant message; `tool_output` becomes two protocol messages (an assistant tool call and a tool result, the result a `failed` text, an omitted-size line or the output as text/JSON); `data` (when opted in) becomes one assistant line `[<dataType>] <value as JSON>`. | `hist:91-174` |
| 6.6 | Result text for a tool that failed: `failedToolResultText(name, error.message)`. For an omitted result: `[The result of <tool> (<n> bytes) was too large to keep in the conversation history.]` (`a value that could not be serialized` for `bytes: null`). | `hist:54-63`, `:135-141` |
| 6.7 | Transient items never enter history. | `hist:247` |
| 6.8 | History is read per prior request ("turn"), oldest first, from the session's window of at most `flow.session.historyWindow.turns` turns (default 50); a turn is a completed request, or one cut short by a dead server (it keeps what it had settled). The in-flight request's own items are appended whatever the limit, unless the query sets `includeInFlight: false`. | `cec:775`, `:851`; `hist:312-410`; `core/src/types/scope.ts:81-89`; OLD generator-context:285 |
| 6.9 | `limit` is turn-aligned: a bare number or `{ turns: N }` is N turns; `{ tokens: N }` packs whole turns from the newest, never splitting one, and always includes the newest prior turn even when it alone is over budget. | `hist:262-341`; `core/src/types/scope.ts:50-70` |
| 6.10 | Views on the session timeline (`ctx.session.items`): `all(query?)` every session item; `client(query?)` items whose visibility has `client: true`; `history(query?)` LLM messages (async); `selectForContext(query?)` raw `SessionItem[]` with no history filtering, honoring `itemTypes`, `includeTransient`, `itemVisibility`, `agentName`; `turns(query?)` past turns. | `core/src/types/scope.ts:155-185` |
| 6.11 | `ItemQuery` fields: `limit`, `includeTransient`, `itemTypes`, `roles`, `itemVisibility` (exact match on resolved visibility), `agentName` (string or array), `includeInFlight` (default true), `afterRequestId` (history only), `earlierDocuments` (`"window"` or `"named"`, history only). | `core/src/types/scope.ts:72-108` |
| 6.12 | `SessionItem` (what `all`, `client`, `selectForContext` return): `id`, `type`, `status`, `transient?`, `requestId`, `itemIndex`, `payload`, `ts?`, `itemVisibility?`, `agentName?`, `role?` (message only). `payload` of a message is its text. | `core/src/types/scope.ts:28-47`; `hist:459-486` |

---

## 7. The wire format (request stream)

| # | Fact | Source |
|---|------|--------|
| 7.1 | Starting a request: `POST /api/flows/:kind/actions/:action` answers `202` with JSON `{ status: "in_progress", request: { id, flowKind, flowId, actionName, status }, session?: { id } }` and an `x-request-id` header. | `eng/routes/action-routes.ts:347-368` |
| 7.2 | The same POST with `Accept: text/event-stream` returns the live event stream as the response (status 200), with headers `cache-control: no-cache, no-transform`, `x-accel-buffering: no`, `x-request-id`, `x-session-id`. | `eng/routes/action-routes.ts:329-345`; `et/streaming/sse-buffer-bound.test.ts:99-128` [test] |
| 7.3 | Following a request: `GET /api/flows/:kind/requests/:requestId/stream`. Response is `text/event-stream; charset=utf-8` with `cache-control: no-cache` and `connection: keep-alive`. | `ru:39-43`; `eng/routes/router.ts:198-205` |
| 7.4 | One frame per event: `id: <requestId>:<sequence_number>`, `event: <type>`, `data: <the whole event as JSON>`, then a blank line. `data` is the full event object (it includes `stream: "request"`, `requestId`, `sequence_number`, `ts`, `type`, and the type's own fields), not just the item. | `eng/streaming/encode-event.ts:16-62`; `eng/streaming/sse.ts:27-54`; `et/streaming/sse-buffer-bound.test.ts:54-85` |
| 7.5 | Every event carries `sequence_number`, an integer that rises by one per event in a request; the first event is 1 (`request.created`), the second is `request.in_progress`. | `re:814-835`, `:252` (`sequenceNumber` starts at 0 and is incremented before use); `eng/execution/runAction.ts:1777-1780`; `et/stream-routes-resume.test.ts:59-62` |
| 7.6 | Event types on the request stream: | |
| | `request.created` (status `in_progress`); `request.<status>` where status is one of `in_progress`, `completed`, `incomplete`, `failed`, `interrupted`, `aborted`, `suspended`. | `ce:16-24`; `contracts/src/types/request-status.ts:11-18` |
| | `item.added`, `item.done` (field `item`); `item.updated` (`itemId`, `patch`). | `ce:26-62` |
| | `content.added` (`itemId`, `contentIndex`, `content`); `content.delta` (`itemId`, `contentIndex`, `delta` string); `content.done` (`itemId`, `contentIndex`, `content`); `content.audio.delta` (`itemId`, `contentIndex`, `audio` base64, `isLast?`). | `ce:64-102` |
| | `resource.changed` (`scope: "request"`, `resourcePath`, `changeType`): sent only for request-scoped resource changes, beside the `resource_change` item. | `ce:104-111`; `re:716-731` |
| | `session.metadata.changed` (`sessionId`, `title?`, `description?`, `tags?`, `metadata?`). | `ce:113-120` |
| | `debug` and `ping` events exist in the union; they are not sent on the wire. | `ce:122-134`; `sr:83-90` |
| 7.7 | A terminal event ends the stream: `request.completed`, `request.incomplete`, `request.failed`, `request.suspended`, `request.interrupted`, `request.aborted`. (`request.in_progress` after a suspended event means the request is running again; the client then treats the stream as open.) | `cs:171-181`, `:262-284`; `eng/stores/subscribe-helpers.ts:34-46` |
| 7.8 | Each frame is saved before it is sent: the emitter waits for the store to flush every replayable event before publishing it, so a client never holds a sequence number the saved log cannot reproduce. | `re:862-905` |
| 7.9 | Not every event is saved or replayed: `ping`, `debug`, `content.delta` and `content.audio.delta` are never replayed. | `re:858-889`; `eng/streaming/resume.ts:147-153`; `et/stream-resume.test.ts:420-448` [test] |
| 7.10 | Events for a `transient` item are sent live and saved in the event log; they are left out of the emitter's in-memory buffer so a polling block cannot evict other events. The buffer holds the newest 10,000 events by default (per-server `maxResponseBufferSize`). | `re:127`, `:845-851`; `eng/runtime-config.ts:42-44` |
| 7.11 | A connection's reader that falls more than 4 MiB behind is cut off: what was already written is delivered, then the stream closes **with no terminal event**. Resuming from the last id received delivers every remaining event exactly once. The limit is fixed. | `eng/streaming/sse-stream.ts:150-156`, `:250-262`; `et/streaming/sse-buffer-bound.test.ts:99-128` [test] |
| 7.12 | An in-flight request is followed live from the cursor: the saved events after it, then new ones, until a terminal event. A record that is terminal but whose terminal event has not been written yet (request-end hooks still running) is also followed live. A terminal request is answered in one response with the saved events past the cursor. If its log has no terminal event, the response ends with one synthesized from the record's status, at sequence = last + 1, not saved. | `sr:1-10`, `:152-216`, `:258-319`, `:535-585`; `et/request-end-stream-contract.test.ts:1-60` [test] |
| 7.13 | A request id with no record and no events answers `404`; one the caller does not own answers as if unknown (`404`). A deleted request replays nothing: its events go with the record. | `sr:218-256`; `et/stream-routes-resume.test.ts` (last three cases) [test] |
| 7.14 | A client that disconnects ends its own tail: the stream closes when the request's abort signal fires. This ends the stream only; it does not stop the request. | `sr:328-375`; `eng/streaming/sse-stream.ts:195-201`; `et/stream-routes-disconnect.test.ts` [test] |
| 7.15 | Stopping a request is separate: `POST /api/flows/:kind/requests/:requestId/abort` (see OLD connection-resilience:120-151 for its `204` / `202` / `404` / `409` answers). | `eng/routes/router.ts:207-213`; OLD connection-resilience:143-151 |
| 7.16 | Status without a stream: `GET /api/flows/:kind/requests/:requestId/status` returns a `RequestStatusSnapshot` (`id`, `status`, `startedAtMs`, `ageMs`, ..., `lastHeartbeatAt?`, `sessionId?`); `?include_result_output=true` adds the stored result. `404` when absent or not the caller's. | `eng/routes/request-status-routes.ts:1-60` |
| 7.17 | Headers that keep a proxy from buffering: the framework sets `no-transform` and `x-accel-buffering: no` on the inline POST stream; `@flow-state-dev/vercel` adds both to every SSE response it wraps; `@flow-state-dev/node` serves the engine's response unbuffered. The plain GET stream uses `SSE_HEADERS` (`cache-control: no-cache`, `connection: keep-alive`, no `x-accel-buffering`). | `eng/routes/action-routes.ts:335-345`; `vercel/src/handler.ts:18-30`, `:40-70`; `node/src/serve.ts:1-30`; `ru:39-43` |
| 7.18 | The Vercel adapter exports `injectHeartbeat(stream, intervalMs)` (retained re-export; engine streams now carry their own heartbeat). `intervalMs <= 0` returns the stream unchanged. | `eng/streaming/heartbeat.ts:1-60`; `et/heartbeat.test.ts` |

Event-name spelling: the wire uses dots (`item.added`, `content.delta`). The NDJSON of `fsdev run` uses underscores (`item_added`, `content_delta`); see §13.

---

## 8. Resume by sequence number

| # | Fact | Source |
|---|------|--------|
| 8.1 | **What a client sends to resume:** the last `sequence_number` it applied, as the query parameter `starting_after=<n>` on the request stream URL, or the standard `Last-Event-ID: <requestId>:<n>` header (the id of the last frame received). Events with a number greater than `n` come back. | `eng/streaming/resume.ts:94-122`; `et/stream-routes-resume.test.ts:73-102` [test] |
| 8.2 | If both are sent, `starting_after` wins. | `eng/streaming/resume.ts:94-107`; `et/stream-resume.test.ts:619-660` [test] |
| 8.3 | `Last-Event-ID` must be `<requestId>:<n>` with the id of **this** request and a non-negative integer. A bare number such as `42`, or another request's id, is ignored and the stream replays from the start. `starting_after` must be a non-negative integer; anything else is ignored. (OLD shows `Last-Event-ID: 42`; that does not resume.) | `eng/streaming/resume.ts:27-92`, `:109-122` |
| 8.4 | With no cursor, replay starts at the first event. A cursor at or past the last event returns an empty body (nothing is reconstructed). | `eng/streaming/resume.ts:131-162`; `et/stream-routes-resume.test.ts:128-146` [test] |
| 8.5 | The saved events are read only from the cursor on; earlier events are never pulled from the store. | `sr:228-231`, `:279-282`; `et/stream-routes-resume.test.ts:73-102` [test] |
| 8.6 | Replay never includes `content.delta` or `content.audio.delta`. A resumed in-progress message does not re-play its tokens: the item text is the text as of the last save while it streamed, and the finished item (`item.done`) carries the whole text. Completed messages replay exactly. Audio chunks sent during a disconnect are lost; the `content.added` / `content.done` snapshots are replayed. | `eng/streaming/resume.ts:147-153`; `re:915-954`; `et/stream-resume.test.ts:420-448` [test]. "Snaps to the last saved copy" as a stream-level behaviour is [?]; state it as "no deltas are replayed; `item.done` carries the whole item". |
| 8.7 | The JS client does this for you. `request(id).stream({ startingAfter?, lastEventId?, includeTrace?, dedupWindowSize?, reconnect?, ...callbacks })`: sends `starting_after` when it has a cursor, otherwise `Last-Event-ID` from the last frame id. | `client/src/client.ts:1053-1064`; `cs:219-245` |
| 8.8 | Reconnection (`reconnect: true`): a failed or ended connection opens again without limit, resuming after the last event, after backoff 1 s doubling to 30 s (reset when a connection delivers). A 401, 403 or 404 ends it with `onError`. `close()` ends it. | `cs:184-206`; `client/src/internal/backoff.ts:1-17` |
| 8.9 | Without `reconnect`, the stream still resumes after a connection ended early with no terminal event (a reader cut off at the byte limit, a host that caps response length): at once if the connection delivered an event or carried a heartbeat, otherwise after backoff. It gives up with `onError` after 5 connections in a row that delivered nothing and carried no heartbeat. An error answer is reported with `onError` and not retried. | `cs:160-200`, `:279-320` |
| 8.10 | The client drops events it already saw, by `requestId` and `sequence_number`, with a sliding window of 1000 (`dedupWindowSize`). | `cs:36-62`; `:25-27` |
| 8.11 | Resume across a suspension: a suspended request resumes **under the same request id**, and its sequence numbers continue from the last one in the saved log. A client at sequence N reconnects after N once the request is back `in_progress`. A stream attached while the continuation is running follows through the `request.suspended` of the earlier run and ends at the continuation's own end. | `eng/streaming/live-stream.ts:44-54`; `sr:143-149`, `:352-366`; OLD items:205-207 |
| 8.12 | Resume across crash recovery: a request continued through `/continue` keeps its id; its sequence numbers continue past the saved log; a `continuation` item marks the seam. | `ct:798-818`; `eng/streaming/live-stream.ts:44-54` |
| 8.13 | A queued retry attempt (BullMQ) keeps the request id and starts its numbering after the last saved event, so a client tailing by cursor sees the retry's events. | `bullmq/src/job-processor.ts:341-353`, `:407`; `et/run-action-manual.test.ts:128-152` [test] |
| 8.14 | Live-tail silence: for the polling backends (SQLite, filesystem, Postgres created with `liveTailPool: null` or on an executor such as PGlite; the Postgres adapter creates the pool by default, `store-postgres/src/types.ts:55-68`), a tail that sees no new event for 30 s (`LIVE_TAIL_LIVENESS_MS`) ends with a synthesized `request.interrupted` at last + 1. The in-memory store ignores the timeout. | `eng/streaming/live-tail-liveness.ts:1-20`; `eng/stores/subscribe-helpers.ts:148-190`; `eng/stores/testing/request-store-conformance.ts:33` |
| 8.15 | `useSession`: `autoResume` (default `false`): on mount, if the session's latest request is `in_progress`, the hook attaches to that request's stream (no cursor: it replays from the start; items are merged by id). With `false`, the page holds one snapshot of the saved conversation and starts no stream. | `us:262-274`, `:619`, `:1790-1860` |
| 8.16 | `useSession` reload: the page reads the saved session snapshot (client-visible, non-transient items, collapsed to their canonical log); transient items are absent after a reload. | `ru:538-556`; `us:596-610` |
| 8.17 | `session.followRequest(requestId)` re-attaches the hook to a request's stream; it resumes after the last event the hook saw for that request only when the stream had dropped; it returns `false` for a request the user stopped or dismissed. | `us:2415-2427` |
| 8.18 | `useSession` option `live` (default `false`): opens one session stream after the first snapshot, so the view also hears requests it did not send (another tab, another user, an agent). Each finished item any request keeps joins `items` about a second later. It also re-reads child sessions when a run starts or ends and hears changes other sessions make to the scopes it reads. Costs an open connection and a server read about once a second. | `us:276-300` |

---

## 9. Heartbeat and liveness

| # | Fact | Source |
|---|------|--------|
| 9.1 | **Wire heartbeat:** the server writes the SSE comment frame `: ping` (then a blank line) on every live request stream and every GET-attach stream at a fixed cadence. It carries no event id and no sequence number. | `eng/streaming/sse-stream.ts:148`, `:270-278`; `eng/streaming/live-stream.ts:75-81` |
| 9.2 | Cadence default 15,000 ms. Set host-wide with `defaultSseHeartbeatMs` (on `createFlowState`), per flow with `defineFlow({ request: { sseHeartbeatMs } })`; the flow value wins. `0` (or a non-finite value) turns it off. | `eng/routes/http-handlers.ts:212`, `:283-288`; `eng/routes/stream-routes.ts:108-111`; `core/src/types/flow.ts:428-441`; `eng/streaming/sse-stream.ts:187-194` |
| 9.3 | A client sees the heartbeat as a comment frame; `onHeartbeat` fires and the connection counts as alive. | `cs:229-235`; `client/src/types/index.ts:515-523` |
| 9.4 | **Client watchdog:** `useSession` option `stuckThresholdMs` (default 30,000 ms; a value at or below 0 or non-finite disables it). It records the time of the last event or heartbeat; every `max(1000, floor(threshold / 4))` ms, if a request is in flight (or was before an error) and the gap is greater than the threshold, `session.isStuck` becomes `true`. The threshold should be at least twice the server heartbeat. | `us:300-308`, `:619-621`, `:2081-2104` |
| 9.5 | `isStuck` clears on the next terminal status, a successful dismiss, or a new `sendAction`; attaching to a stream sets it `false`. `dismissRequest()` works without a live connection (posts the abort, closes the local stream, adds a local `status` item, refreshes the snapshot). A `sendAction` while stuck dismisses the old request first. | `us:340-350`, `:1390-1395`; OLD connection-resilience:106-108 |
| 9.6 | **Executor heartbeat (different thing):** a running request refreshes its active-request registry entry every `request.heartbeatIntervalMs` (default 10,000 ms; `0` disables). The same tick delivers a cancellation recorded by another process. | `eng/execution/runAction.ts:1430`; `core/src/types/flow.ts:415-427` |
| 9.7 | **Stale-request sweeper:** every `staleSweepIntervalMs` (default 30,000; `0` disables), a request whose registry heartbeat is older than `staleSweepThresholdMs` (default 60,000) is marked `interrupted`; a queued request nothing has claimed within `queuedGraceMs` (default 600,000; finite, non-negative, the host throws at startup otherwise) is too. Both bounds also apply to the sweep at startup and to `check-interrupted`. | `eng/flowstate/types.ts:299-312`; OLD connection-resilience:41-75 |
| 9.8 | Interrupted-request routes: `POST /api/flows/users/:userId/check-interrupted` sweeps now and answers the requests that call marked; `GET /api/flows/users/:userId/interrupted-requests` lists the user's `interrupted` requests. Both answer `{ interrupted: [{ requestId, sessionId?, flowKind, flowId, actionName, interruptedAt }] }`. | OLD connection-resilience:32-39 |
| 9.9 | Request status: `GET .../requests/:requestId/status` reports the persisted status (and `lastHeartbeatAt` while a registry entry exists). | `eng/routes/request-status-routes.ts` |
| 9.10 | Heartbeat table for the page (what each is, cadence, who sets it): wire ping (15 s, server, `defaultSseHeartbeatMs` / `request.sseHeartbeatMs`); executor heartbeat (10 s, `request.heartbeatIntervalMs`); sweeper (30 s tick, 60 s age, `staleSweepIntervalMs` / `staleSweepThresholdMs`); client watchdog (30 s, `stuckThresholdMs`). | 9.2 to 9.7 |
| 9.11 | Heartbeat on the **session stream**: a `ping` event (not a comment frame) is sent after a 15 s gap with no other event. | `eng/routes/session-stream-routes.ts:108-122`, `:372-392` |

---

## 10. The session stream (second wire)

| # | Fact | Source |
|---|------|--------|
| 10.1 | `GET /api/flows/sessions/:sessionId/stream` follows a whole session. Query: `since` (server time), `session_created_at`, `item_types` (comma list). | `eng/routes/router.ts:93-99`; `eng/routes/session-stream-routes.ts:186-243` |
| 10.2 | Events (`event:` is the type, `data` the JSON, no `id:`): `session.item` (`requestId`, `item`: a finished item any request kept), `session.runs` (`runs[]`: the session's unfinished runs; sent when the stream opens and on each change), `ping`. Every one carries `stream: "session"`, `sessionId`, `at`. | `ce:156-227`; `eng/routes/session-stream-routes.ts:336-338` |
| 10.3 | There is no per-request sequence number. A reconnect hands the last `at` it heard back as `since`; the server starts reading a little before it (margin 5 s), so an item can arrive twice: tell items apart by `requestId` and `item.id`, keep the one that sorts later by `compareItemOrder`. | `ce:156-190`; `cs:380-400`; `eng/routes/session-stream-routes.ts:108-122` |
| 10.4 | The server reads about once a second (1 s), the first read reaches back 60 s when the client names no `since`, and a connection is closed after at most 15 minutes. | `eng/routes/session-stream-routes.ts:108-122` |
| 10.5 | A 401, 403, 404, 409 or 501 stops the client for good: `onStop`, not `onError`, no retries. Otherwise it reconnects with backoff (1 s doubling to 30 s). | `cs:358-376`, `:380-405` |
| 10.6 | Connection states a UI can read (`sessionFeed`, `useSession` with `live`): `connecting`, `live`, `reconnecting` (the first retry coming, as after the 15-minute close), `lapsed` (a retry failed; what it said may be out of date), `stopped` (it will not come back). | `client/src/session-client/follow-session.ts:6-22` |
| 10.7 | `@flow-state-dev/ui` ships a `ConnectionBanner` (drawn on `lapsed` and `stopped`, nothing on `connecting` or `reconnecting`) and a `ConnectionScreen` for a first read that fails: kind `refused` (the server answered no; no retry) or `unreachable` (a Retry button and an automatic retry at 2, 4, 8, ... seconds, capped at 30). | `ui/registry/components/connection-banner.tsx:1-40`; `ui/registry/components/connection-screen.tsx:1-30`; `ui/test/render/connection-banner.test.tsx:86-150` [test] |

---

## 11. Trace events and the trace channel

| # | Fact | Source |
|---|------|--------|
| 11.1 | Trace items: `block_trace`, `router_decision`, `state_snapshot`, `generator_step`. They resolve `{ client: false, history: false }` (4.3). | `crv:34-46` |
| 11.2 | They are on the same endpoint, filtered out by default. `?include=trace` on the stream URL keeps them (the filter is not applied). The JS client sends it with `includeTrace: true`; `useRequestStream` takes `includeTrace`; the DevTool requests it. The recovery route `/continue` takes the same parameter. | `sr:105-107`, `:178`, `:247`, `:312`; `client/src/client.ts:1053-1064`; `react/src/hooks/useRequestStream.ts:64-66`; `devtool/src/react/hooks/use-request-stream.ts:1-12`, `:213`; `eng/routes/recovery-routes.ts:267-271` |
| 11.3 | Trace emission is gated by `FSDEV_TRACE_OBSERVABILITY` (`true`/`1` or `false`/`0`); unset, it is on unless `NODE_ENV === "production"`. With it off, a completed non-transient block leaves one lean `block_trace` record instead (identity, `output`, `rescued`, `modelUsage` without provider metadata, `harnessSpend`, `lean: true`); a failed, suspended or transient block leaves none. The lean record exists so a continuation can skip finished blocks. | `core/src/helpers/trace-observability.ts:1-19`; `cec:3829-3846`, `:3904-3925`; `ct:311-324` |
| 11.4 | `block_trace` fields: `blockName`, `blockKind` (`generator`, `evaluator`, `handler`, `sequencer`, `router`), `blockInstanceId`, `status` (`in_progress`, `completed`, `failed`, `planned`), `input? { source, connected? }`, `output?`, `generator? { model, tools[], prompt, user?, history?, templateSource?, templateFrontmatter? }`, `evaluator? { model, questions }`, `model?` (resolved identity), `modelUsage? { model, promptTokens, completionTokens, totalTokens, providerMetadata?, cacheReadTokens?, cacheCreationTokens? }`, `harnessSpend?[]`, `resourceLoads?[]`, `declaredResources?[]`, `toolCall?`, `startedAt?`, `completedAt?`, `duration?`, `rescued?`, `lean?`, `error? { message, code?, details? }`. | `ct:223-336` |
| 11.5 | A failed block's trace ends with `status: "failed"` and `error { message, code?, details? }`. For a generator that fails output validation, `details` carries `rawOutput`, `issues` and `phase` (`"stream"` or `"final"`); an author-thrown `FlowError.details` passes through. `tool_output.error` and the `error` item share the shape. | `ct:325-335`, `:399-419`, `:589-601`; OLD items:112 |
| 11.6 | `block_trace` `input` and `output` are `BlockValue` descriptors: `inline { value }`, `structure { shape }` (an array or object of entries), `omitted { bytes, preview }`, and in the runtime form `ref { sourceItemId }` to an upstream trace. A downstream block's `input.source` is a `ref` to the upstream trace; `stepAll`, `parallel`, `forEach` write a `structure`. | `ct:87-151`; OLD items:110 |
| 11.7 | When a block is called as a tool, the called block's `block_trace.output` is a `ref` to the `tool_output` item, so the result is stored once. | OLD items:143; OLD trace-channel:177 |
| 11.8 | Reactive blocks (blocks bound to a resource change) trace under the path `__reactive__/<resourcePath>/<reactiveKind>#<n>`, `<n>` a per-process counter so concurrent dispatches stay distinct; the block nests under the block that made the mutation and cascades as a tree. | `eng/context/reactive-dispatch.ts:173`, `:285-293` |
| 11.9 | The generator's own trace update (what the DevTool shows for a model call): an `item.updated` patch on the `block_trace` with `generator { model, tools, prompt, user?, history? }`. The last capture wins across a multi-step tool loop. | `cec:3890-3910` (patch applies every key of the phase data); `ct:244-255` |
| 11.10 | `ModelIdentity` on items and traces: `{ actual, requested?, gateway? }`. `actual` is the model that ran (provider-reported id, else the framework's winning candidate); `requested` appears when the caller's input differs; `gateway` when a gateway routed it. Items carrying it: generator-made `message`, `reasoning`, `source`, `tool_output`, `tool_call_progress`; `block_trace` carries it even when the generator emitted no item. Handler-emitted items carry none. | `contracts/src/types/model-identity.ts` [?, not opened]; `ct:230-238`; OLD items:390-456 |
| 11.11 | **Trace retention:** trace events are stored apart from the request record, in `stores.traces`, as `{ requestId, sequenceNumber, ts, type: "trace.item.added" \| "trace.item.done", item }` where `item` is a `block_trace`, `router_decision` or `state_snapshot`. A request record's retention does not delete them. Best effort: a failed trace write logs one warning and never fails the request. | `eng/stores/types.ts:1730-1755`; `cec:544-600`; OLD trace-channel:205 |
| 11.12 | Backends: in-memory (per-request ring buffer; drops the oldest events past `maxBytesPerRequest`, 5 MiB; FIFO over distinct request ids; gone at process exit); filesystem (`{rootDir}/traces/{encodeURIComponent(requestId)}.ndjson` plus `_roster.json`; survives restarts); SQLite (tables `trace_events` and `trace_request_roster`, rows cascade on eviction; same database as the request store). | `eng/stores/memory/trace-store.ts:25-60`; `eng/stores/filesystem/trace-store.ts:1-50`; `store-sqlite/src/trace-store.ts:1-30`; `eng/stores/index.ts:255-258` |
| 11.13 | Retention: `maxRequests` per store, default 50; 1000 when `NODE_ENV === "development"`; an explicit `traceStore: { maxRequests }` wins either way. The oldest request's trace goes first. | `eng/stores/index.ts:167-190`; `eng/stores/memory/trace-store.ts:25`; `eng/stores/filesystem/trace-store.ts:33` |
| 11.14 | `fsdev dev` and `fsdev run` with no app config keep local data under `.fsdev/data`. The default local store is SQLite (`.fsdev/data/fsdev.db`); `--store filesystem` keeps JSON files, single-process. (OLD says the filesystem store is what `fsdev dev` uses; the default is SQLite.) | `fsdev/src/local-store.ts:1-40` |

---

## 12. What `fsdev run` streams

`fsdev run <flow> <action>` writes one JSON object per line (NDJSON) to stdout.

| # | Fact | Source |
|---|------|--------|
| 12.1 | Line types: `item_added` (`item`), `item_updated` (`itemId`, `patch`), `item_done` (`item`), `content_delta` (`itemId`, `delta`), `state_change` (`scope`, `resourcePath`, `changeType`), `flow_complete` (`output`, `durationMs`, `items`), `suspended` (`requestId`, `sessionId`, `suspensionId`, `reason`, `title?`, `message?`, `answer`), `error` (`message`). | `fsdev/src/commands/run.ts:56-92` |
| 12.2 | This stream is **unfiltered**: trace items (`block_trace`, `router_decision`, `state_snapshot`) and every other item appear. A browser stream leaves the trace types out unless asked. | `fsdev/src/commands/run.ts:490-506`, `:694-745` (no client filter on the emitter) |
| 12.3 | The NDJSON `state_change` line is the translation of the request-scoped `resource.changed` wire event (`scope`, `resourcePath`, `changeType`). It is **not** the `state_change` item; those arrive as `item_added` / `item_done` with `item.type === "state_change"`. | `fsdev/src/commands/run.ts:726-736` |
| 12.4 | A run that ends cleanly writes `flow_complete` and exits 0; a failed run writes an `error` line (message only) and exits 1; a run held for a person writes `suspended` and exits 0. Exit codes: 0 success, 1 execution error, 2 invalid args, 3 config error, 4 discovery error, 5 scaffold error, 10 internal error. | `fsdev/src/commands/run.ts:572-605`; `fsdev/src/exit-codes.ts:14-20`; `fsdev/test/run-command.integration.test.ts:70-115` [test] |
| 12.5 | `--quiet` silences runtime logs on stderr; NDJSON on stdout is unaffected. `--log-level` sets the stderr level. | `fsdev/src/commands/run.ts:146-147` |
| 12.6 | **Not in this reference:** the exact text of the `error` line when no provider key is set (a model-resolver message; it belongs on the model reference). | `core/src/models/createModelResolver.ts:1226-1232` |

---

## 13. Reading items on the client

| # | Fact | Source |
|---|------|--------|
| 13.1 | `useSession(sessionId, options?)` returns `items: OutputItem[]`, `isStreaming`, `isFinishing`, `isStuck`, `canSendAction`, `statusMessage`, `error`, plus `abortRequest()`, `dismissRequest(requestId?)`, `resumeLatestRequest()`, `followRequest(requestId)`. Options: `items` (`boolean` or `{ includeTransient?, itemTypes? }`), `autoResume`, `live`, `stuckThresholdMs`, `childSessions`, `flowKind`, `userId`, `baseUrl`. The session view has no `messages` or `blockOutputs` fields (OLD shows both). | `us:229-248`, `:262-310`, `:340-380`, `:440-470`, `:526` |
| 13.2 | `session.items` excludes transient items unless `items: { includeTransient: true }`; `itemTypes` narrows by type. | `us:229-233`, `:564-610` |
| 13.3 | JS client callbacks for a request stream: `onItemAdded`, `onItemUpdated`, `onContentDelta`, ..., `onHeartbeat`, `onRequestStatus`, `onError`. (The OLD example's `sent.stream({ onItemAdded, onContentDelta })` shape; the exact callback list is on the client API reference.) | OLD items:486-497; `client/src/types/index.ts:500-536` |

---

## 14. The four questions, for each stored part

| Part | Who owns it | Who can see it | Where it is stored | How many |
|------|-------------|----------------|--------------------|----------|
| **A request's items** | The request record: the user who made the request (`userId`, plus `tenantId` and `orgId` when the request carries them) | The owner of the record, through the session snapshot, the request stream and `status` route; other users, tenants and a same-kind peer instance's callers get a `404`. A client sees only items whose resolved `client` is true (4.11, 4.12); the model sees only those whose `history` is true (§6). The DevTool and `?include=trace` clients see trace items too. | The request store's `items` array on the request record: in memory, filesystem JSON, SQLite or Postgres, whichever store the app configures. | One entry per saved item. Transient items: none (5.3). A keyed `data` item: one per `(requestId, key)`. Nothing caps a request's items; a request record is removed by the session's retention policy. |
| **A request's event log** | The same request record | Same owner and the same filter; `starting_after` / `Last-Event-ID` read from it | The request store's event log (`persistEvents`, `getEvents`), beside the record; events past a cursor are read on demand | One event per replayable emission: every event except `ping`, `debug`, `content.delta`, `content.audio.delta`. Events of transient items are included. Deleting the request deletes its events. |
| **A request's trace** | The request (by id) | The DevTool and any client that asks with `?include=trace`; the session snapshot never shows it | A separate trace store (`stores.traces`): in memory, filesystem NDJSON, or SQLite, apart from the request record | The `block_trace`, `router_decision` and `state_snapshot` events of the newest `maxRequests` requests (50; 1000 under `NODE_ENV=development`); oldest evicted first. In memory also capped at 5 MiB per request. Off in production unless `FSDEV_TRACE_OBSERVABILITY` is on. |
| **The live stream buffer** | The running request | The connection that holds it | Process memory, not stored | The newest 10,000 events (`maxResponseBufferSize`); up to 4 MiB unread per connection. |
| **Session timeline** (`items.all()` and the others) | The session | Whoever may read the session | Not a store of its own: assembled from the session's request records | One timeline per session, all requests' items; history reads at most `historyWindow.turns` (50) past turns. |

Sources for the table: `eng/context/record-owner.ts` [?, not opened], `ru:187-200`, `sr:162-165`, `et/stream-routes-reused-id.test.ts` [?, not opened], `eng/stores/types.ts:1730-1755`, `re:127`, `eng/streaming/sse-stream.ts:156`.

[?] The **retention policy** that removes request records and their items is outside this page (`flow.session.retention`); the page should link to it, not describe it.

---

## 15. Lookups the page answers

| Lookup | Answer | Facts |
|--------|--------|-------|
| **Which items are never stored?** | `resource_change`, `state_snapshot` and `tool_call_progress` (always transient); `status` unless `{ transient: false }`; `state_change` in production unless the flow sets `persistStateChanges`; any item emitted with `transient: true`; ephemeral audio content. Trace items of a `transient: true` block. | 5.1, 5.3 |
| **What does a client send to resume?** | `starting_after=<last sequence_number>` on the request stream URL, or `Last-Event-ID: <requestId>:<last sequence_number>`. `starting_after` wins. A bare number in `Last-Event-ID` does not resume. | 8.1 to 8.3 |
| **Which items does the model see on the next turn?** | Only from a generator that sets `history`; only `message`, `reasoning`, `tool_output` (and `data` that opted in with `itemVisibility.history: true`); never transient items; trace, status, error, state and resource records never. | 6.1 to 6.7 |

---

## 16. Contradictions: existing pages against the code

The page states the code's version. Each is a place the existing page would mislead.

| # | OLD says | Code says | Source |
|---|----------|-----------|--------|
| 16.1 | `ctx.emit.component(name, data, { key })`; item type `component` with `component`, `data`; renderers under `renderers={{ component: { ... } }}`; `<FlowProvider renderers={{ component: { "search-results": ... } }}>`. | The item is `data` (`dataType`, `value`, `key?`), emitted with `ctx.emit.data(dataType, value, options)`, drawn through `renderers.data[dataType]`. A stored `component` item reads back as a `data` item. `renderers.component` exists but is for suspension `render.component` names. There is no `ctx.emit.component`. | `ct:506-523`; `core/src/types/block.ts:497-523`; `react/src/registry/block-renderers.ts:55-67`; `eng/stores/legacy-component-items.ts` |
| 16.2 | "All item types" table lists 15 types incl. `component` and omits `data`, `continuation`, `generator_step`, `tool_call_progress`. | 13 public + 4 trace + the wire-only `tool_call_progress`. | §1.11 to 1.13 |
| 16.3 | Item lifecycle "Done: terminal, immutable". | Updates after done apply; a keyed re-emission reopens the same id. | 3.10 |
| 16.4 | `Last-Event-ID: 42`. | The header value is `<requestId>:<n>`. | 8.3 |
| 16.5 | `event: item.added` / `data: { "item": { ... } }` sample, `item.done` with a bare item. | `data` is the whole event envelope with `stream`, `requestId`, `sequence_number`, `ts`. | 7.4 |
| 16.6 | `session.messages`, `session.blockOutputs`. | Not on the session view; use `session.items`. | 13.1 |
| 16.7 | `block_trace` generator patch sample with `messages`, `temperature`. | `generator` has `model`, `tools`, `prompt`, `user?`, `history?`. | `ct:244-255` |
| 16.8 | `suspension_resume.resolution: "approved" \| "rejected" \| "submitted" \| "skipped"`. | A `SuspensionStatus`: also `pending`, `timed_out`, `expired`, `stopped`, `cancelled`. | `ct:788`; `contracts/src/types/suspension.ts:10-30` |
| 16.9 | "Trace items ... four types" with three listed; `trace-channel` says trace events live in `stores.traces`; only three types go there. | Four trace types; the trace store holds `block_trace`, `router_decision`, `state_snapshot`; `generator_step` stays in the request items as a resume record. | `eng/stores/types.ts:1730-1736`; `cec:544-600` |
| 16.10 | Filesystem store is "used by `fsdev dev`". | Default local store is SQLite. | `fsdev/src/local-store.ts` |
| 16.11 | "Trace items are filtered at the SSE transport layer and never reach the client" (items page) next to "`?include=trace` opts in" (trace page). | Both true: the default client connection drops them; `?include=trace` keeps them. | `sr:105-107` |
| 16.12 | `Streaming-text resume`: "snaps to the most recent persisted snapshot". | Verified: deltas never replay; saved copy carries text so far; `item.done` carries the whole. Whether a stream resume shows the snapshot is not directly observable. | 8.6 |
| 16.13 | Items overview "All item types" gives `state_change` transient `Production`. | True, with the exception `persistStateChanges: true`. | 5.3 |
| 16.14 | `contracts/src/items/internal.ts` comment says the public union is "the 10 client-visible types". | The union has 13. (A comment, not user-facing; do not cite.) | `ct:820-833` |

---

## 17. Ledger: the 35 rows other pages moved to R-06

Each row is a claim. "Carried" means it is true and is in the sections named; "Corrected" means the row's wording was untrue or stale and the page states what the code says; "Dropped" means it is not stated and why. Rows are numbered in the order `grep -rhE --include=*.record.md -e '→ R-06( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` returned them.

| # | Row (source page) | Verdict | Where / why |
|---|-------------------|---------|-------------|
| 1 | `goal-seek-loop-termination` item: fields, reasons, "stream-only, never in model history", custom renderer sets it `false` in the `component` map (goal-seek-loop) | **Corrected** | Fields `collectionId`, `reason`, `iterations` and the key are true (2.34). "Stream-only" is wrong: the item is stored on the request's items and its `itemVisibility` is `{ client: false, history: false }`, so the **client stream does not carry it**. A client never sees it, so a renderer entry is moot. If one is written, it goes in `renderers.data`, not a `component` map. Reasons verified: the judge's own `reason` string on `done`, `converged` when the verdict has none, `max-iterations`, `judge-error`, `waiting-on-a-user`, `waiting-on-an-event` (a pass that ends waiting spends no iteration and runs no judge, replan or finalize). `iterations` is the drains run (`goalSeekLoopDrains`), not counting a pass that ended waiting (`goal-seek-loop.ts:20-32`, `:252-254`, `:480`, `:511`, `:545-547`). |
| 2 | `task-change` and `task-board-meta` emitted by the pattern; which renderer reads each (plan-and-execute) | **Carried** | 2.29, 2.35 |
| 3 | Item table `task-change` / `task-board-meta`; `planning`, `replanning`; `synthesizing` not emitted (plan-and-execute) | **Carried** | 2.29 to 2.33. `planning` comes from the shared planning entry (`patterns/src/shared/planning-entry.ts:370-376`); `replanning` from `evaluate-progress`; `synthesizing` is in the type and not emitted (`synthesize.ts:140-152`). |
| 4 | The emitted `component` item: `component`, `data`, `key`; dispatched by `component` name (generative UI) | **Corrected** | Fields are `dataType`, `value`, `key`; dispatch is `renderers.data[dataType]` (2.4, 2.23, 4.14, 16.1). |
| 5 | Same `key` in the same request replaces the item's data in place; replaced, not merged; different request = separate item (generative UI) | **Carried** (wording: `value`, not `data`) | 2.25, 3.9, 4.16, 5.5 |
| 6 | `key` semantics: one rendered per key within a request; dedupe on by default and can be turned off; no key = always shown (generative UI) | **Carried** | 4.16. The off switch is `deduplicateByKey={false}` on `<ItemsRenderer>`. |
| 7 | Generator with no `itemVisibility` emits nothing to the client; dev warning from `defineFlow`; value `{ client: true, history: true }` (add-to-an-existing-app) | **Carried** | 4.9, 4.10 |
| 8 | Client behaviour when the server is unreachable: connection screen, automatic retry, resume (run-a-starter) | **Carried, narrowed** | The connection screen is a `@flow-state-dev/ui` component for an app's first read (10.7); automatic retry 2 s doubling to 30 s. "Resume" of a request stream is 8.7 to 8.9 and the session stream's reconnect is 10.5. The page should say the screen is part of the UI kit, not the framework's transport. |
| 9 | Trace events: `block_trace` fields (name, status, input, output, error); a failed block's trace ends `failed` with `error`; jq example stays (build-with-your-coding-agent) | **Carried** | 11.4, 11.5, and the `fsdev run` stream in §12 (`item_added` / `item_done` lines whose `item.type` is `block_trace`). |
| 10 | Block traces, router decisions, state snapshots, generator steps never sent to the client; state changes for unexposed fields are sent but ignored by the reducer (what-the-browser-sees) | **Carried** | 4.3, 4.11, 4.17. Note: the reducer ignores keys not in the **initial snapshot**, which is the exposed set. |
| 11 | Resume: session stream reconnects automatically; request stream reopens from the last seen sequence number, the server replays missed items (what-the-browser-sees) | **Carried, corrected in detail** | 8.7 to 8.9, 10.5. The server replays missed **events** (not text deltas). |
| 12 | Visibility flags `client`/`history`; default per block kind (blocks) | **Carried** | 4.1, 4.7 (default per **item type**; per block kind: generator, no visibility = no items; handler emits default `{ client: true, history: true }` for a message, data default client-only). |
| 13 | Item lifecycle: message added empty `in_progress`, `content_delta` appends, `item_done` resends whole as completed; `tool_output` gets name and arguments at start and gains result when done (sessions-items-and-streaming) | **Corrected** | 3.1 to 3.4. The wire name is `content.delta` and `item.done` (the NDJSON names are `content_delta`, `item_done`). Not every message streams: handler-emitted messages go added+done in one step, `completed`. `tool_output` start carries `toolCall` (name, `arguments`, `callId`) and `status: "in_progress"`. |
| 14 | Item fields; per-type table of who makes it and whether the next request's model sees it | **Carried** | §1, §2, §6 |
| 15 | Item identity: `id` unique within a request, list key is `requestId` + `id` | **Carried** | 1.9 |
| 16 | Generator `history` option; history-eligible types (`message`, `reasoning`, `tool_output` yes; `component`, `status`, `error` never); `itemVisibility` flags and defaults | **Corrected** | 6.1 to 6.4. `component` is `data`, which **can** enter history when its emitter sets `itemVisibility.history: true`; `status` and `error` never do. |
| 17 | `ctx.emit.component`: renderer name first argument, `key` replaces, data replaced whole, reload shows the latest | **Corrected** | It is `ctx.emit.data(dataType, value, { key })`; 2.25, 16.1. The replace-whole and reload-shows-latest claims are true. |
| 18 | `ctx.emit` methods: `message` (one piece, enters history), `status` (live text as `statusMessage`, not stored by default, `{ transient: false }` stores), `component` (stored unless `transient: true`) | **Corrected** | 2.24 to 2.27: `component` is `data`. `message` enters history when its resolved `history` is true, which is the default for a handler emit with no `itemVisibility`; inside a generator scope an emitter without its own `itemVisibility` takes the generator's (`cec:355`). |
| 19 | Trace rows appear on the `fsdev run` stream; a browser's stream leaves them out unless the client asks (`includeTrace`, `?include=trace`) (sessions-items-and-streaming) | **Carried** | 11.2, 12.2 |
| 20 | Resume: every event has a sequence number; client sends `starting_after=<n>`, receives all later events | **Carried** | 8.1 to 8.5 |
| 21 | Resume of an in-progress item: deltas not replayed; text snaps to last saved copy, then grows | **Carried, narrowed** | 8.6: deltas are never replayed (verified); "snaps" as a stream behaviour is not directly verified [?]. The page may state: no deltas are replayed, the saved item carries the text so far, `item.done` carries the whole. |
| 22 | Reload: page loads saved conversation; `autoResume` true attaches to the running request, false leaves one snapshot; transient items absent after reload | **Carried** | 8.15, 8.16 |
| 23 | Stuck stream: heartbeat interval, condition that sets `isStuck`, `followRequest(requestId)`, retry rules | **Carried** | 9.1 to 9.5, 8.8, 8.9, 8.17 |
| 24 | Request: streams items; resume by sequence number (glossary) | **Carried** | §7, §8 |
| 25 | Stream response: `text/event-stream`, headers flushed before the first chunk, a client disconnect ends the stream (railway) | **Carried in part; part dropped** | Content type and "a disconnect ends the stream" are 7.3 and 7.14. **Dropped: "headers must be flushed before the first chunk."** No framework code or exported surface states it; it is advice for a host a reader writes by hand, and the railway page's own fact check found the framework's hosts do not hand-flush (`@flow-state-dev/node` serves through Hono). It belongs on the deploy page, not here. |
| 26 | Streaming over a proxy: a buffering intermediary delays SSE events; unbuffered pass-through needed (railway) | **Carried, narrowed** | 7.17: what the framework sets (`no-transform`, `x-accel-buffering: no`). The claim that a buffering proxy delays events is a platform fact, not a framework one; the sheet states only the headers. |
| 27 | Client-visible items vs trace items; DevTool requests them, production stream drops them (debug-a-run) | **Carried, corrected** | 11.2: the DevTool requests `?include=trace` (`devtool/.../use-request-stream.ts:213`); **any** client stream drops them by default, not only production. Trace *emission* is what production turns off (11.3). |
| 28 | Item types `task-change` and `task-board-meta`; board-backed pattern inherits them (write-a-pattern) | **Carried** | 2.29 to 2.33 |
| 29 | `client` / `history` flags; a generator with neither runs but streams no message (your-first-flow) | **Carried** | 4.1, 4.9 |
| 30 | What a run streams: block trace events, the generator trace update, `state_change` items, `duration` on `flow_complete`; exit 1 and `error` text when no provider key (your-first-flow) | **Corrected** | §12. The `state_change` NDJSON line is the `resource.changed` translation; `state_change` items arrive as `item_added`/`item_done`. `flow_complete` has `durationMs` (not `duration`) and `items`. The no-key message text is the model reference's (12.6). |
| 31 | `onItem`: added, updated, done; same fan-out as SSE clients; includes transient items; listener errors never fail the run (run-a-flow-from-code) | **Carried** | 5.7 |
| 32 | Reactive trace path `__reactive__/<resource-ref>/<kind>#<n>` (react-to-a-change) | **Carried** | 11.8 |
| 33 | Resume by `Last-Event-ID` across worker retries: request id and sequence numbers stable (background-jobs-bullmq) | **Carried, corrected in detail** | 8.13: the retry continues numbering after the last saved event (so numbers are stable and increasing). The header form is `<requestId>:<n>` (8.3). |
| 34 | `suspension` and `suspension_resume` types and fields; pending = no matching resume item (human-in-the-loop) | **Carried** | 2.11, 2.12; pending: `useSuspensions` reports `pending` until a matching `suspension_resume` arrives (`react/src/hooks/useSuspensions.ts:36-60`). `resolution` takes the wider status set (16.8). |
| 35 | `live` option of `useSession`: what it subscribes to, default; may belong in the generated React API (human-in-the-loop) | **Carried** | 8.18. It is a hook option and can sit on the React API page; the R-06 mention is one line plus a link. |

---

## 18. Left out for lack of an observable surface, or not verified

- **"Headers flushed before the first chunk"** (ledger 25): no surface; dropped.
- **tool_call_progress visibility effect** (4.6): reading `resolveItemVisibility` puts it on the structural default, which would send it to a client even when its generator is `client: false`. I did not run it. The page may list the type as transient and wire-only and say nothing about its visibility until a pass runs it.
- **Stream-level "snap to the saved copy"** (8.6, ledger 21).
- **`ModelIdentity` source file** (11.10): the fields come from the OLD page and the type comments in `ct`, not from `contracts/src/types/model-identity.ts`, which I did not open.
- **Retention policy for request records** (§14): out of scope; link.
- **Which tests** `tool-output-item-updated.test.ts`, `block-trace-lifecycle.test.ts`, `stream-routes-reused-id.test.ts`, `record-owner.ts` say exactly: named, not opened.
- **Word count, figure and budget**: not this pass.

## 19. Notes for the later passes

- The page is a Reference page: tables, no narrative. About 17 sections of facts here become six or seven tables; the heartbeat, resume and persistence tables each stay at or under six rows by splitting or by linking to the neighbouring Reference pages (concurrency for arrival, resources for `resource_change`, models for `ModelIdentity`).
- One example that uses it, for the page's code sample: `packages/ui/src/generative/info-card/tool.ts:27` (`ctx.emit.data("info-card", input, { key })`) with `generativeRenderers`; the client side is `examples/hello-chat/app/page.tsx` [?, not opened].
- Never state: the 256 KiB limit as a tuning guide (the page states it as the default and names the option), the 4 MiB cutoff mechanism (state it as "a reader more than 4 MiB behind is cut off; resume from its last id").

## 20. Pass 3: what the draft states, drops and adds

The draft (`items.md`, `figures/items-life.svg`) states every row in the §17 ledger marked Carried or Corrected, in the wording §17 gives. Rows the page does not carry in full, and why:

| Ledger row | Page | Why |
|---|---|---|
| 8 (connection screen) | One sentence in "The session stream", naming `ConnectionBanner` and `ConnectionScreen` as `@flow-state-dev/ui` components and their retry cadence | The screen is the UI kit's, not the transport's (§17 row 8). |
| 25 (headers flushed before the first chunk) | Dropped | No surface states it (§18). It belongs on the deploy page. |
| 26 (a buffering proxy delays events) | One row, "A proxy", stating only the headers the framework and its adapters set | The delay is a platform fact, not the framework's. |
| 21 (text "snaps" to the saved copy) | Stated as "no tokens replay; the saved text is what had been saved; `item.done` carries the whole text" | The snap is not directly observable (§8.6). |
| 35 (`live`) | One row in "What a reload shows", with its cost | The hook's full option table belongs on the React API page. |
| 1 (goal-seek) | A row in "Items other packages emit", visibility `{ client: false, history: false }`; no renderer advice | The item reaches no client, so a renderer entry is moot. |

Facts on the sheet the page leaves out: 1.13's union detail beyond one sentence, 2.28 (`ctx.emit.trace.*`, internal), 7.18 (`injectHeartbeat`, a Vercel adapter re-export), 11.10 (`ModelIdentity`, unverified, belongs on `reference/models`), 11.14 (default local store, belongs on `reference/stores` and `reference/cli`), 12.5 (`--quiet`, `--log-level`, on `reference/cli`), 12.6 (the no-key error text, on `reference/models`), 13.3 (the client callback list, on `reference/client`), 7.15's `204`/`202`/`404`/`409` abort answers (on `reference/http-api`), 9.10 (the summary table, replaced by the heartbeat table), the `[?]` rows (4.6 effect on `tool_call_progress`, 8.6 stream-level snap).

Facts the page states that §1 to §15 do not list as their own row, each checked at pass 3:

- `task-board-recorder-failure` has visibility `{ client: false, history: false }` and reports a task write the board could not announce: `packages/orchestration/src/task-board/blocks/recorder-failure.ts:40-55`.
- `converged` is the `goal-seek-loop-termination` reason when the judge's verdict has none: `packages/orchestration/src/task-board/goal-seek-loop.ts:545`.
- A message emitted inside a generator's scope with no `itemVisibility` of its own takes the generator's, and so does `agentName`: `packages/engine/src/context/createExecutionContext.ts:355-356`.
- The plain `GET` stream sets neither `x-accel-buffering` nor `no-transform`: from `SSE_HEADERS` (7.17, `ru:39-43`), which lists `cache-control: no-cache` and `connection: keep-alive` only.

## 21. Pass 8, round 1: what changed on the page

Corrections to the sheet and the page:

- **`request(id)` is on the flow handle.** `Client.requests` holds only `interrupted()`. A request is followed with `createClient(...).flow("support").request(id).stream({ ... })`. `packages/client/src/client.ts:455-462` (`FlowHandle.request`), `:274-290` (`RequestStreamOptions`). The page's example now uses it; the callback event `ItemDoneEvent` carries `item` (`client/src/types/index.ts:492`).
- **`status` is not saved by default** (5.3, 2.26). The page's opening example no longer says a run "leaves" a status item: it sends one, live only.
- **`lookUpOrder` is shown** (`src/flows/support/tools/look-up-order.ts`, a `handler` with `name`, `description`, `inputSchema`, `outputSchema`, `execute`), so the `draftReply` import resolves.
- **`tool_call_progress`** (2.14): every generator emits it, streaming or not. The sheet's "non-streaming ones synthesize them" describes construction and is not stated.
- **`tool_call_progress` and the unions** (1.13): it is in neither `OutputItem` nor the trace types; the page says it is in no item union.

Left on this page, unchanged from §20: every table of item types, lifecycle, visibility, persistence, the model's view, the wire events and their cursor rules, the replay table, the heartbeat table's first three rows, the trace types, the `block_trace` fields (now a table with a type and a meaning per field, 11.4), the `fsdev run` line types.

Moved off the page to a Reference page, each a pointer on this page (ledger and depth pass; rows for the target pages to carry):

| Fact | Facts | Target |
|---|---|---|
| `block` option `transient` affects only the framework's own trace items | 5.4 | `reference/blocks` |
| `defineFlow` development warning for a generator action with no `itemVisibility` | 4.10 | `reference/flows` |
| Client rule for a re-sent item id; `request(id).stream` options and the cursor it sends | 5.6, 8.7 | `reference/client` |
| `runAction` option `onItem` | 5.7 | generated engine API |
| `useSession` fields and options, `statusMessage`, `items.includeTransient`, `itemTypes`, `isStuck` and `dismissRequest()` behaviour | 2.27, 9.5, 13.1, 13.2 | generated React API |
| `task-plan` component; connection states, `ConnectionBanner`, `ConnectionScreen` | 2.35, 10.6, 10.7 | `reference/ui-components` |
| Pending-suspension definition; resumed-request rule for `generator_step`; terminal events and the re-open after `request.suspended` | 5.10, 7.7, 17 row 34 | `reference/durable-execution` |
| Frame format (`id` composition, `data` is the whole event); `check-interrupted` and `interrupted-requests` routes | 7.4, 9.8 | `reference/http-api` |
| Trace store: record shape, backends, `maxRequests`, `maxBytesPerRequest`, failed-write behaviour | 11.11 to 11.13 | `reference/stores` |
| `FSDEV_TRACE_OBSERVABILITY` values, default and lean record | 11.3 | `reference/environment` |
| `staleSweepIntervalMs`, `staleSweepThresholdMs`, `queuedGraceMs`, startup refusal | 9.7 | `reference/runtime` |
| `fsdev run` exit codes | 12.4 | `reference/cli` |

Cut from the page, not moved: the legacy `component` item row (5.8; an Upgrading-page row, not this page); "no default inferred from position" (4.9); the write-before-send ordering (7.8), now stated as "every sequence number a client receives can be replayed from the saved log"; the buffer-eviction reason in 7.10; "the server reads saved events from the cursor on only" (8.5); the executor heartbeat's registry wording (9.6), now "a running request reports itself alive at this interval, and an abort sent through another server reaches it within one interval".

Display order (1.10) is now a row in "What every item has". The goal-seek `iterations` (17 row 1) is "the passes the loop completed; a pass that stopped to wait is not counted".
