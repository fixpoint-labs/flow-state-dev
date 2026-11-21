# Fact sheet: Errors (R-22, reference, `reference/errors`)

Pass 1. Cites only: existing user docs (`apps/docs/**`), the exported surface and its doc comments, tests, `goals/`.
No spec was read. Rows other pages' depth passes moved here (the `→ R-22` rows in the `*.record.md` files) are
checked in section 1; every one is carried or named as dropped.

Marks: **[run]** I ran it in this pass, with a throwaway vitest file that I deleted afterwards (it called `runAction`
on an in-memory store with an `errorCapture` sink and read the result, the `error` item, the events and the stored
record). **[test]** a committed test asserts it. **[read]** I read the code and no test pins it; pass 5 should run it
before the page states it. **[doc]** only an existing user page says it.

Abbreviations (all under `/home/user/flow-state-dev/`):

| Abbr | File |
|---|---|
| `fe-core` | `packages/core/src/errors/flow-error.ts` |
| `ove` | `packages/core/src/errors/output-validation-error.ts` |
| `soe` | `packages/core/src/errors/sequencer-output-schema-error.ts` |
| `sus` | `packages/core/src/errors/suspension-error.ts` |
| `ser` | `packages/core/src/errors/serialize-error.ts` |
| `fe` | `packages/engine/src/errors/flow-error.ts` |
| `ne` | `packages/engine/src/errors/normalize-error.ts` |
| `cpe` | `packages/engine/src/errors/classify-provider-error.ts` |
| `ec` | `packages/engine/src/errors/error-capture.ts` |
| `ra` | `packages/engine/src/execution/runAction.ts` |
| `eb` | `packages/engine/src/execution/executeBlock.ts` |
| `rt` | `packages/engine/src/execution/retry.ts` |
| `cec` | `packages/engine/src/context/createExecutionContext.ts` |
| `te` | `packages/core/src/blocks/internal/tool-executor.ts` |
| `eto` | `packages/core/src/blocks/internal/emit-tool-output.ts` |
| `bb` | `packages/core/src/blocks/internal/build-block.ts` |
| `ct` | `packages/contracts/src/items/types.ts` |
| `bmq` | `packages/bullmq/src/job-processor.ts` (retry config in `retry.ts`) |
| `rr` | `packages/engine/src/routes/recovery-routes.ts` |
| `eh` | `apps/docs/docs/advanced/error-handling.md` |
| `ecd` | `apps/docs/docs/advanced/error-capture.md` |
| `cli` | `apps/docs/docs/cli/overview.md` |
| `mod` | `apps/docs/docs/fundamentals/models.md` |

---

## 1. The 17 moved rows: carried or dropped

Rows are quoted by their opening words. Each says where its facts are below.

| # | Row (from) | Verdict | Where |
|---|---|---|---|
| 1 | What a failed turn records and shows: one error line with the reason, Retry on the newest turn, missing or wrong key as a cause (run-a-starter) | **Carried, split.** The record and the item are R-22 facts (A, F). The "line", Retry offered on the newest turn only, and the `retryable` rule are the React/screen helper's behaviour: carried as the Retry rule (A9). The missing-key text is a model-resolver message, not an error shape: **dropped from R-22** (it belongs on the models page; the sheet holds one pointer, A10). | A9, A10, F |
| 2 | Failure shape: input the schema refuses settles the request as `{ status: "failed", error }`, `send` does not reject (flows-and-actions) | **Carried.** Verified by run: the result is `failed`, code `validation_error`, no block row. One correction to the old wording: the result's `error` carries `{ code, message }` only (A5). | A5 |
| 3 | FlowError fields and the wrap of a plain throw as `execution_error`, original kept as `cause` (when-something-fails) | **Carried.** | B1, B2 |
| 4 | Error item fields as the client receives them; `details.cause` chain, depth 4, wrapper skipped (when-something-fails, corrected by pass 5) | **Carried.** Verified by run, including the skipped wrapper layer. | A2, A3 |
| 5 | `onErrored` hook row (when-something-fails) | **Carried**, with two additions the row lacks: the flow-level `request.onErrored` and the order of the three failure hooks. | E1 to E5 |
| 6 | `errorCapture` event row: leaf once, `final` once, healed failure fires the first kind only, off until set (when-something-fails, corrected by pass 5) | **Carried**, with three corrections to what `error-capture.md` says (D7, D9, D11). | D |
| 7 | No move: `FlowError` shape is an R-22 row; R-42 keeps only the fetch code table. Check that R-22 carries the `retryable` semantics (tools) | **Carried.** The `retryable` semantics are section C. The fetch codes stay on R-42; one line here (B6) lists them so the pointer is true. | B, C |
| 8 | `NoRequestHostError` (`code: "no-request-host"`) (cli) | **Carried** (B7). It is not a `FlowError`; read the note. | B7 |
| 9 | `SuspensionRejectedError` row (durable-execution, corrected by pass 5) | **Carried**, with one correction: inside a generator's tool the rejection does not fail the request (B8). | B8, C7 |
| 10 | Recall failure shape: the tool never throws into the generator (memory) | **Carried** as one row (A11). | A11 |
| 11 | errorCapture fires by default for every block failure, including ones a rescue or retry later recovers; each attempt fires its own event; flags `transient`, `error.retryable`, `attempt` (errors-to-sentry, corrected by pass 5) | **Carried** (D3, D5, D6). "Fires by default" is wrong: nothing fires until `errorCapture` is set. | D |
| 12 | `final` event: after the failed record is written; names the leaf; healed failure never gets one; a setup failure before any block does (errors-to-sentry, corrected by pass 5) | **Carried** (D7, D8). | D |
| 13 | Per-block and final events both reach the hook, so forwarding both reports one failure twice (errors-to-sentry, corrected by pass 5) | **Carried** (D10). | D |
| 14 | Error shapes by failure kind: block input validation, generator output-schema failure, action input failing before any block row exists (debug-a-run) | **Carried** (A4 to A6, B3). | A, B |
| 15 | Result when a completion hook throws after the action returns: the run fails with the hook's error and `output` still holds the action's return (run-a-flow-from-code) | **Carried**, verified by run (A7). | A7 |
| 16 | Which job failures are unrecoverable and skip retries (background-jobs-bullmq) | **Carried** (C8). One correction: "validation errors, unknown flows and unknown actions skip retries" is only partly true (C8). | C8 |
| 17 | `.rescue()` row | Not an R-22 row (it is tagged R-03 in the record). **Not carried.** | none |

The sheet also holds the lookups the plan names: "What does the client get when a block throws?" (answer key, section 8) and
"Which errors are retried?" (section C).

---

## A. Error shapes the client receives

**A1. A thrown value becomes one `FlowError`.** A block fails by throwing. The runtime normalizes whatever was thrown:
a `FlowError` keeps its `code`, `retryable`, `details`, `blockName`, `scope` and `cause`; anything else is wrapped in a
new `FlowError` with the same `message`, `code: "execution_error"`, `retryable: false` and the original as `cause`.
`ne:419-463` (the two `new FlowError` branches `:442-463`); `ne:391-414` (`inferCode`, `inferRetryable`);
`engine/test/errors.test.ts:55-107` **[test]**. **[run]** plain `throw new Error("plain boom")` gives
`{ code: "execution_error", retryable: false, message: "plain boom" }`.
- A `FlowError` thrown with no `code` also gets `code: "execution_error"` (its `retryable` is kept). **[run]**
  (`new FlowError("x", { retryable: true })` normalized to `code: "execution_error", retryable: true`.) `ne:391-397`.
