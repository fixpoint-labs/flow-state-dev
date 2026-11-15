# Facts for Memory (K-36, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited and none was read. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on `reference/memory`; the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[verify]** not confirmed end to end; keep off the page or soften. **[cut]** history or mechanism; never on the page.

Abbreviations:

- `mc` = `packages/memory/src/memory-capability.ts` · `ms` = `packages/memory/src/memory-system.ts` · `msb` = `packages/memory/src/memory-system-blocks.ts` · `cfg` = `packages/memory/src/internal/config.ts` · `cap` = `packages/memory/src/capabilities.ts`
- `wm` = `packages/memory/src/working-memory.ts` · `wmh` = `packages/memory/src/working-memory-helpers.ts` · `ep` = `packages/memory/src/episodic-memory.ts` · `sm` = `packages/memory/src/semantic-memory.ts` · `dg` = `packages/memory/src/digest-memory.ts` · `fm` = `packages/memory/src/formatter.ts` · `jn` = `packages/memory/src/janitor.ts` · `ro` = `packages/memory/src/resource-options.ts`
- `ct` = `packages/memory/test/capabilities.test.ts` · `ti` = `packages/memory/test/tier-isolation.test.ts` · `mt` = `packages/memory/test/memory-system.test.ts`
- `ov` = `apps/docs/docs/memory/overview.md` · `cf` = `apps/docs/docs/memory/configuration.md` · `rt` = `apps/docs/docs/memory/recall-tool.md` · `pr` = `apps/docs/docs/persistence/overview.md` · `rs` = `apps/docs/docs/resources/overview.md`
- `rd` = `packages/core/src/types/resource.ts` · `ks` = `apps/kitchen-sink/flows/rich-text-component/memory.ts` · `kf` = `apps/kitchen-sink/flows/rich-text-component/flow.ts` · `kc` = `apps/kitchen-sink/flows/chat-agent/flow.ts`
- `rm` = `packages/memory/README.md`

## Flags against the page plan (read first)

