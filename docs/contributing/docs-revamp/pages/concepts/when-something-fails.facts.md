# Facts for When something fails (C-19, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`, `eng` = `packages/engine/src`, `ct` = `packages/contracts/src`
- `eh` = `apps/docs/docs/advanced/error-handling.md`
- `ec` = `apps/docs/docs/advanced/error-capture.md`
- `cb` = `apps/docs/docs/sequencers/composing-blocks.md`
- `items` = `apps/docs/docs/streaming/items.md`
- `flows` = `apps/docs/docs/fundamentals/flows.md`
- `sentry` = `apps/docs/guides/routing-errors-to-sentry.md`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/errors` or `reference/durable-execution`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page.

The page's scenario (from the plan): a support desk. `lookUpOrder` throws, `draftReply` is the model step, `handleTicket` is the sequencer. File titles follow `docs/contributing/user-docs.md` (Code examples): `src/flows/support/blocks/handle-ticket.ts` exports `handleTicket`, `blocks/draft-reply.ts` exports `draftReply`, `tools/look-up-order.ts` exports `lookUpOrder`, plus a new `blocks/apologize.ts` exporting `apologize` for the fallback example.

## 1. A block throws (opening, model figure)

- There is no special error channel. A block fails by throwing: `throw new Error(...)` or `throw new FlowError(...)` inside `execute`. `core/blocks/handler.ts:107-121` (execute is any function); `eh:7-30` (author throws `FlowError` from a handler). [page]
- An error thrown in a step of a sequencer stops the sequencer. "By default a thrown error halts the sequencer." Errors bubble out and the sequencer fails unless a rescue catches it. `cb:211`, `cb:248`; `eh:7`. [page]
- A thrown error travels up through the parent sequencer to the action. If nothing catches it, the request ends `failed`. `eh:7`; `eng/execution/runAction.ts:3105-3124` (failure path). [page]
- Whatever is thrown becomes a `FlowError`: a plain `Error` is wrapped (the original is kept as `cause`), a `FlowError` keeps its own `code` and `retryable`. `eng/errors/normalize-error.ts:46-92`. [page, one sentence]
- `FlowError` is exported from `@flow-state-dev/core`. It is an `Error` with optional `code`, `retryable` (default `false`), `details`, `cause`. `core/errors/flow-error.ts:38-55`; `eh:9`. [page]
- A thrown value that is not a `FlowError` gets code `"execution_error"` and `retryable: false`, unless the error is classified as network, timeout, rate limit or model, which are `retryable: true`. `eng/errors/normalize-error.ts:18-43` (`inferCode`, `inferRetryable`); `eng/test/errors.test.ts:22-30` (codes `network_error`, `timeout_error`, `rate_limit_error`, `model_error`, `tool_execution_error`). [ref] reference/errors; the page says only that a plain throw gets a generic code.
- An error that a block throws while a generator is calling it as a tool is different: the tool loop turns an ordinary tool error into a failed tool result the model is told about (`Tool "<name>" failed: <message>`), and the run goes on. The request does not fail because a tool threw. `core/blocks/generator.ts:1491-1496` (doc comment: "Ordinary tool errors become model-visible failed results"); `eng/test/generator-suspension-resume.test.ts:332-391` (a tool that throws after an approval: the model sees `error-text` `Tool "risky_op" failed: ...`, the request status is `completed`, a failed `tool_output` is recorded). [page: this is the answer to cold-read Q1 for a tool-called `lookUpOrder`; the same block called as a sequencer step fails the request]
  - The failed call is also a `tool_output` item with `status: "failed"`, whose `error` is `{ message, code?, details? }`. `items:112`; `core/test/generator.test.ts:793-835` (failed `tool_output` item emitted). [page, one clause]
  - A tool that throws on the stream is visible; so the user may see the tool call marked failed, with its message. [verify the client rendering; keep off]
- A tool's `onToolErrored` observer on the flow's `tools` config fires when a tool throws. `core/types/flow.ts:96-98`; `core/blocks/internal/tool-executor.ts:184-196`. [ref]
- Block-level `onErrored(error, ctx)` exists on a block's config. `core/types/block.ts:1079`. [ref] Not shown on the page: the page's hook is the flow-level one (section 4). I did not find a test that proves when it fires; do not state its timing.
- A generator whose output fails its `outputSchema` throws `OutputValidationError` (a `FlowError` subclass) with `details.rawOutput`, `details.issues`, `details.phase`. `eh:35-45`; `core/errors/output-validation-error.ts:16`. [ref]
- An input or output a block's schema rejects throws and fails the block: `Block "<name>" input validation failed at "<path>": <message>`. `core/blocks/internal/build-block.ts:152-170`. [ref] reference/errors (page links; the guarantee is on Blocks).
- Cancelling a request is not a failure. An intentional abort ends the request `aborted`, with an "aborted" message item and no `error` item; a dropped connection ends it `interrupted`. `eng/execution/runAction.ts:3091-3124` (`wasIntentionalAbort` branch emits `emitAbortedMessage`, not `emitTerminalError`). [ref] reference/durable-execution

## 2. What the caller sees

- The stream carries a terminal item of `type: "error"` with `status: "failed"`, `message`, optional `code`, optional `details`. `ct/items/types.ts:575-587` (`ErrorItem`); `eng/execution/runAction.ts:886-930`. [page]
- The item is emitted before the request's status event, so a caller hears the failure immediately; then `request.failed` closes the stream. `eng/execution/runAction.ts:3118-3124` (error item "before the drain"), `:3296` (`emitRequestStatus("failed")`); `items:51` (`request.failed`: "Request failed with a terminal error"); `client/src/stream-client/streams.ts:170-178` (`request.failed` ends the stream). [page]
- `message` is the thrown error's `message`, verbatim, and `code` is the normalized code (`"execution_error"` for a plain throw, the author's own for a `FlowError`). `eng/execution/runAction.ts:921-923` (item built from `error.message`, `error.code`); `eng/test/execution.test.ts:2293-2307` (failed run has an `error` item). [page]
- **No stack trace.** `details.cause` carries the cause chain as `{ name, message, code?, cause? }` only. The serializer drops `stack` on purpose: "it is large and leaks server paths over the wire". `core/errors/serialize-error.ts:10-21` (comment and `SerializedError` type), `:57-72` (`errorDetailsWithCause`); `eh:57`. [page: the answer to Q1]
- `details` are what the author threw (`new FlowError(msg, { code, details })`), passed through verbatim, plus `details.cause` when the error has a cause. `eng/execution/runAction.ts:906-912` (`errorDetailsWithCause`); `eh:33` ("The thrown details survive normalization"). [page]
- Because `message` and `details` reach the caller verbatim, what a block throws is what a user can read. The page can say: write the message as something a caller may see. This is a consequence of the two facts above, not a separate claim. [page, one sentence]
- A request that fails before its first block (a setup failure) also leaves an `error` item and a `failed` record. `eng/test/served-setup-failure.test.ts:247-285`. [ref]
- The client's request result carries `error: { code, message }` for a failed request. `client/src/types/index.ts:279-293` (`SessionRequestResult.error`). [ref] reference/errors
- `useSession` reports a terminal status for the request (`failed`) when the stream ends, and has its own `error: Error | null` for a failed read of the session snapshot, which is a different failure. `react/src/hooks/useSession.ts:1585-1600` (status handling), `:358` (`error`), `:1232-1239` (snapshot read failure sets it). [ref] Not stated on the page; a reader looking for "the error" in React reads the `error` item from `items`. [verify: no test shows `useSession().error` filled from an `error` item; do not claim it]
- The `error` item renders in the default item renderer as a primary output type (listed with message, reasoning, status, error). `react/src/components/ItemsRenderer.ts:150`. [verify: only a comment; do not describe the look]
- In DevTool, the failed block's detail panel shows the message, the `code`, a "Raw output" section when present, validation issues, and a "Details" JSON panel. `eh:55-59` (what you will see in DevTool). [page, one sentence; link to DevTool]

## 3. Catching it in the flow

`.rescue()` is the one way to handle a failure inside the flow.

- `rescue(handlers)` takes a list of `{ when?: ErrorClass[], block }`. `core/types/block.ts:1441-1444` (`RescueHandlerSpec`); `core/blocks/sequencer-methods.ts:354`. [page]
- Handlers are checked in order, the first match runs. A handler with no `when` catches anything. If none matches, the original error propagates up. `cb:246`. [page]
- The rescue block receives the error as its input, and its output replaces the failed value. `core/test/sequencer.test.ts:418-441` (the rescue block's `execute: (error: Error) => ...` returns `"recovered:broken"` and the sequencer resolves to it). [page, shown in the example]
- Two scopes, one operation. On a sequencer, `.rescue()` recovers the whole chain: the rescue block's output is the sequencer's output and the chain stops there. `cb:240-248`; `core/test/sequencer.test.ts:418-441`. On a single block, `block.rescue([...])` returns a copy that recovers in place: the chain continues to the next step with the fallback's output. `cb:252-273`; `core/types/block.ts:1085-1092`, `:1351`; `core/test/sequencer.test.ts:1936-1984` (chain continues after a rescued step). [page]
- `when` matches by class (`instanceof`), so a typed error class selects a handler. `core/types/block.ts:1442`; `core/test/sequencer.test.ts:1329-1341` (a `GuardError` thrown by `throwIf` is caught by `when: [GuardError]`). [page]
- On a `.step`, the fallback must return a value that fits the failed block's output; the compiler does not check it. `cb:277`. [ref] reference/errors or Composition; keep off the page unless the example needs it.
- A per-step rescue on a `.tap()` keeps the running value unchanged. `cb:275`; `core/test/sequencer.test.ts:1986-2008`. [ref]
- A later step can ask whether an earlier step was rescued with `ctx.wasRescued(block)`. `eh:98-125`; `cb:279-296`. [ref] (Composition page); one clause at most.
- A sequencer that declares an `outputSchema` throws `SequencerOutputSchemaError` when its returned value does not match, including the value a rescue returns, and the parent can rescue that too. `eh:67-82`; `core/test/sequencer.test.ts:1678-1770`. [ref]
- A rescued request completes. No `error` item is written and no `request.failed` is sent for a failure a rescue handled. [verify-by-inference] Tests prove the request result has no `error` and no final capture event: `eng/test/error-capture-final.test.ts:94-117`. No test asserts the absence of an `error` item for a rescued request; the `error` item is only emitted on the failure path (`eng/execution/runAction.ts:3124`), which a rescued request does not take. The page may state "a rescued failure is not an error to the caller" as the guarantee; both halves are code-backed. [page]
- A step that throws inside `.sideChain()` does not fail the main chain. The failure is logged and the failed `block_trace` reaches the DevTool; nothing appears in the user-visible stream. `cb:205`. [ref] Background work page; name in one sentence at most.
- Retrying is separate from rescue. A block can run under a retry policy (`retry` on the block config), and a failed attempt that a retry fixes never fails the request. `core/types/block.ts:1081` (`retry?: RetryPolicy`); `eng/test/error-capture-final.test.ts:119-139`. [ref] reference/durable-execution (the plan sends retries there; the page links, does not explain)

## 4. Hearing about it

Two hooks, for two jobs.

**Lifecycle hook, inside the flow: `onErrored`.**

- Declared on an action, `actions.<name>.onErrored`, and on the flow's `request` config, `request.onErrored`. Each is a **block** (a `BlockDefinition`), not a function. `core/types/flow.ts:211` (`ActionCore.onErrored?: BlockDefinition`), `:419` (`RequestConfig.onErrored?: BlockDefinition`); `eng/test/execution.test.ts:2211-2231, 2283, 2288` (the test builds `observer` with `handler(...)` and passes it as `onErrored`). [page]
- **Contradiction.** `flows:386-396` shows `onErrored: async (error, ctx) => {...}` as a function. The types and the runtime take a block. The code wins; the page shows a handler block. Correct `flows` at the same time (a neighbour). [flag in report]
- The block's input is `{ requestId, actionName, error }`, where `error` is the normalized `FlowError`. For `request.onFinished` the input is `{ requestId, actionName, status: "failed", error }`. `eng/execution/runAction.ts:3298-3316`; `eng/test/execution.test.ts:2308-2313`. [page]
- Order on a failed request: action `onErrored`, then request `onErrored`, then request `onFinished` (status `failed`). `eng/test/execution.test.ts:2308-2313` (`action.errored`, `request.errored`, `request.finished:failed`); `eng/execution/runAction.ts:3298-3316`. [page, ref for the full order]
- The hooks run after the `error` item is sent, the record is written as `failed`, and the `failed` status event is emitted. `eng/execution/runAction.ts:3124-3296`. So a hook cannot change what the caller sees. `flows:401` ("Hooks are observational: they run after the fact and can't modify the result"). [page]
- A hook that throws does not change the outcome and does not hide the original failure: observer errors are swallowed. `eng/execution/runAction.ts:860-875` ("Preserve primary request failure and avoid masking it with observer failures"). [page]
- Hooks do not run for a rescued failure: the request did not fail. `onCompleted` runs instead. [verify-by-inference] from `runAction.ts:3298-3316` being in the failure path only. Keep off the page unless the example needs it.
- `request.onStepErrored` is declared (`core/types/flow.ts:421`) and documented as "non-terminal step failure" (`flows:396`). I found no engine code that calls it and no test. **Do not document it.** [flag in report]
- `.sideChain()` work started by `onErrored` or `onFinished` finishes before the request is over. `eng/execution/runAction.ts:3326-3329`. [ref]

**Error capture, outside the flow: `errorCapture`.**

- `createFlowState({ ..., errorCapture: (event) => {...} })` from `@flow-state-dev/engine`. Off by default. `eng/flowstate/types.ts:196-206`; `eng/runtime-config.ts:76`; `ec:11-30`. [page]
- The callback gets an `ErrorCaptureEvent`: `error` (a `FlowError`), `requestId`, `flowKind`, `actionName`, `userId`, `sessionId?`, `orgId?`, `blockName?`, `blockKind?`, `blockInstanceId?`, `blockPath?`, `attempt?`, `scope?`, `transient?`, `final?`. `eng/errors/error-capture.ts:21-49`; `ec:46-62`. [ref] reference/errors has the table; the page names `error`, `requestId`, `blockName` and `final` only.
- It fires once per failed block, on the leaf block that threw, and once more for the request, marked `final: true`, when the request settles failed. `eng/errors/error-capture.ts:67-76` ("Fires once per failing block (deduped to the leaf), and once more, marked `final`"); `eng/test/error-capture-wiring.test.ts:81-110, 166-205` (events.length 2: the leaf's, then `final`). [page]
- A failure that a rescue or a retry fixed still fires the per-block event but never a `final` one. `eng/test/error-capture-wiring.test.ts:139-164` (rescued: one event, `blockName: "risky"`); `eng/test/error-capture-final.test.ts:94-139`. [page: this is the one rule a reader needs to pick the right event; the choice of which to forward is two lines of code]
- So for an error tracker that wants one report per request that really failed, keep only `event.final`; for every failing block, skip `event.final`. If you forward both you report the same failure twice. `ec:64-92`; `sentry:100-125`. [page]
- The callback is read-only. Its return value is ignored. If it throws or rejects the error is logged and swallowed; it never changes the request. `eng/errors/error-capture.ts:67-76`; `eng/test/error-capture-wiring.test.ts:237-` (throwing handler does not break execution). [page, one sentence]
- It does not fire for failures before block execution (input validation, authentication). Those go to `onError` and the HTTP response. `ec:123-125` ("What it does not cover"). [ref]
- `onError` (HTTP-level, `{ method, path }`) is a different option from `errorCapture`. `ec:42`. [ref]
- The mapping onto a provider (Sentry tags, level from `error.retryable`) is a guide, not the page: B-20 owns it. `sentry:1-125`. [link only]
- Package: the callback type is `ErrorCaptureEvent`, exported from `@flow-state-dev/engine`. `ec:25-26`. [page]
- A fully worked adapter is in `ec:99-115`; the page's example is the 6-line version: `errorCapture: (event) => { if (!event.final) return; report(event.error, { requestId: event.requestId }); }`. [page; `report` must be declared or imported in the example: use `Sentry.captureException` imported from `@sentry/node`, or name the function and import it from `./lib/report`]

## 5. What it gets you (state each as something observable in the page's example)

- **A caller gets an item, not a crash.** The stream ends with an `error` item and `request.failed`; the `useSession`-style client sees a settled `failed` request. `eng/execution/runAction.ts:3118-3296`. [page]
- **Nothing leaks beyond what the block threw.** No stack, no server path. `core/errors/serialize-error.ts:10-13`. [page]
- **A fallback is local.** `lookUpOrder`'s failure can be replaced by a fallback reply for one step while the rest of `handleTicket` runs. `core/test/sequencer.test.ts:1936-1984`. [page]
- **One request, one report.** `final` gives a tracker one event per request that really failed. `eng/test/error-capture-final.test.ts:40-92`. [page]
- **The failed run is kept.** See section 6. [page]

## 6. Is the failed run's history kept? Stored parts (the four questions)

Stored parts a failure creates: (a) the `error` item, (b) the failed request record, (c) the items emitted before the throw, (d) the `block_trace` rows.

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| `error` item | The request that failed; it belongs to that request's session | The caller who owns the session (read through the session's items and the request's stream); the DevTool | The request record's `items`, in the request store (`stores.request`). `eng/execution/runAction.ts:3280-3286` (`items: itemsToPersist()` on the failed write); `ct/items/types.ts:575` | One per failed request on the normal path |
| Failed request record | The request: `status: "failed"`, `failedAtMs`, `error` (`code`, `message`) | Same caller; `SessionRequestResult.error` is `{ code, message }` | Request store. `eng/execution/runAction.ts:647-660` (`settleRequestRecord`), `:3280-3286`; `client/src/types/index.ts:279-293` | One per request |
| Items emitted before the throw (messages, tool outputs) | The request | Same | The same record's `items`. `eng/test/served-setup-failure.test.ts:247-285` (a failed record on a filesystem store keeps the earlier `user` message and the `error` item) | As many as the run emitted |
| `block_trace` row of the block that threw | The request | DevTool, and the trace channel (hidden from the default client) | Trace items on the request. `items:59-112` (`block_trace.error` is `{ message, code?, details? }`) | One per block run; the failed block's row has `status: "failed"` |

- Failed history is stored, so a failed run is not lost; it stays in the request store the same as a finished one. Whether it outlives a server restart depends on the store: the in-memory store does not persist (`apps/docs/docs/advanced/durable-execution.md:11, 32-36`); SQLite and Postgres do. [page, one sentence; the store choice is the Persistence page]
- A tool call that failed is replayed to the model on later turns as `Tool "<name>" failed: <message>`, so it is part of the history the model sees. `core/models/llm-messages.ts:95-100`; `eng/context/history.ts:132`. [ref] Not on the page unless a section needs it; the claim "the model sees it next turn" is only for the failed *tool* case.
- A request left `failed` can be retried or continued through recovery routes. `eng/routes/recovery-routes.ts:92`. [ref] reference/durable-execution; do not explain.
- **[verify]** Whether the next *turn's* conversation history includes the failed request's earlier messages and `error` item. I found no test that proves it, so the page must not claim that the failed turn is in the next turn's model context. It may say the items are kept on the request's record.

## 7. How it fits with the others (state once each, where it first matters)

- Blocks: a block's schema checks and its throw are how a block fails. Page: Blocks (C-02). The guarantee is on that page. [link]
- Composition: `.rescue()` is a sequencer method. The full DSL is the Composition page (C-?); this page shows rescue as error handling only. `cb:209-277`. [link]
- Generators and tools: a tool that throws does not fail the request; the model is told. Page: Generators and tools (see section 1). [link]
- Pausing, resuming and surviving a crash: retries, continuing a `failed` or `interrupted` run, and a crash halfway are not "a block threw". `reference/durable-execution`. [link]
- Not the same as `onError`: that is an HTTP-level option on the router. `ec:42`. [ref]

## 8. Sources reconciled (merge `advanced/error-handling` and `advanced/error-capture`)

- Keep: `FlowError` (what it is and the four fields), the error item the caller receives, rescue in both scopes, `onErrored`, `errorCapture` with `final`, the Sentry pointer.
- Move to `reference/errors`: the `ErrorCaptureEvent` table (`ec:46-62`), `OutputValidationError` and its `details` keys (`eh:35-60`), `SequencerOutputSchemaError` and `.validate()` (`eh:67-82`), the well-known `details` keys table (`eh:47-57`), `wasRescued` (`eh:98-125`), the error-code taxonomy and `retryable` defaults (`eng/errors/normalize-error.ts:18-43`), "what it does not cover" (`ec:123-125`).
- Cut: "What you'll see in DevTool" beyond one sentence (`eh:127-130`); the Sentry adapter body (B-20 owns it, `sentry`); the filtering-noise passage (`ec:94-108`), which is Sentry-adapter advice.

## Contradictions and gaps found while reading (for the report)

1. `flows:386-396` and `flows:231-235` document `onErrored`, `onCompleted` and the request hooks as functions `(error, ctx) => {...}`; `core/types/flow.ts:211, 419-421` types them as `BlockDefinition`, and `eng/test/execution.test.ts:2211-2288` passes handler blocks. The code wins. The same wrong shape sits in the `build/` copies; leave those, they are build output.
2. `request.onStepErrored` is typed and documented but nothing in `eng/` calls it. Not documented on this page.
3. `eh:7` says errors "surface in the DevTool's failed-block detail panel", true, but says nothing about the client. The page's caller-facing facts come from the `ErrorItem` type and `emitTerminalError`, not from an existing page.
4. `ec:11` opens "In production you need to know when flows fail". The `errorCapture` doc comment on `eng/flowstate/types.ts:199-201` lists "tool errors" among the failures captured. Tool errors a model recovers from still fire the per-block event. [verify: no test proves a tool failure inside a generator fires `errorCapture`; the page does not claim it.]
5. The plan's figure ("the two exits") has two exits in code: the `error` item + `request.failed` to the caller, and the `onErrored` hook / `errorCapture` callback beside it. The hook and the capture callback are both reached after the item and status event, in the failure path only (`eng/execution/runAction.ts:3118-3316`); `errorCapture`'s per-block event fires earlier, at the leaf, while the request is still running. Order between the leaf's event and the `error` item is not tested; the figure must not put a number on it.

## Revisions (revise round 1)

- `details.cause` is a serialized cause chain, not name and message only: each level has `name` and `message`, plus `code` when the cause has a string `code`, and a nested `cause` per deeper level, to depth 4. The stack is omitted. For a plain throw the synthetic wrapper layer is skipped, so it shows the original error's own cause. `core/errors/serialize-error.ts:18-23, 35-56`; `eng/execution/runAction.ts:905-911`; `eng/errors/normalize-error.ts:103-113`. [ref] R-22; the page says only "no stack trace".
- `errorCapture` per-block event is deduped to the leaf: one event for the block that threw, not one per enclosing sequencer or action root. `eng/context/createExecutionContext.ts:3607-3631`; `eng/errors/error-capture.ts:8-9, 59-61`. Section 4's "once per failed block" means the leaf only. [page: "for the block that threw"]
- `defineFlow({...})()` is the real call shape: `defineFlow` returns a definition, calling it makes the instance. `apps/docs/docs/fundamentals/flows.md:67-75`.
- A generator with no `outputSchema` outputs a string (`z.string()` default). `core/blocks/generator.ts:2865`. So `draftReply` returns text, and `apologize` returning a string matches it.
- The page now shows `draft-reply.ts` (same file as on Blocks) and `log-failure.ts`; `errorCapture` example logs with `console.error` instead of importing a tracker SDK.
- Moved to Reference (page links): FlowError field list and plain-throw wrap (R-22); error item fields and `details.cause` (R-22); `.rescue()` handler options (R-03); `onErrored` row and capture event row (R-22); what a store keeps of a failed request (R-16).

## Revisions (revise round 2)

- `message` reaches the caller verbatim for any thrown error, not only a `FlowError` you wrote: `normalizeError` copies `normalized.message` onto the wrapper. So a library or `fetch` error's message goes out too. The page says "no stack trace leaves the server", not "only what you chose". `eng/errors/normalize-error.ts:46-92`; `eng/execution/runAction.ts:921-923`. [page]
- The `.step(fn, block)` form: the function before the block maps the previous output to the block's input. `handleTicket` maps the order to the text `draftReply` takes. [page]
- "Action" is defined at first use on the page as the named entry point a caller invokes (`reply` in the `defineFlow` example). `flows:386-396`.
- `errorCapture`: the `if (!event.final) return` check keeps one report per failed request; without it the callback also fires for the failing block, so a failed request fires twice. `eng/test/error-capture-wiring.test.ts:81-110`. [page]

## Revisions (revise round 3)

- `onErrored` (action and request) runs only on the failed-request path, after `emitRequestStatus("failed")`; a rescued failure completes the request and never reaches it. `errorCapture` still fires its per-block event for a rescued failure, never `final`. `eng/execution/runAction.ts:3290-3308`. So the opening says "hooks", not that every failure reaches `onErrored`. [page]
- The message of an error you did not write reaches the caller; stated once, in "What the caller sees", not under "What it gets you".
