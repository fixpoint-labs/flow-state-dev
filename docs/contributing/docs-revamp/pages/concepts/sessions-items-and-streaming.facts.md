# Facts for Sessions, items and streaming (C-06, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example.

Paths are from the repo root. Abbreviations:

- `ct` = `packages/contracts/src/items`
- `core` = `packages/core/src`
- `eng` = `packages/engine/src`
- `cl` = `packages/client/src`
- `rx` = `packages/react/src`
- `hc` = `examples/hello-chat` (`hc/flow` = `src/flows/hello-chat/flow.ts`, `hc/page` = `app/page.tsx`)
- `docs` = `apps/docs/docs`
- `ov` = `docs/streaming/overview.md`, `em` = `docs/streaming/emitting-items.md`, `it` = `docs/streaming/items.md`, `cr` = `docs/server/connection-resilience.md`, `au` = `docs/server/authentication.md`, `pe` = `docs/persistence/overview.md`, `fl` = `docs/fundamentals/flows.md`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/items` (or another Reference page); the page links to it and does not state it. **[verify]** not confirmed against running code; keep off the page or soften until a later pass confirms it. **[ran]** observed by running `fsdev run` while writing this sheet; the captured lines are in section 9.

The page's one app is the support desk used by the Blocks page (flow `support`, sequencer `handleTicket`, generator `draftReply`, tool block `lookUpOrder`). The progress card in the examples is a component named `order-lookup`.

## 1. Opening: what the three words mean

- **Item.** The framework's glossary: "A stream item: what a run streams back (`OutputItem`, `getItems`). Not a resource in a collection." `docs/contributing/glossary.mjs:165-170`. [page: the word "item" means this and only this]
- Every artifact a block produces while it runs is an item: a chat message, a tool call result, a progress indicator, a custom UI component. Each streams to connected clients as it happens and, in most cases, is persisted. `ov:7`
- **Request.** One action invocation. When a user sends a message the framework creates a request, runs the action's root block, and stores the items produced on the request record. `ov:9`; `eng/stores/types.ts:138-146` (`RequestRecord`: `actionName`, `userId`, `sessionId`); `fl:248-254` (action run order)
- **Session.** "One conversation." A request names a `sessionId`; the framework loads that session's state, runs the action, persists changes; the next request with the same `sessionId` picks up where the last left off. `docs/fundamentals/state-and-scopes.md:35`
- A session's items are the items of all its requests, shown as one timeline; each item stays tied to the request that produced it (`requestId`). `ov:9`, `ov:100`; `ct/types.ts:29-49` (`OutputItemBase.id`, `.requestId`, `.itemIndex`)
- Three jobs for items: streaming output, session history, and context for later model calls. `ov:11-15` [page, as "what an item is for"]
- Two ids to keep apart: an item's `requestId` says which request made it; a session holds many requests. `ct/types.ts:48-49`; `eng/stores/types.ts:144`

## 2. One reply, as it arrives (the timeline figure; example 3, `fsdev run`)

What the browser receives while a request runs. The page's claim: items arrive in order, and one of them, the reply text, grows.

- Start of a request: the action's `userMessage(input)`, when the action defines one, becomes a user-role `message` item before the blocks run. `core/types/flow.ts:219`; `eng/execution/runAction.ts:1825-1846`; [ran, section 9, first line]
- The user echo is complete when it appears: `status: "completed"`, `role: "user"`, `transient: false`. `eng/execution/runAction.ts:1830-1841`; [ran]
- A generator that asks for a text reply emits its `message` item first as `in_progress` with empty text: `{ type: "message", role: "assistant", status: "in_progress", content: [{ type: "output_text", text: "" }] }`. `core/blocks/generator.ts:2321-2332`; [ran]
- The text then arrives as `content.delta` events, each a small string (a word or part of one) for that item's id. `ct/events.ts:71-76` (`ContentPartDeltaEvent`: `itemId`, `contentIndex`, `delta: string`); [ran]
- When the model finishes, `item.done` carries the whole item with `status: "completed"` and the full text. `ct/events.ts:31-34`; [ran]
- An item can also end `incomplete` or `failed`. Statuses: `in_progress | completed | incomplete | failed`. `ct/types.ts:7` [page names `in_progress` and `completed` only; the other two [ref]]
- A model's thinking text, when the model produces it, is a separate `reasoning` item that streams the same way, before the reply. `core/blocks/generator.ts:2258-2275`; `ct/types.ts:482-492`; [ran: `hello-chat` asks for reasoning summaries, `hc/flow:46-49`] [page, one clause; the support-desk generator may not produce one, so keep it out of the timeline figure]
- A tool call is an item too. When the model calls a tool, a `tool_output` item is added `in_progress` with the tool's name and arguments before the tool runs, then updated and finished with the result. `core/blocks/internal/emit-tool-output.ts:1-6` (lifecycle `item.added` -> `item.updated` -> `item.done`), `:112-157` (the added item: `blockName`, `toolCall.name`, `toolCall.arguments`, `output: undefined`); `ct/types.ts:339-347`. [page]
- The same `tool_output` envelope is used for a tool the model calls and for a block wrapped with `.asTool()`. `core/blocks/internal/emit-tool-output.ts:1-6`; `it:114-145` [ref]
- Each `tool_output` is a single item in the list, with the arguments and the result in one place, not two items. `ct/types.ts:339-380` [page]
- Events on the wire: `request.created`, `request.in_progress`, `item.added`, `item.updated`, `content.added`, `content.delta`, `content.done`, `item.done`, and one terminal `request.<status>`. `ct/events.ts:136-149` (`RequestStreamEvent` union), `ct/events.ts:19-24` (created), `core/types` request status `contracts/src/types/request-status.ts:11-18`. [ref: the full event list is Reference; the page names `item.added`, `content.delta`, `item.done`]
- Request statuses: `in_progress | completed | incomplete | failed | interrupted | aborted | suspended`. `contracts/src/types/request-status.ts:11-18` [ref]
- Every event on a request stream carries a `sequence_number`; the SSE frame's `id:` is `<requestId>:<sequence>`. `ct/events.ts:7-12`; `eng/streaming/encode-event.ts:13-22` [page: "every event has a number"]
- Order the items are shown in: by time, then by the item's index in its request, then request id, then item id. Server and client use the same comparison, so a live view and a reload show the same order. `ct/order.ts:1-23` [page: "the same order live and after a reload"; the four-key comparison [ref]]
- A text delta reaches the React hook's `items` batched to the next animation frame, so `items` updates at screen rate rather than per token. `rx/hooks/useSession.ts:967-989` [ref; the page does not describe batching]
- What the browser does not receive by default: trace items (`block_trace`, `router_decision`, `state_snapshot`, `generator_step`) are left out of a client's stream unless the client asks for them: the request stream route keeps trace events when the URL has `?include=trace`, and the client and React hook expose it as `includeTrace`. `ct/resolve-visibility.ts:10-16`, `:31-36`; `eng/streaming/client-filter.ts:1-12`; `eng/routes/stream-routes.ts:106`, `:178`; `cl/client.ts:1025-1032`; `rx/hooks/useRequestStream.ts:60`; `docs/streaming/trace-channel.md:9-14`, `:22-27`. [page: one clause, linked, saying a browser's stream leaves them out unless the client asks; the rest is [ref]]
- `fsdev run` prints the unfiltered stream, trace items included, so its output has rows a browser's stream leaves out by default. `fsdev` `packages/fsdev/src/commands/run.ts:487-496`, `:690-737`; [ran: `block_trace` rows in section 9]
- `fsdev run` maps events to NDJSON types `item_added`, `item_updated`, `item_done`, `content_delta`, `state_change`, `flow_complete`, `error`. `packages/fsdev/src/commands/run.ts:56-65` [page: the three lines in section 9 only]

### Q1 answer ("the model is halfway through a sentence; what has the browser received?")

- The user echo (complete), any `tool_output` items (complete), and the reply as one `message` item with `status: "in_progress"` whose text is the deltas so far. Not yet received: the item's `item.done` and the request's terminal event. Sources as above. [ran] `fsdev run` shows the same sequence.

## 3. What an item is

- Every item has: `id`, `type`, `status`, `requestId`, `itemIndex`, `ts`, `provenance` (which block made it: `blockName`, `blockInstanceId`, `phase`). `ct/types.ts:29-49`, `:16-27` [page: five of these; `provenance` named as "which block made it"; field list [ref]]
- Optional on every item: `transient`, `ownedBy`, `taskId`, `itemVisibility`, `agentName`. `ct/types.ts:46-86` [ref]
- Items are a union discriminated by `type`: `message`, `reasoning`, `tool_output`, `component`, `container`, `source`, `status`, `error`, `state_change`, `resource_change`, `suspension`, `suspension_resume`, `continuation`. `ct/types.ts:806-819` [ref for the full table; see section 4 for the ones the page names]
- Plus four trace types that are not in that union and never reach a client: `block_trace`, `router_decision`, `state_snapshot`, `generator_step`. `ct/resolve-visibility.ts:31-36` [ref]
- `fsdev run` and the React hook both fold events into the same list: an item is added, patched by `item.updated` (a shallow top-level merge), and settled by `item.done`. `ct/events.ts:36-69`; `it:39-51`, `ov:122-133` [page: "an item is added, may grow, and is done"; the patch rules [ref]]
- A client that builds its own list can use `createRequestStreamStore`. `ov:19`; `docs/api/client.md#createrequeststreamstore-and-bindstoretocallbacksstore-options` [ref]
- Items are told apart by `requestId` and `id` together, because two requests can keep items with the same id. `ct/events.ts:176-181`; `docs/client/react.md:138` [ref]
- Audio of a spoken reply is a `content.audio.delta` event on the same stream; these are live only. `ct/events.ts:100-115`; `it:267-326` [ref; voice is not on the page]