1. **The figure brief's marks do not fit working memory.** The brief asks for a dashed outline on working memory and hatching on the stored tiers. The figure standard defines dashed as "lasts one action run and is gone" and hatching as "stored and outlives the request" (`docs/contributing/user-docs-figures.md:42-43`). Working memory is a session-scoped resource, declared `writable` with a default of `{ entries: [], currentTurn: 0 }` (`wm:54-59`), so it is stored like the others and is still there on the session's next request. Nothing citable says it is gone after one action run. What does differ is how long each tier holds an entry: working memory per session, bounded by capacity and turn-based decay; the other three across sessions. **The code wins.** The figure should hatch all four and separate them by "how long": this session, across sessions. Decide at the figure brief; the page must not say working memory is gone after a run. **[page]** for the durations in sections 2 and 4.
2. **Install: `createMemoryCapability` reads, it does not write.** It builds the `<memory>` context block, the recall tool and typed helpers; nothing captures into memory on its own (`mc:1-18`, `mc:130-139`; `ov:47-52`; `rm:21-23`). A page whose example is only `createMemoryCapability` gives an agent memory it can read and that something else must fill (a handler writing through `ctx.cap.*` helpers, or `system()`'s capture). The page's Job says "something to hold onto between turns", so it needs one sentence naming how entries get in: `system()`. **[page]**
3. **Flow-level resource registration (resolved in revise round 1).** The page's example does not spread `mem.*Resources` into `defineFlow`: a generator with `uses: [mem]` already declares `workingMemory`, `memorySystem`, `episodicMemory` and `semanticMemory` (`ct:923-933`), and the three example files type-check. The older note follows. The docs and both kitchen-sink flows spread `mem.userResources` into `defineFlow({ resources })` (`ov:75-79`; `kf:41-46`; `kc:116-122`). Neither kitchen-sink flow spreads `mem.sessionResources`. Whether the spread is needed when `uses: [mem]` already installs the capability's resources was not run. `ov` and `cf:34-55` show `{ ...mem.sessionResources, ...mem.userResources }`. **[verify]** show the spread the docs show; do not say it is required or optional.
4. **`ov:98-100` ("Where it lives") carries a move note**: memory "previously lived at `@thought-fabric/core/memory`" and the old path "no longer resolves". That is diff narrative. **[cut]**. The K-36 section "Where it lives" is about stored data (section 6), not the package path.
5. **Code comments and tests name tracker ids** (`FIX-…` in `mc`, `ep`, `ct`). **[cut]**, never on the page.
6. **`ov:41` and `rm:92` use "hygiene" and "janitor".** Hygiene is its own catalog sub-page (`catalog/memory/hygiene`). The page may link to it and state the one-line consequence (old entries age out, section 4); the knobs are **[ref]**.
7. **The `recall` preset's prompt text and the recall tool's name differ.** The tool is the block named `memory/recall` (`packages/memory/src/tools/recall-tool.ts:148-149`); the prompt string the preset injects says `memory_recall` (`mc:359`). The page names the tool `memory/recall`, as `ov:91` and `rt:7` do. **[page]**
8. **Install line.** `package.json` names `@flow-state-dev/memory`, version `0.2.2` (`packages/memory/package.json:3`; name per `rm:1`, `ov:17`). `ov:16-20` print `pnpm add @flow-state-dev/memory` and the npm form. **[page]**

## 1. What memory is

- Memory is a package, `@flow-state-dev/memory`, installed beside `@flow-state-dev/core`; apps that do not need it do not carry it (`ov:14`; `rm:1-12`). **[page]**
- It gives an agent something to hold onto between turns: "one factory, four optional tiers, and a capability you wire into a generator with one line" (`rm:3`; `ov:8`). **[page]**
- The tiers are working, episodic, semantic, digest. Working is always present; episodic, semantic and digest are opt-in; working-only is a real configuration (`ov:32-39`; `mc:69-75`: `working` required, the others optional). **[page]**
- Each tier is independent only up to its dependency chain: semantic requires episodic, digest requires semantic. Building with a gap throws at construction: `Semantic memory requires episodic memory to be configured`, `Digest requires semantic memory to be configured` (`mc:164-172`; `ct:847-850`; `mt:801`). Working-only is allowed. **[ref]** for the exact messages; **[page]** for "semantic needs episodic, digest needs semantic".
- A capability is the framework's way of bundling resources, context and tools so a block picks them all up with one `uses:` entry (`ov:88`; `apps/docs/docs/fundamentals/capabilities.md:7-9`). **[page]**, defined in a clause where first used.
- Every memory carries a subject, who it is about: `user` for the primary user, a lowercase first name for others (`moni`), a lowercase hyphenated name for organizations (`ep:19-28`; `ov:43`; `rm:98`). Consolidation and prune do not merge a fact across subjects; the digest narrates the user and describes others in relation to them (`ov:43`). **[ref]** (belongs with the tier schemas); the page may use one clause.

## 2. The four tiers: what each holds, for how long

Each row answers what it holds, how long, and what writes it.

### Working

- **Holds:** recent observations from the current conversation, each with a salience that falls as turns pass (`ov:34`; `wm:7-22`: `salience`, `importance`, `addedAtTurn`, `lastAccessedAtTurn`). **[page]**
- **How long:** for the session. It is a session-scoped resource (`wm:54-59`). Decay counts turns, not wall-clock time (`wm:38`). **[page]**
- **Bound:** `capacity` entries, default 7; when full, the lowest-salience entry that is not pinned is evicted (`wmh:30-34`; `wmh:136-150`). `maxPinnedSlots` default 2 (`wmh:30-34`). Decay strategy default `power-law`, rate `0.5` (`wmh:30-34`). **[page]** the capacity default and "oldest-fading entries go first"; the decay strategies, pin slots and rates are **[ref]**.
- **Injected as:** `<memory><working>…</working></memory>`, default on (`mc:326-333`). **[page]**
- **Helpers when installed alone:** `workingMemoryCapability` is a standalone capability exposing `add`, `evict`, `pin`, `unpin`, `refresh`, `tick`, `items`, `format` on `ctx.cap.workingMemory` (`cap:55-93`). **[ref]**

### Episodic

- **Holds:** past things that happened, as discrete episodes recallable by content (`ov:35`). An episode has content, `significance` in 0 to 1, a category, a `subject`, the `sessionId` it came from, and a `consolidated` flag (`ep:6-53`). **[page]** content, significance, session it came from; the rest **[ref]**.
- **How long:** across sessions. The resource is user or org scoped (`ep:69-84`). **[page]**
- **Bound:** at most 200 episodes by default (`ms:172-176`; `cap:99-104`); an episode is encoded only if the observation's importance is at least `significanceThreshold`, default 0.6 (`ms:172-176`; `msb:820-826`). **[page]** the 200 default; threshold **[ref]**.
- **Only lasting observations get here:** the observer marks each item `transient`, `session`, `persistent` or `permanent`; only `persistent` and `permanent` items above the threshold are encoded as episodes (`msb:659-664`; `msb:820-826`; `ep:36-45`). Task and event categories are session only (`msb:677-678`). **[page]** one sentence; the four durabilities and categories **[ref]**.
- **Aging:** with hygiene on (the default), persistent episodes are removed after 500 turns or 90 days, whichever comes first; permanent episodes are never deleted and are marked `stale` after 180 days of silence (`jn:44-53`; `apps/docs/docs/memory/hygiene.md:34-40`). **[page]** one clause ("old episodes age out"); numbers **[ref]**.
- **Injected as:** `<memory><episodic>…</episodic></memory>`, the five most recent, default **off** (`mc:344-351`; `fm:56-60`). **[page]** off by default; the count **[ref]**.

### Semantic

- **Holds:** consolidated facts about a subject, "durable facts the agent should keep" (`ov:36`; `cf:179`): `content`, `subject`, `confidence` in 0 to 1, a category, the episodes it came from, `reinforcementCount` (`sm:17-37`). **[page]** one fact is a statement with a confidence; fields **[ref]**.
- **How a fact gets there:** two routes. A persistent or permanent observation in a stable category (identity, relationship, preference, belief, profession, attribute, pattern) is written straight to semantic memory, or reinforces a matching fact (`msb:853-883`). Separately, a consolidation pass over recent episodes runs after 5 new episodes by default, no more often than every 4 turns, and also when persistent entries are evicted from working memory (`ms:178-183`; `cf:183-189`). Consolidation is a model call (`cf:191`). **[page]** one sentence; thresholds **[ref]**.
- **How long:** across sessions. User or org scoped (`sm:56-82`). Confidence decays with a 180-day half-life when hygiene is on and facts below 0.1 are removed (`jn:44-53`; `apps/docs/docs/memory/hygiene.md:21-33`). **[page]** one clause; numbers **[ref]**.
- **Bound:** pruning when the fact count reaches 20 by default; `0` disables (`ms:190-193`; `cf:190`). **[ref]**
- **Scope default:** semantic follows episodic's scope, else `user` (`cfg:171-175`). **[ref]**
- **Injected as:** `<memory><semantic>…</semantic></memory>`, the top 10 by reinforcement count, default **off** (`mc:334-342`; `fm:52-54`). **[page]** off by default.
- **Relations:** an opt-in `relations` field on `semantic` stores typed connections between entities (`mc:216-222`; `cf:193`). **[page]** a link to `catalog/memory/relations`; no explanation.

### Digest

- **Holds:** one model-written narrative paragraph summarising what the agent knows about the user (`dg:2-10`: "a single LLM-generated narrative paragraph"). The state keeps the current digest and a count of how many were ever generated (`dg:43-49`). **[page]**
- **How long:** across sessions. User or org scoped, at the semantic tier's scope (`dg:53-70`; `cfg:192-195`). **[page]**
- **Rewritten, not appended:** regenerated as a side effect of consolidation and prune, and only when the semantic or episodic stores have changed since the last one (`dg:2-10`; `digest-blocks.ts:1-17`). Capped at `maxTokens`, default 400 (`ms:196-199`). **[page]** "replaced when the facts change"; cap **[ref]**.
- **Injected as:** `<memory><digest>…</digest></memory>`, default on; does nothing when no digest tier is configured (`mc:316-325`). It is the cheapest surface to put in a prompt: a block the agent reads, not something it searches (`cf:196`). **[page]**
- **Needs semantic:** digest requires semantic (see section 1).

### Defaults that decide what the agent sees

- The capability's default presets are `digest`, `working` and `recall`; `semantic` and `episodic` context sections are off (`mc:372-377`; `ct:469-485`, `ct:782`). **[page]**
- The `recall` preset installs the `memory/recall` tool, which searches semantic facts and past episodes on demand and does not search working memory (`mc:352-362`; `ms:559-561` doc comment; `rt:7-9`). With neither episodic nor semantic configured it does nothing (`mc:352-356`). **[page]** one sentence; the tool is **[ref]** / `catalog/memory/recall-tool`.
- Turn a preset off or on with `.with({ ... })`: `mem.capability.with({ recall: false })`, `.with({ semantic: true })` (`ms:593-597`; `cf:253-269`). Those are `system()`'s capability. **[verify]** that `.with` works the same on the value `createMemoryCapability` returns: it is a `DefinedCapability` (`mc:112`) and `ct:469-485` read its `__presetDefs`, but no test or doc calls `.with` on it. Leave presets to **[ref]**, or show `.with` only on `system()`'s `mem.capability`.
- A generator that declares its own `tools:` list gets exactly that list, so the preset adds no tool to it; name `mem.tool.recall()` in the list (`cf:271`; `rt:11`). **[page]** as a limit, one sentence, if the example's generator has no `tools:` list it need not appear. **[ref]** otherwise.

## 3. Install it

- `pnpm add @flow-state-dev/memory` (`ov:16-20`; `rm:10-12`). **[page]**
- Import `createMemoryCapability` (and `system`) from the package root (`ov:22-26`; `ks:20`). **[page]**
- Required option: `model`, a model id or fallback chain, used by the recall tool's filter call; `working` is required, `true` for defaults (`mc:65-85`). Omitting `model` throws `createMemoryCapability requires a \`model\` for the recall tool` (`mc:179-183`; `ct:851`). **[page]** that `model` and `working` are required; the error text **[ref]**.
- Use a small fast model id in the example: `openai/gpt-6-luna` (`ov:63`). **[page]**

## 4. Use it: the smallest example

What the checked-in flows do, as the shape for the page's example (rewrite names to the page's one app at pass 3):

