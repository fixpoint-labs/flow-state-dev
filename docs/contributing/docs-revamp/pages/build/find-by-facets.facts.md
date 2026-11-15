# Facts for Find records by facets (B-38, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`. Paths are from the repo root. This sheet replaces the earlier one for the same page.

Abbreviations:

- `fc` = `packages/core/src/types/faceted-collection.ts`
- `ev` = `packages/core/src/blocks/evaluator.ts`
- `evt` = `packages/core/src/types/evaluation.ts`
- `enx` = `packages/engine/test/faceted-collection.test.ts` (behaviour, run through `testFlow`)
- `cx` = `packages/core/test/faceted-collection.test.ts` (refusals when built)
- `td` = `packages/core/test/faceted-collection.test-d.ts` (compile-time)
- `goal` = `goals/index-time-facets/found-without-a-model-call/goal.md`
- `ex` = `examples/guides/index-time-facets/` (`src/facets.ts`, `src/flow.ts`, `fsdev.config.ts`, `test/helpers.ts`, `test/facets.test.ts`)
- `srch` = `apps/docs/docs/resources/searching.md` (the existing page; the facets half is lines 80 to 196, the half this recipe keeps)
- `col` = `apps/docs/docs/resources/collections.md`
- `rb` = `apps/docs/docs/resources/reactive-blocks.md`
- `sas` = `apps/docs/docs/fundamentals/state-and-scopes.md`
- `blk` = `apps/docs/docs/fundamentals/blocks.md`
- `mdl` = `apps/docs/docs/fundamentals/models.md`

Legend: **[page]** the page states it. **[ref]** belongs on `reference/resources`; the page links. **[test]** pinned by a test. **[ran]** I ran it against the source in this checkout (throwaway file, removed). **[source]** read from source, not run. **[verify]** not confirmed; keep off the page or soften.

The sitemap's two questions are **Q1: When does the model run?** and **Q2: What does a search by facets cost?** Steps: declare the questions a model answers on write, search by the answers, re-classify after an edit.

## Read this first: corrections and decisions for pass 3