## 4. The items you will meet

The page names these, each with who makes it. Visibility is the whole story of who sees what; see the visibility rules at section 6.

| Item | Made by | Browser sees it | Next model sees it | Persisted | Source |
| --- | --- | --- | --- | --- | --- |
| `message`, `role: "user"` | the action's `userMessage` | yes | yes | yes | `eng/execution/runAction.ts:1825-1846` |
| `message`, `role: "assistant"` | a generator, or `ctx.emit.message` | yes (default) | yes (default) | yes | `core/blocks/generator.ts:2321-2332`; `eng/context/createExecutionContext.ts:326-361` |
| `reasoning` | a generator | yes (default) | yes (default) | yes | `ct/resolve-visibility.ts:45-47`; `eng/context/history.ts:118-129` |
| `tool_output` | a tool call | yes (default) | yes (default) | yes | `core/blocks/internal/emit-tool-output.ts:112-157`; `eng/context/history.ts:130-168` |
| `component` | `ctx.emit.component` | yes | no | yes unless `transient: true` | `eng/context/createExecutionContext.ts:379-415`; `ct/resolve-visibility.ts:42-49` |
| `status` | `ctx.emit.status` | yes, live | no | no (live only) unless `transient: false` | `eng/context/createExecutionContext.ts:508-551` |
| `error` | the framework, when the request fails | yes | no | yes | `ct/types.ts:575-588`; `ov:41` |
| `state_change`, `resource_change` | the framework, when state or a resource changes | yes (not drawn by the default renderer) | no | not asserted here | `ct/types.ts:559-573`; `rx/components/ItemRenderer.ts:56-69` |