- `createMemoryCapability({ model, working: { capacity: 7 }, episodic: true, semantic: true })` (`ks:44-49`; `ov:62-67`). **[page]**
- Install it on a generator with `uses: [mem]` (`ov:69-73`; `mc:393-399` doc comment `mc:405-412`). The capability then contributes the `<memory>` context block, the recall tool and typed `ctx.cap.*` helpers (`ov:88-92`). **[page]**
- Spread the user-scoped resources into the flow: `resources: { ...mem.userResources }` (`kf:41-46`; `kc:116-122`); `ov:75-79` spreads `{ ...mem.sessionResources, ...mem.userResources }`. See flag 3. **[verify]**
- The returned object carries `sessionResources` (always `workingMemory` and `memorySystem`), `userResources` (the configured user-scoped tiers), `tiers` (per-tier capabilities) and `recallToolBlock` (`mc:380-405`; `cf:61`). **[ref]**
- What the agent sees each turn: a `<memory>` summary (digest, working entries) plus a recall tool for the rest (`ov:82`; `mc:272-278` presets). **[page]**
- To write into memory, use `system()`: it builds the same capability as `mem.capability` and adds the capture pipeline (`ov:84`; `mc:1-18`; `ms:757-780`). In a flow, the capture pipeline is added after the reply with `.sideChain(mem.capture)`, or `mem.captureFromItems`, which reads the last user message and a truncated reply (500 characters by default) from the session's items (`ms:765-775`; `ms:450-451`; `ms:875-877`; `ms:412`; `ms:186-188`). Capture is a model call that reads new messages and pulls out what is worth keeping (`cf:93-95`). **[page]** the `system()` swap and `.sideChain(mem.capture)` in one example; options **[ref]**.
- With `system()` the capability is `mem.capability`: `uses: [mem.capability]` (`ov:84`; `ms:544-600`). **[page]**
- Skipping captures that hold nothing: an optional `evaluator` (`captureEvaluator("<model>")`) asks first whether anything is worth remembering (`cf:84-92` area; `ms:424-429`). It needs an evaluation model, not a chat model. **[ref]**; the page links.

