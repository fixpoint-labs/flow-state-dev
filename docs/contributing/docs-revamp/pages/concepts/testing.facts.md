# Facts for Testing (C-20, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec was read.

Paths are from the repo root. Abbreviations:

- `t` = `packages/testing/src`
- `tt` = `packages/testing/test`
- `hc` = `examples/hello-chat/test/flow.test.ts` (the one example that uses it) and `examples/hello-chat/src/flows/hello-chat/flow.ts`
- `old-ov` = `apps/docs/docs/testing/overview.md`
- `old-tf` = `apps/docs/docs/testing/testing-flows.md`
- `old-bca` = `apps/docs/guides/building-a-chat-app.md`
- `old-bm` = `apps/docs/docs/testing/benchmarks.md`
- `blocks.md` = `docs/contributing/docs-revamp/pages/concepts/blocks.md` (the page that fixes the support-desk names this page reuses)

Legend: **[page]** the page states it. **[ref]** belongs on the generated `@flow-state-dev/testing` reference; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[ran]** confirmed by running it against the package source (a throwaway vitest file, deleted afterwards).

## 0. Where the existing pages are wrong (do not copy)

`old-ov`, `old-tf` and `old-bca` state several things the package does not do. Each was checked against the source and by running it. The page uses the code's shape, not theirs.

| Existing pages say | Code does | Evidence |
| --- | --- | --- |
| `generators: { "chat": { output: "Hi" } }` | `generators` is `Record<string, MockGeneratorInstance>`, and an instance is what `mockGenerator({ name, script })` returns. A bare `{ output }` object type-errors and, at runtime, fails the run with `Cannot read properties of undefined (reading 'push')`. [ran] | `t/test-utilities/types.ts:56,160`; `t/mocks/mockGenerator.ts:157-178,434-437` |
| `mockGenerator({ name, output, items })` | `mockGenerator` takes only `name` and `script`. There is no `output` or `items` option. | `t/mocks/mockGenerator.ts:434-437` |
| `result.session.state.messageCount` on a `testFlow` result | `TestFlowResult` has `status`, `requestId`, `output`, `error`, `items`, `suspension`, `answer`, `resume`. No `session`. [ran: keys listed] | `t/test-utilities/types.ts:191-212` |
| `result.session.state.count` on a `testBlock` result | The field is `result.state.session.count`. | `t/test-utilities/types.ts:97-103`; `tt/test-utilities.test.ts:35` |
| `items.ofType("tool_call")` (`old-tf`) | The selector is `byType`. `ofType` does not exist. [ran: `typeof items.ofType === "undefined"`] | `t/test-utilities/testItems.ts:18-24` |
| `testSequencer(...)` (`old-ov`, `old-tf`, package README) | Not exported from the package. `testBlock` takes a sequencer. | `t/index.ts:1-100` (no such export); `tt/test-block-kinds.test.ts:13` |
| An eval with `analyzerScorer({ model: "anthropic/claude-haiku-5-5" })` grades with that model | The `model` string alone calls no provider. Without `modelResolver` on the scorer, the judge runs with `unmockedGeneratorPolicy: "allow"`, which resolves to a no-op model. See 7. | `t/eval/analyzerScorer.ts:46-49,152-157` |

## 1. Opening: what testing a flow is

- A flow is blocks, and each block has typed input and output, so one block can be run alone with `testBlock`, and a whole action can be run with `testFlow`. [page] `t/index.ts:6-7`
- Both run in the same process. Neither starts an HTTP server or opens an SSE connection. `testFlow` calls the engine's `runAction` directly. [page: "no server"] `t/test-utilities/testFlow.ts:11,215`
- Both run against in-memory stores the harness creates for the call. No database is needed. `testFlow` calls `createInMemoryStores()` unless a `stores` option is passed. [page: answers "does a flow test need a database?"] `t/test-utilities/testFlow.ts:185`
- The one thing replaced is the model call. A generator's call to a provider is answered by a scripted stand-in instead. Validation, block execution, lifecycle and state writes run as in production, because `testFlow` runs the engine's own `runAction`. [page] `t/test-utilities/testFlow.ts:202-216`
- An action's input is validated before it runs. An invalid input makes the run finish with `status: "failed"` and `error.message` `Action input validation failed at "message": String must contain at least 1 character(s)`. It does not throw. [ran] [ref: message text] `hc/src/flows/hello-chat/flow.ts:21-23` (schema `message: z.string().min(1)`)
- Installation: `pnpm add -D @flow-state-dev/testing vitest`. [page: one line, or leave to Start] `old-tf:11-13`
- A test needs no API key. `hello-chat`'s tests spy on `fetch` and make it throw, to prove no network request is made, and still pass. [page, optional] `hc/test/flow.test.ts:57-67`