1. **"Re-classify after an edit" means two different edits, and they behave differently.** Editing a record's body re-classifies it by itself, with nothing for the reader to call (facts 14 to 16). Changing the questions re-classifies nothing; the reader calls `reindex` with `{ force: true }` (fact 29). The page's step 3 must say both, in that order. **[page]**
2. **Editing a state field does not re-classify.** The collection binds only the body-write reaction (`fc:525`). A `patchState` on `title` runs no model; this is the same loop boundary `rb:130` states (state and content are separate axes, `rb:58`). So a facet describes the body as it was last written, and a state-only edit never touches it. **[page]** (the example's `write` action patches `title` and writes the body in separate calls, `ex src/flow.ts:37-41`.) No test patches state on an already-classified row and checks the call count; V1 (`enx:269-282`) shows the converse, a title-only write with no body makes no call. **[source]**
3. **The model is named in one place and it is the evaluator's, not the collection's.** `fc:36-37`: "Nothing here names, resolves or builds a model." The example builds the evaluator in `fsdev.config.ts:19` and passes it to the flow (`ex src/flow.ts:15`). **[page]**
4. **The earlier draft's `EvaluatorQuestions` annotation is needed, and the reason is confirmed.** **[ran]** Under `apps/kitchen-sink`'s `strict` tsconfig, `defineFacetedCollection({ ..., evaluator: evaluator({ ..., questions: <object literal with choice(...) values> }) })` fails with `TS2322: ... not assignable to type 'AnyEvaluatorBlock' ... types of 'config.onCompleted' are incompatible`. The same code with `questions` typed `EvaluatorQuestions` (`@flow-state-dev/core`, `evt:74`, exported at `packages/core/src/index.ts:373`) compiles, including `defineFlow({ resources: tickets.resources, actions: { search: { block: tickets.search }, reindex: { block: tickets.reindex } } })`. The example compiles un-annotated only because its tsconfig has `strict: false` (`ex tsconfig.json:6`), and core's own compile-time test compiles un-annotated (`td:20-37`). A page whose snippets must type-check under `strict` annotates the questions. The annotation widens the search's option types; no search-input claim should depend on the narrow ones then. **[page: one sentence]**
5. **Search returns keys, not records.** Output is `{ keys: string[] }` (`fc:90`, `:537`). To show a title, the caller reads each ticket by key. **[page]**
6. **The existing page names `typesafe-ai/jev`; the example falls back to `openai/gpt-6-luna` without a gateway key** (`srch:131`, `ex fsdev.config.ts:19`). Jev is reached through Vercel's AI Gateway (`mdl:479`); `openai/gpt-6-luna` needs `@ai-sdk/openai` and `OPENAI_API_KEY`, and is rejected by the gateway without them (`mdl:485`). The page names `typesafe-ai/jev` and says in a clause that the model must be one that supports evaluation (`blk:381`). **[page]**
7. **Cut from the page**, all on `srch` today: the classify-the-search-string alternative (`srch:194-196`), the migration note (`srch:190-192`), the text-in-state alternative (`srch:188`), the projected-collection filter note (`srch:180`). The refusal list (`srch:140-150`, `fc:233-309`, `cx:88-177`) is **[ref]**.

## The recipe's one scenario

The support desk's tickets. The earlier draft and the example both use `tickets/*`, `scope: "user"`, `stateSchema: z.object({ title: z.string() })`, questions `topic` (billing, outage, other) and `status` (open, closed) (`ex src/facets.ts:20-35`, `ex src/flow.ts:16-22`). **[names only]**

## Step 1: Declare the questions

8. **Questions belong to an evaluator block.** `evaluator({ name, model, questions })` (`ex fsdev.config.ts:17-21`); `defineFacetedCollection({ evaluator })` takes it (`fc:128-133`, `:251`). `evaluator` and `choice` are exported from `@flow-state-dev/core` (`ex src/facets.ts:11-17`). **[page]**
9. **The questions are a fixed object, never a function.** A function (questions computed per call) is refused when the collection is defined (`fc:255-262`, `cx:95-98`). `fc:129-131`: "Its questions must be a fixed object: they type the stored facets and the search's options." **[page]**
10. **Question ids can be anything except `minConfidence`**, which collides with a search option; refused when defined (`fc:263-265`, `cx:117-125`). **[ref]**
11. **Choice questions are the searchable ones.** The search takes one optional value per `choice` question: its option keys. `yes/no` (`boolean`) and `score` answers are stored but have no search option (`fc:76-87`, `:339-343`, `:345-351`; compile-time: `td:44-54`, "a boolean question has no search option"). **[page]**
12. **A `choice` question lists its options as keys with a description each**: `choice("What is this support ticket about?", { billing: "...", outage: "...", other: "..." })` (`ex src/facets.ts:20-35`, `blk:352-362`). The option keys are the values a search can ask for (`fc:315-317`, `:350`). **[page]**
13. **The evaluator's input is the body, a string.** The collection passes `stamp.body` to it (`fc:508`). An evaluator whose input schema refuses a string is refused when defined, unless it adapts the body with `connectInput` (`fc:243-254`, `cx:131-146`). **[ref]**; the page's evaluator takes the default string input and says nothing more.

## When does the model run? (Q1)

14. **Once per body write inside a flow turn.** "Every body write inside a flow turn runs the reaction" (`fc:12`). It covers a write from an action, from a tool, and from an agent (`srch:156`; `rb:132`: a tool that calls `writeContent`, the generic content tool, a file flush). The example's `write` action calls `ref.writeContent(input.body)` (`ex src/flow.ts:41`). **[page]**
15. **One evaluator call classifies all the questions on that body.** A body with three questions (topic, status, urgent) made one model call: `model.calls` is `[A]` (`enx:279-282`, facets stored at `:284-290`, **[test]**). So the number of questions does not change the number of calls. **[page: one clause]**
16. **Writing again re-classifies.** A rewrite of the same record runs the model again on the new body; the earlier answers are cleared first (`fc:15-17`, `:481`; **[test]** `enx:469-485`: a rewrite with a failing model leaves `facets` null and `model.calls` is `[A, B]`). **[page]** This is "re-classify after an edit" for a body.
17. **No model runs when there is nothing to classify.** A record created with no body, and one whose body is only whitespace, make no call and have no facets (`fc:511`, `:513-515`; **[test]** `enx:269-282`: `model.calls` has length 0 and `facets` is null for both). **[page: one clause]**
18. **A state-only write runs no model.** The collection binds only `contentUpdated` (`fc:525`; `rb:130`, `:58`). Storing the answers is itself a state write and does not trigger a second classification (**[test]** `enx:297-305`, V6: after a write and a search, `model.calls` has length 1). **[page]** (see correction 2.)
19. **A search runs no model.** See Q2, facts 31 to 34. **[page]**
20. **A client cannot write a body into a faceted collection**, so no write escapes classification: `client.content.create` and `client.content.update` are refused when the collection is defined, because "a client body edit runs no reaction" (`fc:136-140`, `:280-287`, `cx:104-107`; `rb:132`). Clients may read and delete. **[ref]**; the page says "write bodies through a flow action".
21. **Classification runs on a side chain and finishes before the turn ends.** "Classify on a side chain. A failed or refused model call shows in the trace and does not fail the write. Nothing retries" (`fc:18-19`); "The side chain drains before the turn ends" (`fc:504-505`); facets are in place when the turn ends (`srch:159`). In the example test, the `write` turn's result is `completed` and the ticket's facets are read straight after (`ex test/facets.test.ts:23-26`). **[page]** (so the write action's turn includes the model call: a body write is slower by one evaluation. **[source]** `fc:504-505` and the test; not timed.)
22. **A failed classification does not fail the write.** The save succeeds, the ticket has no facets, and the failure shows in the trace as a failed `evaluator` row (**[test]** `enx:469-485`, `:480`: `rewrite.status` is `completed`, `rewrite.error` undefined, an `evaluator` row has status `failed`). The example test does the same (`ex test/facets.test.ts:43-44`). **[page]**
23. **Nothing retries.** A failed ticket stays without facets until `reindex` (`fc:19`, `:98-99`; `enx:484` `model.calls` is `[A, B]`; `srch:162`). **[page]**
24. **A ticket with no facets never matches any search**, not even one that names no value: a stale or missing classification cannot return a wrong ticket (`fc:367-378`; **[test]** `enx:336-350`: `{}` returns the two classified tickets, not `t3` which was never classified; `enx:477-482`). **[page]**
25. **Facets always describe the current body.** If a body is rewritten while an earlier classification is still running, the earlier answers are discarded and the newer body's answers win (`fc:20-22`, `:487-502`; **[test]** `enx:519-524`, V5: held answers for A are dropped, `topic` ends as `outage` for B; and `enx:566-571`, V9). On the memory, SQLite and Postgres stores that holds across processes; on the filesystem store it holds within one process (`srch:160`). **[page: the guarantee in a sentence]**; the per-store scope is **[ref]**.
26. **`indexedAs` is a one-write token.** Each body write stamps a new random token on the row in the same write that clears `facets` (`fc:480-481`); the answers are stored only if the row still holds that token (`fc:498-500`). **[ref]** The page does not explain it; it says only that the collection adds two fields (fact 35).
27. **A reindex runs the model once per row it classifies**, listed in fact 29 to 30.
28. **Where the model's usage shows.** An `evaluator` trace row nests under the write (`enx:353-354`, `:480`); a search turn has no `evaluator` or `generator` row (`enx:351`). **[page]** (a clause: "the trace shows one evaluator row per write").

## Step 3: Re-classify after an edit

29. **Changing the questions re-classifies nothing on its own.** Stored facets keep answering the old questions until each ticket is re-run. `tickets.reindex` takes `{ force?: boolean }`. With `force: true` it re-runs every row that has a body; without it, only rows with no facets (`fc:92-93`, `:176`, `:551-563`; **[test]** `enx:585-617`: a plain reindex calls the model for `A` and `B` once each, a forced one for `A, A, B`). **[page]** The existing page says the same (`srch:184`).
30. **`reindex` output is `{ reindexed: string[], failed: string[] }`.** `reindexed` holds the keys it classified; `failed` the keys whose classification failed. A row with no body is in neither (`fc:98-101`, `:566-583`; **[test]** `enx:619-636`: `{ reindexed: [], failed: ["t2"] }`, and the body-less row `t3` appears in neither). A failed row keeps no facets and is not retried; the next `reindex` tries it again. A row a newer write rewrote during the reindex is in neither, since that write classifies it (`fc:98-99`, `:578-580`). **[page: the two keys; the edge cases are [ref]]**
31. **Reindex of a failed row costs another model call each time you run it.** `enx:619-636`: `model.calls` is `[B]` after one run, and a `force` run calls again for every row (`forced.output` is `{ reindexed: ["t1"], failed: ["t2"] }`). **[page: one clause in Q1's answer]**
32. **At most eight classifications run at once in a reindex** (**[test]** `enx:638-670`: 20 rows, peak is greater than 1 and at most 8). **[ref]**
33. **Existing records written before the collection was faceted have no facets and never match a search until reindexed.** (**[test]** `enx:585-600`: a row stored in the pre-facets shape, `{ title }` only, is missing from a search and is classified by a plain reindex.) **[page: one clause]**

## Step 2: Search by the answers (and Q2: what does it cost?)

34. **The search is an action block you mount**: `search: { block: tickets.search }` in the flow's `actions` (`fc:411-415`, `ex src/flow.ts:52`). The block's name is `search-<name>`, so for `name: "tickets"` it is `search-tickets` (`fc:531`; the agent-tool test calls `toolName: "search-tickets"`, `enx:380`). `tickets.reindex` is mounted the same way (`ex src/flow.ts:53`). **[page]**
35. **Input and output.** Input: one optional value per choice question, plus an optional `minConfidence` in [0, 1]. Output: `{ keys: string[] }` (`fc:85-90`, `:345-359`). `{ topic: "billing", status: "open" }` returns the keys whose stored `topic` and `status` match both; a value left out is not constrained (`fc:373-390`, **[test]** `enx:342-348`: `{ topic: "billing", status: "open" }` gives `["t1"]`, `{ status: "closed" }` gives `["t2"]`). **[page]**
36. **`minConfidence` keeps only answers the model reported with at least that confidence; an answer with no confidence fails it** (`fc:367-372`, `:385-387`; **[test]** `enx:399-416`, V4). Only some evaluation models report confidence: Jev does for choice and score questions, the popular providers' evaluation models do not (`blk:377`). **[ref]**; the page may add "see the reference for `minConfidence`".
37. **Stored answers are the evaluator's answers as given.** The collection adds two fields to the row's state beside yours: `facets` (answers keyed by question id; a choice answer is `{ type: "choice", choice, probabilities?, confidence? }`) and `indexedAs` (`fc:6-10`, `:103-111`, `:319-337`; **[test]** `enx:284-290`). Do not put them in `stateSchema`: it is refused if you do, and if it is not a `z.object()` (`fc:295-307`, `cx:109-115`). **[page]**
38. **A search by facets makes no model call and spends no tokens.** The goal: a search turn's trace "has no `evaluator` or `generator` row and its model usage totals 0 tokens" (`goal` lines 6 to 10, Signal e2; verdict log: "1 trace row, no evaluator or generator row, 0 tokens"). The control, a search that classifies the query, fails that leg. Engine test: after three searches the call count is unchanged and the search turn's trace holds no model row (`enx:336-355`). The doc comment: "Filters stored answers; makes no model call" (`fc:535`). **[page]** [answers Q2]
39. **What a search does cost: a read of every ticket in the caller's scope.** It lists every record in the collection and filters them in memory (`fc:540-546`). There is no index and no cursor, no limit argument, and no paging. The cost grows with the number of tickets, not with the number of questions or the query. The collection's own docs: an eager collection loads its whole prefix into memory before any block reads it, so a list is exact and needs no store round-trip (`col:289-293`, `:313`); on a lazy collection `list()` is one unbounded scan with no pagination (`col:330-332`). The collection is unbounded unless `maxInstances` is set (`col:270-282`). **[page: one limit sentence: "good for a bounded set, not a corpus of millions"]** [answers Q2] Not measured: no benchmark of search time against row count exists in the tests or goals. **[verify: do not state numbers]**
40. **The order of `keys` is not promised.** The tests sort the result before comparing (`enx:187`). **[page: do not state an order]**
41. **A search with no values returns every classified ticket**, and none that has no facets (`enx:346-347`). **[page]**
42. **Hand the same block to an agent as a tool.** `tools: [tickets.search]` on a generator, with the collection registered by the flow's `resources: tickets.resources` (`enx:357-397`, **[test]**: the tool's output equals the direct search's, and the call count is unchanged). The agent sees each question's options as the allowed values: each choice field is a `z.enum` of the option keys with its description (`fc:345-351`, `srch:172`). The agent's own turn uses its own model; the search inside it adds no model call (`enx:395-396`). **[page]**
43. **The collection must be registered under its `name`.** Pass `tickets.resources` to `defineFlow({ resources })` and add no other entry under that key; if nothing is there, or a different collection is, the first body write fails with an error naming `resources`, with the body already saved (`fc:437-461`, **[test]** `enx:688-700`, `:735-772`; `srch:136-138`). **[page: the instruction]**; the failure is **[ref]**. The block that writes bodies declares the collection under the same key: `resources: { tickets: tickets.collection }` (`ex src/flow.ts:32`). **[page]**
44. **Resources the evaluator declares ride along in `tickets.resources`** (`fc:178-182`, `:204-231`; `enx:858-866`). **[ref]**

## The four questions, for each stored part

The recipe stores one thing the reader did not already have: the answers on each ticket. Two fields, `facets` and `indexedAs`, sit in the ticket's state beside `title`.

| Question | `facets` | `indexedAs` | Source |
| --- | --- | --- | --- |
| Who owns it | The collection's scope, set by `scope` (here `user`: one set per user, inside one organization) | the same row | `fc:134-135`, `:522-526`; `sas:491`: Alice in Acme and Alice in Globex have two user records and two copies of every user-scoped resource |
| Who can see it | Blocks that declare or are given the collection; the search block and reindex block read it; a client sees it only if the collection's `client` config exposes the field; clients may read and delete rows, never write bodies | not written by the app; blocks that read state see it | `fc:136-141`, `:159-163`; `ex test/fence.test.ts:46-50` (the example grants clients no content edits) |
| Where it is stored | In the ticket row's state in the scope's resource store, beside the app's own fields; the body is stored separately as content | the same state | `ex test/helpers.ts:77-79` (`stores.resourceState.get("user", "u:~org:<org>", "tickets/t1")` returns `{ title, facets, indexedAs }`), `fc:103-111` |
| How many exist | One per ticket: null until classified, null when a classification failed or was superseded, otherwise one answer per question. Tickets are unbounded unless `maxInstances` is set | One per ticket, replaced on every body write | `fc:103-111`, `col:270-282` |

45. **Whose tickets a search returns.** The search lists the collection as the run's scope resolves it, so for `scope: "user"` it covers the calling user's tickets in the current organization, not another user's and not the same user's in another organization (`fc:540`, `sas:491`, `col:298-299`). Search takes no user argument, so the caller cannot ask for another user's tickets. **[source]** No test runs a faceted search as a second user. **[verify: state it as "the signed-in user's tickets"; the sentence follows the scope rules, which the page links to]**
46. **The tickets themselves** (the body, `title`) are the collection's instances: owner is the scope, one per key `tickets/<key>`, unbounded unless capped. They are not this page's subject; B-34 and `reference/resources` cover them.

## Limits (for one short sentence each, or Reference)

47. **A facet answers only questions you asked at write time.** A search cannot ask a new question of old tickets without a reindex (fact 29). **[page]**
48. **Classification is only as good as the model's answer.** A wrong or doubtful answer is stored as given; `minConfidence` filters only where the model reports confidence (fact 36). **[page: one clause]**
49. **The search matches stored choices exactly.** It is not a text search: `{ topic: "billing" }` finds tickets the model called billing, not tickets that contain the word (`fc:384`). For words, see B-34. **[page: link]**
50. **A text that lives in state rather than the body does not classify** (see fact 18). If the text to classify is in a state field, the collection does not fit (`srch:188`). **[ref]**

## Links the page makes

- B-34 (`./search-a-collection.md`): finds records by path and by words; the pair to this page. **[page: opening or Next]**
- B-36 (the sitemap names it as a neighbour; its slug is not in the sheets I may cite, so verify the target before linking).
- `reference/resources` (`../reference/resources.md`): refusals when the collection is defined, `minConfidence`, reindex edge cases, the per-store scope of the stale-answer guarantee, client limits.
- `./route-with-an-evaluator.md` (the evaluator block itself) and `../concepts/blocks.md` for the term "evaluator" (`blk:347-385`).

## Open items for the caller

- **Correction 1** is the main edit to the sitemap steps: step 3 is "re-classify after an edit" and covers a body edit (automatic) and a question change (`reindex` with `force`).
- **Two claims left [verify]:** a multi-user search (fact 45) and a latency figure (fact 39). Do not state a number for either.
- **Nothing here is run end to end with a real model.** The goal's verdict log shows 2 of 5 real-model runs failing on a provider outage and the last row BLOCKED on an inference-scoped key (`goal` verdict log). The page's behaviour claims rest on the mock evaluation model in the engine tests and on the goal's earlier PASS rows.

## After revise round 1

Page changes: the model is `openai/gpt-6-luna` (the example's own fallback, `ex fsdev.config.ts:19`; it needs `@ai-sdk/openai` and `OPENAI_API_KEY`, `mdl:485`). The `EvaluatorQuestions` note is now a code comment (correction 4 still holds). `indexedAs` is named only as a reserved field. "Flow turn" is now "action run".

Moved to R-08 (`reference/resources`; the page does not exist yet, so these rows are for whoever writes it):

- Facet question kinds: choice, yes/no, scale; all stored, only choice searchable, option keys are the values (facts 11, 12).
- `defineFacetedCollection`: fields, returns collection, search and reindex blocks; evaluator input is the body; refusal when questions are a function (facts 8, 9, 13).
- Reserved fields `facets` and `indexedAs`, the refusal when `stateSchema` declares them, the full refusal list (facts 26, 37).
- When classification runs: every body write inside a flow turn, from an action, tool or agent (facts 14, 15).
- Search: input, output `keys`, unfaceted records never match, agent-tool options as allowed values (facts 24, 35, 42).
- Classification timing and failure: side chain, failed classification leaves the save intact, a rewrite during classification discards earlier answers (facts 21, 22, 25).
- Reindex: input `force`, which records it selects, output `reindexed` and `failed` (facts 29, 30).
- Reindex failures are listed in `failed` and never retried automatically (fact 23).

## After revise round 2

Page changes: step 2 now lists `resources` among what `defineFacetedCollection` returns (`fc:10`, `:182`, `:538`). The flow-registration instruction names the mistake and its result: a different or missing collection under the key fails the first body write with an error naming `resources`, body already saved (fact 43; `fc:436-461`). Step 3's closing paragraph now states what a caller sees: classification finishes inside the action run (fact 21, `fc:504-505`), a failed one leaves no facets and the ticket out of search (facts 22-24), and a new body write clears old facets first, in a blocking step before the body is read (`fc:473-480`, header rule 1 `fc:14-16`), so stale facets are never returned (fact 16). This answers the suspected-inaccuracy check: facets are cleared on write, and fact 25 (an overlapping rewrite) is the other half. A state-only edit leaves facets alone (correction 2).

## After revise round 3

Page changes: the flow-registration paragraph now states only the instruction (pass `tickets.resources` as the flow's `resources`; the block's own `resources` is separate). The misregistration failure (error naming `resources`, body already saved; fact 43, `fc:437-461`) moved to **[ref]**, for R-08 (`reference/resources`). Step 2 says "To change the model, change it here." The failure sentence no longer uses "still".

## After the loop (review)

Checked in the code and by running it; the page changed to match.

- **Correction to fact 4: the `EvaluatorQuestions` annotation drops the search's option keys, not only widens them.** **[ran]** The page's five snippets, copied verbatim into a scratch folder under `apps/kitchen-sink` (`strict: true`, `tsconfig.json:7`) with a planted `const planted: number = "bad"`, report only the planted error. A probe in the same folder, `const q: BlockInput<typeof tickets.search> = { topic: "billing" }`, fails with `TS2353: 'topic' does not exist in type 'FacetSearchInput<EvaluatorAnswers<EvaluatorQuestions>>'`. Without the annotation, or with `satisfies EvaluatorQuestions`, `evaluator: triage` fails with `TS2322 ... not assignable to type 'AnyEvaluatorBlock' ... types of 'config.onCompleted' are incompatible` (`fc:69`). So under `strict` the search's input is untyped by option; it is checked when the search runs, by the `z.enum` of option keys (`fc:345-358`). **[page: the step 1 code comment]**
- **Fact 44 confirmed by running it: in this recipe the collection reaches the flow from the blocks; `tickets.resources` adds the evaluator's resources.** **[ran]** The page's flow, with and without `resources: tickets.resources`, run through `testFlow` on in-memory stores with the mock evaluation model: both write with status `completed`, make 1 model call for the two questions, and `search { topic: "billing" }` returns `["t1"]`. Block declarations bubble up into the flow (`defineFlow.ts:749-761`); `writeTicket`, `tickets.search` and reindex's select step declare the collection (`fc:538`, `:554`). The reaction runs outside the action graph, so resources the evaluator declares reach it only through `tickets.resources` (`fc:26-28`, `:178-182`, `:204-231`; control `enx:868-876`). **[page]**
- **The same run, with the model call failing:** the write completes, `search { topic: "billing" }` and `search {}` both return `[]`, and a plain `reindex` returns `{ reindexed: [], failed: ["t1"] }` (facts 22-24, 30, 41; `fc:18-19`, `:367-372`, `:573-606`). **[page]**
- **The same run, as a second user:** `search {}` returns `[]` for user `u2` while user `u` has `t1` (fact 45). **[page: "the signed-in user's tickets" plus a link to `concepts/state-and-scopes`]**