## 5. How the agent reaches memory

- Each turn the generator gets a `<memory>` context block built from the enabled sections (`mc:316-362`; `fm:5-30`). **[page]**
- The model can call the `memory/recall` tool for what the block does not include; the injected text tells it to check memory before saying it does not know (`mc:357-362`). **[page]**
- Handlers read and write through `ctx.cap`: `ctx.cap.memory.recall()` returns ranked items from every configured store; `ctx.cap.workingMemory.add({ content, importance })` writes one (`ms:577-600` doc comment; `mc:281-289`). The per-tier capabilities add `ctx.cap.episodicMemory`, `ctx.cap.semanticMemory`, `ctx.cap.digestMemory` (`cap:113-137`, `cap:168-196`, `cap:223-240`). **[ref]**
- Using one tier alone: `uses: [workingMemoryCapability]`; the same for `episodicMemoryCapability`, `semanticMemoryCapability`, `digestMemoryCapability` (`cap:92-93`, `cap:136-137`, `cap:198-199`, `cap:242-243`; `cf:276-288`). **[page]** one sentence with a link; **[ref]** the rest.

## 6. Where it lives: the four questions, per stored part

Stored parts: the working memory entries, the episodes, the semantic facts, the digest (plus the bookkeeping resource `memorySystem`). Shared facts first.