- The page glosses three terms on first use: an action is one of the named calls a flow exposes (`actions: { reply: ... }`, `hc/src/flows/hello-chat/flow.ts:78-95`); an item is what a client receives from a run (section 5, `result.items`); `handleTicket` is a sequencer in `src/flows/support/blocks/handle-ticket.ts` (`blocks.md:22-75`). The page's test files import `handle-ticket` and `clean-message` from there without showing them. "Milliseconds" rests on section 8's 36 ms run of four `testFlow` calls.

## 2. Test one block: `testBlock`

- `testBlock(block, { input, ...seeds })` returns a promise of a result. Types are inferred from the block's schemas: input from `inputSchema`, output from `outputSchema`. [page] `t/test-utilities/testBlock.ts:72-86`
- A handler with no generator needs nothing but `input`. For `cleanMessage` (from `blocks.md:24-35`), `testBlock(cleanMessage, { input: { message: "  hi  " } })` gives `output` `{ text: "hi", truncated: false }` and `error` `null`. [ran] [page: the example] `t/test-utilities/testBlock.ts:145-148`
- `testBlock` does not throw when the block fails. The failure is on `result.error`, and `result.output` is `undefined`. An input the block's schema rejects gives `error.message` `Block "clean-message" input validation failed at "message": Expected string, received number`. [ran] [page: one sentence; the message text is [ref]] `t/test-utilities/testBlock.ts:146-147`; `t/test-utilities/types.ts:94-95`
- The result carries: `output`, `error` (`Error | null`), `items`, `state` (per scope: `request`, `session`, `user`, `org`, `sequencer`), `stateChanges`, `resources`, `meta` (`durationMs`, `blockName`, `retryAttempts`). [ref: the full list] `t/test-utilities/types.ts:93-129`
- A sequencer's result also carries `steps` (one `StepTrace` per step with `blockName`, `input`, `output`, `error`), `sideChainResults` and `loopIterations`. For `handleTicket` the steps came back in the order `handle-ticket`, `clean-message`, `draft-reply`. [ran] [page: one clause] `t/test-utilities/types.ts:87-92,130-132,134-144`
- A router's result names the route it chose in `selectedRoute`. Absent for every other kind. [page or ref] `t/test-utilities/types.ts:125-129`; `tt/test-block-kinds.test.ts:30`
- `resources` holds the block's resource registry after the run, so a test can read rows the block wrote. `{}` when the block declares none. [ref] `t/test-utilities/types.ts:105-119`
- Other `testBlock` options, all [ref]: `flow` (a flow instance, to use its resource configs), `flowConfig` (what the block reads as `ctx.flow.config`, frozen, `{}` when omitted), `request`, `session`, `user`, `org`, `sequencer`, `targets`, `tools`, `generators`, `models`, `unmockedGeneratorPolicy`, `modelResolver`, `unmockedDefault`, `signal`. `t/test-utilities/types.ts:36-69`
- Every `testBlock` run uses the session id `"test-session"`. [ref] `t/test-utilities/testBlock.ts:119`

## 3. Test a flow: `testFlow`

