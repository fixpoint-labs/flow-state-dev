# Facts for Route with an evaluator (B-23, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, `docs/internal/`, `CLAUDE.md`, PR or commit was read. Nothing below was run in this pass; each fact was read at the cited line.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`; `cr` = `core/utility/cascading-router.ts`; `gate` = `core/utility/cascading-router-gate.ts`; `ev` = `core/blocks/evaluator.ts`; `evt` = `core/types/evaluation.ts`; `sfu` = `core/types/suspend-for-user.ts`; `rt` = `core/blocks/router.ts`
- `crt` = `packages/core/test/cascading-router.test.ts`; `ert` = `packages/engine/test/cascading-router.test.ts`; `sfut` = `packages/engine/test/suspend-for-user.test.ts`
- `ex` = `examples/guides/routing-with-evaluators` (`ex/src/route.ts`, `ex/src/classify.ts`, `ex/src/flow.ts`, `ex/src/models.ts`)
- `guide` = `apps/docs/guides/routing-with-evaluators.md`; `util` = `apps/docs/docs/patterns/utility-blocks/core.md`; `blk` = `apps/docs/docs/fundamentals/blocks.md`; `mod` = `apps/docs/docs/fundamentals/models.md`; `hitl` = `apps/docs/guides/human-in-the-loop.md`; `dx` = `apps/docs/docs/advanced/durable-execution.md`
- `goal` = `goals/cascading-router/fails-closed-on-a-real-evaluation-model/goal.md`

Legend: **[page]** the page states it. **[ref]** belongs on Reference (`cascadingRouter`, `evaluator`, `suspend`); the page links and does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[conflict]** two sources disagree; the code wins and the note names the wrong source. **[plan]** the sitemap entry and the code or the existing page disagree; the page owner decides.

The page's one app is the support desk: flow `support`, as on the other Build pages. Ticket triage is the scenario `guide` and `ex` already use; names below are theirs unless marked.

## 0. Items for the page owner before drafting

1. **[plan] "Send doubtful cases to a person" is not what `cascadingRouter` does by itself.** The router sends a doubtful case to the one `ambiguous` block you supply, and nothing else: `cr:136-141` ("Where every edge that doesn't open goes"), `cr:221-226`. It has no hand-off to a person. The existing page and the example both make `ambiguous` an ordinary handler that returns `{ queue: "review" }`, a name, not a person (`ex/src/route.ts:8-9`, `:19-23`; `guide` lines 183-185 "Here they're handlers that return the queue's name"). A person enters only if the `ambiguous` block itself asks one. The code that does that is `ctx.suspendForUser({ kind: "approval" | "review" | "input", prompt })` or `ctx.suspend({ reason, message })` (section 6). The engine test that proves a branch block can suspend inside the tree uses a leaf (`escalate`), not `ambiguous`: `ert:66-79`, `:366-398`. `ambiguous` is wrapped exactly as a leaf is (`cr:258`, `cr:270`), so it should behave the same, but no test I read suspends in `ambiguous` itself. **[verify]** that an `ambiguous` block that calls `ctx.suspendForUser` pauses and resumes on the same route; say it only if a run shows it. [page: decide whether step 3 is "an `ambiguous` block that returns a queue name" (verified) or "an `ambiguous` block that asks a person" (leaf-verified, `ambiguous`-not-run).]
2. **[plan] The sitemap's example names `evaluator` and `router`; the page's tree is `cascadingRouter`.** A plain `router` appears only as the alternative for a model that reports no confidence: `util:1045-1055`, `guide` lines 205-207, `blk:584`. The `cascadingRouter` is itself a sequencer that contains an `evaluator`, a gate handler and a `router` per level, so the trace shows "ordinary kinds only" (`cr:12-28`, `ert:361-362`). The page may name `router` as that fallback and as what the tree is made of; it cannot say a plain `router` routes on confidence. [page]
3. **[conflict, small] `ex/src/route.ts` and `guide` use `gpt-6-luna` as an OpenAI evaluation model; the goal checks `gpt-5.4-mini`.** `goal:1-8` (Model line) names `evaluationModel("gpt-5.4-mini")`. The docs and example name `gpt-6-luna` (`ex/src/models.ts:19-23`, `mod:481-482`). The page uses `openai/gpt-6-luna`, as the standard says. Whether the goal's gateway alias still serves the newer name is not something the goal records. Keep model names to `typesafe-ai/jev` and `openai.evaluationModel("gpt-6-luna")`, both on current docs. [page]
4. **[conflict, small] The question types.** `guide` line 37-39 says three kinds. Code agrees: `evt:20` (`"choice" | "score" | "boolean"`). But `cascadingRouter` routes only on `choice`: `cr:196-198` (refused at build, "which is a score question, not a choice"). So on this page a `score` or `boolean` answer is read by code, not routed on. [page]
5. **[plan] Which models report confidence.** The code reads only the chosen option's `confidence`; `probabilities` and a boolean's `probability` are never read as confidence (`gate:1-11`, `crt:97-107`, `:119-122`). The existing guide statement "OpenAI's and Anthropic's evaluation models don't report one at all" (`guide` line 99-100) is on the page today; the `util` page (line 1045) names only "the popular providers' evaluation models, like `openai.evaluationModel(...)`". I found no test that runs an Anthropic evaluation model. **[verify]** keep to "OpenAI's evaluation model", which `goal:Verdict log` (2026-09-24 row) ran, and drop Anthropic. [page]