- **Resource scope sets the owner.** A session-scoped resource belongs to one session; a user-scoped resource is stored at the user's id; an org-scoped one at the organization's id (`rd:199-215`). **[page]**
- **Default scope:** episodic `user` (`ms:172-176`), semantic follows episodic else `user` (`cfg:171-175`), digest follows semantic (`cfg:192-195`), working is `session` always (`wm:54-59`). Episodic, semantic and digest can be `org` instead (`ep:85`; `sm:69-73`; `dg:62`). **[page]** user by default, org on request.
- **Across flows:** a user-scoped tier is stored at `(userId, ref)`, so it is shared by every flow that user touches, unless the flow sets `isolateUserState: true` (`isolateOrgState` at org scope) or the tier sets `flowIsolation` (`rd:206-226`; `cf:215-219`; `ro:6-14`; `ti:25-60`). `flowIsolation: true` is rejected on a session resource, so working memory has none (`rd:628-632`). **[page]** one sentence: a user's memory is shared across the flows they use unless the flow isolates it; the per-tier rules and the digest rule are **[ref]** (`cf:215-243`; `cfg:117-135`).
- **Visible to clients:** none of the memory resources declares a `client` projection, and a resource with no `client` is invisible to clients (`wm:54-59`, `ep:85-92`, `sm:69-82`, `dg:62-70`; `rd:323-324`). The agent sees memory through the capability only: the context block and the recall tool. **[page]**
- **Visible to the model:** through the capability's context sections and `memory/recall`, per the presets in section 2 (`mc:316-362`). The generic resource tools are separate and the `llmReadable` / `llmWritable` flags default off (`rs:289`). **[page]** one sentence; **[ref]** the flags.
- **Where stored:** in the server's configured store. The default is in-memory, lost on restart; SQLite, Postgres or filesystem keep it (`pr:7`, `pr:25-39`). So memory survives restarts only on a persistent store. **[page]**