- `testFlow({ flow, action, input, userId, ... })` runs one action of a flow and returns the finished run. `userId` is required. `flow` is a flow instance, the value `defineFlow({...})()` gives (the `hello-chat` example default-exports it as `flow`). [page] `t/test-utilities/types.ts:153-159`; `hc/src/flows/hello-chat/flow.ts:78-95`
- The result is `{ status, requestId, output?, error?, items, suspension?, answer, resume }`. `status` is one of `"completed" | "failed" | "incomplete" | "interrupted" | "aborted" | "suspended"`. [page: `status`, `output`, `items`; rest is ref] `t/test-utilities/types.ts:191-212`
- A run that fails comes back with `status: "failed"` and `error` set. `testFlow` does not throw for it. [ran: missing mock and invalid input both gave `failed` with a message] `t/test-utilities/testFlow.ts:218-231`
- `sessionId` defaults to `"test-session"`. `seed.org` makes the run use an org id `"test-org"`, otherwise the default org. [ref] `t/test-utilities/testFlow.ts:186-188`
- Other `testFlow` options, all [ref]: `generators`, `models`, `unmockedGeneratorPolicy`, `unmockedDefault`, `settings` (what blocks read as `ctx.settings`), `stores`, `durable`. `t/test-utilities/types.ts:160-188`
- A step that waits for a user (`ctx.suspendForUser`) or for `ctx.suspend` ends the run with `status: "suspended"`, because `durable` defaults to `true`. `run.answer(...)` and `run.resume(...)` answer the stop through the engine's own route and return the run that followed. [ref: R-level; page may give one sentence] `t/test-utilities/types.ts:182-188,197-211`; `tt/test-flow-stops.test.ts:49-72`
- `hello-chat` runs `testFlow` with a scripted generator and asserts `result.error` is `undefined`, `result.status` is `"completed"`, and `result.output` is defined. [page: the shape of the assertion] `hc/test/flow.test.ts:69-82`

## 4. Standing in for a generator: `mockGenerator`

- `mockGenerator({ name, script })` returns a scripted stand-in. `name` is the generator block's name, and `script` is a list of steps. [page] `t/mocks/mockGenerator.ts:434-437`
- A step is `{ text }` for a text reply, or `{ structuredOutput }` for a generator that returns an object. A step may also carry `toolCalls` (each `{ toolCallId, toolName, args }`) and `finishReason`. [page: `text` and `structuredOutput`; `toolCalls` and `finishReason` [ref]] `t/mocks/mockGenerator.ts:135-144`
- Steps are used in order, one per call to the generator. A second call gets the second step. Calling more times than there are steps fails with `Mock generator "<name>" has no script entry matching the current call. Plain-step queue is exhausted and no predicate matched. ...`. [page: one sentence; message text [ref]] `t/mocks/mockGenerator.ts:91-100,468-482`; `tt/mock-generator.test.ts:5,125`
- A predicate step `{ when: (input) => boolean, then: step }` answers every call whose input satisfies `when`, and is not used up. [page: one sentence, or ref] `t/mocks/mockGenerator.ts:146-155,466-473`; `tt/mock-generator.test.ts:48`
- The mock records every call on `calls` (the messages sent, the model id, the block name). `.reset()` clears the position and the calls. For `draftReply` the recorded input was `[{ role: "system", content: <prompt> }, { role: "user", content: "where is my order" }]`, so a test can assert on what the model would have been sent. [ran] [page: the idea; shape [ref]] `t/mocks/mockGenerator.ts:157-178`
- A script step with `toolCalls` and no `text` or `structuredOutput` makes the mock run each tool call against the generator's real tools and then take the next step. The loop stops at the first step with `text` or `structuredOutput`, or at `maxSteps` (default 8). A tool call with no registered tool returns `{ ok: true }`. [ref] `t/mocks/mockGenerator.ts:56-74,85-133`
- Mocks are attached by block name through the `generators` option: `generators: { "draft-reply": mock }`. The key is the block's `name`, not the exported variable name (`draftReply` is named `"draft-reply"`). [page] `t/mocks/mockGenerator.ts:249-252`; `blocks.md:43-44`; `hc/test/flow.test.ts:41-54`
- A mock can instead be attached by model id through `models: { "openai/gpt-6-luna": mock }`. A block-name mock wins over a model-id mock. [page: one sentence] `t/mocks/mockGenerator.ts:249-252`; `tt/mock-generator.test.ts:23`; `hc/test/flow.test.ts:49-54` (the example passes both)
- A generator with no mock fails the run, naming it: `No mock for generator "draft-reply" / model "openai/gpt-6-luna". Provide generators["draft-reply"] or models["openai/gpt-6-luna"], or set unmockedGeneratorPolicy to "warn", "allow", or "default".` In `testBlock` the same text lands on `result.error`; in `testFlow`, on `error` with `status: "failed"`. [ran] [page: the guarantee that an unmocked model call never reaches a provider] `t/mocks/mockGenerator.ts:384-389`
- `unmockedGeneratorPolicy` is `"error"` (default), `"warn"`, `"allow"` or `"default"`. `"warn"` logs and answers with a no-op model, `"allow"` answers with a no-op model, `"default"` answers with `unmockedDefault` (a step, or a function of `{ modelId, blockName }`). [ref] `t/mocks/mockGenerator.ts:180-189,247,388-410`; `tt/mock-generator.test.ts:260-310`
- `mockEvaluationModel` scripts an `evaluator` block's model the same way; an evaluator whose `model` is a string is scripted through `createMockModelResolver({ evaluators })`. [ref: one clause or a link] `t/mocks/mockEvaluationModel.ts:1-30`; `t/mocks/mockGenerator.ts:233-238,413-428`
- The mock stands in for the model only. The generator's own work around it (building the prompt, its `inputSchema`, emitting the reply as a message item, schema checks on structured output) runs as it does in production. [page] [ran: with a `{ text }` step, `testFlow` on `hello-chat` returned the user message and the assistant message items] `t/mocks/mockGenerator.ts:256-289`