- A thrown AI SDK error is classified before the generic path, unless the caller forced a `code` or it is already a
  `FlowError`: status 429 gives `rate_limit_error` (retryable); a message matching context length gives
  `context_length_error` (not retryable); status 408 or 504 or a timeout message gives `timeout_error` (retryable); any
  other status 500 or above gives `provider_unavailable_error` (retryable); anything else falls through to
  `execution_error`. The original stays on `cause`. `cpe:56-92`; `engine/test/classify-provider-error.test.ts:32-88` **[test]**.
  Detection is by the AI SDK's marker symbol or an `AI_` name prefix, not `instanceof`. `cpe:39-43`.

**A2. The `error` item.** When a request fails, the runtime emits one item of `type: "error"`, `status: "failed"`, with
`message`, `code`, and `details` only when there are any. `ct:589-601` (type); `ra:886-930` (built at `:912-924`).
**[run]** the item for the plain throw was `{ type: "error", status: "failed", message: "plain boom", code: "execution_error",
details: { cause: {...} } }`; for a `FlowError` with `details: { a: 1 }` it was `details: { a: 1 }`; for an input
validation failure it had no `details` key. Its provenance is `blockName: "runtime"` **[run]**. There is no stack trace on it.
- It is emitted before the stream's `failed` status event, and before the request's side-chain work drains. `ra:3118-3124`,
  `:3296` **[read]**.
- `message` is the thrown error's `message`, verbatim, for any thrown value, not only a `FlowError` the author wrote.
  `ne:454-462`; **[run]**. So the message of a library error (a failed `fetch`) goes out too.
- `details` are what the author put on the `FlowError`, passed through verbatim (**[run]**), plus `details.cause` when the
  error has a cause (A3). `eh:35-37` **[doc]**.
