# Facts for Blocks (C-02, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`
- `hc` = `examples/hello-chat/src/flows/hello-chat/flow.ts`
- `old` = `apps/docs/docs/fundamentals/blocks.md`
- `dur` = `apps/docs/docs/advanced/durable-execution.md`
- `memo` = `apps/docs/docs/advanced/block-memoization-and-replay.md`
- `items` = `apps/docs/docs/streaming/items.md`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/blocks` or `reference/durable-execution`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften.

## 1. What a block is (opening, model figure)

- A block is a named piece of work with a typed input and a typed output. A `BlockDefinition` has `kind`, `name`, optional `description`, `inputSchema`, `outputSchema`. [page] `core/types/block.ts:1211-1216`
- `inputSchema` and `outputSchema` are Zod schemas; when omitted they default to `z.any()`. [page, one clause] `core/blocks/internal/build-block.ts:210-211`
- A block cannot be handed a value its `inputSchema` rejects, and cannot return one its `outputSchema` rejects. Input is validated before `execute` runs, output after. A failure throws `Block "<name>" input validation failed at "<path>": <message>` (or `output`). [page: the guarantee; the message text is [ref]] `core/blocks/internal/build-block.ts:152-170` (message), `:356` (input check), `:358-364` (output check)
- A sequencer's output type is its last step's output type; the sequencer itself does not validate against it unless the author declares one. [ref] `core/blocks/internal/build-block.ts:171-185`; `old:823` (declaring a sequencer `outputSchema`)
- Blocks hold other blocks: sequencers and routers compose other blocks. `core/types/block.ts:38-42`
- Five kinds, exactly: `"handler" | "generator" | "evaluator" | "sequencer" | "router"`. `core/types/block.ts:43`
- Doc comment on the kinds: `handler` runs code, `generator` asks a model to write, `evaluator` asks an evaluation model typed questions, `sequencer` and `router` compose other blocks. `core/types/block.ts:38-42`
- A flow's `actions` expose blocks to a client. `defineFlow({ kind, actions: { chat: { block: chatPipeline, ... } } })`. A sequencer is accepted as the action's block. `hc:78-91`
- A block is run by the framework (as an action, a step, a route, or a tool). The public `BlockDefinition` type has no `run`; `run` exists only on the runtime view. So `block.run(input, ctx)` from user code is a type error. [page, one sentence; "what it won't do" goes to ref] `core/types/block.ts:1195-1204` (doc comment), `:1376-1390` (`BlockRuntime.run`)

## 2. The smallest working example

Handler

- `handler({ name, inputSchema, outputSchema, execute })`; `execute(input, ctx)` returns the output (sync or async). `core/blocks/handler.ts:107-121`, `core/types/block.ts:1076`; used in `hc:58-66`
- `outputSchema` may be omitted on a handler that returns nothing (`hc:58-66`, no `outputSchema`). Use `outputSchema` when the next step reads the value.
- A handler shows the user nothing unless it emits through `ctx.emit` (message, component, status). [ref: reference/items, visibility defaults; the page does not name `ctx`] `core/types/block.ts:466` (`emit`), `:130` (`EmitMessageOptions`)
- For "call my own API mid-flow": the `execute` body of a handler is arbitrary async code. `core/types/block.ts:1076`. Handler is the kind for non-model work (validate, transform, update state, tool logic). `old:17`

Generator

- `generator({ name, model, prompt, inputSchema, user, itemVisibility, tools })`. `prompt` is required; `model` is required unless a capability supplies one. `core/blocks/generator.ts:599` (`model`), `:608-614` (`prompt`, `user`, `tools`), `:585` (`itemVisibility`)
- `user` is a function of the input (or a static string); it becomes the user message. `core/blocks/generator.ts:612`; `hc:42-52`
- With `outputSchema` omitted the generator returns a string (`z.string()`), and the reply streams token by token. `core/blocks/generator.ts:2865`; `hc:35-38`
- A generator asks a model to write: text, tool calls, or a typed object. `old:7`
- `itemVisibility: { client: true, history: true }` is the user-facing agent: items stream to the client and are kept in conversation history. `{ client: true, history: false }` is observable work. `{ client: false, history: true }` is private context. `{ client: false, history: false }` is trace only. `core/blocks/generator.ts:570-583`
- With `itemVisibility` unset a generator emits no items: the model still runs, nothing reaches the client. There is no inferred default. [ref: reference/items; the page says only what `client: true` and `history: true` do for `draftReply` and links] `core/blocks/generator.ts:570-583`, `:1271-1275`
- `history: true` loads prior conversation from persisted request items. `hc:42-52`
- An item is one thing a flow streams to the client (a message, a tool call). `items:55`; `core/types/block.ts:130`
- Model id convention for examples: `openai/gpt-6-luna`. `hc:17`

Sequencer

- `sequencer({ name, inputSchema })` returns a builder; `.step(block)` appends a block whose output becomes the next step's input. `core/blocks/sequencer.ts:2576-2585`; `core/blocks/sequencer-methods.ts:163-166`; `hc:71-73`
- `.step(connector, block)`: a function over the previous output reshapes it into the block's input. `core/blocks/sequencer-methods.ts:177-181`
- A sequencer is itself a block (`SequencerDefinition extends BlockDefinition`), so it can be a flow action, a step in another sequencer, or a tool. `core/blocks/sequencer-methods.ts:155-161`; `hc:82-83`
- `.tap(block)` runs a block for its side effect and keeps the previous output as the pipeline's output. `core/blocks/sequencer-methods.ts:328`; `hc:68-73` (comment). [ref; Composition page]
- `.parallel`, `.forEach`, `.stepIf`, `.sideChain`, rescue: [ref]; Composition page. `core/blocks/sequencer-methods.ts:196-` (`stepIf`)

## 3. The five kinds, by who decides

Axis for the figure (the page's claim): who decides what happens next. Each row below states the kind's decision-maker.

| Kind | Who decides | What it does | Fact |
| --- | --- | --- | --- |
| handler | your code | runs your code, returns the typed output | `core/types/block.ts:38-42`, `core/blocks/handler.ts:107-121` |
| sequencer | your code | runs steps in the order you wrote | `core/blocks/sequencer-methods.ts:156-181` |
| router | your code | `execute` returns which listed route to run | `core/blocks/router.ts:132-141` |
| evaluator | the model answers, your code acts | asks a typed question, gets a typed answer back | `core/blocks/evaluator.ts:1-8` |
| generator | the model | writes text, calls tools, or returns a typed object | `core/types/block.ts:38-42` |

- Router: `router({ name, inputSchema, outputSchema, routes, execute })`; `execute` returns one of `routes` (sync or async). `core/blocks/router.ts:132-141`
- Router routes all share the router's input and output types, so the router can be one step in a sequencer. `core/blocks/router.ts:132` (`routes: BlockDefinition<TInputSchema, TOutputSchema>[]`); `old:703`
- Evaluator: "A generator asks a model to write. An evaluator asks questions whose possible answers the author already knows (which option, where on a scale, yes or no) and returns `{ answers }` typed by the questions." `core/blocks/evaluator.ts:1-8`
- Question builders: `choice(instructions, options)` answers with one of the option keys, `score(instructions, levels)` answers with a position on an ordered scale, `boolean(instructions)` answers with a probability that the answer is yes. `core/blocks/evaluator.ts:72-105`
- An evaluator answers and stops. It does not retry, fall back, or decide what to do with the answer; branching is a router or a step that reads the answer. [ref/Generators and tools] `old:383`
- Evaluators and handlers are silent: what an evaluator asked and got back appears in the DevTool trace, not to the user. `old:383`

Routing the first question: calling your own API mid-flow is a **handler** (kind runs your code; `execute` is async). Model: Q1 answer is "a handler".

## 4. Blocks inside blocks

- A sequencer or router contains other blocks and does no model or API work of its own. `core/types/block.ts:38-42`
- Nesting: a sequencer can be a step in a sequencer; a router can route to sequencers; a sequencer can contain routers. `old:694-703`
- A nested block's own declared resources bubble up: a composite's `declaredResources` includes every descendant's; `ownDeclaredResources` is the block's own. `core/types/block.ts:1218-1230`
- Block names must be non-empty (`Cannot build "<kind>" block without a non-empty "name"`). `core/blocks/internal/build-block.ts:204-206`
- Names are unique within a flow, for provenance and debugging. `old:824` [ref]
- When a nested block runs it can read its parent's name and kind (`ctx.parent`). [ref] `old:617-635`

## 5. Giving a block to a model

- A generator's `tools` accepts blocks of any kind: `type GeneratorTool = BlockDefinition<any, any>`. `core/blocks/generator.ts:422`; `tools` slot at `:613`
- `tools` may be a static array or a function of `(input, ctx)` returning blocks. `core/blocks/generator.ts:613`, `:425` (`ToolsSlot`)
- What the model is given for each tool: the block's `name`, its `description`, and its `inputSchema` as the parameters. `core/blocks/generator.ts:922-932` (`compileToolsForModel`), `:946-952` (`compileToolsWithExecute`)
- So a **sequencer as a tool shows the model a name, a description and an input shape**, the same as a handler does; it does not show the steps. The sequencer's `name`, `description` and `inputSchema` are the ones it was built with. `core/blocks/sequencer.ts:1233-1240` (config passes `name`, `description`, `inputSchema`); test: `packages/core/test/flow-config.test.ts:766-790` (a `sequencer({ name, description, inputSchema }).step(...)` listed in `tools`)
- The output is what the sequencer returns (its last step), and that goes back to the model as the tool result. `old:152`
- A block with a `description` is listed to the model in the generator's context as `- <name>: <description>`, on by default (`describeTools`). `core/blocks/generator.ts:647-648` (`describeTools`, default true), `:967-983` (`buildToolDescriptionContext`), `:3088`, `:3126-3131`
- A tool's name is sanitized to the alias the model calls (a name with `/` or `.` becomes `_`). [ref] `core/blocks/generator.ts:967-983` (comment)
- Give a block a different name or description for the model without changing it: `block.as({ name, description })`. [ref] `core/types/block.ts:1315-1342`
- A tool can call `ctx.suspend()` to pause for a person. [ref/Human in the loop] `old:154`
- A tool's output is recorded and, for a tool, becomes part of the model's history; return ids and counts, not bulk data. [ref] `old:826`
- `retry` is a block option. [ref] `core/types/block.ts:1081`

## 6. What a block gets you

Stored parts, four questions. A block itself holds no data between runs. What a run leaves behind about blocks:

| Stored part | Owner | Who sees it | Where | How many |
| --- | --- | --- | --- | --- |
| A block's recorded output and input (a `block_trace` item) | The request (one run of an action) | The developer, in the DevTool. The default client filter strips trace items; a client sees them only if it asks (`includeTrace`) | The request's durable item log | One row per execution of a block |
| A sequencer checkpoint (its state at each step boundary) | The request | Not shown to the user; read by the engine on resume | The `checkpoints` store of the app's stores | One record per durable sequencer, overwritten at each step; swept after the run |

Sources: `items:55-59` (one row per block execution; trace items flow only on the trace channel, stripped by the default client filter); `packages/client/src/client.ts:276-278` (`includeTrace`); `memo:7` (recorded in the durable item log); `dur:9`, `dur:28` (checkpoints, `checkpoints`, `suspensions`, `leases` stores); `core/blocks/sequencer.ts:274-282` (a durable sequencer overwrites the prior record). The checkpoint-store contents are [ref].

Facts for each claim "What it gets you":

**A finished block is a checkpoint (Q2).**
- Durable execution is on by default wherever stores persist: filesystem, SQLite and Postgres. Not on for in-memory stores. `dur:11`, `dur:32-36` (table)
- The runtime checkpoints sequencer state at every step boundary. `dur:9`
- A finished block's recorded output is reused: on a continuation, the runtime injects the recorded output of every block that has a `completed` `block_trace` and skips its `execute`. `memo:7-13`
- A run that died (process killed) is listed as `interrupted`. The user, or a DevTool operator, continues it; it keeps the same request id, and it does not start over. `goals/continue-interrupted-run/after-a-restart/goal.md:3-6` (Outcome, Signal b); `dur:169` (`interrupted → in_progress → terminal`)
- Continuing replays finished work: in the goal, an early handler and a finished background block each ran exactly once across two continues; one `continuation` item (trigger `recovery`) was recorded; the same request id reached `completed`. `goals/continue-interrupted-run/continues-not-restarts/goal.md:5-6` (Outcome, Signal)
- So for the page's Q2 ("A run dies after `cleanMessage`. On a store that persists, what runs again?"): on continue, `cleanMessage` is replayed from its recorded output, not run again; `draftReply` runs, because it has no recorded output. [page] The page says the run picks up at `draftReply` when you continue it, and links the blocks reference for how. It does not name the interrupted status or the request id, and never says a dead run resumes by itself. Continuing: the run is picked up when it is continued (a listed Continue action, the DevTool's per-run Continue), not instantly on restart. `goals/continue-interrupted-run/after-a-restart/goal.md:6`; `goals/continue-interrupted-run/after-a-restart/goal.md:19` (stale threshold: swept to `interrupted` about a minute after the restart with defaults)
- The block that was running at the crash has no recorded output and runs again; a side effect in it that is not captured in its output can fire twice. `memo:9-11`; `ctx.runOnce(key, fn)` guards it. `dur:211`; `core/types/block.ts:579`. [ref]
- Retries, replay rules, lease, sweeper, retention: [ref] `dur:283-354`.
- Opt out per sequencer with `durable: false`, or for the app with `durable: false` on `createFlowState`. [ref] `dur:11`

**A block can wait.**
- A block pauses a request with `ctx.suspend()`; the pause is held across a restart and the request continues on the same id once answered. [page: stated only as holding on a store that persists; `ctx` is not named] `dur:9`, `dur:28`, `dur:169`
- `ctx.suspend()` throws on a host without durable execution (in-memory stores by default). [ref: not on the page] `dur:42`
- Resolution actions (`approve`, `reject`, `submit`, `skip`), expiry: [ref]. `dur:145-165`, `:251-254`

**Every block is traced.**
- Each block execution is captured as a `block_trace` item: block name, kind, input, output, status, timing; a generator's trace carries model and prompt. `items:57-110`
- The row appears when the block starts (status `in_progress`) and is patched in place; when a block fails, `block_trace.error` is `{ message, code?, details? }`. `items:59-112`
- The DevTool trace view shows the execution tree and live status of running blocks. `apps/docs/docs/devtool/overview.md:130-136`
- No logging code is required of the block. [page: inferred from the above; no test asserts "no logging"]

**A block moves.**
- A block declares its own input and output and its own resources and state; it knows nothing of the flow around it. `core/types/block.ts:1211-1230`; `old:796-800`
- Including a block in a flow installs the resources it declares: a block's `resources` map bubbles up through sequencers and routers and `defineFlow` merges it into the flow. `core/flow/defineFlow.ts:3-8`, `:1233-1290`; `core/types/block.ts:1218-1230`; `core/blocks/handler.ts:100-105` (`resources` option)
- The same block can be an action, a step, a route and a tool; the framework runs it each time. `old:822`
- A resource is stored data a flow keeps. [page, one clause; Resources page covers it]

## 7. Limits (go to reference/blocks, not the page)

Reference homes: the first two limits are R-01 rows ("how a block is invoked" and the handler limits, in the handler options table). The visibility default (section 2) is an R-06 row. The page's "How it fits with the others" keeps one sentence (a block is run by the framework, never called) and links to `reference/blocks`.

- A block cannot be called as a function from user code (`BlockDefinition` omits `run`). `core/types/block.ts:1195-1204`
- A handler's `execute` cannot call another block; a handler that needs another block's output goes after that block in a sequencer. Enforced by the type above. `core/types/block.ts:1195-1204`
- Generator `model` missing on both the block and its capabilities is a runtime error at construction. `core/blocks/generator.ts:595-597`
- `name` must be non-empty; `execute` is required (handler, router). `core/blocks/internal/build-block.ts:204-209`
- A router's chosen block must be one of `routes`. `core/blocks/router.ts:137-141` (`validateRoute` hook), `:132`
- A refused input or output throws and fails the block. `core/blocks/internal/build-block.ts:152-170`

## 8. Contract between blocks (Q4)

- What a block declares so the next block can trust what it gets: `outputSchema` on the producer and `inputSchema` on the consumer. `.step(a).step(b)` types `b`'s input as `z.infer` of `a`'s `outputSchema`; a mismatch is a TypeScript error unless a connector reshapes it. `core/blocks/sequencer-methods.ts:163-181` (overloads: `step(block)` infers the next `TOutput` from `TOutSchema`; `step(connector, block)` takes `ConnectorFn<TOutput, TStepIn>`)
- And at run time each side is checked: output by the producer's `outputSchema`, input by the consumer's `inputSchema`. `core/blocks/internal/build-block.ts:356-364`
- A schema left off is `z.any()`: nothing is checked and the type is `any`. `core/blocks/internal/build-block.ts:210-211`
- Type helpers that read these schemas: [ref/type-helpers]. `apps/docs/docs/fundamentals/type-system.md`

## 9. The page's example (one scenario)

One scenario: a support desk answers "Where is my refund?". Names, as the code layout wants them (`user-docs.md` Code examples):

- `src/flows/support/blocks/clean-message.ts` exports `cleanMessage` (handler), `blocks/draft-reply.ts` exports `draftReply` (generator), `blocks/handle-ticket.ts` exports `handleTicket` (sequencer), `tools/look-up-order.ts` exports `lookUpOrder` (handler used as a tool). The existing draft at `docs/contributing/docs-revamp/pages/blocks.md` already uses these and type-checks per its brief.
- New examples this plan asks for beyond the draft: a handler that calls the user's own API (extend `lookUpOrder` or add `fetchOrder` with `fetch`); `fetch` inside `execute` is plain TypeScript. No test needed; `execute` is any async function. `core/types/block.ts:1076`.

## Not verified, so not on the page

- A test that runs a **sequencer as a generator tool** end to end. `packages/core/test/flow-config.test.ts:766-790` builds one and lists it in `tools`, and `old:124-152` says the framework runs the pipeline and returns the output as the tool result. No test in `packages/core/test` or `packages/engine/test` calls such a tool and asserts the result. The statement "the model sees name, description and input schema" is confirmed in `compileTools*`; "runs the whole pipeline behind the call" rests on `old:152` and `GeneratorTool = BlockDefinition<any, any>`.
- "Crash then restart continues by itself": not confirmed. The goal's flow has a manual Continue (client `continue()`, DevTool). Only specific cases are driven on by the sweeper (a gate already resolved; a wait that died before it parked), `dur:352-353`. The page should say "continue", not "resumes on its own".
- That `description` on a handler is shown to the model: confirmed in `compileTools*` (`core/blocks/generator.ts:946-952`) and the context line (`:967-983`). Both read `tool.description`.
- Number of times a block's `block_trace` row is kept past a run (retention): not on this page; `dur:328-347` is [ref].