## 5. Asserting on items and state

What to assert on (cold-read Q2): the stream's items, the stored state, and the block's output. Not the model's wording, which the script fixed.

- `byType(type)` is typed to `OutputItem["type"]`, which excludes `block_trace`; trace rows come only through `blockOutputs(name?)`. [ran: type check] `t/test-utilities/testItems.ts:18-24`. The page shows only `messages()`.
- `result.items` is the list of items the run emitted, which is what a client would have received. For `hello-chat` it came back, in order: the user message, a `block_trace` for each block (`chat-pipeline`, `chat-generator`, `increment-message-count`), the assistant message, and a `state_change` on `session`. [ran] [page: an example list is fine] `hc/src/flows/hello-chat/flow.ts:71-73`
- `testItems(result.items)` returns selectors, each a list in item order: `all()`, `byType(type)`, `messages()`, `errors()`, `blockOutputs(blockName?)` (the `block_trace` items, filtered by block name), `components(name?)`, `sideChain()`, `main()`, `byAgent(name)`, `byVisibility({ client?, history? })`. [page: `messages`, `byType`, `blockOutputs`; rest [ref]] `t/test-utilities/testItems.ts:11-79`
- A user message item is `role: "user"` with `content: [{ type: "output_text", text }]`, and the assistant's is `role: "assistant"` the same way. For input `"hello"` and a script step `{ text: "Hi there" }` the two messages were `[ "user", "hello" ]` and `[ "assistant", "Hi there" ]`. [ran] [page] `t/test-utilities/testItems.ts:25-29`
- Side-chain items are separated from the main run by `sideChain()` and `main()`. [ref] `t/test-utilities/testItems.ts:63-68`
- `snapshotTrace({ items, requestId, actionName })` returns `{ requestId, flowKind, actionName, steps, items }`, a stable summary for snapshot tests. [ref] `t/snapshot/snapshotTrace.ts:4-24,47-60`
- State, in a block test: `result.state.session`, `.user`, `.org`, `.request`, `.sequencer` hold each scope's state after the run. For `hello-chat`'s counter, started at `session: { state: { messageCount: 5 } }`, the `stateChanges` entry was `scope: "session"`, `operation: "patchState"`, `resultingState.messageCount` `6`. [page] `t/test-utilities/types.ts:97-104`; `hc/test/flow.test.ts:98-114`; `tt/test-utilities.test.ts:28-37` (`result.state.session.count` is `3` after `incState` of 2 on a seed of 1)
- `stateChanges` entries have `scope` (`"request" | "session" | "user" | "org" | "block_instance"`), `operation` (`patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`), `args`, `resultingState`. [ref] `t/test-utilities/types.ts:71-85`
- State, in a flow test: the result does not carry it. Read it from the stores. Pass a `stores` registry made with `createInMemoryStores()` (from `@flow-state-dev/engine/host`) and read it afterwards with `stores.session.get(sessionId)`. For `hello-chat` seeded with `messageCount: 3` and run once, `(await stores.session.get("test-session"))?.state` was `{ messageCount: 4 }`. [ran] [page: the one pattern for state after a flow test] `t/test-utilities/testFlow.ts:174-181`; `tt/test-utilities.test.ts:188-239` (the same read, `stores.session.get(sessionId)` at 237-238); `packages/engine/package.json:35`
- Passing the same `stores` to several `testFlow` calls shares session, user, org and request state across them. The second call sees the first call's writes, because seeding does not overwrite an existing record. This is how a test spans two turns of one session. [page] `t/test-utilities/types.ts:174-181`; `tt/test-utilities.test.ts:188-239` (a counter returns total 1, then total 3)
- Without `stores`, each call gets fresh in-memory stores, so tests do not share state. [page: answers isolation] `t/test-utilities/testFlow.ts:185`