- `error` items are produced when the request itself fails. A failure inside a background `.sideChain()` task produces no public item. `ov:41` [ref]
- `suspension` and `suspension_resume`: a block paused for a person's answer, and the audit row when it resumes. Client-visible, never in model history. `ct/types.ts:700-790`; `it:209-240` [page: one clause, link to C-10 / reference; `suspension` is not the page's subject]
- Default renderer behaviour (what a registered name does, what an unregistered one prints) belongs to Rendering items (C-10). `rx/components/ItemRenderer.ts:1-9` (unregistered types fall back to a JSON `<pre>`), `rx/components/ItemRenderer.ts:56-69` (`state_change`, `resource_change`, `suspension_resume`, `continuation` render nothing) [ref]
- Defaults for a handler's `ctx.emit.message`: it emits `role: "assistant"`, `status: "completed"` in one step (`item.added` then `item.done`), so the text arrives whole, not in deltas. `eng/context/createExecutionContext.ts:326-361`; [ran: section 9, handler run]. [page: "a message you emit arrives in one piece"]
- Handler-emitted messages have no `model` field; only generator items carry one. `ct/types.ts:455-460`; `em:61` [ref]
- Tool blocks and the progress card: `ctx.emit` is on every block's context, including a handler the model calls as a tool. `core/types/block.ts:466-523` [verify: the sheet did not run an emit from a block called as a tool; pass 4's type-check and pass 5's fact check confirm it, or the example emits from a sequencer step instead]

## 5. A session keeps them

The four questions, for each stored part.

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| Session | The `userId` it was created under, and the organization (`orgId`) when it has one. Fixed at creation; reopening cannot move it. `eng/stores/types.ts:33-49`; `au:33-36`, `:107-108`, `:357-358` | That user. Another signed-in user who asks for it gets a `404`, the same answer as for an id nobody used; a user acting for the wrong organization gets `403`. `au:357-371` | The session store of the configured stores: in memory by default (gone on restart), or the file, SQLite or Postgres adapter. `pe:7`, `:23-28`; `eng/stores/types.ts:33`; `docs/streaming/overview.md:92-94` | Many per user; each flow can hold many. A session has one `latestRequestId`. `eng/stores/types.ts:134` |
| Request | The same user. `eng/stores/types.ts:143`. A caller reaching someone else's request gets a `404` for its status, stream, retry, continue, resume and abort. `au:357-363` | That user | The request store, as one record per request. `eng/stores/types.ts:138-146` | Many per session, one per action run. `eng/stores/types.ts:144` (`sessionId`) |
| Item | The request that made it (`requestId`). `ct/types.ts:48-49` | By visibility: the user's browser sees `client: true` items; the model sees `history: true` items; trace items are the DevTool's. Section 6 | On the request record, in `items`. A session's list is built by reading its requests' items; the session holds none itself. `eng/stores/types.ts:233-238`; `eng/routes/state-routes.ts:104-121` | As many as the request emits: one per emission, except a keyed component, which is one per `(requestId, key)`. Transient items are never stored. `packages/engine/test/execution.test.ts:2907-2962`; `eng/execution/runAction.ts:431-445` |