## 1. What an evaluator returns

- An evaluator asks a model questions whose possible answers the author already knows (which option, where on a scale, yes or no) and returns `{ answers }` typed by the questions: `ev:1-8`; `blk:349`. [page]
- Three question builders: `choice(instructions, options)`, `score(instructions, levels)`, `boolean(instructions, criteria?)`, all exported from `@flow-state-dev/core`: `ev:64-107`. [page]
  - `choice`: option keys become the answer's type; at least one option: `ev:64-77`, `ev:181-185`. [page]
  - `score`: an ordered scale of at least two levels; the answer's `score` is a position from 0 to levels minus 1 and may be fractional: `ev:79-91`, `ev:186-190`; `evt:91-99`. [page: one clause]
  - `boolean`: the answer's `probability` is the model's estimate that the answer is yes, "an answer, not the model's confidence in it": `ev:93-107`; `evt:101-111`. [page]
- Block config the page shows: `name`, `model`, `inputSchema`, `state`, `questions`: `ev:311-392` (`model: string | EvaluationModel`, `questions`, `state?`). `state` is what the model looks at, a string, an array or a plain object, and defaults to the block's input: `ev:360-371`; `blk:379`. A `state` that is anything else is refused: `ev:205-212`. [page: `state`; the refusal is [ref]]
- Output: `{ answers }`, keyed by question id. `answers.team.choice` is `"billing" | "technical"`, not `string`: `evt:76-129`, `blk:353`; `guide` line 71-72. [page]
- A choice answer: `{ type: "choice", choice, probabilities?, confidence? }`. `confidence` "is present only when the model reported one; the evaluator never supplies it": `evt:76-88`; `blk:377`. [page]
- A score and a boolean answer may also carry `confidence`: `evt:90-111`. [ref]
- An evaluator makes one call per run and has no `retry`: `ev:303-306`. It answers and stops: "doesn't retry, doesn't fall back to another model, and doesn't decide anything with the answer": `blk:383`. [page: one sentence]
- Branching belongs to the author's code: a `router` that reads `answers.team.choice`, or a sequencer step: `blk:383`. [page]
- Evaluators are silent like handlers: nothing is emitted to the client; what was asked and what came back shows in the DevTool trace: `blk:383`. [page]
- The model: one model, named by a string (resolved through the app's model setup) or an evaluation model instance. A model that can only generate text, an intent, a fallback array and `selectModel` are refused when the block is built: `ev:138-171`; `mod:513-520`. The refusal text for a text model is, verbatim: `Evaluator "<name>": the model can generate but not evaluate.` then `Pass an evaluation model, e.g. openai.evaluationModel("gpt-6-luna"), or a model string.`: `ev:161-165`; `guide` lines 92-95 (the example's test pins that text, `ex/test/guide.test.ts:62-70`). [page: the message; the intents and arrays are [ref]]
- Model reach: `"typesafe-ai/jev"` goes through Vercel's AI Gateway (`AI_GATEWAY_API_KEY`); `openai.evaluationModel("gpt-6-luna")` is an instance with `OPENAI_API_KEY`; the gateway "serves Jev as an evaluation model, but not OpenAI's": `mod:472-487`; `ex/src/models.ts:1-33`. [page: Jev by string, one OpenAI instance; the three-way key table is [ref] with `fundamentals/models#evaluation-models`]
- Jev reports confidence for choice questions (and score): `mod:487`; `blk:377` ("Jev reports it for choice and score questions"). OpenAI's evaluation model reports none: `util:1045`; `goal:Outcome`. [page]
- A state that is not a string, array or plain object, or a string model with no `resolveEvaluationModel` on the app's resolver, is refused (`ev:220-238`; `mod:524`). [ref]