| Part | Owner (default) | Who can see it | Stored | How many |
| --- | --- | --- | --- | --- |
| Working entries (`workingMemory`) | The session (`wm:54-59`) | The agent, through the `<memory>` block when the `working` preset is on; not a client (no `client`, `wm:54-59`) | In the server's store, with the session (`pr:7`) | One resource per session; up to `capacity` entries, default 7 (`wmh:30-34`) |
| Episodes (`episodicMemory`) | The user, or the org with `scope: "org"` (`ms:172-176`; `ep:85`) | The agent, through `memory/recall`; in the prompt only with the `episodic` preset (`mc:344-362`); not a client | In the server's store at the user's or org's id; per flow when the flow or tier isolates (`rd:206-226`) | One resource per user (per flow copy when isolated); up to 200 episodes, default (`ms:172-176`) |
| Facts (`semanticMemory`) | The user, or the org (`cfg:171-175`) | The agent, through `memory/recall`; in the prompt only with the `semantic` preset (`mc:334-362`); not a client | Same as episodes | One resource per user (per flow copy when isolated); pruned when the count reaches 20 by default (`ms:190-193`) |
| Digest (`digestMemory`) | Follows semantic's scope (`cfg:192-195`) | The agent, in the prompt by default (`mc:316-325`); not a client | Same as episodes; isolated when either source is (`cfg:117-135`) | One digest per user (per flow copy when isolated); regenerated in place (`dg:43-49`) |
| Bookkeeping (`memorySystem`) | The session (`ms:109-121`) | Not a client | With the session | One per session; tracks how much of the conversation was read and when consolidation last ran (`ms:109-121`, `ms:76-95`) |

**[page]** the first four rows as prose or one small table (the page has a six-row table limit); the `memorySystem` row is **[ref]** or **[cut]**, a reader never touches it.