## 6. Seed state

- `seed` on `testFlow`: `{ request?: { state }, session?: { state, resources }, user?: { state, resources }, org?: { state, resources } }`. It sets the starting state of each scope and the starting rows of its resources. [page] `t/test-utilities/types.ts:12-26,159`
- `testBlock` takes the same scopes as top-level options (`session: { state }`, `user`, `org`, `request`), not under `seed`. [page: one sentence, the names differ] `t/test-utilities/types.ts:49-52`
- Seeding is not an overwrite. When a record already exists for that session, user or org (for example through a shared `stores`), the seed is skipped for it. [ref] `t/test-utilities/testFlow.ts:58-60,119-137` (`existing === undefined` guards)
- `hello-chat` seeds `session: { state: { messageCount: 5 } }` and asserts the counter writes 6. [page: the example] `hc/test/flow.test.ts:98-114`
- The state seeded must fit the flow's own state schema in the usual way; seeds go in as-is. [verify: keep off the page]
- Stored data: nothing the harness stores outlives the test. Four questions for the parts a test touches. [page: one sentence]
  - Session, user, org, request state and resource rows: owned by the test, visible to the test through `stores` (flow tests) or `result.state` (block tests), stored in memory in the test process, one set per `testFlow` or `testBlock` call, or one shared set when the same `stores` is passed. `t/test-utilities/testFlow.ts:185`; `t/test-utilities/types.ts:174-181`
  - Scripted mocks (`mockGenerator`): owned by the test, hold their position and `calls` for the life of the object, so build a new one per test or call `.reset()`. [page: one sentence, a real trap] `t/mocks/mockGenerator.ts:464-488`; `tt/mock-generator.test.ts:5-22`. Example: `hc/test/flow.test.ts:40-47` builds a fresh fixture in each test.

## 7. Checking the model's work: evals

The split (cold-read Q3): a test checks that your code does what you wrote, against a scripted model, so it gives the same answer every time. An eval measures how good the model's output is, across a set of cases, with real model calls.