- The session's list is assembled on read: each request's items go through the client filter, then are sorted into one order. `eng/routes/state-routes.ts:104-121`; `eng/routes/route-utils.ts:529-556` (`snapshotItemsOf`: client visibility or an `item_types` filter). [page: "a session keeps its requests' items as one list"]
- A reload and a live view show the same set of items; the same filter and comparison serve both. `eng/routes/route-utils.ts:529-545`; `ct/order.ts:1-9`. [page: the guarantee]
- The session snapshot (`GET /sessions/:id/state`) returns items only when asked for with `include_items`, at most 100 by default (`limit`, `offset`). `eng/routes/state-routes.ts:29`, `:79-83`, `:107` [ref; the hook does the reading for the page's reader]
- `useSession` reads the whole item history on mount. `rx/hooks/useSession.ts:527-535` (`refresh` doc: "the snapshot with its whole item history") [page]
- Persisted items exclude transient items and ephemeral content parts (such as audio). The rule is applied on every write of a record's items, "so a read while a request runs shows what its settled record will". `eng/execution/runAction.ts:431-445`; `ct/content.ts:1-6`
- An in-progress item's partial text is written to the record while it streams, at the store's own cadence, not per token. So a read taken mid-answer shows the text as of the last write. `eng/execution/runAction.ts:1744-1755`; `eng/streaming/response-emitter.ts:776-797`, `:856-862`, `:863-889`; `it:199-203`. [page: "a reload mid-reply shows the reply text saved so far, which can trail what was on screen by a moment"; the cadence and checkpointing [ref]]
- A session's request records are pulled in by one scope: session id, tenant, owner, organization, flow. `eng/routes/state-routes.ts:102-110` [ref]
- Retention of old sessions and requests is not described on any page the sheet may cite. [ref / leave out; do not state a retention rule]
- History window: each request loads at most `session.historyWindow.turns` past turns for the model, default 50. `docs/fundamentals/flows.md:348-358`; `core/types/flow.ts:390`. The full session remains retrievable. [ref]
- Hand-off to the model: `ctx.session.items.all()` is everything; `.client()` is what a browser can see; `.history()` is the model's view, as messages (async, returns `Promise<LLMMessage[]>`); `.selectForContext()` is a raw query. `core/types/scope.ts:153-173` [page: `.history()` only, with `await`]

## 6. Which items the next request's model sees (Q4)

- A generator sees earlier items only when it asks: its `history` option set to `true`, or an item query object. `core/blocks/generator.ts:358-368` (`GeneratorHistoryConfig`), `:610` (`history?`), `:783-795` (`true` runs `ctx.session.items.history()`); `hc/flow:43`. Without it the generator sends no prior conversation, unless a capability it uses adds a history query. `core/blocks/generator.ts:188-190`, `:3134-3140`. [page]
- The model's history is built from items whose resolved visibility has `history: true`: user messages, and conversational items (`message`, `reasoning`, `tool_output`) with `history: true`. `eng/context/history.ts:78-93`, `:88-168`; `ct/resolve-visibility.ts:1-21`, `:42-49`. [page]
- Resolution rules: trace types are never visible to the client or the model; `message`, `reasoning`, `tool_output` take the item's own `itemVisibility`, and absent that resolve to `{ client: true, history: true }`; every other type is `{ client: true, history: false }`. `ct/resolve-visibility.ts:38-49`. [page: the one-line summary; the three-way table [ref]]
- So `component`, `status`, `error`, `state_change`, `resource_change`, `suspension` items never reach the model. `ct/resolve-visibility.ts:42-49`; `eng/context/history.ts:78-93`, `:80-83` ("Returns an empty array for item types that don't map to conversation messages"). [page]
- A generator chooses how its own output is seen with `itemVisibility`: `{ client: true, history: true }` is the user-facing agent; `{ client: true, history: false }` is shown but not remembered (a sub-agent); `{ client: false, history: false }` is trace only; unset means the generator emits no session items at all (it still returns its output to the next block). `core/blocks/generator.ts:570-585`; `core/types` `ct/types.ts:74-85`; `ov:58-78`; `it:364-384`. [page: the first two; the rest [ref]]
- The `hello-chat` example sets `itemVisibility: { client: true, history: true }` and `history: true` on its generator. `hc/flow:43-45`
- `ctx.emit.message(text)` in a handler is visible to the client and enters history by default; pass `{ itemVisibility: { client: false, history: false } }` to keep it out. `ct/resolve-visibility.ts:45-47`; `core/types/block.ts:130-141` (`EmitMessageOptions`); `ov:80-90`. [page]
- A message's `metadata` is never sent to a model; history holds the text alone. `ct/types.ts:468-480`; `em:46-59`. [ref]
- A tool call enters history as two model messages (the call, then the result). `eng/context/history.ts:130-168`; `it:116`. A result too large to record enters later turns as one line naming the tool and its size. `eng/context/history.ts:134-137`; `it:147-163`. [ref]
- The in-flight request's own items are included in `history()` by default. `core/types/scope.ts:80-89` (`includeInFlight`, default `true`). [ref]
- `history()` limits are turn-aligned: whole turns are kept or dropped together. `core/types/scope.ts:50-70`; `ov:112`. [ref]

### Q4 answer

- The next request's model sees the earlier user messages, assistant messages, reasoning and tool calls that are `history: true`, at most the history window, when the generator opts in with `history`. It does not see components, statuses, errors, or any item flagged `history: false`. Sources above.

## 7. Emitting your own (example 2, `ctx.emit.component`)

- Three emitters on every block's `ctx`: `ctx.emit.message(text)`, `ctx.emit.component(name, data, options?)`, `ctx.emit.status(message, options?)`. `core/types/block.ts:466-523`; `ov:21-31` [page]
- A generator emits its own messages and reasoning automatically; the emitters are for handlers and any other block. `ov:23`, `ov:33-41`; `em:7`. [page]
- `ctx.emit.message(text)`: a visible chat message that enters model history. Optional `{ itemVisibility, agentName, transient, metadata }`. `core/types/block.ts:130-141`; `em:13-26`. [page]
- `ctx.emit.status(message)`: sets a single in-flight "what is happening now" slot. Default `transient: true` (live only); the same text twice in a row emits once; `undefined` leaves the slot as is. `core/types/block.ts:511-528`; `eng/context/createExecutionContext.ts:508-551`. [page: one sentence]
- The React hook exposes the slot as `statusMessage`, and clears it to `""` when the request ends. `rx/hooks/useSession.ts:351-357`. [page]
- `ctx.emit.component(name, data, options?)`: a custom UI item. `name` picks the React component registered on the client; `data` is a plain object. It is shown to the client and never enters model history. `core/types/block.ts:487-512`; `ct/types.ts:494-509`; `em:85-105`. [page]
- Options: `key`, `itemVisibility`, `agentName`, `transient`. `core/types/block.ts:499-510`; `eng/context/createExecutionContext.ts:365-370`. [page: `key` and `transient`; the rest [ref]]
- A component is stored by default; `transient: true` streams it live and never stores it. `eng/context/createExecutionContext.ts:385-398`, `:403`; `core/types/block.ts:487-491`; test `packages/engine/test/execution.test.ts:2629-2740`. [page]
- **Keyed components.** Emitting a component again with the same `key` replaces the earlier one: the item id is derived from the key (`item_component_keyed:<key>`), and the stored record holds one entry per `(requestId, key)`. `data` is replaced whole, not merged: fields missing from the new payload are gone. `eng/context/createExecutionContext.ts:385-411`; `ct/types.ts:494-509`; test `packages/engine/test/execution.test.ts:2907-2962`, asserting one stored item whose `data` is `{ a: 99 }` after `{ a: 1, b: 2 }` then `{ a: 99 }`. [page: the progress-card example]
- Live clients still see every emission, one `item.added` + `item.done` pair each; only the stored record collapses. `eng/context/createExecutionContext.ts:385-411`; test `packages/engine/test/execution.test.ts:3052-3110`; `em:158`. [page: "live clients see each update; a reload shows the latest"]
- Without a `key`, each call is a separate item that stacks. `em:146-148`; test `execution.test.ts:2965-3010`. [ref or one clause]
- Keys must be stable for one logical thing; a key that changes per call makes a new item each time. `em:190`. [ref]
- `key` is not the SSE `id:` used for resume. `em:191`. [ref]
- A client that is not the bundled React hooks must overwrite items by id rather than append, or a keyed component shows up twice. `em:160`; `docs/client/react.md:138` (the hook's rule: "An item one request emits more than once under the same id, such as a keyed component, shows its latest copy"). [ref]
- `transient` x `key` give four combinations; the table lives on the Reference page. `em:176-193`. [ref]
- The client names components in `FlowProvider renderers={{ component: { "order-lookup": OrderLookup } }}`; the name in `ctx.emit.component` and the key in `renderers.component` must match. `docs/client/react.md:9-34`; `em:104`. Registering and drawing them is C-10. [page: one sentence, link]
- Output you emit but no renderer is registered for prints as JSON in development rather than nothing. `rx/components/ItemRenderer.ts:1-9`. [ref]
- Container components group child blocks' items under one card (`container` on a sequencer or router). `em:234-270`. [ref; C-10]
- Updating an item already emitted (patch fields) is a lower-level path; `item.updated` shallow-merges top-level keys; `id`, `type`, `provenance`, `itemVisibility`, `transient` cannot be patched. `ct/events.ts:36-69`; `em:272-286`. [ref]

### Q3 answer ("your handler wants to show a progress card")

- It calls `ctx.emit.component("order-lookup", data, { key })`, again with the same `key` as the work moves on, and registers a renderer named `order-lookup` on the client. For one line of text instead of a card it calls `ctx.emit.status`. Sources above.

## 8. If the connection drops

- A request keeps running on the server when the browser's connection ends; a stream is a view onto it, not the request itself. `cr:7-9`; `docs/server/connection-resilience.md:120-124` (a request dispatched to a worker has no browser attached at all). [page]
- Every event has a sequence number. A client can reconnect with `Last-Event-ID: <requestId>:<n>` (the standard SSE header) or `?starting_after=<n>`; the server replays every event after that number, then continues live. `it:180-197`; `eng/streaming/resume.ts:51-60`, `:94-115`, `:128-163`; `eng/streaming/encode-event.ts:13-22`. [page]
- `starting_after` wins when both are sent. `eng/streaming/resume.ts:94-115`. [ref]
- A reconnect that names an id that is not that request's is treated as no cursor. `eng/streaming/resume.ts:105-113` [ref]
- Replay applies to a running request and to a finished one alike: a request that completed replays from its stored event log; one still running is followed live from the cursor. `eng/routes/stream-routes.ts:152-215` (live tail), `:258-312` (terminal replay). [page: "a finished request replays the same way"]
- Replay leaves out: pings, debug events, `content.delta` and `content.audio.delta`. `eng/streaming/resume.ts:141-153`; `eng/streaming/response-emitter.ts:776-797`; test `packages/engine/test/stream-resume.test.ts:379-448`, asserting that after a cursor the replay holds `content.added` and `content.done` and no `content.delta`. [page: the consequence, not the list]
- **What that means for text mid-answer.** The exact pieces of a half-streamed reply are not replayed. On reconnect the text snaps to the latest saved copy of the item and continues from the next live delta; the eventual `item.done` carries the final text. A finished message always replays exactly. `it:199-203`; `eng/streaming/response-emitter.ts:776-797`; test `stream-resume.test.ts:386-391`. [ref; the page does not state the snap: figure 2 and the resume paragraph describe only resuming at the next number. The guarantee, in one sentence if stated. Why it is built that way (a disk write per token) is told as the consequence "streaming does not slow down"; the mechanism is cut.]
- The wire carries a `: ping` comment frame at a set interval so idle proxies do not close the connection; default 15 s, set with `defaultSseHeartbeatMs` on `createFlowState` or `request.sseHeartbeatMs` on a flow. `eng/routes/http-handlers.ts:211`, `:285`; `eng/streaming/heartbeat.ts:1-17`; `cr:27`, `:41-64`. [ref: the page links; the page says only that heartbeats exist]
- **The browser client does the following on its own.** If the server ends a stream before the request finished with no terminal event (a reader that fell behind is cut off, or a host ends a long response), the client reconnects after the last event it delivered. At once if the connection delivered something or carried a heartbeat; otherwise after a backoff. After five connections in a row that deliver nothing it gives up with `onError` (`cl/stream-client/streams.ts:167`). `cl/stream-client/streams.ts:182-198` (doc comment), `:214-297`. [page: "when the stream ends before the request does, the client reconnects and resumes on its own; a reload is different and needs `autoResume`"; the give-up count [ref]]
- A failed connection (a network error, or an error response such as a `404`) is reported with `onError` and is not retried by the stream itself. `cl/stream-client/streams.ts:186-192`, `:284-297`, `:539-577`. [ref]
- The React hook, on that error, stops streaming, remembers which request was running, and reads the request's record. `rx/hooks/useSession.ts:1646-1664`. [page]
- A view that is stuck: if the stream is silent past `stuckThresholdMs` (default 30,000 ms, at least twice the server's heartbeat) while a request is in flight, `session.isStuck` turns true so the page can show a banner. `rx/hooks/useSession.ts:298-305`, `:340-348`, `:620`; `cr:29`, `:110-118`. [page: the flag; the tuning rule [ref]]
- Ways to carry on from there, each a method of `useSession`: `followRequest(requestId)` re-attaches and picks up after the last event the view had, so state changes already applied are not applied twice; `dismissRequest()` sends the stop to the server, closes the local stream and clears the stuck state; `resumeLatestRequest()` re-runs the latest request if it is `interrupted` or `failed` (a new request id); `continueRequest(requestId)` continues a crash-interrupted request under its own id. `rx/hooks/useSession.ts:448-464`, `:493-525`, `:2417-2427`; `docs/client/react.md:112-124`; `cr:88-108`. [page: `followRequest`; the others one clause each, link to Reference]
- **Reloading the page mid-answer (Q2).**
  - The session view reads the saved session on mount, and the saved record holds the partial reply as of its last write. `rx/hooks/useSession.ts:1741-1790`, `:527-535`; `eng/execution/runAction.ts:431-445`, `:1744-1755`.
  - The hook then re-attaches to the request still running only when `autoResume: true`. Default `false`: without it the page loads one snapshot and does not follow the running request. `rx/hooks/useSession.ts:266-271`, `:618`, `:1790-1850`; `docs/client/react.md:240-248` ("`autoResume` matters here: without it you load one snapshot and it never ...").
  - With `autoResume`, the hook finds the session's in-progress request and attaches to its stream; items come through the same merge as a live send, so nothing shows twice. `rx/hooks/useSession.ts:1790-1850`, `:991-1010`.
  - [page, Q2 answer: "you see the conversation so far, with the reply as far as it was last saved; with `autoResume` it carries on streaming from there."]
- What a reload loses: items that were `transient`. A live-only status is not on the saved record, so it is absent after a reload. `eng/execution/runAction.ts:431-445`; `ov:92-96`. [page]
- A `component` with `transient: true` is gone after a reload; a keyed one without it comes back as its latest copy. `eng/context/createExecutionContext.ts:385-411`; test `execution.test.ts:2629-2740`, `:2907-2962`. [page]
- Hearing requests this view did not send (another tab, a worker): `useSession(id, { live: true })`. `rx/hooks/useSession.ts:272-297`; `docs/client/react.md:126-158`. [ref / C-10; one clause]

## 9. What `fsdev run` prints (example 3, three lines) [ran]

Captured with this repo, `examples/hello-chat`, `pnpm fsdev run hello-chat chat -i '{"message":"Say hi in four words."}' --quiet`, which streams NDJSON on stdout. Ids shortened here; the real lines are longer.

```text
{"type":"item_added","item":{"id":"item_msg_17…98","type":"message","role":"assistant","status":"in_progress","content":[{"type":"output_text","text":""}], …}}
{"type":"content_delta","itemId":"item_msg_17…98","delta":"Hi"}
{"type":"content_delta","itemId":"item_msg_17…98","delta":" there"}
{"type":"content_delta","itemId":"item_msg_17…98","delta":","}
{"type":"content_delta","itemId":"item_msg_17…98","delta":" my"}
{"type":"content_delta","itemId":"item_msg_17…98","delta":" friend"}
{"type":"content_delta","itemId":"item_msg_17…98","delta":"!"}
{"type":"item_done","item":{"id":"item_msg_17…98","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"Hi there, my friend!"}], …}}
```

- Also in the same run, before the reply: the user echo (`item_added` + `item_done`, `role: "user"`, `text` equal to the input), `block_trace` rows for `chat-pipeline` and `chat-generator`, and a `reasoning` item streaming its own `content_delta` lines; after the reply, a `state_change` item (the counter handler) and the trace rows' `item_updated` and `item_done`. [ran]
- The assistant message's `role` is `"assistant"`. `core/blocks/generator.ts:2326`. The captured `item_added` shows `status:"in_progress"` and empty text; the `item_done` shows the full text.
- A handler-only run: the handler's own `ctx.emit.status("Looking up order 1042")`, `ctx.emit.component("order-lookup", { orderId: "1042", state: "found" }, { key: "order-1042" })` and `ctx.emit.message("Your order shipped yesterday.")` produce: a status item with `"transient": true`; a component item with `id: "item_component_keyed:order-1042"`, `"key": "order-1042"`, and `"data"`; and one assistant `message` that arrives as `item_added` then `item_done` with its full text and no `content_delta` lines. The run's `flow_complete` reports `"items": 5` (user echo, `block_trace`, status, component, message). [ran]
- `flow_complete` lists `output`, `durationMs`, `items` (a count of items from the run, trace items included). `packages/fsdev/src/commands/run.ts:62`, `:570-577`. [page: do not print; only the three lines above]
- `fsdev run` needs a `--session` to continue a conversation across runs. `docs/cli/overview.md:42`; `docs/cli/agent-dev-loop.md:13`. [ref]
- A model key must be set in the environment for a generator to run. `docs/cli/overview.md:26` (a generator "still calls its model provider over the network and still needs that provider's key"). [page: one clause under the example]
- `jq` to read only the reply text: `jq -r 'select(.type=="content_delta") | .delta'`. `docs/cli/agent-dev-loop.md:47`. [page, optional]

## 10. What it gets you

Each point is something the reader can observe in the support-desk example.

- **The reply shows as it is written.** `session.items` holds the growing `message`; the page renders it each frame. `rx/hooks/useSession.ts:379`, `:967-989`; `hc/page:37-50`, `:89`. [page]
- **A reload loses nothing that was saved.** Non-transient items are on the request record, the session list is rebuilt from the records, and a finished request replays exactly from a sequence number. Sections 5 and 8. [page]
- **One kind of thing for everything the run does.** A message, a tool call and a progress card are all items in one ordered list; the page draws each by type. `ct/types.ts:806-819`; `ct/order.ts:1-23`. [page]
- **Progress cards stay out of the prompt.** Each item type has a default visibility (`component` is `history: false`), so a card shown to the user is not sent to the next request's model. The page does not claim the default cannot be overridden. Section 6. [page]
- **The same list on the server and the client.** The server's snapshot and the client's merge use one order and one filter, so a live view and a reload agree. `ct/order.ts:1-9`; `eng/routes/route-utils.ts:529-545`. [page]
- A browser app gets all of this from `useSession`; "No manual stream management." `it:476-480` [do not repeat the phrase; the hook reads, orders and re-attaches, which is the observable claim: `rx/hooks/useSession.ts:1741-1885`]

## 11. How it fits with the others

- Blocks (C-02) are what emit items; an item records which block made it (`provenance.blockName`). `ct/types.ts:16-27`. [page: one clause]
- Rendering items (C-10): the page links; it does not explain renderers. `docs/client/react.md:9-60`, `:318-363`. [ref]
- State and resources are separate from items. A `state_change` or `resource_change` item tells a client that something changed; it is not the state. `ct/types.ts:559-573`; `docs/fundamentals/state-and-scopes.md:465`. [page: one clause, without the type names ("a short notice item"), because neither type has a row on the page; owned by the state concept page]
- Background work and task boards have their own sessions; a session's `childSessions` list is separate from `items` and is not folded into the transcript. `rx/hooks/useSession.ts:388-396`. [ref]
- Where the word differs from other frameworks: "message" is one item type, not the whole transcript. A transcript here is the session's item list, which holds messages, tool calls, UI cards and statuses. `ov:7`. [page: optional; no "If you know" section is needed, because no mainstream framework word collides]

## 12. Links (Next)

- Reference page: `../reference/items.md` takes every item type and its fields, visibility, the wire format, resume and heartbeat, the trace channel, values too large to record, the `suspension`, `suspension_resume` and `continuation` items. `it:*`, `ov:135-155`, `docs/streaming/trace-channel.md:*`. [ref]
- Rendering items: `./rendering-items.md` (C-10).
- Blocks: `./blocks.md`.

## 13. Left for Reference (rows the page links to)

Each is observable behaviour, so it moves to `reference/items`, not away.

- Item lifecycle (section 2): message added with empty text and `in_progress`, `content.delta` appends, `item.done` resends the whole item `completed`; a `tool_output` carries name and arguments at start and gains its result when done. The page keeps one sentence: the reply grows, then is sent whole.
- Item fields and the per-type table (sections 3, 4); item identity: an id is unique within a request, so a list key is `requestId` plus `id` (the page states the key and links).
- Session ownership detail: another user's request gets a not-found (`404`), a wrong organization `403` (section 5). The page keeps "a session belongs to the user who created it".
- What persists: items live on the request record and the session list is assembled on read (section 5). The page keeps only the default (memory, lost on restart) and one alternative (SQLite or Postgres).
- Item visibility rules, `history` option eligibility, `itemVisibility` flags (section 6). The page keeps that `history` must be on and the table's default column.
- `ctx.emit.component` details: `key` replacement, data replaced whole, reload shows the latest; `ctx.emit.message`, `ctx.emit.status` (live only by default, `{ transient: false }` stores it), `transient: true` components (sections 4, 7). The page keeps that a key makes the second call replace the first.
- Resume detail: sequence numbers and `starting_after`, no replay of text deltas, reload behaviour without `autoResume`, transient items absent after reload, `isStuck` and `followRequest` (section 8). The page keeps that a reconnect picks up after the last event, and that a reload mid-reply returns the thread, which `autoResume: true` carries on.

- Item type table, with who emits it, client / history / transient columns. `ov:135-155`; `ct/types.ts:806-819`.
- The visibility resolution table and `itemVisibility` on generators, multi-peer agents, parallel sub-agents, `selectForContext`. `it:328-388`; `ct/resolve-visibility.ts:38-49`.
- Wire events, SSE frame shape, `item.updated` patch rules, `ITEM_UPDATE_INVARIANT_KEYS`. `ct/events.ts:36-69`; `it:9-52`.
- `block_trace`, `tool_output` fields, `outputOmitted` and `RECORDED_VALUE_OMITTED`, `maxRecordedValueBytes` (256 KiB). `it:57-175`; `ct/types.ts:223-335`, `:339-440`.
- Resume cursor rules, `starting_after` vs `Last-Event-ID`, replay exclusions, suspension and continuation resume. `eng/streaming/resume.ts:51-163`; `it:180-207`.
- Heartbeat, watchdog, sweeper, status endpoint, `stuckThresholdMs`, `queuedGraceMs`. `cr:*`.
- The transient x key table, container components, `ctx.response.emit` with `item.updated`. `em:176-193`, `:190-244`.
- `history()` options (`limit`, `includeInFlight`, `afterRequestId`, `earlierDocuments`) and `historyWindow`. `core/types/scope.ts:41-122`; `fl:348-358`.

## 14. Contradictions found in the existing pages (the code wins)

1. **`useSession` snippet.** `docs/client/react.md:79-110` and `docs/streaming/items.md:464-478` show `session.messages` and `session.blockOutputs`. `SessionView` has neither: `rx/hooks/useSession.ts:323-640` lists `items`, `isStreaming`, `isLoading`, `isStuck`, `statusMessage`, `latestRequest`, `followedRequest`, `getItemsByAgent`, `getItemsByVisibility`, `getOwnedItems`, and no `messages` or `blockOutputs`. The page uses `session.items`. The same snippet passes `items: { visibility: "ui" }`; `SessionItemsOptions` is `boolean | { includeTransient?, itemTypes? }`, so `visibility` is not an option. `rx/hooks/useSession.ts:228-234`.
2. **`history()` is async.** `docs/streaming/overview.md:108-110` shows `const history = ctx.session.items.history({ limit: { tokens: 20_000 } })` with no `await`. The type is `Promise<LLMMessage[]>`. `core/types/scope.ts:165`. `all()`, `client()` and `selectForContext()` are synchronous. `core/types/scope.ts:155-173`.
3. **"Status: Transient Always."** `docs/streaming/overview.md:147-149` marks `status` transient "Always". The default is transient, and `{ transient: false }` stores one. `core/types/block.ts:519-521`; `eng/context/createExecutionContext.ts:534`; test `packages/engine/test/execution.test.ts:2827-2860`. The same table marks `state_change` transient "Production" and `resource_change` "Always"; the sheet found no source for either. Not stated on the page. [verify before the Reference page states it]
4. **"Replay with `Last-Event-ID`."** `docs/streaming/items.md:180-197` is correct for an SSE client; the browser client here sends `starting_after` through `startingAfter` (and `Last-Event-ID` only when no `startingAfter`). `cl/stream-client/streams.ts:210-217`. Either works.
5. **Existing text says a reload "snaps to the most recent persisted snapshot".** True for the replay path (`stream-resume.test.ts:386-391`). For a page that did not set `autoResume`, a reload shows the saved record and does not follow the request at all; the old pages do not say so. Section 8 states both.
6. **`docs/streaming/overview.md:9` "so you can access them conveniently as one collection".** The session holds no item list of its own; the list is built from request records on read. `eng/routes/state-routes.ts:104-121`.

## 15. Checked and not stated

- The brief's Q2 ("you reload the page mid-answer, what do you see?") has two answers (with and without `autoResume`). Section 8 has both; the page states the saved-reply behaviour first and `autoResume` second.
- No retention or deletion rule for sessions or requests was found in citable sources. The page says nothing on how long a session lasts, beyond "in memory by default, gone on restart; a persistent store keeps it".
- The suspension items, voice audio, reasoning options and `tool_call_progress` (a live-only item the generator emits for in-flight tool calls, `core/blocks/generator.ts:3511-3525`) are not drawn into this page's figures.

## 16. Figure facts

**Figure 1, one request as a timeline.** Items in order along a line: the user's message, a tool call, text arriving in pieces, done.

- The line is time; the marks on it are items in the order the support desk emits them: user message (complete at once), `tool_output` for `lookUpOrder` (in progress, then done), `reply` message (`in_progress`, deltas, `completed`), the terminal event. Sources: section 2.
- The request is a dashed outline (lasts one action run). Dashed = lasts one action run, from `docs/contributing/user-docs.md:350-355`; a request's scope is one action run, `eng/stores/types.ts:138-146`.
- The session's list below it is hatched (outlives the request): the same items appear in the session's list, one timeline for all requests. `ov:9`; `eng/routes/state-routes.ts:104-121`.
- The highlighter is on the growing text item. [page: the one idea]
- A transient `status` item appears on the line but not in the session's list below. `eng/context/createExecutionContext.ts:534`; `eng/execution/runAction.ts:431-445`. [figure: optional]

**Figure 2, dropped and resumed.** The same timeline with a gap.

- The connection is lost after sequence number N; the request keeps running on the server. `cr:7-9`.
- The stream picks up at N+1: `Last-Event-ID: <requestId>:N` or `starting_after=N`. `it:180-197`; `eng/streaming/resume.ts:94-115`.
- The deltas inside the gap are not replayed; the text snaps to the latest saved copy and continues. `stream-resume.test.ts:379-448`; `it:199-203`.
- Red mark on the dropped connection: `CONNECTION LOST`. [figure rule, `docs/contributing/user-docs-figures.md`; not read for facts]

## 17. Not checked

- Whether `ctx.emit.component` from a handler that a model calls as a tool reaches the browser as a component item (section 4, last bullet). [verify]
- Replay of a request that was `suspended` or resumed: not on the page, kept for Reference (`it:205-207`).
- `autoResume` against a request that finishes between the snapshot and the attach: the hook's catch-up path covers it (`rx/hooks/useSession.ts:1815-1850`); not on the page.