## 2. Ask a typed question (step 1)

- The code the step shows is `ex/src/classify.ts:4-29` (an evaluator named `classify-ticket` with `team`, `frustration`, `urgent`). `team` is exported and reused by the tree's first level: `ex/src/classify.ts:10-14`; `ex/src/route.ts:6`, `:36-37`. The example takes the model as a parameter so tests can pass a scripted model: `ex/src/classify.ts:1-3`; `ex/src/flow.ts:8-9`. [page: show a trimmed `team` and `urgency` pair, not all three kinds, since the router routes only on `choice`: see item 4]
- File layout: the page's app puts a block in `src/flows/<flow>/blocks/<block>.ts`, one export per file (`docs/contributing/user-docs.md` "Code examples"). The example's own layout is `ex/src/classify.ts` and `ex/src/route.ts`. The page's code titles follow the user-docs layout (`src/flows/support/blocks/<block>.ts`, one export per file). Block files `urgent-billing`, `billing-queue`, `tech-queue`, `review` and the `skills/` folder are named in a clause and not shown; the example's flat paths are not the page's. The page writes `model: "typesafe-ai/jev"` inline (a string is accepted: `ev:311-392`), and `skillEvaluator("typesafe-ai/jev")` takes a string as the example's `skillActivator(model?)` does.
- The example's input schema is `z.object({ message: z.string().min(1) })`: `ex/src/classify.ts:8`. [page]
- The example's action runs from the CLI as `pnpm fsdev run routing-with-evaluators classify -i '{"message":"..."}'`: `ex/src/flow.ts:41`; `guide` lines 26-28. The test pins that every command on the guide matches this pattern: `ex/test/guide.test.ts:76-82`. [page: one command, if any]

## 3. Route on the answer (step 2)

### The router and what goes in it