- "Unit tests tell you if your code is correct. Evals tell you if your AI is any good." [page: the sentence is on the existing page; paraphrase] `old-ov:157`
- `evalBlock(block, { dataset, scorers, concurrency?, blockOptions?, signal? })` and `evalFlow(flow, { action, dataset, scorers, concurrency?, userId?, flowOptions?, signal? })` run each case and score it. `concurrency` defaults to 1. `evalFlow`'s `userId` defaults to `"eval-user"`. [page] `t/eval/types.ts:42-60`; `t/eval/evalBlock.ts:12-18`; `t/eval/evalFlow.ts:14-26`
- A case is `{ id?, input, expected?, metadata? }`. An unnamed case is `case-<index>`. [ref] `t/eval/types.ts:31-36`; `t/eval/evalBlock.ts:26`
- Both run each case through `testBlock` / `testFlow`. So with no mocks and no resolver supplied, an eval case that reaches a generator fails with the missing-mock error, like any test. [page] `t/eval/evalBlock.ts:32-35`; `t/eval/evalFlow.ts:36-43`
- To have an eval call a real model, pass `blockOptions: { modelResolver }` to `evalBlock`. A `modelResolver` overrides the mocks (mock options passed with it are ignored, with a console warning). [page] `t/eval/types.ts:46`; `t/test-utilities/types.ts:59-60`; `t/runtime/createTestContext.ts:503-521`
- `evalFlow` takes no `modelResolver`: its `flowOptions` is `TestFlowOptions` minus `flow`, `action`, `input`, `userId`, and `TestFlowOptions` has no `modelResolver`. A flow eval can only run on mocks (`generators`, `models`, `unmockedDefault`). [ran: not run; read from types and `testFlow.ts:202-209`, which builds only the mock resolver] [page: state the limit in one sentence, or keep off and link; flag to caller] `t/eval/types.ts:56-59`; `t/test-utilities/types.ts:153-189`; `t/test-utilities/testFlow.ts:202-209`
- A case whose block or flow returns an error is a failed case with `error: { message, name }` and no scores. `report.passed` is true only when every case passed every scorer. [ref] `t/eval/evalBlock.ts:44-57`; `t/eval/evalFlow.ts:43-56`; `t/eval/types.ts:66-90`
- The report: `{ passed, results: EvalCaseResult[], summary, timing: { totalMs, meanPerCaseMs } }`. `summary` is keyed by scorer name, each `{ mean, min, max, stddev, passRate }`. It is JSON-serialisable. [page: `passed` and `summary`; rest [ref]] `t/eval/types.ts:77-90`; `t/eval/report.ts:9-40`; `tt/eval-block.test.ts:116`
- Eight code scorers: `exactMatch(field?)`, `schemaValid(schema)`, `contains(substring)` (case-insensitive), `jsonPath(path, expected)`, `threshold(field, min, max?)`, `custom(name, fn)`, and the composites `allOf(...)` and `anyOf(...)`. [ref: the page may name two] `t/eval/scorers.ts:45,67,92,111,132,164,175,200`
- `analyzerScorer({ criteria, model?, scoreMapping?, name?, threshold?, modelResolver? })` grades with a model against criteria you write. Each criterion is scored 0 to 1; `scoreMapping` is `"mean"` (default), `"min"` or `{ strategy: "weighted", weights }`; `threshold` defaults to `0.5`. Variants: `.relevance()`, `.factuality()`, `.coherence()`, `.safety()`. [page: what it is; options [ref]] `t/eval/analyzerScorer.ts:38-51,57-62,126-130,172-183` (variants at 69 onward)
- `analyzerScorer` calls a model only when given a `modelResolver`. With none, the judge runs on `unmockedGeneratorPolicy: "allow"`, a no-op model, so nothing real grades the output. [page: one sentence, a real trap; contradicts the existing pages] `t/eval/analyzerScorer.ts:46-49,152-157`
- `loadDataset(path, { schema?, transform? })` reads a JSON array of `{ input, expected?, id? }`; `fromCsv(path, { input, expected?, id? })` maps CSV rows to cases. [ref] `t/eval/types.ts:96-105`; `old-tf:257-286`
- Evals can also run on mocks, for a deterministic run in CI, by passing `blockOptions.generators` or `flowOptions.generators`. Then they test the scoring and the dataset rather than the model. [ref] `old-tf:241-255`; `t/eval/types.ts:46,56`
- A benchmark compares whole coordination patterns against each other and a single-generator baseline, on one model and the same tasks. An eval scores one block or flow. [page: one sentence, link to the benchmarks page (B-33)] `old-bm:7-13`; `packages/testing/README.md:177-179`. The benchmark harness is on the `@flow-state-dev/testing/benchmark` subpath. `t/index.ts` (closing comment); `packages/testing/package.json:34-37`

## 8. What it gets you (observable, tied to the page's example)

Each is something the reader can see, from facts above.