Whose memory is it (the plan's question 3): the user's, by default, and shared across that user's flows; the organization's with `scope: "org"`; working memory is the session's. **[page]**

## 7. Questions the page must answer (plan) and where the answer lives

1. **What line gives a generator memory?** `uses: [mem]`, where `mem = createMemoryCapability({ model, working: true, … })` (`ov:62-73`; `mc:405-412`). With `system()`: `uses: [mem.capability]` (`ov:84`).
2. **Which tier holds a fact about the user, and which a past conversation?** A consolidated fact about the user is semantic (`ov:36`; `sm:17-37`). A thing that happened in a past session is an episode (`ov:35`; `ep:6-53`). Working holds recent observations for this session (`ov:34`). The digest is the one-paragraph summary (`dg:2-10`).
3. **Whose memory is it?** Section 6.

## 8. Reference rows (do not state on the page; link to `reference/memory`)

- Every option of `createMemoryCapability` and `system()` (`mc:65-85`; `cf:34-80`): `model`, `working`, `episodic`, `semantic`, `digest`, `tool`, `hygiene`, and the `system()`-only `consolidationModel`, `pruneModel`, `source`, `maxAssistantChars` (default 500), `name`, `inputSchema`, `evaluator`.
- Tier config tables and defaults (`cf:155-205`): working `capacity` 7, `maxPinnedSlots` 2, `decay.strategy` power-law, `decay.rate` 0.5; episodic `scope`, `flowIsolation`, `significanceThreshold` 0.6, `maxEpisodes` 200; semantic `scope`, `flowIsolation`, `consolidation.episodicThreshold` 5, `.onEviction` true, `.minInterval` 4, `pruneThreshold` 20; digest `maxTokens` 400, `topN.facts` 30, `topN.episodes` 10.
- Hygiene knobs: confidence-decay half-life 180 days, cull floor 0.1; episodic TTL 500 turns, 90 days, `OR`, permanent stale after 180 days; schedule `onConsolidation` by default (`jn:44-53`; `ms:308-342`).
- Recall tool strategy and defaults: `tool.strategy` default `llm-filter`, `tool.model` (`mc:76-77`, `mc:245-256`).
- Validation errors and their texts (`mc:164-183`).
- Presets table: `digest`, `working`, `semantic`, `episodic`, `recall`, `connect`; defaults and the relations-on default (`mc:316-377`).
- Per-tier resource factories and `MemoryResourceOptions` (`ro:6-14`; `cf:243`).
- Standalone `workingMemoryCapture` (`cf:290-298`).
- `flowIsolation` per tier and the digest rule (`cf:215-243`; `cfg:117-135`; `ti:25-60`).

## 9. Not on the page

- The old import path and its removal (`ov:100`). **[cut]**
- How the observer prompt is worded, the reflect routing code, the dedup overlap thresholds (0.95, 0.85 auto-pin) (`msb:640-700`, `msb:790-860`). **[cut]** mechanism; the observable consequence (an important observation is pinned in working memory) is **[ref]**.
- The recall tool's pipeline (prepare, filter, merge, format) (`packages/memory/src/tools/recall-tool.ts:3-35`). **[cut]**
- Why `createMemoryCapability` omits `source`, `maxAssistantChars` and the other `system()` fields (`mc:59-64`). **[cut]**

## 10. Checks run

- Every file path above was opened. Line numbers are from the working tree on 2026-11-15; `ov` and `cf` line numbers are for the pages as they stand today.
- No example was type-checked: this sheet writes none. The page's example uses only exports shown in `packages/memory/src/index.ts` (`createMemoryCapability`, `system`, `workingMemoryCapability`) and `defineFlow`, `generator` from `@flow-state-dev/core` (`ov:59-60`).

## 11. Revise round 1 changes

- Scope column: episodic is `user` by default, or `org` (`ms:215-216`); semantic follows episodic, else `user` (`cfg:171-175`; `ms:270-271`); digest follows semantic (`cfg:192-195`; `ms:399-404`). No tier is fixed at `user`. **[page]**
- Subjects, hygiene detail, presets and per-tier capabilities moved to `reference/memory` (R-37); the page keeps one sentence each and links. The old import path moved to the release's Upgrading page (R-40); the page no longer carries it. Both are **[ref]** / **[cut]** here.
- The page links `../../reference/memory` for configuration; there is no `catalog/memory/configuration` page, only `hygiene`, `recall-tool`, `relations`.
- Example: three titled files (`src/lib/memory.ts`, `src/flows/support/blocks/reply.ts`, `src/flows/support/flow.ts`); `generator` needs `name`, `model`, `prompt` (`ct:923-928`). Type-checked with tsc against the workspace.
## 12. Revise round 2 changes

- The example flow reads only; the page now says what fills it: a flow running `system()` for the same user, since user-scoped tiers are shared across that user's flows unless isolated (`rd:206-226`; flag 2). Working memory is session-scoped and is not filled by another flow. **[page]**
- Dropped the "composed system, not a single store" contrast, the "real configuration" line and the opening "most agents need to remember" sentence; no fact changed.

- Gloss: consolidation turns episodes into lasting facts (`ms:178-183`); prune trims facts once the count reaches the threshold (`ms:190-193`). **[page]**

## 13. Revise round 3 changes

- Read-only flow: the `<memory>` block and recall tool exist, nothing in the flow writes to them. Episodic and semantic are user scoped by default (org on request), shared across that user's flows, so another flow running `system()` fills them. Working memory is session scoped (`wm:54-59`); a different flow has a different session, so it is not filled from outside (`cap:71`: `add` is a handler or capture write). **[page]**
- Glossed capability and generator at first use; dropped the repeated tier count; "FSD" replaced by "the framework".