- An item with `type: "error"` is client-visible and never enters model history. `docs-revamp/pages/reference/items.facts.md:62, :132, :348`
  (the Items page's rows on visibility; cross-check at pass 5).

**A3. `details.cause`.** The cause chain is serialized: each level has `name` and `message`, plus `code` when the cause has a
string `code` (system codes like `ECONNRESET`), and a nested `cause` for each deeper level. Depth: the top call has
depth 4, and each nested cause one less, so up to five levels print; below that the chain is cut. `ser:35-56`.
- No stack is serialized. `ser:12-17`.
- A thrower that already put its own `cause` into `details` is not overwritten. `ser:71-81`.
- For a plain throw, the synthetic wrapper layer is skipped (it would only repeat the message), so `details.cause`
  describes the original error's own cause, not the original error. `ne:476-486`; `ra:905-911`. **[run]** `new Error("plain boom",
  { cause: new Error("root cause", { cause: Object.assign(new Error("deep"), { code: "ECONNRESET" }) }) })` produced
  `details.cause = { name: "Error", message: "root cause", cause: { name: "Error", message: "deep", code: "ECONNRESET" } }`.
- A plain throw with no cause gets no `details` at all. **[run]** (the input-validation item and the `FlowError` item show it).
- Type of the entry: `SerializedError = { name, message, code?, cause? }`. `ser:18-23`.
- Well-known `details` keys on a block's error: `rawOutput`, `issues`, `phase` (output validation), `cause`
  (any error with a cause), `errorType`, `httpStatus`, `responseBody` (`fetch` tool). `eh:51-65` **[doc]**. Two more keys exist:
  `httpStatusText` and `url` on fetch errors (`packages/tools/src/fetch/errors.ts:104-118`), and `errorType: "blocked"` is a
  seventh value the doc's list lacks (`errors.ts:24-31`). **Contradiction for the page:** `eh:61` lists six `errorType` values.

**A4. A block's input or output schema refuses a value.** The block throws a plain `Error` (no code):
`Block "<name>" input validation failed at "<path>": <message>` (or `output validation failed`), naming the first issue
only; the `at "<path>"` part is left out when the path is empty. `bb:152-171`. Normalized: `code: "execution_error"`,
`retryable: false` **[run]**. The block's `execute` does not run. **[run]** (0 calls).
`core/test/build-block.test.ts:50-65` **[test]** for the phrase.

**A5. Action input refused before any block runs.** `Action input validation failed at "<path>": <message>` (first issue only;
no `at` part for an empty path), a `ValidationError`: `code: "validation_error"`, `retryable: false`. `ra:412-428`.
- The request is accepted and then settles `failed`; the call does not reject. Its `error` item has `code: "validation_error"`
  and no `details`; no block ran, so no `block_trace` row exists for the action. **[run]** (`{"status":"failed","error":{"code":"validation_error",
  "message":"Action input validation failed at \"n\": Expected number, received string"}}` on the stored record).
  `engine/test/action-input-schema-fix552.test.ts:50-51, 82-83` **[test]** (`result.error.message` matches).
- An unknown action name is **not** a failed request. `resolveAction` throws the `ValidationError` `Flow "<kind>" does not define action "<name>"` before any record or `error` item is written, so `runAction` rejects. `ra:399-404`; `engine/test/execution/carried-action-core.test.ts:57-72` **[test]** (`rejects.toThrow`). Only the action-input schema failure above settles `failed`. The HTTP status for an unknown action is the HTTP API page's.
- The HTTP status for these, and the `{ error }` body for a refused route, are the HTTP API page's rows
  (`reference/http-api.facts.md:33`: an unhandled throw is `500`, a validation error `400`, with `{ error: <message> }`). R-22 links, not repeats.

**A6. A generator's output fails its `outputSchema`.** `OutputValidationError` (a `FlowError`): `code: "output_validation_error"`,
`retryable: false`, `details: { rawOutput: string, issues: ZodIssue[], phase: "stream" | "final" }`. `ove:10-28`;
`core/test/output-validation-error.test.ts:11-45` **[test]**. `rawOutput` is the model's text exactly as it arrived; `issues`
is the Zod issue list; `phase` is `"stream"` when the failure was caught mid-stream, `"final"` after the model finished. `eh:39-49` **[doc]**.
Exported from `@flow-state-dev/core`. `core/src/index.ts:426-427`.

**A7. A completion hook (`onCompleted`) throws after the action returned.** The request fails with the hook's error and `output` still holds
the action's return. **[run]** (`onCompleted` block that throws: result `{ error: { code: "execution_error", message: "hook fail" },
output: "fine" }`; the stored record `result` was `{ output: "fine", error: { code, message } }`; the status `failed`.)
`ra:2420-2432` (the answer is recorded before the hooks); `client/src/types/index.ts:283-299` (`SessionRequestResult`) **[read]**.

**A8. What the stored request record keeps.** `status: "failed"`, `failedAtMs`, and `result.error = { code, message }`.
`details` and `cause` are not in the record's `result.error`. `engine/src/stores/types.ts:224, :317-341`; **[run]** (`rec.result`).
The client reads it as `SessionRequestResult.error?: { code: string; message: string }` from the session's request list or
`handle.result()`: `{ status, ...stored }` (`client/src/client.ts:1031-1035`; `client/src/types/index.ts:283-301`). The listing
adds `output` only with `includeResultOutput`, and a `failed` record with no `result` means none was recorded (an older
store). `client/src/types/index.ts:266-274, :283-290`.

**A9. Retry on a failed turn.** The retry route `POST .../retry` re-runs a `failed` or `interrupted` request as a **new request**
(new id; the response names it with `retryOf: <old id>`), optionally with `inputOverride`. `rr:71-170`.
- Refusals: `409` when the original is `in_progress`; `409` for any other status; `400` on a flow-instance mismatch;
  `404` (the same shape as a missing id) for an unknown id, a caller who does not own it, or a source the route does not
  re-enter; `415` for a body without the JSON media type; `500` with `{ error: <message> }` if the re-run cannot start. `rr:77-130`, `:170-175`.
- Which requests it re-enters: those that arrived on `http`, `mcp` or `scheduled`, plus a host's own sources named in the
  host option `publicReentrySources`. `webhook`, `task` and `internal` are never re-entered and the option refuses them at
  construction. `engine/src/routes/public-reentry.ts:55-90` (the sets), `:95-127`; `engine/test/turn-retryable.test.ts` **[test]**.
- The session's request list marks each request `retryable` with that same rule, so a screen offers Retry from the field.
  `engine/src/routes/session-routes.ts:655-658`; `engine/test/turn-retryable.test.ts:1-14` **[test]** (the field agrees with the route on every source).
- The conversation helper `conversationLines(items, turns)` draws a failed turn as one `{ kind: "failed", item: ErrorItem, retryable }` line and
  marks `retryable: true` only on the newest turn that drew a line and only when the turn's own `retryable` is `true`; with
  no `turns` argument, no failed line offers Retry. `react/src/components/conversation-lines.ts:222-296`;
  `labs/teammates/test/failed-turn.test.tsx:36-52` **[test]**. Exported from `@flow-state-dev/react` (the `ItemLine` type is, `labs/teammates/test/failed-turn.test.tsx:15`).
- The client call: `handle.retry({ input? })` returns a new handle. `client/src/client.ts:1043-1053`.

**A10. Missing provider key.** A model that cannot be resolved fails the turn with the resolver's message; the exact text is
a model-resolver row (`core/src/models/createModelResolver.ts:1215-1226` for "No provider available for ..."). Not an R-22
shape: pointer only. The Teammates test uses `"AI_GATEWAY_API_KEY is not set"` as a fixture reason, **not** the live text.
`labs/teammates/test/failed-turn.test.tsx:36-40`.

**A11. A tool never throws into the generator.** The memory recall tool catches any error in its pipeline and returns
`{ error, query, strategy }`; the model reads `Recall failed: <error>`. `packages/memory/src/tools/recall-tool.ts:127-159`;
`format-helpers.ts:30-33`. In general: an ordinary tool error does not fail the request. The generator hands the model a failed
tool result, the text `Tool "<name>" failed: <message>`, and the run goes on; the failed call is also recorded as a
`tool_output` item with `status: "failed"` and `error: { message, code?, details? }`. `core/src/blocks/generator.ts:1491-1496` (doc
comment); `core/src/models/llm-messages.ts:95-100`; `eto:195-228`; `engine/test/generator-suspension-resume.test.ts:332-391` **[test]**.
An error with a `cause` there carries the same serialized `details.cause`. `eto:206`.
- A tool call that suspended is recorded `failed` with `error.code === "SUSPENSION"` (overriding any code of its own) so that resume
  can find it; it is not a failure. `eto:208-218`.

**A12. Failures that leave a stored trace too.** A block that fails ends its `block_trace` row `status: "failed"` with `error: { message, code?, details? }`.
`ct:325-335`. Trace items are off the default client stream. `client/src/client.ts:1051` (`include: "trace"` only with
`includeTrace: true`).

**A13. Not failures.** A cancelled request ends `aborted` with an "aborted" message item and **no** `error` item.
`ra:3118-3126` (the `wasIntentionalAbort` branch emits the aborted message, `emitTerminalError`
only when not aborted) **[read]**. **Correction:** a dropped HTTP connection does not end the request. The action route does not
pass the request signal into `runAction`, so a disconnect only closes the stream and the run goes on
(`engine/src/routes/action-routes.ts:166-172`) **[read]**. A request ends `interrupted` when its process dies and the stale sweep
finds it (`ra:3063-3064`, `detectInterruptedRequests`), or when a direct `runAction` call's own `signal` aborts with no
recorded cancel (`ra:3070-3092`, `wasIntentionalAbort` false) **[read]**. A step in `.sideChain()` that throws does not fail the main chain. `apps/docs/docs/sequencers/composing-blocks.md:205` **[doc]**.
A failure a `.rescue()` handled is not a failure of the request: no `error` item and no `final` capture event (`engine/test/error-capture-final.test.ts:94-117` **[test]**).

---

## B. Codes

Every row is what the client sees as `code` on the `error` item and on `result.error`. "Class" is the class a thrower can use or
the runtime throws. **Only a few classes are exported**: `FlowError`, `OutputValidationError`, `SequencerOutputSchemaError`,
`SequencerSchemaMismatchError`, `StrictSchemaError`, `SuspensionError`, `SuspensionRejectedError`, `SuspensionTimeoutError`,
`RouteUnavailableError`, `RecordedValueOmittedError` from `@flow-state-dev/core` (`core/src/index.ts:426-441`;
`core/src/errors/index.ts:5-28`), `ConcurrentModificationError` from `@flow-state-dev/engine` (`engine/src/index.ts:16`), `OrgRequiredError`, `RequestOwnerMismatchError`, `UserBindingMismatchError` and `StoreSubscriptionError` from `@flow-state-dev/engine/host` (`engine/src/host.ts:188, :210-212, :224-225`), and `UnresolvedIntentError` from the `@flow-state-dev/core/errors/unresolved-intent-error` subpath (`core/package.json:87`).
`ValidationError`, `NetworkError`, `TimeoutError`, `RateLimitError`, `ModelError`, `ContextLengthError`, `ProviderUnavailableError`,
`ToolExecutionError`, `AmbiguousBlockNameError`, `FlowStateConfigError`, `FlowStateDisposedError`, `ResourceDeletedError` and
`ResourceAlreadyExistsError` live in `engine/src/errors/flow-error.ts` and are **not** exported from any engine entry point
(`engine/src/index.ts`, `host.ts`, `internal.ts`, `testing.ts` were checked). So the page lists them as **codes a client receives**, not as classes to import.
`NoRequestHostError` is exported from `@flow-state-dev/core/internal` only. `core/src/internal/index.ts:27`.

| Code | Class / source | `retryable` | When | Evidence |
|---|---|---|---|---|
| `execution_error` | a plain throw; a `FlowError` with no code | `false` (a `FlowError`'s own flag is kept) | Default for anything thrown | `ne:391-414`; **[run]** |
| `validation_error` | `ValidationError` | `false` | Action input refused; unknown action; other request-level refusals | `fe:33-44`; `ra:412-428` |
| `network_error` | `NetworkError` | `true` | Only when a thrower or runtime uses the class or forces the code | `fe:49-60` |
| `timeout_error` | `TimeoutError` | `true` | AI SDK 408, 504 or a timeout message (classified); or the class | `fe:65-76`; `cpe:83-85` |
| `rate_limit_error` | `RateLimitError` | `true` | AI SDK 429 (classified) | `fe:81-92`; `cpe:73-75` |
| `model_error` | `ModelError` | `true` | The class | `fe:97-108` |
| `context_length_error` | `ContextLengthError` | `false` | AI SDK error whose message matches context length | `fe:115-126`; `cpe:34-35, :79-81` |
| `provider_unavailable_error` | `ProviderUnavailableError` | `true` | AI SDK status 500 or above | `fe:132-143`; `cpe:87-89` |
| `tool_execution_error` | `ToolExecutionError` | `false` | The class | `fe:148-159` |
| `ambiguous_block_name` | `AmbiguousBlockNameError` | `false` | A block name resolves to more than one block | `fe:164-175`; `cec:4242` |
| `flowstate_config_error` | `FlowStateConfigError` | `false` | `createFlowState` configuration refused (stores shape, unknown profile, slot without capability) | `fe:177-194` |
| `flowstate_disposed_error` | `FlowStateDisposedError` | `false` | `getRouter()` or `ready()` after `dispose()` | `fe:196-211` |
| `resource_deleted` | `ResourceDeletedError` | `false` | A resource write reaches a deleted key; `details.resourceKey` | `fe:240-258` |
| `resource_already_exists` | `ResourceAlreadyExistsError` | `false` | A create-if-absent write loses its race; `details.resourceKey` | `fe:274-302` |
| `concurrent_modification` | `ConcurrentModificationError` (exported) | `true` | A version-checked write lost; `details.attempts` | `fe:355-373`; `engine/src/index.ts:16` |
| `output_validation_error` | `OutputValidationError` | `false` | A generator's output fails its `outputSchema` | A6 |
| `sequencer_output_schema_error` | `SequencerOutputSchemaError` | `false` | A sequencer's returned value fails its declared `outputSchema`, on any exit path (tail, `exitIf`, `rescue`); `details: { sequencerName, lastStepName, rawOutput, issues }` | `soe:32-76`; `eh:67-81` **[doc]** |
| `sequencer_schema_mismatch` | `SequencerSchemaMismatchError` | `false` | `.validate()` at build time: declared and inferred output disagree; `details: { sequencerName, declaredKind, inferredKind, reason }` | `soe:78-102` |
| `strict_schema_error` | `StrictSchemaError` | `false` | A generator `outputSchema` holds a construct strict structured output rejects; raised at `generator()` construction | `core/src/errors/strict-schema-error.ts:53-91` |
| `route_unavailable` | `RouteUnavailableError` | `false` | A resumed router's recorded route is gone or its selector chose differently | `core/src/errors/route-unavailable-error.ts:1-45` |
| `generator_tool_unavailable` | `GeneratorToolUnavailableError` (not exported) | `false` | A resumed generator's pending tool is no longer in its resolved tool set; `details.toolName` | `core/src/blocks/internal/generator-resume.ts:44-62` |
| `RECORDED_VALUE_OMITTED` | `RecordedValueOmittedError` | `false` | A resume would have to hand on a value the record kept only as a placeholder; `details: { blockName, bytes }` | `core/src/errors/recorded-value-omitted-error.ts:11-47` |
| `unresolved_intent` | `UnresolvedIntentError` (not exported by name from core) | `false` | An `intent/<name>` model with no mapping and no default | `core/src/errors/unresolved-intent-error.ts:11, :124-133` |
| `store_subscription.<subCode>` | `StoreSubscriptionError` | `false` | Failure of a store's event subscription | `engine/src/errors/store-subscription-error.ts:21-45` |
| `fetch_http_error`, `fetch_transport_error`, `fetch_blocked_url`, `fetch_provider_error` | the `fetch` tool | per call (below) | The fetch tool; the code table and `errorType` are R-42's | `packages/tools/src/fetch/errors.ts:87-155` |
| `no-request-host` | `NoRequestHostError` (**not a `FlowError`**) | n/a, becomes `false` | See B7 | `core/src/types/request-host.ts:688-700` |

Notes under the table:
- A thrower's own `code` is any string. `fe-core:23-31`, `:38-57`. The framework reads `code` for nothing but display and `retryable` classification (C1).
- **Classes the runtime names but that are not codes of their own:** `SuspensionError` (control flow, B8), `SuspensionTimeoutError`.
- The code table above lists only codes a reader can see. Codes that appear only in an internal throw I could not tie to a client-visible path
  (for example the `OrgRequiredError` and `FlowInstanceBindingMismatchError` a direct `runAction` call rejects with, `bmq:456-465`) are left out;
  they reject the call and never become an `error` item. **[read]**

**B1. `FlowError`** (`@flow-state-dev/core`): `new FlowError(message, { code?, retryable?, details?, cause? })`. `retryable` defaults to
`false`. Also accepts `blockName`, `blockInstanceId`, `scope` (`"request" | "sideChain" | "resource" | "block"`), which the runtime fills
in; authors are not meant to set them. `fe-core:13-57`. `FlowError.isInstance(err)` matches by `instanceof`, or by `name === "FlowError"` for a duplicate copy of the
class from a bundler boundary. It matches subclasses by `instanceof` only. `fe-core:59-74`. Subclasses of `FlowError` pass `instanceof FlowError`
(`eh:49` **[doc]**).

**B2. Block name and scope on the error.** `normalizeError` stamps the failing block's `blockName` and `scope: "block"` on a block failure and
`scope: "request"` on a request-level one. They ride on the `FlowError`, which `onErrored` hooks and `errorCapture` receive; they are **not** on the `error` item
(`ct:589-601`; **[run]** the item has no `blockName`). `eb:490-494`; `ra:511`.

**B3. Output-validation and input-validation shapes** are A4 to A6.

**B4. Request-level errors raised before any request exists** (an unknown flow, no organization, someone else's session or request,
a flow instance mismatch) **reject** the `runAction` call and never produce an `error` item or a record. The classes:
`OrgRequiredError`, `FlowInstanceBindingMismatchError`, `RequestOwnerMismatchError`, `UserBindingMismatchError`.
`docs-revamp/pages/build/run-a-flow-from-code.facts.md:112` cites `ra:1166-1168, :1295-1342`. **[read]** at those lines, re-check at pass 5.

**B5. `ConcurrentModificationError`.** `retryable: true`, `details.attempts`. Raised when a version-checked state or resource write lost: the retry
budget ran out, or a version-checked resource `delete` conflicted (no retry loop behind that one). An in-memory scope never raises it. `fe:303-373`. Exported from
`@flow-state-dev/engine`. The class's doc comment is long; the page states only the first two sentences.

**B6. Fetch codes** (for the one-line pointer R-22 keeps, the table is R-42's): `fetch_http_error` (`retryable` for status 500 or above, 429, 408; not for other 4xx;
`details: { errorType: "http", httpStatus, httpStatusText, responseBody?, url }`), `fetch_transport_error` (`retryable` for `errorType` `network` or `timeout`; `abort`,
`parse`, `unknown` not; `cause` is kept), `fetch_blocked_url` (never; `errorType: "blocked"`), `fetch_provider_error` (never; `errorType: "unknown"`).
`packages/tools/src/fetch/errors.ts:87-155`.

**B7. `NoRequestHostError`.** Thrown by `requireRequestHost(ctx)` when a context has no runtime host. It is a plain `Error` subclass with `readonly code = "no-request-host"`,
`name: "NoRequestHostError"` and the default message `This capability needs a runtime host, and none is wired on this context. A host built through the
shipped entry points supplies one; a hand-built test context must provide requestHost explicitly.` `core/src/types/request-host.ts:688-700, :723-727`.
- It is **not** a `FlowError`, so when it escapes a block the client sees `code: "execution_error"`, `retryable: false`, and the message above; `"no-request-host"` is on
  the error's own `code`, which shows up in `details.cause.code` only for a wrapped cause. **[read]** (it follows from A1 and A3; I did not run it.)
- `fsdev` run with discovery or `--no-config` wires no host, so background work throws it; on a task board the row the work was claimed for is recorded failed.
  `cli:109-121` **[doc]**. A host built by `createFlowState` supplies one. `engine/src/flowstate/createFlowState.ts:1055-1075` (comment) **[read]**.

**B8. `SuspensionRejectedError`, `SuspensionTimeoutError`, `SuspensionError`** (`@flow-state-dev/core`). `sus:178-290`.
- `SuspensionError` is the control-flow signal a block throws, through `ctx.suspend()`, to pause. It is **not** a block failure and a `.rescue()` handler does not fire for it. `sus:1-13`; `core/src/types/block.ts:1085-1090`.
- `SuspensionRejectedError`: fields `suspensionId`, `rejectedBy?`, `rejectionData?`, `expired`, `cancelled`. Messages: `Suspension <id> was rejected`, `Suspension <id> expired and is no longer valid` (`expired: true`), `Suspension <id> was cancelled` (`cancelled: true`). `sus:233-272`.
  It is thrown from `ctx.suspend()` on resume when the gate was rejected, when an **approval** passed its deadline, or when the task or stop was cancelled. `cec:250-276`.
  A `.rescue([{ when: [SuspensionRejectedError], block }])` catches it (it is a plain `Error`, so `when` matches by class). Uncaught outside a generator tool, the request ends `failed` with
  that message. `engine/test/suspension-resume.test.ts:293-354` **[test]** (the message contains "rejected"); the expired and cancelled messages **[read]**.
  `code` on the item is `execution_error` (it is not a `FlowError`). **[read]**
- Inside a generator's tool call the rejection does **not** fail the request: the model is handed `{ denied: true, reason: <message> }`, or for an expired approval
  `{ denied: true, expired: true, reason: "The approval for this tool call expired and is no longer valid. The tool was not run." }`. `core/src/blocks/generator.ts:1768-1796` **[read]**; `engine/test/stop-suspended.test.ts:1232, :1268` **[test]** (the expired text).
- `SuspensionTimeoutError` (`Suspension <id> timed out`): thrown when a suspension that is **not** an approval (one allowing no `reject`, or a review or an input `ctx.suspendForUser`) reaches its deadline with no answer. Catch to proceed, end or ask again; uncaught it fails the request. `sus:274-290`; `cec:250-276`.
  An approval at its deadline reads as `SuspensionRejectedError` with `expired: true` instead.

---

## C. Which errors are retried

Five separate mechanisms. They do not share a policy, and only the first consults `FlowError.retryable`.

**C1. A block's `retry` policy** (`RetryPolicy = { maxAttempts?, baseDelayMs?, maxDelayMs?, retryableErrors? }`, `core/src/types/block.ts:1037-1042`;
on a block config as `retry`, `:1082`; a generator config as well, `core/src/blocks/generator.ts:633`; a run can pass `retry` too, `engine/src/execution/types.ts:140`).
- The block's own policy fields override the run's, per field. `rt:38-54`. Defaults: `maxAttempts: 1` (no retry unless set), `baseDelayMs: 0`, `maxDelayMs: 5000`; delay doubles each attempt (`factor: 2`), no random jitter. `rt:23-25`, `:143-149`.
- An error is retried when: there is a policy, **and** it is not a `SuspensionError`, **and** (if it is a `FlowError`) its `retryable` is `true`, **and** (if `retryableErrors` is set and non-empty) it is an instance of one of those classes. A thrown value that is not a `FlowError` has no `retryable` flag, so it is retried under any policy. `rt:59-90`; `engine/test/retry-p-retry.test.ts:14-30, :203-` **[test]**.
  **[run]** a block with `retry: { maxAttempts: 3 }` that throws a plain `Error`: `execute` ran 3 times. The same policy on a `FlowError` with `retryable: false`: ran once. With `retryableErrors: [MyErr]` and a thrown plain `Error`: ran once.
- **A block whose input fails its schema is retried like any plain throw.** **[run]** a block with `retry: { maxAttempts: 3 }` and bad input: the input check ran 3 times (`execute` 0 times) and the request failed with the `Block "..." input validation failed` message. (Pass 8 should decide whether to keep this on the page; it is true and surprising.)
- A retried `FlowError` that eventually fails is the `FlowError` itself on the item. `engine/test/retry-p-retry.test.ts:67`.
- `onRetry` fires only before an attempt that will happen, not for the last failure; each failed attempt fires its own `errorCapture` event (D5). `rt:101-110`, `:150-157`; `eb:429-468`.
- A `.rescue()` on an action's root block that is not a sequencer runs only after the last attempt, or at once for an error that is not retryable. `eb:332-362` (`eb:336-337` skips sequencers). A sequencer's own `.rescue()` runs on the first failure of a matching step and returns the recovery output, so the retry loop sees no error and does not retry; only an unmatched error, or one the handler throws, is retried. `core/src/blocks/sequencer.ts:1078-1089`.
- A cancel (`signal` aborted) before, during a backoff wait, or during an attempt ends the loop with `Error("Retry aborted")`. `rt:118-127`, `:160-170`; `engine/test/retry-p-retry.test.ts:137-172` **[test]**.

**C2. A tool's retry** (`defineFlow({ tools: { defaults: { retry } } })`, `core/src/types/flow.ts:92-95`) for tools called by a generator. `te:403-453`. Attempts `maxAttempts` (default 1), `baseDelayMs` default 0, `maxDelayMs` default unbounded, exponential. It
does **not** read `FlowError.retryable`: only `retryableErrors`, when set, narrows it. **[read]** (the loop's whole body). A `SuspensionError`, `SuspensionRejectedError` or
`SuspensionTimeoutError` is never retried. `te:421-436`; `core/test/tool-executor-suspension.test.ts:19-60` **[test]**. A block-level retry policy on the action's root block is
**not** guarded against `SuspensionRejectedError` (it is a plain `Error`; `rt:67-90` guards `SuspensionError` only). **[read]**; pass 5 should run it if the page states it.
Observer `onToolErrored` fires once per tool call that ends in a throw, after every retry attempt is used up (the retry loop runs inside the call the hook wraps), not once per attempt. `te:138-141, :187-195`. (The errors page leaves this to R-02.)

**C3. The model call** (`createModelResolver({ retryPolicy })`, or `createFlowState({ models: { retryPolicy } })`): per model in a fallback group, `maxAttemptsPerModel` default 2, `baseDelayMs` 1000,
`maxDelayMs` 10000; then the next model. Retryable here means: the AI SDK error's own `isRetryable` boolean when it has one; a `LoadAPIKeyError` is not; HTTP status 429, 500, 502 or 503; messages containing
`fetch failed`, `ECONNREFUSED` or `ETIMEDOUT`. Streaming falls back only before the first chunk. `core/src/models/types.ts:87-96`; `fallbackModel.ts:36-80`, `:160-200`;
`createModelResolver.ts:112-116`; `mod:530-545` **[doc]**. **Correction (pass 8):** only `generate` and `generateStep` retry per model (`maxAttemptsPerModel`, default 2, doubling backoff). `stream` and `streamStep` try each candidate once; a retryable error moves to the next model whether or not a chunk was yielded, a non-retryable one (a `LoadAPIKeyError` included) is rethrown. The `!yieldedFirstChunk` guard covers only provider-load and message-prepare failures. `fallbackModel.ts:179-205, :243-278`. This is the models page's row (R-21); R-22 names it in one line so the lookup is complete.

**C4. A job queue** (`@flow-state-dev/bullmq`): a job whose action fails is retried when the failed result has `retryable !== false`, up to `attempts` (default 3, counting the first), backoff
exponential from 1000 ms with jitter 0.5. `packages/bullmq/src/retry.ts:9-30`. **Consequence [read]: a plain thrown error has `retryable: false` (A1), so it fails the job at once with no retry;
only an error that is `retryable: true` (a `FlowError` the thrower marked, or one of the classified codes in B) is retried.** `bmq:430-437, :519-521`; `bullmq/test/job-processor.test.ts:121-160` **[test]**
(a `retryable: true` error on a non-final attempt publishes no terminal; `retryable: false` throws `UnrecoverableError`).

**C5. The retry route and client `handle.retry()`**: a person or a client re-runs a `failed` or `interrupted` request as a new request (A9). It is not automatic.

**C8 (the "unrecoverable job" list).** These fail a job at once with no retry, whatever the attempts setting:
- an unknown flow (`Unknown flow "<kind>"`). `bmq:327-330`; `bullmq/test/job-processor.test.ts:190-200` **[test]**.
- a failed result with `retryable: false`: so every plain throw and every `validation_error`. `bmq:430-437`.
- an organization the job lacks (`OrgRequiredError`) and a request or session another flow instance owns (`FlowInstanceBindingMismatchError`), matched by error name. `bmq:456-466`.
- a run stopped because its concurrency place was lost. `bmq:424-428`.
- a job whose concurrency-key wait timed out. `bmq:309-312`.
- **Correction to the old wording** "Validation errors, unknown flows and unknown actions skip retries" (the row from the background-jobs page, `docs-revamp/pages/build/background-jobs-bullmq.facts.md:24`): unknown **actions** have no `UnrecoverableError` path in the processor; a `validation_error` result is non-retryable by its flag, which does cover an unknown action's `ValidationError` thrown at `ra:399-404` **[read]**. Say "a failed result marked not retryable".
- With `retry.deadLetter: true`, a job that fails for good is copied to `<queueName>-dlq`. `packages/bullmq/src/retry.ts:238-271` **[read]**, `bullmq/test/retry.test.ts:45-65` **[test]**; the BullMQ page owns that row.

**C7. The `retryable` flag's reader list** (so the page can say what `retryable` does): the block retry policy (C1), the BullMQ job processor (C4), and `errorCapture` consumers (`event.error.retryable`, D6). The retry route (A9) ignores it; it keys on the request's status and source. The tool retry (C2) ignores it.

---

## D. What is captured and where: `errorCapture`

**D1. The option.** `createFlowState({ errorCapture })` (`engine/src/flowstate/types.ts:239`); also an option of `createFlowApiRouter`, and `RuntimeConfig.errorCapture` for a direct `runAction` call
(`engine/src/runtime-config.ts:76`; `engine/test/error-capture-final.test.ts:33-38` passes it that way). Type `ErrorCaptureHandler = (event) => void | Promise<void>`
(`ec:65`; exported from `@flow-state-dev/engine/host`, `engine/src/host.ts:207`); the event type `ErrorCaptureEvent` is exported from `@flow-state-dev/engine` (`engine/src/index.ts:53`). **Off until set.** `ec:59-60`.

**D2. The event.** `ec:24-56`:

| Field | Type | Notes |
|---|---|---|
| `error` | `FlowError` | Normalized. The raw thrown value is on `error.cause` when it was wrapped (a plain throw); for a thrown `FlowError` the error is the same class's copy and `cause` is its own cause. `ec:25-26`; `ne:442-463` |
| `requestId` | `string` | |
| `flowKind` | `string` | The flow's `kind` |
| `actionName` | `string` | |
| `userId` | `string` | |
| `sessionId` | `string?` | Session-bound requests |
| `orgId` | `string?` | Optional in the type; the runtime fills it from the request's organization (`cec:3664-3670`) |
| `blockName` | `string?` | The leaf block that threw. Absent when no block threw (D8) |
| `blockKind` | `"handler" \| "generator" \| "evaluator" \| "sequencer" \| "router"`? | |
| `blockInstanceId` | `string?` | `<requestId>:<blockPath>:<attempt>`. **Differs per attempt.** `packages/contracts/src/block-instance-id.ts:54-60`; `eb:463`. **[read]** The doc comment at `ec:37` and `ecd:51` say it "excludes attempt" and is "useful for correlating retries": that is not what the builder does. `blockPath` is the stable key across attempts. |
| `blockPath` | `string?` | Structural path, e.g. `root/step[0]` |
| `attempt` | `number?` | 0-indexed attempt of the failing block |
| `scope` | `"block" \| "request" \| "sideChain" \| "resource"`? | `"block"` on a per-block event; `"request"` on the final event |
| `transient` | `boolean?` | `true` for a high-frequency transient block (a poll loop); lets an adapter down-sample. It does not mean the failure was rescued or retried. `ec:45` |
| `final` | `true?` | The one extra event, D7 |

**D3. What fires, once.** One event per failing **leaf** block; the sequencers and the action's root block above it that re-throw the same error do not fire. Deduped on the raw thrown value. `cec:3652-3691`; `ec:8-9`.
`engine/test/error-capture-wiring.test.ts:81-110` **[test]**; **[run]** (nested: one event `block: "boom"`, then the final).
- A failure a `.rescue()` recovers still fires the per-block event and never a `final`. `error-capture-wiring.test.ts:139-164`, `error-capture-final.test.ts:94-117` **[test]**.
- A hook that throws also fires an event for the hook block. **[run]** (an `onErrored` block that threw produced an event with the hook's block name after the final one; the request outcome was unchanged). That holds for failure-path hooks only (`runObserverSafely`, `ra:824-875`, `:3298-3316`). A success-path hook (`request.onStarted` `ra:2400-2403`, `action.onCompleted` `:2813-2824`, `request.onCompleted`, `request.onFinished` after success `:2964-2969`) runs through `runObserver`, which rethrows: the request fails with the hook's error, the event names the hook block, and a `final` event follows (a startup failure in `onStarted` sends only `final`). **[read]**

**D4. What does not fire.** A call that never becomes a request (an unknown flow, no organization, a refused session: B4) fires nothing, since it rejects before a record. A request whose input validation fails before any block runs fires the
**final** event only (D8), no per-block event. **[run]** `ecd:121-123` says the opposite for input validation; **contradiction to fix at pass 8 or in the neighbouring page.**

**D5. Retries.** Each failed attempt fires one event with its 0-indexed `attempt`; the last attempt's event is the terminal one. **[run]** a root block with `maxAttempts: 3` that failed every time: events `attempt: 0, 1, 2`, then the final.
`error-capture-wiring.test.ts:211-235` **[test]**. A block that recovers on a later attempt reports the attempts that failed and no final. `error-capture-final.test.ts:119-139` **[test]**.
- `attempt` on a root action block is set on every event (0 with no retry) **[run]**; on a nested leaf with no retry it is absent (`error-capture-wiring.test.ts:105-107` comment) **[test, by the comment; the assertion is `blockInstanceId` and `blockPath` truthy]**. So the doc's "set only under a retry policy" is true for nested leaves only.

**D6. `error.retryable` in an event** is the normalized error's flag (A1). It is not "the runtime will retry"; the page should say "the failure type may be retried" at most. `ecd:84-96` **[doc]**.

**D7. The final event.** A request that settles `failed` sends one more event with `final: true`, `scope: "request"`, the request's identity, and the leaf block's identity when a block threw. It is sent
after the failed record is written and before the `failed` status event and the `onErrored` hooks. `ra:3280-3296`; `error-capture-final.test.ts:40-92` **[test]** (the record already says `failed` when the sink runs;
`events.filter(e => !e.final)` still holds the per-block event). **[run]** final events for plain throw: `{ block: "boom", final: true, scope: "request" }`.
- Only a request this run settled sends one: the send is guarded by the failed write having landed. `ra:3294`.
- It bypasses the dedup set, since the leaf's own event already holds the thrown value. `cec:3693-3717`.
- It is sent even when the failed-status event cannot be written. `error-capture-final.test.ts:171-199` **[test]**.

**D8. A setup failure.** A failure before the request starts running blocks (context creation, checkpoint restore, a replay build) on a **fresh** request, whose failed record landed, sends one final event with no block. `ra:2230-2275`;
`error-capture-final.test.ts:141-170` **[test]**. A failed **action input** check is the same shape **[run]**: a final event with no `blockName`, `code: "validation_error"`. A setup failure on a **replay continuation** leaves the request `suspended` or `interrupted`, not `failed`, and sends none. `ra:2237-2243` (comment) **[read]**.

**D9. Safety.** The callback is read-only; its return value is ignored. It may be `async`. A throw or a rejection is logged at `warn` and swallowed. `ec:58-65`, `:134-153`; `error-capture-wiring.test.ts:237-` **[test]**.

**D10. Forwarding both.** An adapter that forwards every event sees a request that ends failed twice, once for the leaf and once as the final. To report one per failed request, forward only `event.final`; to report each failing block, skip `event.final`.
`ecd:60-95` **[doc]**; **[run]**.

**D11. The Sentry example's mapping** (level from `error.retryable`, tags from `code`) lives on the recipe, not here. Contradictions with `error-capture.md` found while verifying, all for the neighbour's cleanup:
1. `ecd:121-123` (input validation does not fire errorCapture): false for the final event (D4, D8).
2. `ecd:51` / `ec:37` (`blockInstanceId` excludes attempt): false (D2).
3. `ecd:53` (`attempt` set only under a retry policy): true for nested leaves only (D5).

**D12. `onError` is a different option.** `createFlowState({ onError })` is an HTTP-level sink `(error, { method, path }) => void` called first for an error no route handled. `engine/src/routes/createFlowApiRouter.ts:105`; `engine/src/flowstate/types.ts:228`; `reference/http-api.facts.md:33`.

**D13. DevTool.** The failed block's panel shows the message, a code badge, "Raw output" and "Validation issues" when present, a "Cause" chain, HTTP and type chips for fetch errors, and every other `details` key as JSON. `eh:119-121` **[doc]**;
`docs-revamp/pages/build/debug-a-run.facts.md:102` (item-detail source, cross-check).

---

## E. Hooks

All lifecycle hooks below are **blocks** (a `BlockDefinition`, for example `handler({ ... })`), not plain functions. `core/src/types/flow.ts:211, :419`. The block's input is the object shown.

| Hook | Declared on | Fires | Input | Evidence |
|---|---|---|---|---|
| `onErrored` (action) | `defineFlow({ actions: { <name>: { block, onErrored } } })` | A failed request, after the record and status event | `{ requestId, actionName, error }` | `ra:3298-3302`; `flow.ts:211` |
| `onErrored` (request) | `defineFlow({ request: { onErrored } })` | Same, after the action's | `{ requestId, actionName, error }` | `ra:3304-3308`; `flow.ts:419` |
| `onFinished` (request) | `defineFlow({ request: { onFinished } })` | Every end; on failure with the status | `{ requestId, actionName, status: "failed", error }` | `ra:3310-3316` |
| `onErrored` (block) | a block's config: `handler({ onErrored })` etc. | When that block throws, before a rescue runs | `(error: Error, ctx: BlockContext)`, a **function**, not a block | `bb:381-388`; `core/src/types/block.ts:1080` |
| `onToolErrored` | `defineFlow({ tools: { onToolErrored } })` | A tool call a generator made threw; once per thrown attempt | `{ toolName, input, error }`; a function or a block | `te:186-195`; `core/src/types/flow.ts:74-98` |
| `errorCapture` | `createFlowState` | D | `ErrorCaptureEvent` | D |

**E1. Order on a failed request:** the `error` item is emitted; the failed record is written; the `final` capture event; the `failed` status event; action `onErrored`; request `onErrored`; request `onFinished` (status `failed`).
`ra:3118-3124, :3280-3316`; `engine/test/execution.test.ts:2285-2313` **[test]** (`request.started`, `action.errored`, `request.errored`, `request.finished:failed`).

**E2. The hooks cannot change the outcome.** They run after the caller has the item and after the record says `failed`. `ra:3270-3316`. A hook that throws is ignored: the original failure stands, and `result.error` is the original. `ra:860-875` (the swallowing `runObserverSafely`); **[run]** (`onErrored` that threw: result and item unchanged).
- The hook that threw does fire an `errorCapture` event for itself (D3).
- `.sideChain()` work an `onErrored` or `onFinished` started finishes before the request is over. `ra:3326-3329` **[read]**.

**E3. They run only on the failure path.** A failure that a rescue recovers completes the request, so none of the `onErrored` hooks fire. **[read]** (`ra:3270-3316` is the failure branch only). `onCompleted` runs instead.

**E4. A block's own `onErrored`** swallows its own throw too (`bb:381-388`) and runs on the scope-less path; a rescue handler of the same block runs after it. **[read]**.

**E5. `request.onStepErrored` is declared and nothing calls it.** `core/src/types/flow.ts:421`, `core/src/flow/defineFlow.ts:718, :741`; a search of `engine/src` and `core/src` finds no call. **Do not document it as a hook that fires**; the `flows` page documents it as "non-terminal step failure" (`apps/docs/docs/fundamentals/flows.md:396`), which is a contradiction for the neighbour.

**E6. The old doc shape is wrong:** `apps/docs/docs/fundamentals/flows.md:231-235, :386-396` shows `onErrored: async (error, ctx) => {}` as a function for the action and request hooks. The types and runtime take a block. The code wins.

**E7. Request-end hooks** (the framework-facing request-end seam) are not a flow author's hook. Left out. `core/src/types/request-end.ts:1-20`.

---

## F. Stored parts (the four questions)

A failed request leaves four things. All belong to the request and sit in the request store beside the session.

| Part | Who owns it | Who can see it | Where stored | How many |
|---|---|---|---|---|
| The request record's outcome: `status: "failed"`, `failedAtMs`, `result.error = { code, message }` (and `result.output` when the action had returned first, A7) | The request, under its session and its user | The caller who owns the request (the retry, status, stream and list routes check `callerReachesRequest` / `principalOwnsRequest`); a caller without access gets the same not-found as a missing id (`rr:77-80`, `ra:526-535`) | The request store (`stores.request`); durable with a persisting store (SQLite, Postgres, filesystem), lost on restart with the in-memory store | One per request; a retry writes a **new** request, the old one stays `failed` |
| The `error` item | The request | Same; it is on the request's stream, and in the record's `items` | The record's `items` (`ra:3281-3286`, `itemsToPersist()`; `engine/test/served-setup-failure.test.ts:247-285` **[test]**: a failed record on a filesystem store keeps the earlier user message and the `error` item) | One per failed request on the normal path (more when a hook adds nothing; **[run]** one) |
| The items emitted before the throw (messages, tool outputs) | The request | Same | The same record's `items` | As many as the run emitted before it failed |
| The failed block's `block_trace` row (`status: "failed"`, `error`) | The request | DevTool and a client that asks for `include=trace`; hidden from the default stream | Trace items on the request | One row per block run; the block that threw has `status: "failed"` |

- A failed request's history is kept like a finished one's. Whether it survives a restart depends on the store. `apps/docs/docs/advanced/durable-execution.md:11, :32-36` **[doc]**.
- `details` and `cause` live on the stream's `error` item and on the trace row, **not** in `result.error` (A8).
- A tool call that failed is replayed to the model on later turns as `Tool "<name>" failed: <message>`. `core/src/models/llm-messages.ts:95-100`. The `error` item itself never enters model history (A2).
- Not verified: whether the next turn's model context includes the earlier messages of a failed turn. **Do not claim it.**

---

## 7. What the page must not state (found while checking)

- That `errorCapture` "fires by default": it is off until set (D1).
- That `blockInstanceId` is the same across retries (D2).
- That input-validation failures do not reach `errorCapture` (D4).
- That `details.cause` carries only name and message (A3).
- That an unknown action is its own unrecoverable job path (C8).
- That `request.onStepErrored` fires (E5).
- That `ConcurrentModificationError`, `NetworkError` and the other typed subclasses can be imported (B, intro).
- The Teammates failure text for a missing key is a fixture, not product text (A10).

## 8. Answer key for the two lookups

**What does the client get when a block throws?**
- On the stream: one `error` item, `status: "failed"`, `message` (the thrown message, verbatim), `code` (`execution_error` for a plain throw, the author's own for a `FlowError`), and `details` only when the thrower set some or the error has a cause (`details.cause`, a serialized chain to five levels, no stack). Then the request's `failed` status event ends the stream. (A2, A3)
- On the request: `status: "failed"` and `result.error = { code, message }`; `result.output` too if the action had already returned and a completion hook threw. The client reads it through `handle.result()` or the session's request list. (A7, A8)
- A tool that throws inside a generator does not fail the request: the model gets `Tool "<name>" failed: <message>`, and the call is a failed `tool_output`. (A11)
- Input the action's schema refuses: the same, with `validation_error`; no block ran. (A5)

**Which errors are retried?**
- Automatically, a block with a `retry` policy retries any thrown value except a `FlowError` with `retryable: false`, a `SuspensionError`, and anything outside `retryableErrors` when that is set; the default is no retries. (C1)
- A tool under `tools.defaults.retry` retries on `retryableErrors` only, never a suspension error; it ignores `retryable`. (C2)
- `generate` and `generateStep` retry each model (`maxAttemptsPerModel`, default 2, with backoff) on 429, 500, 502, 503, network messages or the SDK's own `isRetryable`, and go to the next model at once on a non-retryable or provider-load error. `stream` and `streamStep` try each model once, go to the next on a retryable error and rethrow a non-retryable one. (C3, correction)
- A queued job is retried only when the failed result is not marked `retryable: false`; a plain throw is marked false, so it is not. Default 3 attempts. (C4, C8)
- A person or client can re-run a `failed` or `interrupted` request with the retry route, as a new request. (A9, C5)

## 9. Stored-data summary

See F: four parts, all request-owned, request store, one record per request.

## 10. Items I could not verify (pass 5 should run before the page states them)

1. `SuspensionRejectedError` uncaught in a **non-generator** step: the item's `code` is `execution_error`, retryable false (B8). Only the message is test-pinned.
2. `NoRequestHostError` through an actual failed run: the client's `code` (B7).
3. Tool retry ignoring `FlowError.retryable` (C2), and a root-block retry policy retrying a `SuspensionRejectedError` (C2).
4. The BullMQ claim that a plain throw skips job retries (C4): derived from `isNonRetryable` plus A1, not run against Redis.
5. `blockInstanceId` including the attempt (D2), for a nested leaf.
6. Order of `error` item relative to a leaf's capture event (not tested; the page puts no number on it).

---

## 11. Pass 8 revisions: what the page no longer states

The page keeps lookups (shapes by failure, codes, a retry-mechanism table, the `errorCapture` event) and links the rest. Facts in sections A9, B4, B7, B8, C1 to C4, D1, D9, D12, E and F remain true here but are no longer on the page; each lives on the page named in the page's link: Blocks (R-01, `retry` fields, block `onErrored`), Generators (R-02, tool retry, `onToolErrored`, output validation), Sequencer methods (R-03, rescue timing), Flows and actions (R-05, hooks), Runtime configuration (R-12, `errorCapture` and `onError` options), HTTP API (R-13, retry route), Stores (R-16, stored parts' visibility and persistence), Pause, resume and replay (R-17, suspension errors), Background work (R-19, BullMQ retry, `NoRequestHostError`), Authentication and tenancy (R-20, pre-request refusals), Models (R-21, model retry), React API (`conversationLines`).
- Not on the page now: rows for `network_error`, `model_error`, `tool_execution_error` (no condition a reader can cause or recognise).
- The `error` item has no `retryable` field; the flag is on the `FlowError` that hooks and `errorCapture` receive (A2, B2).
- Block output refusal: the same message with `output validation failed`; `execute` has already run (A4).

Round 2 revisions (all already true in the sections named): the page now says a block retry policy retries any error except a `FlowError` with `retryable: false`, a suspension signal, or a class outside `retryableErrors`, while BullMQ and `errorCapture` read the wrapped error's `retryable: false` (A1, C1, C4); `result` is absent on a failed record only from a server that predates stored results (A8, `client/src/types/index.ts:265-274`); `RECORDED_VALUE_OMITTED` means a recorded output over `maxRecordedValueBytes` (`recorded-value-omitted-error.ts`); `NoRequestHostError` is raised for background work in a process with no runtime host, such as `fsdev run` with no config (B7); the importable classes are a table by import path (B).