- A run that never leaves the process, so a test of `handleTicket` takes milliseconds and needs no key. [ran: whole probe file, four `testFlow` calls, finished in 36 ms; the page says "milliseconds", no tighter figure] `t/test-utilities/testFlow.ts:11,185,215`
- The same answer each run, because the stand-in returns the scripted step. [page] `t/mocks/mockGenerator.ts:434-488`
- A model call you did not mock fails the test naming the block, so a test cannot reach a provider by accident. [page] `t/mocks/mockGenerator.ts:384-389` [ran]
- The run is the real one: input validation, block order, state writes, items emitted. A flow that passes `testFlow` did those through the engine's own `runAction`. [page; avoid "if it passes in tests it behaves the same in production", which `old-ov:269` claims and which is wider than what is checked] `t/test-utilities/testFlow.ts:211-216`
- Isolation: a fresh set of in-memory stores per call, unless `stores` is shared. [page] `t/test-utilities/testFlow.ts:185`

## 9. What is real, and what is faked (figure "What is real in a test")

For the figure: the blocks of `handleTicket` (`clean-message`, then `draft-reply` with `lookUpOrder` as its tool, as in `blocks.md`), with only the model stood in for.

- Faked: the model call of `draft-reply` (the `generators["draft-reply"]` mock). `t/mocks/mockGenerator.ts:249-289`
- Real: `clean-message`'s code and schemas; `handle-ticket`'s sequencing; input and output validation; state writes; emitted items; the engine run. `t/test-utilities/testFlow.ts:211-216`; `t/test-utilities/testBlock.ts:136-140`
- Tools a model calls: a tool call in a script step runs the generator's real tool block unless the test replaces it with the `tools` option of `testBlock`, which takes functions keyed by tool name. [verify: the `tools` option's matching rule was not exercised; keep to "a script step's `toolCalls` run the generator's registered tools"] `t/test-utilities/types.ts:55`; `t/mocks/mockGenerator.ts:104-116`
- Not faked and not present: a database (stores are in memory), an HTTP server, SSE, the network. `t/test-utilities/testFlow.ts:185,215`
- The stores are the in-memory ones, so what a persistent store (SQLite, Postgres) does with a crash or a restart is not tested. [page: one sentence of limit, flat] `t/test-utilities/testFlow.ts:185`; `t/test-utilities/types.ts:182-188` (`durable` defaults to true: the run is durable on in-memory stores)

## 10. How it fits with the others

- The block kinds the page leans on are on Blocks (C-02): `handler`, `generator`, `sequencer`. Link, do not explain. `blocks.md:22-70`
- A flow, its actions and its state are Flows and actions and State and scopes. The page uses `defineFlow({ kind: "support", actions: { reply: { block: handleTicket } } })` from `blocks.md:75`. Link.
- The in-process, no-transport call of a flow outside tests is on `apps/docs/docs/advanced/manual-flow-execution.md`. `old-ov:272`. [ref link]
- Benchmarks: B-33 (`old-bm`). Link.
- Every harness option lists on the generated `@flow-state-dev/testing` reference. Link.
- An eval is not a test: it scores quality across many cases and may call a real model; it does not replace the scripted test. [page]

## 11. Names for the page's example

Names fixed elsewhere that the page reuses (so the page adds no second scenario): `cleanMessage` (`clean-message`, handler, `{ message } -> { text, truncated }`), `draftReply` (`draft-reply`, generator, model `openai/gpt-6-luna`, string in), `handleTicket` (`handle-ticket`, sequencer, `{ message }` in), `lookUpOrder` (a handler the model calls as a tool), `summarizeTicket` (a side chain). Files under `src/flows/support/blocks/`. Flow `kind: "support"`, action `reply`. `blocks.md:22-75`. `blocks.md` and `background-work.md` disagree on whether `draftReply` is stepped as `.step((cleaned) => cleaned.text, draftReply)` (`blocks.md:66`) or `.step(draftReply)` (`background-work.md:57-58`); a test page must follow whichever the final C-02 keeps. [flag to caller]