- `utility.cascadingRouter({ name, ambiguous, root })` builds "a decision tree of evaluator choice questions that fails closed": `cr:1-10`, `cr:248-250`. Exported as `utility.cascadingRouter` from `@flow-state-dev/core`: `ex/src/route.ts:4`, `:47`. [page]
- `name` is the router's name; levels, gates and routes are named under it: `cr:134-135`. [ref]
- `ambiguous` is required. Building with none throws `cascadingRouter "<name>": ambiguous is required: the block every edge that doesn't open runs.`: `cr:252`; `crt:243-248` ("BR-23"). [page: one clause, "required"]
- `root` is the first level. A level is `{ ask, on, branches }`: the evaluator to `ask`, the id of the choice question to route `on`, one branch per option: `cr:50-58`. [page]
- A branch is `{ block }` or `{ next }`, plus an optional `minConfidence` in [0, 1], compared inclusively: `cr:43-48`. A branch with both or neither, or a floor outside [0, 1], is refused at build: `cr:206-216`; `crt:187-199`, `:233-241` ("BR-18", "BR-22"). [page: the shape; the refusals are [ref]]
- Branch keys are checked against the question's options, so a typo is a compile error: `cr:113-127`; `packages/core/test/cascading-router.test-d.ts` (the type test file exists; I did not read its lines, so this is the `guide`'s claim, `guide` lines 178-179, and `util:1034`). At runtime a key that is not an option is refused at build when the evaluator's questions are static: `cr:199-203`; `crt:212-216` ("BR-20"). [page: "a typo is a compile error", as the docs say; run-time check [ref]]
- Routing on a question the evaluator does not ask, or on a score or boolean question, is refused at build: `cr:190-198`; `crt:200-211` ("BR-19"). [ref]
- A tree that reaches a level from inside itself is refused: `cr:185`; `crt:250-259` ("BR-24"). A level must ask an `evaluator` block: `cr:187-189`. [ref]
- The router takes no model. The evaluators carry it: `util:47` ("`cascadingRouter` takes no `model` either: each evaluator in its tree carries its own"); `cr:5`. [page]
- The router's input is what the root evaluator accepts. Every evaluator, leaf and `ambiguous` receives that same value, not the level above's answer: `cr:81-85`, `cr:228-229`; `ert:139-150` (level 2's evaluator asked about the ticket, "not level 1's answer"; the leaf received the action's input). [page]
- The router returns whatever the chosen leaf or `ambiguous` returns: `cr:146-155`, `cr:228-229`; `util:1032` ("They must all return the same output type"). [conflict, small] `util:1032` says every leaf and `ambiguous` "must all return the same output type"; the type is `OutputOf<TAmbiguous> | LeafOutputsOf<TRoot>` (`cr:150-155`), a union, so differing outputs compile. The example's leaves all return `Routed` (`ex/src/route.ts:8-9`). The page should say the router returns what the chosen block returns, and not claim the types must match. [page]
- Every leaf and `ambiguous` must accept the router's input: a type check on the config: `cr:98-104`, `cr:141`, `cr:122`. [ref]
- A leaf may sit under two edges: `ert:207-225`; `crt:181-186` ("BR-14"). [ref]
- Levels not on the chosen path never run: "Levels on other branches never run, so they cost nothing": `util:1061`; `ert:167-175` (a level-1 leaf runs and the level-2 model is called zero times). [page]

### When an edge opens (the gate)

All from `gate:42-60` and its tests `crt:32-129`.

- An edge opens only when the answer is a choice that has a branch, and the model reported a confidence (a finite number in [0, 1]), and, when the edge sets `minConfidence`, that confidence reaches it: `gate:1-11`, `gate:42-60`. [page]
- Confidence at exactly the floor opens the edge; below it does not: `gate:58`; `crt:41-47` ("BR-2"), `crt:51-55` ("BR-3", 0.59 against 0.6). [page]
- An edge with no `minConfidence` opens on any reported confidence, however low (0.2 in the test): `gate:19-21`; `crt:35-39` ("BR-1"); `util:1043`; `ert:177-181`. [page]
- Every other outcome runs `ambiguous`, with one of three reasons: `no-confidence`, `below-floor`, `no-branch`: `gate:15`; `cr:7-10`. [page]
  - `no-confidence`: the model reported none, whether or not the edge has a floor: `gate:56`; `crt:57-67` ("BR-4", "BR-5"); `util:1040`. [page]
  - `below-floor`: `gate:58`. [page]
  - `no-branch`: the model chose an option the tree gave no branch, or gave no answer to the routed question: `gate:46-54`; `crt:84-103` ("BR-8"). [page]
- A confidence that is NaN, above 1, below 0, or a string counts as none: `gate:29-34`; `crt:68-83` ("BR-7"). [ref]
- A choice's `probabilities` and a boolean's `probability` are never read as the model's confidence, even when high: `gate:9-11`; `crt:104-122` ("BR-6", "BR-9"). [page: one sentence, "a high probability for the chosen option is not confidence"]
- A level asks its evaluator once; on resume the recorded answer is replayed, not asked again: `cr:15-16`; `ert:366-398` (both models called exactly once across a suspend and a resume, `expect(departmentModel.calls).toHaveLength(1)`). [ref; needs durable execution, see section 6]
- On a model that reports no confidence, every edge goes to `ambiguous` and the tree never reaches level 2: `cr:225-226`; `util:1045`; `ert:183-195`; `goal:Outcome` and its `o1`-`o3` signal (three tickets: each `no-confidence` at `root`, review ran, level 2 never asked, per the 2026-09-24 verdict row). [page]
- To branch on the bare answer from such a model, put a plain `router` after the evaluator that reads `answers.team.choice`; its leaves then receive the evaluator's answers, not the ticket: `util:1045-1057`; `blk:584`. [page: one sentence and a link; the code listing is [ref]]
- **[conflict] `guide` line 193-194** says that a question which isn't a support ticket ... Jev's pick doesn't clear the edge's floor. The guide's run command is not a recorded test; `goal` records a clear billing-urgent ticket on Jev routing to the escalate leaf, and no off-topic ticket run. **[verify]** the off-topic run is not recorded, so the page says only that a confidence below a branch's `minConfidence` lands on `review` (`gate:58`; `crt:51-55`).

### What the trace shows

- Each level the router walked shows its evaluator row (answer and any confidence) and a verdict. The verdict is `{ level, on, edge, confidence }` for an open edge, or `{ level, on, ambiguous: <reason>, choice? }` for ambiguous, `choice` present when the answer was a string choice: `cr:157-160`, `cr:281-289`; `ert:351-364` (an ambiguous landing: one evaluator row `department`, verdict `{ level: "root", on: "team", ambiguous: "no-confidence", choice: "billing" }`); `ert:183-195` (a two-level walk: verdicts for `root` and `root/billing`). [page: one sentence]
- The trace carries "ordinary kinds only": sequencer, evaluator, handler, router: `ert:361-362`. [ref]
- `level` is the path: `root`, `root/billing`: `cr:262-264`, `cr:283`; `ert:183-195`. [page, in the figure's labels]
- A level reused under two branches reports the path it was reached by: `ert:271-306`. [ref]

### Failure and cancel

- A failed evaluation (a provider error, a refused model) fails the router with that error. It does not go to `ambiguous`: `cr:9-10`, `cr:226`; `ert:307-314` (error `provider down: 503`, `received.review` undefined). [page: "doesn't go to ambiguous"]
- A `.rescue` around the router catches that error: `ert:315-323`; `util:1059` ("wrap the router in a sequencer and add `.rescue`"). [page: one sentence]
- A request cancelled mid-level ends cancelled, not failed and not ambiguous: `ert:325-348`. [ref]

## 4. The routing tree figure's facts

The sitemap's figure, "The routing tree": arrow, dashed arrow (`ONLY WHEN UNSURE`), highlighter on the hand-off. What the code supports for each:

- Arrow: the router asks the root evaluator, the answer opens the edge for the chosen option, a branch leads to a block or the next level: `cr:50-58`, `cr:262-317`. [page]
- Dashed arrow, "only when unsure": every non-open outcome (`no-confidence`, `below-floor`, `no-branch`) goes to the one `ambiguous` block, from any level: `cr:136-141`. A figure may draw one dashed arrow from each level to `ambiguous`, or one from the router box, since it is one block receiving the router's input: `cr:228-229`, `ert:183-195` (review received the ticket). [page]
- The dashed outline in the figure language means "lasts one action run" (`docs/contributing/user-docs.md` figure marks), a different meaning from a dashed arrow; the figure doc rules the arrow styles. [plan] read `docs/contributing/user-docs-figures.md` before drawing; I did not.
- Highlighter on the hand-off: the hand-off is the `ambiguous` block; what it does with the case is the author's code (item 1).

## 5. Where the router's three levels come from (names the page uses)

The page's example, borrowed from the existing guide so the page keeps its tested code: two levels, `department` (team: `billing` | `technical`) then, under billing, `billing-urgency` (`urgent` | `routine`); leaves `urgentBilling`, `billingQueue`, `techQueue`; `ambiguous` is `review`: `ex/src/route.ts:25-68`. Floors in the example: 0.6 on `billing`, 0.6 on `urgent`, 0.5 on `routine`, 0.6 on `technical`: `ex/src/route.ts:55`, `:60-61`, `:65`. The tree is built by `triage(model)`, a function of the model, "so the two runs can't drift apart": `ex/src/route.ts:1-3`, `:31`. [page]

The example's leaves are handlers that return `{ queue }`, not blocks that do work: `ex/src/route.ts:11-23`. The guide labels this "in your app they could be anything": `guide` line 183-185. [page]

## 6. Send doubtful cases to a person (step 3)

What the code supports, and what it does not (item 1).

### What the `ambiguous` block gets

- It receives the router's own input (the ticket), not the evaluator's answers, and the router's output is what it returns: `cr:136-141`, `cr:228-229`; `ert:183-195` (`received.review` equals `[ticket]`; output `{ handledBy: "review", input: ticket }`); `ert:196-205`. [page]
- It does not get the reason or the answer; the verdict is in the trace, not passed to `ambiguous`. The block's input type is the router's input: `cr:81-85`, `cr:141`. [page, as a limit: "`ambiguous` receives the ticket and nothing about why it was reached"]

### Asking a person

- `ctx.suspendForUser({ kind, prompt, ... })` stops the request until the user answers; the code reads the answer on its next line. Three kinds: `approval` (yes or no), `review`, `input`: `sfu:1-26`, `sfu:36-40`; `core/types/block.ts:593-608`. [page]
- Returns, for an approval: `{ cancelled: true }`, or `{ cancelled: false, approved: true, answer? }`, or `{ cancelled: false, approved: false, deadline: boolean, answer? }`: `sfu:69-72`. For a review or an input: `{ cancelled: true }` or `{ cancelled: false, answer }`: `sfu:75-76`. Test pin for the yes case: `sfut:711` (`[1, { cancelled: false, approved: true }]`). [page]
- `cancelled: true` is returned when the task the request works is cancelled while it waits: `sfu:14-25`, `sfu:62-66`; `sfut:198`. [ref]
- A deadline: `deadline` in milliseconds from the call; an approval at its deadline reads as a no with `deadline: true`; a review or an input throws `SuspensionTimeoutError`; with no deadline it waits until answered, stopped or cancelled: `sfu:20-35`, `sfu:46-56`; `sfut:170-196`. [ref]
- It "needs durable execution, as `suspend` does": `sfu:19`; `core/types/block.ts:601-607`. Durable execution is on wherever stores persist (filesystem, SQLite, Postgres), off by default on in-memory stores unless `durable: true`: `dx:9`, `dx:34-40`; `hitl:30-45`. `fsdev run` and `fsdev dev` with no config get it over their local SQLite file: `dx:28`. [page: one sentence, linking to B-03 and the durable page]
- The lower-level call is `ctx.suspend!({ reason: "user_approval", message })`; `ctx.suspend` is optional on the context type so examples write `ctx.suspend!`: `core/types/block.ts:589`; `hitl` ("const decision = await ctx.suspend!({"); `ert:73-75` (exactly this call inside a leaf). `suspendForUser` maps `kind: "approval"` to `reason: "user_approval"` and the other kinds to `user_input`: `sfu:92-100`. [page: `suspendForUser`; `suspend` is [ref]]
- The page's example, if it takes the "asks a person" route: a handler as `ambiguous` that calls `ctx.suspendForUser({ kind: "review", prompt })`. **[verify]** not run; see item 1. An `ambiguous` that is a bare handler on a host with durable execution: the tests that suspend inside a tree run it inside a `durable: true` sequencer (`ert:366-398`). Whether a bare handler as the action's block works without a sequencer is a separate question, recorded as unverified on the human-in-the-loop sheet; the `cascadingRouter` is itself a sequencer, so its leaves always run inside one (`cr:319-321`). [page: keep to what the tree is]
- A request that is suspended resumes on the same route without asking either evaluator again: `ert:366-398` (`received.escalate` is `[ticket, ticket]`: the leaf runs twice, from the top, once on each side of the pause; `departmentModel.calls` and `urgencyModel.calls` each length 1). So code before the `suspendForUser` call in the leaf runs twice. [ref: replay behaviour; the page may say "the evaluators are not asked again"]
- A router's selector re-runs on resume and a different route than recorded is fatal: `rt:200-216`. The tree's selector reads only the stored verdict, so resume reaches the same route: `cr:297-298`. [ref]
- The Inbox (a user's list of stops across tasks) lists `suspendForUser` stops and `ctx.suspend` stops whose reason is `user_approval` or `user_input`: `hitl:20`. [page, one clause, if the page names where the person sees it]
- Where a person sees it in a React app: `useSuspensions(session)` and `<ApprovalRenderer>`: `dx:132`; `hitl` (the guide). [ref; link B-03]

### The four questions, for the stored suspension record the hand-off creates

Asked because step 3 may store a suspension. Observations come from the cited sources; the page states the first two lines and links the rest.

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The request that paused, which belongs to the user who made it. Request-addressed routes answer only that user: "same user, same tenant, and, when the record carries one, the same organization" | `engine/src/context/request-principal.ts:41-52`; `engine/src/routes/route-utils.ts:186-211` |
| Who can see it | The owning user. Another user's or another tenant's request is answered as a missing one. Where nothing in the app authenticates, the tenant is the only boundary | `engine/src/routes/route-utils.ts:186-211` |
| Where it is stored | The `suspensions` store of the active store profile, with `checkpoints` and `leases`; in memory unless the app's stores persist | `dx:28`, `dx:301`, `dx:38` |
| How many exist | One per call that pauses; resolved ones are pruned after `suspensionTerminalMaxAgeMs` (7 days in the example config) | `dx:340`, `dx:355` |

[plan] consequence for the page: on a signed-in app the person who answers a doubtful ticket is the same user who sent it. A support desk where an agent reviews a customer's ticket needs the review done as a worker on the user's own task board, not as a second user answering the first user's request. This is a limit the page cannot hide if step 3 is "asks a person". **[verify]** I read `route-utils.ts:186-211` and `request-principal.ts:41-52` only; not the route guard.

The tree itself stores nothing the page needs to name: the evaluators' answers and the verdicts live in the request's trace items (`ert:351-364`), which the DevTool shows (`blk:383`). The router and evaluators have no state of their own to declare in this page's example. [page]

## 7. Other uses of an evaluator the page may link to and not explain

Sitemap links only C-04. The existing guide (`guide` lines 209-267, 269-280) also covers the skill activator and links facets and memory. These are out of the recipe's three steps and 800 words; they are facts, not page content.

- `createSkillActivator({ initialSkills, evaluator: skillEvaluator(model) })`: the evaluator is the third tier after slash commands and keywords; the model's pick is final and its confidence is not compared to a threshold: `guide` lines 209-267. Source of the code: `ex/src/activate.ts` (not read line by line here; the guide's test checks each titled block against the example, `ex/test/guide.test.ts:36-52`). [ref / link `skills/activation#tier-3-with-an-evaluator`]
- Classify documents once on write (`resources/searching#find-by-facets`) and decide which turns memory captures (`memory/configuration#deciding-which-turns-to-observe`): `blk:385`. [ref / links]
- Workforce coordinators use the same reported confidence with their own `minConfidence`: `mod:489`. [ref]

## 8. What the page must not say

- That a plain `router` routes on confidence (`util:1045-1057`: it reads the bare answer).
- That `ambiguous` knows why it ran (`cr:228-229`; the reason is in the trace only).
- That a failed model call lands in `ambiguous` (`cr:9-10`; `ert:307-314`).
- That a boolean's `probability` or a choice's `probabilities` is the model's confidence (`gate:9-11`).
- That the router takes a model (`util:47`).
- That "no confidence" means "low confidence": it means the key is absent, and the gate refuses to fill it in (`evt:76-88`; `blk:377`; `crt:57-67`).
- Anything about Anthropic's evaluation models (item 5).
- That `ambiguous` hands a case to a person on its own (item 1).

## 9. Counts and shapes for the cold-read questions

For the cold-read pass (written by another agent; these are the facts it can key on):

- Evaluator output keys are the question ids: `evt:122-129`.
- A tree with two levels runs level 2's evaluator only when level 1's edge opened: `ert:167-175`, `ert:196-205`.
- Floors compared inclusively: `crt:41-47`.
- Three ambiguous reasons: `gate:15`.
- On a no-confidence model, three of three tickets go to `ambiguous`, whatever the model chose: `goal:Outcome`, 2026-09-24 verdict row.
- Failure: provider error propagates; `.rescue` catches: `ert:307-323`.

## 10. Revise round 1

- Moved off the page to Reference, linked only: the three-way model-key list and gateway limits, the generate-only refusal text, the `cascadingRouter` field-by-field description, the no-confidence trace verdict and the `routeWithoutConfidence` run, the activator's error and fallback behaviour and `skillQuestions`. The page keeps one sentence each for the default model, absent `confidence`, the no-confidence rule, and the activator's tiers and final pick.
- The `ambiguous` block is described as one fallback block; the page no longer says it hands a case to a person (item 1).
- Open: under `strict: true`, `utility.cascadingRouter` rejects evaluators with typed question maps (`ask` is typed `AnyEvaluatorBlock`, `cr:40`, whose `onCompleted` parameter is `Record<string, EvaluatorAnswer>`). The snippet passes under the example's tsconfig (`strict: false`). A core typing fix, not a page fix.

## 11. Revise round 2

- Line 148's claim (a branch with no `minConfidence` still goes to `ambiguous` when the model reports no confidence) confirmed: `crt:58-62` (BR-4) and `examples/guides/routing-with-evaluators/test/flow.test.ts:120-128`, `:132-145`.
- Strict-mode limit now on the page (item 188 above): `ask` is typed `AnyEvaluatorBlock` (`cr:40`); under `strictFunctionTypes` an evaluator with typed questions fails TS2322. Verified by a type-check of the page's snippets; the example's tsconfig sets `strict: false`. The sibling-file import errors are expected: those blocks are separate files not shown.
- Jev defined on first use as an evaluation model (answers fixed questions with typed answers).
- "Edge" removed from the page; the page says branch and ticket.

## 12. Revise round 3

- Strict-mode limit reworded: under `strict: true` the fix is to keep `strict` and add `strictFunctionTypes: false` (the type-check passed under `strict: true` with `strictFunctionTypes: false`); the example sets `strict: false`.
- Dropped the sentence that a below-floor ticket lands on `review` from the run paragraph; the same fact stays in Step 2's opening paragraph (`gate:58`; `crt:51-55`).
- Step 1 now says a no-confidence model sends every ticket to `ambiguous` in Step 2 (`gate:56`; `crt:57-67`).
- Type-check finding on the four unshown sibling imports: accepted. The page says they are ordinary blocks in their own files, handlers returning a queue name.
