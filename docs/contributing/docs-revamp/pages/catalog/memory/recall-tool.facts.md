# Facts for The recall tool (K-38, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on a Reference page; the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[reconcile]** depends on something not settled or a page elsewhere.

Abbreviations (all under `packages/memory/`): `rt` = `src/tools/recall-tool.ts` · `ty` = `src/tools/types.ts` · `fh` = `src/tools/format-helpers.ts` · `lf` = `src/tools/strategies/llm-filter-strategy.ts` · `st` = `src/tools/strategies/index.ts` · `ge` = `src/tools/strategies/graph-expand.ts` · `qp` = `src/tools/strategies/query-phrases.ts` · `mc` = `src/memory-capability.ts` · `ms` = `src/memory-system.ts` · `rtt` = `test/tools/recall-tool.test.ts` · `ct` = `test/capabilities.test.ts`. User docs: `ex` = `apps/docs/docs/memory/recall-tool.md` (the page this one keeps) · `ov` = `apps/docs/docs/memory/overview.md` · `cf` = `apps/docs/docs/memory/configuration.md` · `cap` = `apps/docs/docs/fundamentals/capabilities.md` · `rel` = `apps/docs/docs/memory/relations.md`.

## Flags against the page plan and the existing page (read first)

1. **The existing page's custom-strategy example does not type-check.** `ex` shows `const myStrategy: RetrievalStrategy = handler({ ... execute: async ({ input }) => ... })` and says a strategy is "a block factory that produces a handler-shaped block". `RetrievalStrategy` is an object, `{ name, prepareBlock, filterBlock?, formatBlock? }`, not a block (`ty:97-137`, `st:43-57`). A strategy with no `filterBlock` supplies only `prepareBlock`, which must return a `PrepareEnvelope` (`ty:87-110`, `ty:113-137`). The page must not reuse the example. Whether a custom strategy belongs on a 700-word page at all is a plan call; the sheet gives the contract in section 8 **[ref]**. **[reconcile]**
2. **The existing "Ranking and decay" section describes a different function.** `mem.recall()` (the cross-store helper, `ms:465-466`, built in `src/internal/recall.ts:31-153`) ranks by effective confidence with time decay. The tool does not call it. The tool's ranking is in section 5. A page about the tool must not borrow the helper's ranking. The helper is a different surface (`ctx.cap.memory.recall()`, `mc:288-289`), not the tool. **[page]** only to the extent of one pointer, if at all.
3. **The existing "Working-only caveat" is right about the code.** The `recall` preset's `tools: () => [recallToolBlock]` has no gate on which tiers exist (`mc:357-362`), although its doc comment says "No-op when neither episodic nor semantic is configured" (`mc:352-356`). With working only, the tool is installed and its description still says it searches memory (`ty:215-219`). The code wins: the tool is installed and finds nothing. The tool returns `{ results: [], totalMatched: 0 }` when both stores are empty or absent (`fh:142-150`, `lf:251-262`, `rtt:271-288`). `readStores` treats a missing store as empty (`lf:165-190`). **[page]** one flat sentence: with no episodic or semantic tier the tool is still offered and always comes back empty; leave the preset off (`recall: false`, `cf:261`).
4. **The tool description names itself in the preset's prompt text as `memory_recall`.** `mc:359` tells the model to "use the memory_recall tool". The model sees the alias `memory_recall`: tool names are sanitised by replacing every character outside `[a-zA-Z0-9_-]` with `_`, so `memory/recall` becomes `memory_recall` (`packages/core/src/helpers/tool-name.ts:17-21`). The block's own name stays `memory/recall` (`rt:149`, `rtt:259`). **[page]** state `memory/recall`, mention the model sees `memory_recall` only if the page shows a transcript.
5. **No stored data belongs to the tool.** See section 9 for the four questions on the parts it reads.
6. **No `examples/`, `labs/` or `goals/` file installs the recall tool by hand.** The one app using the memory system is `apps/kitchen-sink/flows/chat-agent/run/cognition.ts:20-33` (`system({ model, working: { capacity: 7 }, episodic: true, semantic: true, digest: true })`) and installs it through the capability's default presets. `labs/knowledge-hub/src/inbox.ts` imports the package. The page's example is the plan's own scenario, so it must be written to type-check against the package surface in section 1 (BP-003; `rtt:1-9` shows the tool runs under `runForTest`).