A flow test for the example would need a flow instance. `defineFlow({ kind: "support", requireUser: true, actions: { reply: { block: handleTicket } } })()` is the shape `hc/src/flows/hello-chat/flow.ts:78-95` and `tt/test-utilities.test.ts:69-81` use. Whether `requireUser` is shown is the writer's call; `testFlow` takes `userId` regardless. [verify: `kind`, `actions`, `requireUser` from those two files; the `support` flow file itself does not exist in the repo]

## 12. Examples the page can show (each [ran] against the package source)

1. Test a flow. `testFlow({ flow, action: "reply", userId, input: { message }, generators: { "draft-reply": mockGenerator(...) } })`, then `expect(result.status).toBe("completed")` and `expect(result.output).toBe(...)`. Shape from `hc/test/flow.test.ts:69-82`; output of a text-generating action was the step's `text` (`"Hi there"`). [ran]
2. Test one block. `testBlock(cleanMessage, { input })` and `expect(result.output)`; `result.error` is `null`. [ran] `t/test-utilities/testBlock.ts:145-148`
3. A generator stand-in. `mockGenerator({ name: "draft-reply", script: [{ text: "Your order shipped." }] })`, passed as `generators: { "draft-reply": mock }`. With `handleTicket` as the block under test, `result.output` was `"Your order shipped."`. [ran] `t/mocks/mockGenerator.ts:434-437`
4. Seed state. `seed: { session: { state: { ... } } }` on `testFlow`, or `session: { state }` on `testBlock`. `hc/test/flow.test.ts:98-114`; `t/test-utilities/types.ts:21-26`
5. Read state after a flow run through `stores.session.get("test-session")`. The page seeds `session: { state: { ticketCount: 5 } }` on a flow whose `count` action runs `countTicket`, and the stored session state came back `{ ticketCount: 6 }`. [ran] `tt/test-utilities.test.ts:237-238`
6. Items: `testItems(result.items).messages()`. [ran]

All of these import from `@flow-state-dev/testing` (`testFlow`, `testBlock`, `testItems`, `mockGenerator`, `evalBlock`, scorers) and `createInMemoryStores` from `@flow-state-dev/engine/host`. `t/index.ts:5-62`; `packages/engine/package.json:35`.

## 13. Answer key for the four reader questions

1. How do you test `handleTicket` without calling a provider? Give `testBlock` or `testFlow` a `mockGenerator` for `draft-reply`, passed in `generators` under the block's name. Without it the run fails naming the block. (4, 2, 3)
2. What do you assert on? The run's `output`, its `items` (through `testItems`) and its state, not the model's wording, which the script fixed. State is `result.state.<scope>` in a block test, and `stores.session.get(id)` after a flow test, since `testFlow` returns no state. (5)
3. Reply quality did not drop: test or eval? An eval. A scripted test cannot see quality, because the model's answer is scripted. An eval runs cases through a real model (`blockOptions.modelResolver` on `evalBlock`) and scores them. (7)
4. Does a flow test need a database? No. It runs on in-memory stores the harness creates, in the same process, with no server. (1, 3)

## 14. Contradictions and gaps to hand back

- Three existing pages (`old-ov`, `old-tf`, `old-bca`) show APIs that do not exist (section 0). `old-bca:253-298` is a guide shared with B-01 ("the tests step"); it needs the same correction there, or this page and B-01 will disagree. [flag to caller]
- `packages/testing/README.md:13,26-27,101,119` lists `testSequencer` and `testRouter`, which `t/index.ts` does not export. [flag: README correction]
- `old-ov:269` ("If it passes in tests, it'll behave the same way in production") claims more than the harness checks (in-memory stores, mocked model). The page does not repeat it. See 9.
- `evalFlow` cannot take a real model resolver (section 7). If the page's job needs "check a flow's reply quality with a real model", the code does not allow it through `evalFlow`; the page can say an eval of a model call runs through `evalBlock`. [flag to caller]
- No `support` flow exists in the repo, so the page's example flow cannot be copied from a running file; its flow code is shaped after `hello-chat` and `tt/test-utilities.test.ts`. Examples need a type-check at pass 4 against a declaration or a scratch flow.
