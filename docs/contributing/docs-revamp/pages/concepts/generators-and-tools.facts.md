# Facts for Generators and tools (C-03, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`.

Paths are from the repo root. Abbreviations:

- `gen` = `packages/core/src/blocks/generator.ts`
- `asm` = `packages/core/src/blocks/internal/message-assembly.ts`
- `exec` = `packages/core/src/blocks/internal/tool-executor.ts`
- `ctxfn` = `packages/core/src/context.ts`
- `gt` = `packages/core/test/generator.test.ts`
- `gol` = `packages/core/test/generator-owned-loop.test.ts`
- `fence` = `packages/core/test/generator-tools-fence.test.ts`
- `blk` = `packages/core/src/types/block.ts`
- `bsq` = `packages/core/src/blocks/sequencer-methods.ts`
- `old` = `apps/docs/guides/building-agents.md` (the page being promoted)
- `old-ctx` = `apps/docs/docs/advanced/generator-context.md`
- `cfg` = `apps/docs/docs/configuration/blocks.md`
- `items` = `apps/docs/docs/streaming/items.md`
- `blocks.facts` = `docs/contributing/docs-revamp/pages/concepts/blocks.facts.md` (C-02 sheet; facts about block kinds live there, not repeated here)
- `hc` = `examples/hello-chat/src/flows/hello-chat/flow.ts`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/generators`; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften.

The page's one scenario, the support desk from C-02: `handleTicket` answers "Where is my refund?". Blocks: `cleanMessage` (handler), `draftReply` (generator), `handleTicket` (sequencer), `lookUpOrder` (handler used as a tool, file `src/flows/support/tools/look-up-order.ts`). New here: `checkRefundPolicy` (handler, the check that must never be skipped), `supportAgent` (the generator with tools), `lookUpOrder` and `issueRefund` as the two tools the model chooses between. These names are the page's choice; the code layout is `docs/contributing/user-docs.md` (Code examples).

## Things the page cannot state as built

1. **There is no `agent()`.** `grep -rn "export function agent\b" packages/core/src` finds nothing; the exported block builders are `handler`, `generator`, `evaluator`, `sequencer`, `router` (`blk:43`, kinds exactly five). `old:8` says the same. [page]
2. **The old page's "retry on failure" for a tool call is not a generator option.** `old:331` says a failed tool call is retried "based on the generator's `retry` config". In code, the tool executor retries with `flowTools.defaults.retry` (`exec:81`, `const retry = flowTools?.defaults?.retry`), set on the flow's `tools` config or a generator's `flowTools`. The generator's own `retry` option is documented as "Retry the model call" (`cfg:86`). Keep retry off the page; it is a Reference row. [ref]
3. **The old page's "If `maxIterations` is reached, the last response becomes the output" is wrong when the last step is a tool call.** At the cap, the run throws `Generator "<name>" did not produce output after N step(s)` unless `loop.answerOnLastStep: true` makes the last step answer without tools. `gol:1710-1717` (throws `/did not produce output after 3 step/`), `gol:1702-1708` (answers), `gen:3557`, `gen:3250-3259`. The page does not state the cap behaviour; it is [ref]. `old:157`, `old:327` should not be copied.
4. **`maxIterations` is a count of model calls (steps), not "rounds of tool calls" and not tool calls.** `gen:2075` loops `stepNumber < maxSteps`, one model call per step. Default 8. [ref] `gen:108`, `gen:1223-1226` (`loop.maxIterations ?? maxIterations ?? 8`, minimum 1). `gt:448-472` (the cap is passed to the model call as `maxSteps`). `cfg:79-80, 115` list both spellings; `loop.maxIterations` is the preferred one.

## 1. If you know agents (section after the opening)

- The old page opens: "you're probably looking for the `agent()` function. There isn't one." `old:8`. The same words are the model for the page's opening (`user-docs.md` table of models: "concept opening").
- Same as other frameworks: a model, a prompt, tools and a loop. A generator with `tools` is that: the model calls a tool, the framework runs it, the result goes back, and the model is called again until it answers. `old:115`, `old:321-329`; test of a two-call loop: `gol:62` ("one generateStep call per step and completes with text"), `gt:257-309` (the model calls a tool through its `execute`, the final answer comes back).
- The difference: the generator is one block among five, and you place it where you want. The loop is the generator's, written by the framework, so you never write it. `old:16`, `old:159` ("You define the tools. The framework runs the loop"). [page: answers Q1, "where is the agent loop and who wrote it": inside every generator that has `tools`, written by the framework]
- The same primitives give a pipeline with a model in one step, or a model that chooses everything: "A generator with tools is the classic agentic loop. A sequencer with a generator step is a structured pipeline with AI in the middle." `old:16`. [page]
- There is no agent-shaped option on a generator: `GeneratorConfig` has `tools`, `loop`, `maxIterations`, `maxTokens`, `repair`, `retry`, `flowTools`, `providerTools`, `search` and no `agent` field. `gen:540-649` (the interface).
- "Not everything is a generator with tools" is covered by Blocks (C-02); this page links, does not redo the kinds. `blocks.facts:57-76` (who decides per kind).

## 2. A generator with a tool (smallest working example)

Generator surface the example uses:

- `generator({ name, model, prompt, inputSchema, user, tools, itemVisibility })`. `prompt` required; `model` required unless a capability supplies one. `gen:599` (`model`), `gen:608` (`prompt`), `gen:612` (`user`), `gen:613` (`tools`), `gen:585` (`itemVisibility`). Same facts as `blocks.facts:39-47`.
- `tools` takes `GeneratorTool[]`, where `type GeneratorTool = BlockDefinition<any, any>`. A block of any kind. `gen:422`, `gen:613`.
- `tools` can also be `(input, ctx) => GeneratorTool[]`, resolved per call, so the generator can be handed different tools by what it receives. `gen:613`, `gen:425` (`ToolsSlot`); test: `gt:396-446` (input `pick: "a" | "b" | "both"` gives `["toolA"]`, `["toolB"]`, `["toolA","toolB"]`). [ref; the page may show a static list only]
- A handler passed in `tools` is the whole tool: `handler({ name, description, inputSchema, outputSchema, execute })`. `gt:257-272`; `gt:614-625`; `old:121-130`. `description` is what tells the model when to call it. [page]
- What the model is given for a tool: the block's `name`, `description` and `inputSchema` (as the parameters). `gen:922-932` (`compileToolsForModel`), `gen:946-952` (`compileToolsWithExecute`). [page]
- When the model calls a tool, the framework runs the block as a block, so its input is checked against `inputSchema` (the same check as any block, `blocks.facts:20`) and its output goes back to the model. `exec:130-137` (`asRuntime(tool).run(args, scopedCtx)`), `gt:257-309`. [page: the tool is a block; the check detail is [ref]]
- Each tool call produces a `tool_output` item (tool name, input, output, call id, the generator that issued it) that the client can show. `gt:614-672` (`blockName`, `output`, `toolCall.callId`, `toolCall.name`, `toolCall.generatorBlock`), `items:114-145`. Emitted when a tool runs, whether or not `itemVisibility` is set (the test sets none). [ref for the item shape; the page may say "each call shows up as an item"]
- Progress items for a call, `tool_call_progress`, are emitted only when `itemVisibility` is set. `gt:1303-1340` (none when unset), `gt:1197-1265` (paired in-progress and completed items when set), `gen:570-583`. [ref]
- With `itemVisibility` unset a generator emits no message items; the model runs and nothing reaches the client. `gen:570-583`, `gt:1103-1140`. [ref R-06; the page's example sets `{ client: true, history: true }` and says it is the reply the user sees and the conversation keeps]
- With `outputSchema` omitted the generator returns a string and streams token by token. `gen:2865`, `hc:35-38`, `gt:12-29`. [page]
- A tool that fails does not end the run. The error text goes back to the model as the tool's result (`Tool "<name>" failed: <message>`) and the loop goes on, so the model can try something else. `gen:1629-1631` (`error-text` with the error message for a failed call), `gen:1825`, `llm-messages.ts:98-100` (`failedToolResultText`). A tool that suspends (`ctx.suspend()`) is the exception: it stops the loop. `gol:229-278` (a tool's `SuspensionError` propagates out of the loop). [ref; one clause on the page at most]
- With a sequencer in `tools`, the tool's result is the sequencer's last step output. For the page's `refund` (`issueRefund` then `checkRefundPolicy`) that is `{ reply, needsReview }`. Same [verify] as the sequencer-as-tool fact above (`old:262-286`; no test asserts it).
- A model that calls a tool name that does not exist gets `Model called unknown tool "<name>"` as the result, and the loop continues. `gol:612-648`, `gen:1750`. [ref]
- A generator's `tools` names must be unique across distinct blocks; building a generator whose tools share a name throws. The same block instance listed twice is fine. `gol:650-701`, `gen:3101-3108`. [ref]

## 3. The loop the generator runs (figure: the generator's loop)

The figure: the model, a tool call out to `lookUpOrder`, the result back, repeat, then the answer. Facts it rests on:

- One step is one model call. If the model asks for tool calls, the framework runs them, adds their results to the conversation, and calls the model again; the loop stops when a step has no tool calls. `gen:2075-2140` (loop; break when `frameworkCalls.length === 0 && isTerminalStep`), `gol:62-96`. [page]
- A step with several tool calls runs them together and returns all results in one go to the next step. `gol:98-150` ("builds ONE assistant message containing all of a multi-tool step's calls"). [ref: how they are run]
- Every step re-reads `context`, so a tool call earlier in the loop can change what the next step's model call is told. Test: a generator `context` function reads `ctx.self.state.loaded` and a tool writes to it; the seen contexts are `["", "a", "a,b"]`. `packages/engine/test/block-state.test.ts:285-330` (seen contexts assertion at the end of the test), `apps/docs/docs/advanced/block-state.md:70-95`. [ref: advanced, needs `stateSchema` and `ctx.parent`; the page does not teach it]
- Two limits bound the loop: the step cap (default 8) and `loop.runTools`. `gen:108`, `gen:1223-1226`. With `loop.runTools: false` the model may name a tool but nothing runs and the call is returned; `gt:571-613`, `gen:3249`. [ref]
- At the cap with the last step still a tool call the run throws; `loop.answerOnLastStep: true` offers no tools on the last step so it answers in text. `gol:1675-1717`. [ref R: "Tool-loop limits" row; the sitemap names tool-loop limits as links-to, not explained]
- Streaming: text deltas stream to the client as the model writes them when the generator has tools or `itemVisibility` and a text output. `gen:3293-3296` (`canStream` = `(itemVisibility !== undefined || hasTools)` and text output and the model streams). `gol:1159-1326` (one `streamStep` per step, tools run between steps). [ref]
- Text written before a tool call is kept: with two text-writing steps either side of a tool, the output is both texts separated by one blank line. `gol:1327-1353`, `gol:1518-1548`. [ref]

## 4. From fixed steps to free choice (figure: the spectrum; section)

Three versions of the support reply, side by side. Facts:

**Check after the model (the page's first column and first way).**
- The page's `handleTicket` is `sequencer({ name, inputSchema }).step(supportAgent).step(checkRefundPolicy)`: the generator with tools, then the check. `cleanMessage` and `draftReply` are not on the page. A sequencer's order is yours, e.g. `sequencer({ name, inputSchema }).step(cleanMessage).step(draftReply)`. The order is yours; each step's output is the next step's input; a generator step is one model call (tools absent) whose output is typed. `bsq:163-166`, `hc:71-73`, `blocks.facts:51-53`. [page]
- A sequencer with a generator step has fixed order and free text inside the step. `old:64`, `old:111` ("You can reason about this flow statically, test the handlers deterministically, and mock the generator"). [page]

**A pipeline as one tool.**
- In the page's second way the check's input is `issueRefund`'s output (`{ reply, refundCents }`), so the generator needs no `outputSchema`; in the first way the check's input is the generator's output, so `supportAgent` gets `outputSchema`. `bsq:163-166`.
- A sequencer in `tools` is a tool. The model sees the sequencer's `name`, `description` and `inputSchema`; it does not see its steps. A call runs the whole sequencer and the output (the last step's) goes back as the result. `gen:922-932`; `packages/core/test/flow-config.test.ts:772-790` (a `sequencer({ name, description, inputSchema }).step(innerLookup)` in `tools`); `blocks.facts:92-93`. The "runs the whole pipeline behind the call" half rests on `old:262-286` and `GeneratorTool = BlockDefinition<any, any>` (`gen:422`); no test calls such a tool and asserts the result (`blocks.facts:172`). **[verify: soften to "the model calls it like any tool" on the page, or run it before the page ships]**
- The sequencer must be built with a `description` and an `inputSchema` for the model to use it well: the description is what the model reads (see the description facts below). `gen:967-983`, `flow-config.test.ts:766-790`.
- This is the answer to Q2: "You want the model to choose between two tools but never skip the final check." Two builds, both from facts on this sheet:
  1. Put the generator with `tools: [lookUpOrder, issueRefund]` as a step in a sequencer and the check as the next step: `.step(supportAgent).step(checkRefundPolicy)`. The model chooses inside its step; the step after it always runs. `bsq:163-166`, `old:347-354` (a pipeline "validates input, calls an LLM, then post-processes"), `old:111`.
  2. Make the check part of the tool: a sequencer in `tools` whose last step is the check (`.step(issueRefundStep).step(checkRefundPolicy)`), so the model can only reach `issueRefund` through the check. `old:262-286`; same **[verify]** as above.
  [page: both, as the two lines of the spectrum]

**Free tool choice.**
- A generator with `tools: [lookUpOrder, issueRefund]`: the model decides which tool, in what order, how many times, and when it is done. `old:115`, `old:337`. [page]
- A model may call no tool at all and answer straight away: the loop ends on the first step with no tool calls. `gol:62-96`. [page, one clause]
- The model can be given several tools and a tool can itself be a generator: the specialist runs its own model call when the outer model calls it. `old:288-317`; `GeneratorTool` accepts any block (`gen:422`). No test calls a generator as a tool and asserts the result in the sources read for this sheet. **[verify; keep off the page, or one clause linking to the kit/pattern pages]**
- A tool can read and write state, emit status or components to the stream, and suspend for a person. `old:219-260` (state and emit); `blocks.facts:97` (suspend). A tool's own state is declared like any block's (`sessionStateSchema`, etc.). [ref; the page says a tool is a block and so can do what any block does, one sentence]

**Fixed vs free is a decision of who picks the next step:** sequencer, your code; router, your code (`execute` returns the route); generator with tools, the model; evaluator, the model answers and your code acts. `blocks.facts:57-76`. [page: a clause that links to Blocks]

## 5. What the model is told: prompt and context (section)

- A generator assembles the model's input from four slots: `prompt`, `context`, `history`, `user`. `old-ctx:7`, `old:323`. [page]
- Order of what the model receives: the system message (prompt, then rendered context), then history, then the user message. `asm:70-102` (`messages = [...systemPrefix, ...historyValues, ...userMessages]`). [ref for the order; the page may say "prompt and context come first, then the conversation"]
- `prompt` is the standing instructions you write; `context` is what changes per turn or comes from a capability. `old-ctx:7`. [page]
- `context` takes a string, an object of tagged sections, a function of `(input, ctx)`, or an array of those. `gen:353-394` (`GeneratorSlot`, `GeneratorSlotEntry`), `gen:330-348` (`ContextObject`, `ContextValueFn`), `old-ctx:20-51`. [page: the function form; the object form is one sentence + link]
- `contextFn` ignores its schemas argument at runtime (`_schemas`, types only): it passes `ctx.session.state` straight to the callback, so a Zod `.default()` in the schema is never applied. The page's example declares `plan: z.string().optional()` and writes `session.plan ?? "free"` in the callback. `ctxfn:84-103`.
- A `context` function reads the run's state through `ctx`. Example: `ctx.session.state` in a function, with the state's shape declared on the generator with `sessionStateSchema`. `gen:550` (`sessionStateSchema` is a generator option), `packages/core/test/block-context-assignability.test-d.ts:95-100` (a `context: (_input, ctx) =>` callback reads `ctx.session.state.count`, typed from the schema), `packages/engine/test/block-state.test.ts:296-299` (`context: (_input, ctx) => ... ctx.self?.state.loaded`). [page: answers Q4, "the model needs the customer's plan in its prompt. Where does that come from?": from state the run can read, passed through the `context` slot as a function; it is not part of `prompt`]
- Where the customer's plan itself lives is not a generator matter. In the page's scenario it is read from session or user state (`ctx.session.state`, `ctx.user.state`); `contextFn` is the typed helper for exactly this: `contextFn({ session: schema }, ({ session }) => string)` returns a function that fits the `context` slot, and the callback receives the session state typed from the schema. `ctxfn:1-60` (signature, `{ session }` and `{ session, user }` overloads), `core/src/index.ts:179` (exported), `packages/core/test/context-fn.test.ts:24-35` (reads session state), `:37-50` (reads user state; a `@ts-expect-error` marks that the `{ session, user }` callback types its `user` argument wrongly today, so the page should show the session overload only). [page: Q4's code example, session overload]
- A function whose return is a string becomes one system message after the prompt. In object form, the string is wrapped in a tag named after the key and the sections aggregate in one system message. `old-ctx:35`, `old-ctx:53-69`; test `packages/core/test/generator-object-context.test.ts:38-56` (`"You are helpful.\n\n<documents>\n  doc body\n</documents>"`). [ref for the tag rules (normalization, reserved names, escaping, placeholders, type mismatches): `old-ctx:71-166` and the tests `generator-context-aggregation.test.ts`, `generator-object-context.test.ts`, `prompt-reserved-tags.test.ts`]
- Capabilities add context and tools through `uses`; their context lands in the same tags under the generator's own. `old-ctx:105-129`, `generator-object-context.test.ts:58-89`. [ref; capabilities have their own page]
- Tools with a `description` are listed to the model in the system context as `<tools>` with one `- name: description` line each, on by default. `describeTools: false` turns it off. `gen:647-648`, `gen:967-983`, `gen:3127-3131`, `gt:851-896` (the test asserts `- tf_memory_recall: Search your stored memory`). A tool's description is therefore read twice: as the tool's own description and in this list. [page: "write the description for the model"; the switch is [ref]]
- A generator declaring `tools: [...]` is a fence: capability-contributed tools are dropped when the block declares `tools`, including `tools: []`; declaring nothing leaves capability tools in. `fence:1-30`, `cfg:73` the `tools` row ("Declaring it also drops tools a capability would contribute"). [ref]
- `history: true` loads prior turns from the session; `history: { limit: 8 }` narrows it. `hc:42-52`, `old-ctx:253-271`. [page: a clause; history is Reference and Sessions]
- `user` is the user-role message for this turn. `gen:612`, `old-ctx:190-196`. [ref]
- The prompt can live in a markdown file instead of inline text: `prompt: loadPromptFile(...)`. `gen:595-608` (doc comment: "Passing the PromptFile directly"), `old-ctx:401-407`. [page: one clause linking to B-22]

## 6. A typed answer: `generator({ outputSchema })`

- `outputSchema` makes the generator return a typed object instead of text. With it omitted the output is a string. `gt:12-29` (default string), `gt:55-77` (an object schema is passed through to the model call), `gen:2865`. [page]
- The result is validated against the schema. A reply that does not fit is repaired first (deterministic repair, then a model coercion pass, in the default `"auto"` mode); the block fails only when repair does not produce a match, or at once when the mode is `"fail"` or `"rescue"`. Then the generator throws `OutputValidationError` with the raw text and the Zod issues on `details`. `gen:1081`, `gt:218-256` (code `output_validation_error`, `details.rawOutput`, `details.issues`, `details.phase`). [ref; the page does not state the failure, it links to the reference]
- A tool-using generator can also have an `outputSchema`: the loop runs, and the final answer must fit. `gt:257-309` (the test uses a tool with an object `outputSchema`). [page]
- The schema must be one the provider's strict mode accepts. Building a generator whose `outputSchema` holds a `z.record` or a non-literal union throws at definition. `gen:2859-2863` (`assertStrictCompatible`), comment: "a reachable z.record / non-literal union in the declared output schema fails OpenAI strict mode". [ref]
- A typed answer feeds the next step: the sequencer passes it on as the next step's input. `bsq:163-166`, `old:174-181` (planner → forEach). [page, one clause]
- A streamed text generator's reply is an item, and its recorded output refers to that item rather than copying the text. `packages/core/test/generator-block-output-ref.test.ts:45-72`. [ref]

## 7. What it gets you (claims, each tied to the example)

Stored parts, four questions. **A generator and its tools hold no data of their own.** What a run leaves behind about them:

| Stored part | Owner | Who sees it | Where | How many |
| --- | --- | --- | --- | --- |
| A `tool_output` item per tool call (tool name, input, output, call id, issuing generator) | The request (one run of an action) | The client (it is a conversation item) and the DevTool; history reads it back as a call and a result | The request's item log | One per tool call, per step |
| The reply, a `message` item, when `itemVisibility` is set | The request; kept for later turns when `history: true` in `itemVisibility` | The client if `client: true`; later turns if `history: true` | The request's item log (and the session's history view) | One per reply |
| A `block_trace` row for the generator, and one for each tool block it runs | The request | The developer, in the DevTool; not the client by default | The request's item log | One row per execution; the tool's trace output is a `ref` to its `tool_output` |
| A tool's result in the record | The request | As above | Same | Over 256 KiB serialized it is replaced by a placeholder (`outputOmitted`, `preview`, `bytes`) |

Sources: `gt:614-672` (`tool_output`), `gen:570-583` (visibility), `items:55-59` (one `block_trace` row per execution; trace items are not sent to the client by default), `items:114-155` (`tool_output` detail; "the tool result is therefore stored once, surfaced in two places"; 256 KiB), `blocks.facts:107` (trace visibility, `includeTrace`). The conversation history is the session's item history (`hc:42-52`; `old-ctx:253-291`). Tool state a tool writes goes to the scope it declares (session, user, request); that is the Resources and State pages' answer, not this page's.

What the reader gets (each observable in the example; use three or four):

- **You choose how much the model decides, per step, in one place.** On the page `lookUpOrder`, `issueRefund` and `checkRefundPolicy` are the same in all three columns; moving between columns changes how they are composed. The first column adds an `outputSchema` to `supportAgent` and the second wraps `issueRefund` and `checkRefundPolicy` in a new `refund` sequencer, so the claim is about those three blocks only. `old:16`, `old:337-380`. [page]
- **A tool is an ordinary block, so it keeps what blocks have:** typed input and a typed output (the page says only this and that it can be a step elsewhere; state, resources and trace rows are [ref]). Including a block as a tool installs the resources it declares into the flow (those in a static `tools` array; tools returned by a function are not collected, declare their resources on the flow). `apps/docs/docs/fundamentals/blocks.md` ("Blocks declare their resources", the `defineFlow` bullet), `blocks.facts:139`. [page: the first half; the function-tools caveat is [ref]]
- **The model only gets what you hand it.** The tool list is the whole reach of the model: tools you list, or none; a capability's tools are dropped if you declare `tools` (see the fence). `fence:1-30`. [page, one sentence]
- **You see what the model did.** (The page glosses an item as an entry in the run's stream and the DevTool as the local debugging UI.) Each tool call is an item with the input and the output, and each block run has a trace row; the DevTool shows the tree. `items:114-145`, `blocks.facts:131-135`, `apps/docs/docs/devtool/overview.md:130-136`. [page]
- **A tool that errors does not crash the run.** The model is told and can try again or answer. `gen:1629-1631`. [page, if one clause fits; otherwise ref]
- **Tests need no live model.** A generator takes a model; a test hands it a scripted one, and the loop runs the real tools. `gol:62-96` (step-capable mock), `old:111` ("mock the generator for end-to-end tests"). [ref; Testing page]
- Durability: a generator's finished tool calls are recorded; on a continue after a crash the tool calls that finished are replayed from the record rather than run again, and a call that had not finished runs again. The generator resume tests: `gol:229-278` (suspend), `packages/core/test/generator-resume*.test.ts` was not read for this sheet. **[verify; keep off the page. `blocks.facts:114-125` states the block-level checkpoint, which the page may link to.]**

## 8. How it fits with the others

- **Blocks (C-02):** a generator is one of five kinds; a tool is any block. Not repeated. `blocks.facts:57-76`, `:89-98`.
- **A tool is not a different kind of thing from a block; it is a block placed in `tools`.** The difference for the reader (Q3, "what is the difference between a tool and a block?"): none in the block; "tool" names the role: handed to a model, which calls it by name with arguments checked against the block's `inputSchema`, and gets the output back. The same block can be an action, a step, a route and a tool. `old:215-217`, `blocks.facts:140`. [page]
- A block placed as a step does not need a `description`; a tool does, for the model to know when to use it (a block without one is still callable, but not listed in the `<tools>` section). `gen:967-983` (only described tools are listed), `gen:922-932` (the `description` field passes through even if undefined). [page]
- Calling a block as a tool from a step with no model: `.asTool()`, which shows a deterministic call as a `tool_output`. `items:145`, `apps/docs/docs/fundamentals/blocks.md:190-194` (`.asTool()`). [ref; one link at most]
- **Router (Blocks / Sequencers):** a router picks a route in your code (`execute` returns the block); a generator with tools picks in the model. `blocks.facts:69-70`. [page: one clause in the spectrum; the router has its own page]
- **Evaluator:** answers typed questions and stops; it can also be given as a tool (the executor handles `tool.kind === "evaluator"`). `exec:130-135`, `blocks.facts:71-74`. [ref]
- **Patterns** (`supervisor`, `planAndExecute`, `blackboard`) are compositions of generators with tools and sequencers, and forward `uses`. `old:389`, `apps/docs/docs/patterns/overview.md`. [page: one link; Q "build an agent" lands on Patterns for ready-made shapes]
- **Model choice** (C-18) and **prompt files** (B-22): links only. `gen:595-608` for what a prompt file accepts.
- **Capabilities**: `uses` can add tools, context and resources to a generator; `cfg:` the `uses` row. [ref; own page]
- A coding agent such as Claude Code, Codex or Cursor is a different thing (`harness`), run as a block through its own package, not a generator with tools. Per the package map in repository docs only. **[verify; leave off the page unless C-xx covers harnesses]**

## 9. Reference rows this page links to (`reference/generators`)

The page keeps the guarantee in a sentence and links. Moved to Reference (each with its source):

| Row | Source |
| --- | --- |
| Generator options table: `prompt`, `model`, `user`, `context`, `history`, `tools`, `uses`, `itemVisibility`, `agentName`, `search`, `providerTools`, `loop`, `maxTokens`, `repair`, `repairOutput`, `caching`, `describeTools`, `providerOptions`, `flowTools`, `retry` | `gen:540-649`, `cfg:62-87` |
| Tool-loop limits: step cap default 8, `loop.maxIterations`, `maxIterations` (legacy spelling), `runTools: false`, `answerOnLastStep`, the error at the cap | `gen:108`, `gen:1223-1226`, `gen:3249-3259`, `gen:3557`, `gol:1675-1717`, `cfg:79-80`, `cfg:115-119` |
| A failed tool call: error text to the model, loop continues; suspend stops it; unknown tool name | `gen:1629-1631`, `gen:1750`, `gol:229-278`, `gol:612-648` |
| Tool name rules: unique per generator, sanitized alias for the model (`.` and `/` become `_`), the same instance twice is fine | `gen:3101-3108`, `gen:967-983`, `gol:650-701`, `gt:851-896` |
| `tools` as a function; the tools fence; `describeTools` | `gt:396-446`, `fence:1-30`, `gen:647-648` |
| Retry and timeout for tool calls (`flowTools.defaults.retry`, `timeoutMs`) | `exec:80-82` |
| Visibility flags and defaults; which items a generator emits (`message`, `tool_call_progress`, `tool_output`, `reasoning`, `source`) | `gen:570-583`, `gt:1103-1140`, `gt:1197-1340` |
| Structured output: `outputSchema`, repair modes (`auto`, `rescue`, `fail`), `maxAttempts`, `coerce`, `OutputValidationError` shape, strict-schema rule | `gen:1081`, `gen:2859-2863`, `gen:323-370` (types), `gt:218-256`, `cfg:100-110` |
| Context formatters and object-form context: tag normalization, value types, cross-source aggregation, placeholders, reserved names, escaping, type mismatch error | `old-ctx:71-166`, `generator-context-aggregation.test.ts`, `generator-object-context.test.ts`, `prompt-reserved-tags.test.ts`, `packages/core/src/prompt/` (`xmlTag`, `renderTaggedContext`, `validateTagName`, `RESERVED_TAG_NAMES`, subpath `@flow-state-dev/core/prompt`) |
| History: `true`, `{ limit: n }`, `{ limit: { turns } }`, `{ limit: { tokens } }`, `session.historyWindow.turns` default 50, summaries past the window | `old-ctx:253-399` |
| Order of the assembled message list and de-duplication of a leading user message that history already ends with | `asm:70-102`, `old-ctx:196-210` |
| Streaming of text and tool events | `gen:3293-3296`, `gol:1159-1353` |
| Prompt files: `<context>` block owns the context position; `config.context` | `old-ctx:401-407` |

## Not verified, so not on the page

- Running a sequencer as a tool end to end (see section 4). `blocks.facts:172` records the same gap.
- A generator used as a tool of another generator, end to end.
- Resume and replay of a generator's tool calls after a crash. `blocks.facts:114-125` covers the block level; the generator-level step-resume code (`gen:~1818-1830`) was not exercised for this sheet.
- That `description` on the sequencer-as-tool is what the model reads: the description reaches the model by the same two code paths (`gen:922-952`, `gen:967-983`); `flow-config.test.ts:766-790` asserts the sequencer builds with `description` and sits in `tools`, not what the model receives.
- `old:331`, `old:157`, `old:327` (retry; behaviour at the cap) contradict the code as set out in "Things the page cannot state as built"; the code wins, and the page uses neither sentence.