## 1. What a reader touches (exported surface)

- `createRecallTool(opts: { strategy: RetrievalStrategy; defaults?: { limit?: number; perItemCharCap?: number } })` returns the tool block. `rt:45-55`, `rt:89-165`. Exported from the package root. `src/index.ts:248-262`, `src/tools/index.ts:10-12`. **[page]** (as the by-hand route; the usual route is a preset)
- `mem.tool.recall()` returns the tool block, ready to put in `tools:`. `ms:643-654`. `mem.tool.recall()` returns the same block the capability holds (`recall: () => memCap.recallToolBlock`, `ms:907-908`). **[page]**
- `mem` is what `system({ model, ... })` returns. `ms` default export, `ms:757-` (the factory), the `tool` field `ms:651-661`. The page's example imports `system` from `@flow-state-dev/memory` (`ov:25`, `ex:18`). **[page]**
- `createMemoryCapability({ model, working, episodic?, semantic?, digest?, tool?, hygiene? })` builds the read side and exposes the same tool. `mc:60-80`, `mc:180-183`. `model` is required and the factory throws `createMemoryCapability requires a \`model\` for the recall tool` when it is missing or an empty array. `mc:180-183`. **[ref]**
- `semantic` requires `episodic`, `digest` requires `semantic`; each throws at factory time. `mc:164-171`. **[ref]**
- Config: `tool?: MemoryToolConfig` with `strategy?` (`'llm-filter'` or a `RetrievalStrategy`, default `'llm-filter'`), `model?` (defaults to the memory system's `model`; the first entry when `model` is an array) and `defaults?: { limit?, perItemCharCap? }`. `ms:352-370`, `mc:245-256`. **[page]** (`defaults` and `model`; `strategy` is one clause) **[ref]** (the full table)
- Constants exported: `DEFAULT_RECALL_LIMIT = 5`, `DEFAULT_PER_ITEM_CHAR_CAP = 400`, `TRUNCATION_MARKER`, `PRE_RANK_EPISODIC_CAP = 30`, `RECENCY_HALF_LIFE = 50`, `EXACT_PHRASE_CAP = 5`, `GRAPH_EXPAND_CAP = 10`. `fh:45-53`, `lf:53-59`, `ge:27`. **[ref]**

## 2. How a generator gets the tool

- A memory capability has five presets: `digest`, `working`, `recall`, `semantic`, `episodic`. `ms:130-163`. `recall` is on by default; the default-on set is `digest`, `working`, `recall`. `mc:373-376`, `ct:484-485`, `ct:781-782`. **[page]**
- `uses: [mem.capability]` installs the tool with the other default presets. `ms:588-589`. `mem.capability.with({ recall: false })` leaves it out. `cf:261`, `ms:615-622`. **[page]**
- `mem.capability.with({ digest: false, working: false })` gives a worker the tool and no `<memory>` section. `ms:591-594`. **[page]** (candidate for "a worker that only searches")
- With relations on, the default-on set also contains `connect`, a separate tool, `memory/connect`. `mc:374-376`, `ct:793`. Recall becomes connection-aware (section 7). `ex:55-57`, `rel:45`. **[page]** one pointer to Relations.
- The `recall` preset also adds one line to the prompt's `<memory>` section: "There are additional memories available then what are included within this context. Use the memory_recall tool to access them ... Before saying you don't know, check memory for any relevant context first." `mc:357-361`. **[page]** (as what the model is told; paraphrase, do not quote the typo)
- A generator that declares its own `tools:` gets that list and nothing else; a capability's tool is dropped. Name the tool in the list: `tools: [lookupOrder, mem.tool.recall()]`. `cap:146-160`, `cf:274`, `ex:11`. **[page]** (a reader hits this)
- A handler can opt out of all section presets and keep resources and helpers (`recall: false` among them). `ms:615-622`. **[ref]**
- The `episodic` and `semantic` presets inject those tiers into the prompt each turn; they are off by default because the tool covers them. `cf:272`, `ms:140-151`. **[page]** (this is the "tool or automatic context" answer, with section 3)

## 3. Tool or automatic context

- Auto-injected context costs no extra model call per turn and is always on; the tool costs a tool call and a follow-up turn and the model decides when to use it. `ex:62-66`. **[page]**
- Context is "right for the digest and working-memory excerpts the agent should always see"; the tool "when the relevant context depends on what the user just asked". `ex:64-65`. **[page]**
- The defaults give both: digest and working context are injected, the tool is installed. `mc:373-376`, `ex:68`. **[page]**
- Working memory is not searchable through the tool; it lives in the formatter and would duplicate context cost. `ty:1-8`, `ms:643-648`. **[page]** one flat limit.
- For a rare lookup the tool is the cheaper route: it runs only when the model calls it. The facts above are the evidence; the page may say so without a number. The sheet has no measured cost figure. **[gap]** for any quantified claim.
- The tool description tells the model when to call it: when it needs "a specific detail that is not in the summary at the top of your context", and "Do not use this to re-retrieve facts already shown to you". `ty:210-219`. The source comment calls the last line "the single biggest lever against over-retrieval". `ty:205-208`. **[page]** (the first two as when the model reaches for it; the comment is rationale, leave it out)
- Whether the model actually calls it is the model's choice: nothing forces a call. **[gap]** no test or example shows calling frequency; state only that the model decides (`ex:66`).

## 4. What the model sends and gets back

- Input: `query` (required string, at least 1 character, "Natural-language search query"), `limit` (optional integer, 1 to 20, "default 5, hard max 20"), `sinceTurn` (optional integer, 0 or more, "Only return memories from this turn forward (episodes only)"). `ty:73-90`. **[page]**
- A `limit` above 20 or an empty `query` fails the input schema. `rtt:316-317`, `rtt:268-269`. **[ref]**
- `limit` defaults to 5 and the factory's `defaults.limit` changes the default. `rt:93`, `rt:102`, `fh:48-49`. **[page]**
- The result is the cap below which `limit` is clamped to 1 to 20: `Math.min(20, Math.max(1, input.limit ?? defaultLimit))`. `rt:102`. So a `defaults.limit` above 20 is clamped to 20. **[ref]**
- Result, on success: `{ results, query, strategy, totalMatched, truncatedTo }`; each result is `{ id, content, source, score, metadata, truncated }`. `ty:172-205`, `fh:99-124`. **[page]** (show one) **[ref]** (the full shape)
- `source` is `'semantic'`, `'episodic'` or `'relation'`. `ty:20-26`. **[page]**
- `metadata` is source-specific: semantic items carry `subject`, `category`, `confidence`, `reinforcementCount`, `lastReinforced`; episodic items carry `category`, `occurredAtTurn`, `significance`, `encodedAt`. `fh:73-93`. A relation item goes down the episodic branch of `buildResultMetadata` (`fh:87-92`), so its metadata is the episodic fields, which are undefined for it, and its `from`, `to`, `relationType` are not in `metadata`. **[ref]** (the relation row is a code-level observation; no test covers it, state nothing about it on the page)
- `totalMatched` is the number of items the strategy selected before `limit` applied; `truncatedTo` is how many are returned. `ty:182-190`, `rtt:380-386` (8 matched, 5 returned). **[ref]**
- On failure the tool returns `{ error, query, strategy }` as an ordinary result and does not throw into the generator. `ty:195-205`, `rt:125-143`, `rtt:388-399` (a filter that throws `rate limit` returns `error: 'rate limit'`). **[page]** (one sentence plus the shape)
- An empty store returns `{ results: [], query, strategy, totalMatched: 0, truncatedTo: 0 }` and makes no model call. `fh:142-150`, `rtt:271-288`. **[page]**
- Content over the per-item cap is cut and ends with `… [truncated, re-query with narrower terms for full content]`; the item's `truncated` is `true`. Default cap 400 characters. `fh:45-71`, `rtt:327-347`. A custom cap: `tool: { defaults: { perItemCharCap } }`. `rtt:349-365`, `ms:366-369`. **[page]**
- What the model reads is not that JSON. A summary string replaces it: one line `- <content>` per result; `Recall failed: <error>` on error; `No memories matched "<query>".` on empty; and when more matched than were returned, `(N of M matches shown; re-query with narrower terms for more)`. `fh:19-43`, `rt:163-168`, `rtt:452-497`. The structured result still reaches the devtool, the items log, tests and history replay. `rt:163-168`. **[page]** (this is what the model sees; scores and metadata are not in it)
- The summary shows `content` only: `score`, `metadata`, `id` and `source` are not in what the model reads. `fh:37`. **[page]**

## 5. How results are ranked (the strategy: `llm-filter`)

The tool runs in up to three steps: prepare, an optional filter, format. `rt:1-28`, `rt:146-159`.

**Step 1, prepare (no model call). Builds the candidate list.** `lf:228-308`.

- Every semantic fact is a candidate. No cap, no query matching: the semantic store is "already bounded by `pruneThreshold`". `lf:211-215`, `lf:239-240`, `rtt:577-607`. **[page]**
- Episodes are scored `significance × exp(-(currentTurn - occurredAtTurn) / 50)`, kept to the top 30. `lf:93-103`, `lf:53-56`, `lf:242-249`, `rtt:524-551`, `rtt:609-625`. **[page]** (in words: significant and recent episodes first; ancient ones fade) **[ref]** (the formula, 50 and 30)
- `currentTurn` comes from working memory's `currentTurn`; with no working memory it is 0. `lf:184-187`. **[ref]**
- `sinceTurn` drops episodes that occurred before that turn, before scoring. It does not affect semantic facts. `lf:235-237`, `ty:82-86`. **[page]**
- Exact-phrase pass-through (on by default; `exactPhrasePassThrough: false` turns it off): a query of three or more words is split into every run of three or more consecutive words, and an episode that missed the top 30 but contains one of those runs (case-insensitive) is added, at most 5. `lf:268-273`, `lf:136-159`, `qp:104-131`, `lf:58-59`, `lf:396-402`. **[page]** (one sentence: a distinctive string in a low-ranked episode is still found) **[ref]** (the 3 and 5)
- When the relations tier is on and the graph has edges, edges connected to entities the query names are added, up to 10, with `source: 'relation'`. Section 7. `lf:281-295`.
- If there are no semantic facts and no episodes after the cap, the candidate list is empty, no model call is made, and the result is the empty one. `lf:251-262`, `lf:301`.

**Step 2, filter (one model call).** `lf:310-390`.

- A single generator call reads the query, the limit and the candidates and returns the IDs of the relevant ones, most relevant first. `lf:326-336`, `lf:314-317`. **[page]**
- Its instructions: return at most `limit` IDs, omit off-topic candidates and do not pad to the limit, return only IDs in the list, and return an empty list if nothing is relevant. `lf:326-336`. **[page]** (it may return fewer than `limit`)
- Each candidate is shown to it with its id, source, a few metadata fields and its content. Semantic: subject, category, confidence, reinforcementCount (raw `confidence`, no decay). Episodic: category, occurredAtTurn, significance. Relation: from, to, relationType, confidence. `lf:338-361`, `lf:374-387`. **[ref]**
- The model is `tool.model`, else the memory system's `model` (the first entry of an array). `mc:245-252`, `lf:397-398`. **[page]**
- The call is hidden from the client and from history (`itemVisibility: { client: false, history: false }`). `lf:388`. **[ref]**
- Spend per call is bounded by the candidate list, not the store: all facts plus at most 30 episodes, plus at most 5 pass-throughs, plus at most 10 relations. As the store grows the cap on episodes gets stricter; facts are bounded by prune. `lf:22-24`, `lf:211-227`. **[page]** (one sentence; no token figure exists, **[gap]**)

**Step 3, format (no model call).** `fh:126-165`.

- The IDs the filter returned are looked up in the candidate list, in the filter's order. An ID not in the list is dropped. `fh:157-163`, `rtt:412-429`. **[page]** (the model cannot invent a memory)
- `score` is position-based, not a relevance measure: `1 - i/n` over the n returned items, so the top item is 1. `fh:95-98`, `fh:112`. **[page]** one sentence: the score is the rank rescaled, not a probability. **[ref]**
- `limit` is applied after selection: the first `limit` selected items are returned. `fh:104`.
- When a strategy has no filter step, or prepare sets `shouldFilter` false, results are the prepare step's own order, first `limit`. `fh:152-155`, `rt:152-158`, `rtt:431-450`. With the built-in strategy, `shouldFilter` is false only when the candidate list is empty (`lf:301`), so the built-in always filters when there is anything to filter. **[ref]**

**Decay of facts.**

- Fact decay (`effectiveConfidence`, `intrinsicSemanticScore`) is exported for custom strategies. `ex:46`, `lf:63-91`, `st:12-23`. The built-in strategy does not use it to choose candidates: all facts pass through (`lf:239-240`), and the model is shown the raw confidence (`lf:341-346`). So the age of a fact does not by itself keep it out of a recall result; the filter model decides. `ex:46`. **[page]** (answers "how are results ranked"; the contrast with `mem.recall()` in flag 2 stays off the page) **[ref]** (the helper)

## 6. Strategies

- One built-in: `'llm-filter'`. `st:26-27`, `st:43-57`. An unknown name throws `Unknown recall strategy: <name>`. `st:54`. **[ref]**
- A custom strategy is an object `{ name, prepareBlock, filterBlock?, formatBlock? }`. `prepareBlock` takes `PrepareInput` (`query`, resolved `limit`, `sinceTurn?`, `strategyName`, `perItemCharCap`) and returns a `PrepareEnvelope` (`query`, `limit`, `candidates`, `shouldFilter`, `strategyName`, `sinceTurn?`, `perItemCharCap`). `filterBlock` takes `{ query, limit, candidates }` and returns `{ selectedIds }`. `formatBlock` takes the envelope plus `selectedIds?` and returns the result. `ty:97-137`, `ty:100-110`. **[ref]**
- Strategies that supply only `prepareBlock` (vector or keyword search) skip the filter, and the default format returns their order. `ty:128-137`, `rtt:431-450`. `ex:51`. **[page]** (one sentence; "vector search fits the same shape" is the existing page's claim and no strategy of that kind ships, **[gap]** beyond the contract)
- Pass a custom strategy as `system({ tool: { strategy: myStrategy } })`. `ms:358`, `st:43-47`. **[ref]**
- To build the tool by hand: `createRecallTool({ strategy })`; `strategy.name` appears on every result as `strategy`. `rt:89-165`, `rtt:401-410`. **[ref]**

## 7. With relations on

- Entities named in the query pull in nearby edges, up to depth 2 from each matched node, at most 10 edges in all, as `relation` items whose content reads `<from> <type> <to>`. `ge:23-33`, `ge:48-103`, `ty:50-62`. **[page]** (one sentence, link to Relations)
- A query word matches an edge endpoint when a single-word endpoint is a whole word of the query (at least 2 characters), or a multi-word endpoint appears in the query. The generic subject `user` never triggers it. `ge:72-84`. **[ref]**
- With the relations tier off, or the graph empty, nothing is added and no cost is paid. `ge:12-14`, `lf:281-295`. **[ref]**
- The separate `memory/connect` tool answers "what links X to Y" by walking the graph. `ex:70`. **[page]** one pointer; its own page is out of scope.

## 8. Limits the page states flat

- The tool searches semantic facts, past episodes and, with relations, edges. Not working memory, not the digest. `ty:1-8`, `ms:643-648`, `lf:233-249`. **[page]**
- `sinceTurn` filters episodes only. `ty:86`. **[page]**
- `limit` tops out at 20. `ty:75-81`. **[page]**
- A tool call and its result are recorded like any other tool call; the model reads the summary string. `rt:163-168`. **[page]** (already in section 4)
- The built-in strategy makes one extra model call per tool call that finds any candidate. `lf:301`, `rt:154-158`. **[page]** (the cost of the tool, and the reason a store with nothing in it is cheap)
- The tool cannot write. It only reads stores (`readStores` reads `ctx.resources`, `lf:165-190`). **[page]**
- Nothing makes the model call it, and nothing limits how often it calls. **[gap]** for any number.

## 9. Stored data the tool reads (four questions)

The tool stores nothing of its own. It reads three stored parts, each owned by the memory system. A custom strategy may read others; the built-in reads these.

| Part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| Episodes (`episodicMemory`) | The memory system's episodic tier; written by capture, not by the tool. `ms:130-163`, `ex:7` | The user whose `userId` the run carries, at the default scope `user` (or the org at `scope: 'org'`). Shared across that user's flows unless the flow sets `isolateUserState` or the tier sets `flowIsolation: true`. `cf:172-173`, `cf:216-218`, `episodic-memory.ts:85-91` | In the flow's resource store at user (or org) scope, which persists across sessions. `episodic-memory.ts:71-84`, `ov:35` | At most `maxEpisodes`, default 200; at the limit the oldest consolidated episode goes first. `ms:173-176`, `src/episodic-memory-helpers.ts:24-26`, `:49`. The tool considers the top 30 by score, plus up to 5 phrase matches (section 5). |
| Facts (`semanticMemory`) | The semantic tier; written by consolidation. `cf:179` | Same rules as episodes. Scope inherits episodic's, else `user`; `flowIsolation` is its own. `cf:183-184` | Resource store at user (or org) scope. `semantic-memory.ts:57-80` | Bounded by prune: default `pruneThreshold` 20, the point the source comments cite for "already bounded". `ms:190-193`, `lf:211-215`. All of them are candidates. |
| Relation edges | The semantic resource, when the relations tier is on. `semantic-memory.ts:57-80` | Same as facts | On the semantic resource (an `edges` slot), only when `relations` is configured. `semantic-memory.ts:59-65` | Up to 10 added per call. `ge:27` |

- Working memory (`workingMemory`) is session scoped, is not searched by the tool, and its `currentTurn` is read only to age episodes. `working-memory.ts:47-55`, `lf:184-187`. **[page]** (one clause)
- Who sees the *result*: it goes to the model in that run, and the structured result is recorded in the items log and replayed in history. `rt:163-168`. A fact about one user is not returned to another user because the stores are user scoped, but the sheet cites no test that proves that across users; `test/tier-isolation.test.ts` exists in the package and was not read for this sheet. **[reconcile]** read it before the page says anything about a second user.
- Editing the default: no stored data about the tool itself exists, so there is no "who edits" for the tool. The user's own copy rule from the workers pilot does not apply here.

## 10. Words and names

- "Recall tool" and `memory/recall` are the same thing; the model sees `memory_recall`. Flag 4.
- Tier, episode, fact, digest: defined on `ov:28-43`; the page defines each in a clause where used (episode: a discrete record of something that happened in a past session; fact: a consolidated statement the agent decided to keep). `ov:32-37`, `cf:168`, `cf:179`. **[page]**
- Strategy: the part that decides what the tool returns. The built-in is `llm-filter`. **[page]**
- Handler, generator: core terms; the page needs neither beyond "a block".
- `userId`: the caller input every run carries. Not needed on this page.

## 11. Edges of the existing page to correct when the page is written

- `ex:5-7` opening is acceptable as the situation ("the always-on view is not enough"); the plan's opening is the problem the reader has had. The outline for a `catalog` page: what you get, install it, use it, slots it opens, slots it fills and views it serves, change it. The slots rows of the outline have no content for this tool: it opens no slot and fills one, the generator's tools list (section 2). `docs/contributing/user-docs.md:117`. **[reconcile]** with the catalog outline, not a fact.
- `ex:15` "over candidate semantic facts and recent episodes": episodes are scored, not just recent. Section 5.
- `ex:23-27` shows a `tool: { defaults: { limit: 5 } }` example; the example is valid (`ms:353-370`) but sets the default value, so it demonstrates nothing. Use a value that differs from 5 or `perItemCharCap`.
- `ex:31` (the working-only caveat) reads as a tracked bug ("Pre-existing, tracked separately"); that is process narrative. Flag 3 states the behaviour.
- `ex:40-56` custom strategy: wrong shape. Flag 1.

## 12. Revise round 1: what the page now carries

- The page states: the tool is installed by default with `mem.capability`; install, `recall: false`, the `createMemoryCapability` preset and the generator `tools:` rule are one-clause pointers to `reference/memory` and `reference/capabilities` (sections 2 and 4 **[ref]**). `mem.tool.recall()` is named once (`ms:643-654`).
- The page's example is `system({ model, working: true, episodic: true, semantic: true, tool: { defaults: { limit: 8, perItemCharCap: 600 } } })`, titled `src/lib/memory.ts`. `tool.defaults` is `{ limit?, perItemCharCap? }` (`ms:352-370`). `working` is required (`ms:392`).
- Working-only: the tool is installed (`mc:357-362`) and returns an empty result because it reads only semantic facts and episodes (`lf:165-190`, `fh:142-150`). The tool's description does not mention tiers (`ty:216-220`), so the page makes no claim about it. Corrects flag 3's description clause.
- Ranking: `llm-filter` passes every fact and shows raw `confidence` (`lf:239-240`, `lf:341-346`); `effectiveConfidence(fact)` is exported from the package root (`src/janitor.ts:75`, `src/index.ts:137`). `mem.recall()` is a separate programmatic helper that ranks differently (`ms:465-466`; flag 2). The helper's ranking rule is **[ref]**.
- Strategy: `RetrievalStrategy` is an object `{ name, prepareBlock, filterBlock?, formatBlock? }`, not a handler (`ty:117-169`). It is set through `tool: { strategy }` on `system()` or `createMemoryCapability`, or `strategy` on `createRecallTool` (`ms:352-371`, `mc:248-256`, `rt:48-51`). `system()` has no top-level `strategy`. The page keeps one sentence and a link; the contract and the custom-strategy example are **[ref]** (the old example is removed; flag 1).
- Moved to `reference/memory` (R-37) **[ref]**: argument bounds, candidate rules, 400-character default cap and `TRUNCATION_MARKER`, the working-only limit detail, `mem.recall()` ranking, the strategy contract. Moved to `reference/capabilities` (R-10) **[ref]**: a generator with its own `tools` list drops the capability's tools (`cap:146-160`).
- Relations: with relations on, relation edges can appear as results with `source: 'relation'` (`ge:23-33`, `ty:50-62`).

## 13. Revise round 2

- Opener says the tool is one the model calls, and that `<memory>` is in context every turn (`mc:357-361`). `mem` is defined as the memory system created with `system()` before first use. Pointers split: turning the tool off (`cf:261`); `createMemoryCapability` `recall` preset.
- Working-only: the action is "turn the tool off", which applies to both setups (`cf:261`, `mc:357-362`).
- `llm-filter` gloss: a model call picks relevant candidates and returns IDs in order (`lf:326-336`, section 5 step 2).
- `mem.recall()` weights facts by `effectiveConfidence` when hygiene's confidence decay is on; otherwise raw confidence (`src/internal/recall.ts:37-60`, `:158-162`).

## 14. Revise round 3

- New example `src/flows/support/blocks/support-agent.ts`: `generator({ name, model, prompt, inputSchema, user, uses: [mem.capability] })`, imports `mem` from `src/lib/memory.ts` (generator shape as in `apps/kitchen-sink/flows/chat-agent/run/assistant/assistant.ts:19-60`).
- When the model searches: the `recall` preset adds the "more memories exist, check memory before saying you don't know" line to `<memory>` (`mc:357-361`); the tool description says to call for a detail not in the summary and not to re-fetch shown facts (`ty:210-219`); nothing forces a call (`ex:66`). Searches semantic facts, episodes and, with relations, edges; not working memory or the digest (`ty:1-8`, `ms:643-648`).
- Three steps prepare, filter, format; episodes top 30 by significance and recency plus phrase pass-through; filter model is `tool.model` else the system's model, may return fewer than `limit`; invented IDs dropped; `score` is rank rescaled, top = 1 (`rt:1-28`, `lf:228-336`, `fh:95-98,157-163`, `rtt:412-429`).
- Empty stores: no results, no model call, model reads `No memories matched "<query>".`; failure: `{ error, query, strategy }` returned, model reads `Recall failed: <error>` (`fh:19-43,142-150`, `rt:125-143`, `rtt:271-288,388-399`).
- `limit` default 5, max 20; over 20 fails the input schema; `defaults.limit` above 20 clamps to 20 (`ty:75-81`, `rtt:316-317`, `rt:102`). Working-only: installed, always empty; `mem.capability.with({ recall: false })` (`mc:357-362`, `cf:261`).
- Cost line: a call is one tool call, one filter model call and a follow-up turn (`lf:301`, `rt:154-158`).
