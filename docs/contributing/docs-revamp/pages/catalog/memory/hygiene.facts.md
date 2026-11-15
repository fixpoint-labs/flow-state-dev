# Facts for Memory hygiene (K-39, catalog)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec is cited and none was read. Paths are from the repo root.

Legend: **[page]** the page states it. **[ref]** belongs on `reference/memory`; the page links, does not state it. **[gap]** nothing citable exists; the page must not assert it. **[verify]** not confirmed end to end; keep off the page or soften. **[cut]** history or mechanism; never on the page.

Abbreviations:

- `jn` = `packages/memory/src/janitor.ts` · `jb` = `packages/memory/src/janitor-blocks.ts` · `hc` = `packages/memory/src/internal/hygiene-config.ts` · `ms` = `packages/memory/src/memory-system.ts` · `msb` = `packages/memory/src/memory-system-blocks.ts` · `mc` = `packages/memory/src/memory-capability.ts`
- `eh` = `packages/memory/src/episodic-memory-helpers.ts` · `ep` = `packages/memory/src/episodic-memory.ts` · `sm` = `packages/memory/src/semantic-memory.ts` · `sh` = `packages/memory/src/semantic-memory-helpers.ts` · `rc` = `packages/memory/src/internal/recall.ts`
- `jt` = `packages/memory/test/janitor.test.ts`
- `hy` = `apps/docs/docs/memory/hygiene.md` (existing page) · `cf` = `apps/docs/docs/memory/configuration.md` · `ov` = `apps/docs/docs/memory/overview.md` · `rt` = `apps/docs/docs/memory/recall-tool.md`

## Flags against the page plan and the existing page (read first)

1. **The existing page's "silence" is age since encoding.** `hy:44` and `ep:47-50` say a permanent episode is marked `stale` after `permanentStaleDays` of "silence". The code measures `now - encodedAt` and nothing else; recalling or touching an episode does not reset it (`eh:155-176`; test `jt:344-357` uses `encodedAt` a year back). **The code wins.** The page says "180 days after it was recorded", never "since it was last used". **[page]**
2. **Facts decay from the last reinforcement; episodes age from encoding.** Facts anchor on `lastReinforced`, falling back to `extractedAt` (`jn:80`; `jt:172-186`). Persistent episodes anchor on `encodedAt` for days (`eh:129-130`). Reinforcing a fact resets its decay clock (`sh:44-68`, `lastReinforced: now` at `sh:67`). Nothing resets an episode's clock. **[page]**
3. **The turn leg of the episode TTL is inert across sessions.** Turn age is `max(0, currentTurn - occurredAtTurn)`; `currentTurn` lives on session-scoped working memory and resets each session, while episodes persist across sessions (`eh:123-128`). So for an episode from an earlier session only the days threshold can fire, unless the current session has itself run past the turn threshold. **[page]** one sentence, because it answers "what happens to an old one"; the mechanism is **[ref]**.
4. **Existing page says "More than `persistentTurns` turns since the episode occurred" and "More than `persistentDays` days since the episode was encoded" (`hy:41-42`).** The code uses `>=`, not `>` (`eh:132-133`). **[ref]**; the page says "after 90 days".
5. **`cullFloor` upper bound.** `hy:90` and `cf` do not state it. Construction throws unless `cullFloor` is in `[0, 1)` (`hc:44-46`), `halfLife > 0` (`hc:41-43`), and each of `persistentTurns`, `persistentDays`, `permanentStaleDays` is `> 0` (`hc:67-75`; tests `jt:565-612`). The error strings are `hygiene.confidenceDecay.halfLife must be > 0, got <n>` and so on. **[ref]**
6. **`hygiene: true` is accepted** and means the defaults, as does omitting it (`hc:29`; `ms:418-422`). **[page]** only as "on by default".
7. **The existing page's "Relationship to prune" is correct but the order claim is the capture-pipeline order.** The janitor is `.tap()`ped after persist inside the consolidation chain, and the digest regenerates after it (`msb:1428-1440`). Prune is a separate `.sideChain` after consolidate on the capture pipeline (`msb:1832-1834`, from `pipeline.sideChain(consolidateBlock).sideChain(pruneBlock)`). Do not state "janitor, then prune" as a guarantee when `schedule` is `'onCapture'` or `'manual'`. **[verify]** keep to: prune is a separate, optional, model-driven step (`ms:287`, `jb:` none). **[ref]**
8. **Code comments name tracker ids (`FIX-411`, `FIX-745`) and prior behavior ("pre-FIX-411", "V1 bug fix").** **[cut]**.
9. **Existing page `hy:63` argues for the default ("conservative on purpose", "many systems pick aggressive half-lives").** Design defense, and `jn:28-31` is the same. **[cut]**. The page states the default and says a shorter half-life decays faster.
10. **Existing page says the stale marker lets "operators see what's gone cold".** True as an inspection surface, but nothing in the package reads `stale` back (grep of `packages/memory/src` finds it written in `eh:172` and declared in `ep:47-52` only; the formatter and recall do not filter on it). **[page]** "marked `stale: true`; nothing else changes, the episode is still recalled." That last clause is **[verify]**: no test asserts recall of a stale episode; state only that it is never deleted by the janitor (`eh:100-105`, test `jt:322`).

## 1. What hygiene is, and what problem it answers

- A long-running agent's store grows, and old entries rank beside fresh ones. Hygiene is a periodic pass that lowers old facts' rank, removes the ones that fall below a floor, removes old persistent episodes, and flags old permanent episodes (`hy:8-13`; `jn:1-7`). **[page]**
- It is on by default when `system()` is built with a semantic or episodic tier (`hy:10`; `ms:418-422`; `ms:847-848`; tests `jt:515-525`). **[page]**
- It does not exist for working-only memory: with neither semantic nor episodic configured there is no janitor (`ms:847`; test `jt:539-542`). **[page]**
- The pass is deterministic and makes no model call (`hy:15`; `jb:75-148`, no generator in the block). **[page]**
- The janitor also drops relation edges whose endpoint fact subject was culled, only when relations is on and `createImplicitEntities` is false (`jb:116-123`; `packages/memory/README.md:115`; `apps/docs/docs/memory/relations.md:36`). **[page]** one clause, linking to the relations page; the condition is **[ref]**.

## 2. What happens to a fact from eighteen months ago

The question the sitemap sets. Facts are semantic facts; episodes are separate (section 3).

- A fact has `confidence` (0 to 1), `extractedAt`, and an optional `lastReinforced` (`sm:34`; `jn:76`). New facts get `lastReinforced` equal to `extractedAt` (`sh:20-30`; test `jt:205-220`). Reinforcing an existing fact updates `lastReinforced` (`sh:44-68`, `sh:79-100`). **[page]**
- Effective confidence is `confidence x 0.5 ^ (elapsedDays / halfLife)`, computed when read, never stored (`jn:55-91`; `jn:9-11`). The stored `confidence` does not change. **[page]** the formula in one line; "never stored" as "the stored score stays the same, the decayed one is computed when it is needed". The clamping and clock-skew cases are **[ref]**.
- Default `halfLife` is 180 days. At one half-life the value is half the stored one, at two half-lives a quarter (`jn:45`; tests `jt:160-170`). **[page]**
- Two places read it. Recall ranking: `relevance = effective x (0.5 + 0.5 x min(1, reinforcementCount / 10))`, so at equal stored confidence a fresh fact outranks an old one (`rc:55-68`; test `jt:627-653`). The janitor's cull. **[page]** the ranking consequence; the formula is **[ref]**.
- The `llm-filter` recall strategy shows the model the raw `fact.confidence`, not the decayed one; `effectiveConfidence` is exported for custom strategies (`rt:36-38`). **[ref]**
- The janitor removes a fact whose effective confidence is below `cullFloor`, default 0.1; a fact at exactly the floor is kept (`jn:45`; `sh:151-169`, `>= cullFloor` at `sh:161`; tests `jt:223-270`, "keeps facts at or above the floor" `jt:237`). **[page]**
- **Worked answer for eighteen months (548 days) at defaults**, computed from the formula above with `node`: factor `0.5 ^ (548/180)` = 0.1213. A fact stored at confidence 0.8 is at 0.097 and is below the 0.1 floor, so it is removed on the next janitor run. A fact stored at 0.9 is at 0.109 and survives, ranking at about an eighth of a fresh one. The age at which a 0.8 fact crosses the floor is 180 x log2(8) = 540 days. **[page]** state as "a fact that has not been reinforced for eighteen months and was stored at 0.8 is gone; at 0.9 it is still there and ranks far below fresh ones". These figures are derived, not copied from a test. The example must be marked as computed, and the page example should stay with whole numbers a reader can check. **[verify]** by running `effectiveConfidence` once in a scratch test before the page ships.
- A fact reinforced since resets to full strength: the clock restarts from the reinforcement. **[page]**
- Culled facts are deleted from the store; the fact is not archived and the janitor keeps no copy. The IDs of the last run's culls are the only trace (section 6). **[page]** (`sh:157-169`; `jn:96-100`).
- Nothing about episodes the fact came from changes when it is culled (`sh:157-169` touches `facts` only). **[verify]** keep off the page.
- Setting `cullFloor: 0` decays ranking without ever removing a fact (`hy:35`, `hy:90`; `sh:161`: effective is never below 0, so nothing is removed). **[page]**

## 3. What happens to an episode

- An episode records `durability`, `persistent` or `permanent`, default `persistent` for older records, and `stale`, default `false` (`ep:36-53`). Only `persistent` and `permanent` observations become episodes (`ep:38-41`). **[page]**
- **Persistent episodes are deleted** when their age passes a threshold: 500 turns or 90 days, whichever comes first (`jn:46-51`; `eh:128-142`; tests `jt:274-320`). With `operator: 'AND'` both must pass (`eh:134-136`; test `jt:303-320`). **[page]** the defaults and "whichever comes first"; `AND` is **[ref]**.
- The turn leg only matters inside one session (flag 3). **[page]** one sentence.
- Episodes are kept until then even though their content may have been consolidated into facts; the existing docs say consolidation preserves the knowledge (`eh:93-95`: "Knowledge is preserved in consolidation-derived semantic facts either way"). That comment is a doc comment on an exported type, so it is citable, but it is rationale, not an observable. **[cut]**. If the page wants it: "A persistent episode that was consolidated has already become a fact, and the fact outlives it." Whether an episode has been consolidated does not change when it is culled (`eh:118-143` does not read `consolidated`). **[page]** only "consolidated or not".
- **Permanent episodes are never deleted by the janitor.** After `permanentStaleDays`, default 180, from the day they were recorded they get `stale: true`; marking is once, idempotent, and changes nothing else (`eh:100-105`, `eh:149-176`; tests `jt:322-342`, `jt:344-386`). **[page]**
- `maxEpisodes` (default 200) is a separate size cap and is not part of hygiene (`ms:172-176`). **[ref]**; a pointer from this page to the memory catalog page is enough.

## 4. How to turn it off, and how to tune it

The sitemap's second question.

- `hygiene: false` on `system()`: no janitor block is built, `mem.janitor` and `mem.janitorResource` are `undefined`, and the `janitor` session resource is not in `mem.sessionResources` (`ms:418-422`, `ms:847-848`, `ms:902`; test `jt:527-537`). Recall ranks by raw `fact.confidence` (`rc:55-58`, `rc:167-171`; test `jt:655-`). Stores grow without bound except for their own caps (`ms:418-422`; `hy:160`). **[page]**
- Turn off one branch: `confidenceDecay: false` skips fact decay and the cull, and recall then ranks by raw confidence; `episodicTTL: false` skips deletion and stale-marking of episodes (`hc:33-34`, `hc:51-53`; `jb:91`, `jb:125`; tests `jt:485-512`). **[page]**
- Partial overrides keep the other defaults: `hygiene: { confidenceDecay: { halfLife: 60 } }` leaves `cullFloor` at 0.1 and the TTL at defaults (`hc:36-62`; test `jt:554-563`). **[page]**
- The `hygiene` option lives on `system()` and on `createMemoryCapability`. On the capability only the `confidenceDecay` slice acts, on recall ranking; nothing is scheduled there (`mc:80-84`, `mc:188-190`; `cf:66`). **[page]** one sentence: "read side ranks by decay; only `system()` removes".
- Shortest example that compiles against the surface: `system({ model, working: true, episodic: true, semantic: true, hygiene: { confidenceDecay: { halfLife: 60, cullFloor: 0.05 }, episodicTTL: { persistentDays: 30 } } })` (`hy:69-83`; `ms:308-346`; test `jt:554-563`). The page's own app names go in; `openai/gpt-6-luna` is the model name `hy` uses. **[page]**
- Option table: `halfLife` (days, 180, `> 0`), `cullFloor` (0.1, in `[0, 1)`), `persistentTurns` (500), `persistentDays` (90), `operator` (`'OR'` default, `'AND'`), `permanentStaleDays` (180), `schedule` (`'onConsolidation'` default). Seven fields, more than three options: **[ref]** (`jn:44-53`; `ms:308-346`; `hy:85-113`). The page names `halfLife`, `cullFloor`, `persistentDays` and `schedule`, and links to the Reference row for the rest.

## 5. When it runs, and calling the janitor

The sitemap's "calling the janitor".

- **Default `schedule: 'onConsolidation'`**: the janitor is appended to the consolidation chain after the new facts are written and before the digest is rebuilt, so it runs whenever consolidation runs (`msb:1428-1440`; `ms:335-339`). Consolidation runs after 5 new episodes, at most once per 4 turns, and when persistent items are evicted from working memory (`ms:178-183`; `cf:183-189`). **[page]** "when consolidation runs"; thresholds **[ref]**.
- So the janitor does not run every turn by default. It does not run at all if consolidation never triggers; e.g. a session that ends before 5 new episodes. **[page]** as consequence. The janitor's schedule is a property of consolidation cadence (`msb:1439-1440`). **[verify]** keep "if consolidation never runs, neither does the janitor" off the page unless run once; it follows from the wiring but no test asserts it.
- **Episodic-only app**: with `onConsolidation` and no semantic tier there is no consolidation chain, so the janitor is attached to the capture pipeline instead and episodic cleanup still runs (`msb:1838-1851`). **[page]** one sentence.
- **`schedule: 'onCapture'`**: runs as a background side chain on every capture, every turn (`ms:340-342`; `msb:1845-1851`). The doc comment calls it rarely worth it (`ms:340-342`). **[page]** one line.
- **`schedule: 'manual'`**: never wired in; call it yourself (`ms:342-344`; `msb:1837-1840`). **[page]**
- **Calling it directly.** `mem.janitor` is a handler block (`jb:62-63`) with `inputSchema: z.any()` and no output (`jb:64-65`). It takes any input, returns nothing, and so can be a step in a sequencer. The existing page's example is `sequencer({ name: 'cleanup', inputSchema: z.any() }).step(mem.janitor!)` (`hy:129-131`). `mem.janitor` is typed optional, hence the `!` (`ms:462`; `hy:130`). **[page]** the example, given its own file path and imports (`sequencer` from `@flow-state-dev/core`, `z` from `zod`; the existing example omits both). **[verify]** that `sequencer` with `.step` compiles as written; type-check before shipping.
- Where to call it from: the existing page names a nightly cron, a Vercel cron route, a teardown step (`hy:117`). The flow would be wired as an action; whether a scheduled action can reach the same user's stores is **[gap]** here and belongs to the scheduled-actions page. The page links, does not claim.
- The block needs the semantic and episodic resources of the memory system it came from; it installs them by itself (`jb:66-74`). A janitor built from a `system()` without episodic skips the episodic branch silently, and the same for semantic (`jb:70-73`; `jb:91`, `jb:125`). **[ref]**
- If `hygiene` is set explicitly, `schedule` is not `'manual'`, and neither tier is configured, `system()` logs a warning that the janitor will no-op (`ms:803-813`). **[ref]**
- A failure inside any branch is caught and logged with `console.warn`; the run still records its result (`jb:95-97`, `jb:120-122`, `jb:129-136`). **[ref]** ("What goes to Reference": a crash halfway through.)

## 6. What an operator can see

The sitemap's third question. This page is about something that stores data, so every stored part answers the four questions.

### The janitor resource (`janitor`)

- **What it is:** one session-scoped resource, `ref: 'janitor'`, `writable: true` (`jn:125-137`). **[page]**
- **Who owns it:** the memory system; `system()` includes it in `mem.sessionResources` when hygiene is on, and the janitor block declares it on itself so it comes in wherever the block is used (`ms:902`; `jb:66-69`; test `jt:515-525`). The app does not write it. **[page]**
- **Who can see it:** anyone who can read session resources of that session: DevTool or the resource registry (`jn:119-123`; `hy:144`). Whether a browser client can read it depends on the flow's client-data settings. **[gap]** the page does not say it is readable from the client. The resource's default `expose` behavior is not cited here; do not assert it.
- **Where it is stored:** in the session's state, through whichever store the app uses; a persistent store keeps it across restarts, the in-memory store does not (`apps/docs/docs/persistence/overview.md`, as cited by the memory page's fact sheet). **[page]** only "stored with the session, in the app's store".
- **How many exist:** one per session, overwritten each run (`jn:94-100`; `hy:144`). It is a snapshot, not a history. A new session starts from the default (`jn:129-135`). **[page]**
- **Fields** (`jn:101-114`): `lastRunTurn`, `lastRunAt` (ISO datetime, absent until the first run), `totalRuns` (cumulative for the session), `lastCulledFactIds`, `lastCulledEpisodeIds`, `lastMarkedStaleEpisodeIds`. Each `last...` array is replaced on each run, so a run that culls nothing sets them to `[]` and the previous run's IDs are gone (`jb:139-147`). **[page]** the six names; the schema types are **[ref]**.
- It records IDs only, not the content of what was removed. Once a fact or episode is culled its text is unrecoverable from memory (`jn:108-111`; `sh:157-169`). **[page]**
- The existing page says an evicted-memory event stream is out of scope (`jn:98-99`, a code comment). **[cut]**; the page says "a snapshot, not a history".
- Several janitor instances in one system (consolidation chain and `mem.janitor`) write the same resource, so the snapshot shows whichever ran last (`ms:841-846`). **[ref]**
- The `janitorResource` and `janitorStateSchema`, `JanitorState`, `DEFAULT_HYGIENE_CONFIG`, `effectiveConfidence`, `memorySystemJanitor` are exported from the package index (`packages/memory/src/index.ts:133-146`; `packages/memory/README.md:139`). **[ref]**

### The stored things the janitor edits (not owned by hygiene; one line each so the page does not misattribute)

- **Semantic facts.** Owned by the memory system. Scope `user` by default and shared across that user's sessions (`sm:57-76`; `ms:173` for the episodic default; the semantic default is set where the tier config is resolved, not read here). Stored in the app's store at user scope. Count: unbounded by hygiene; prune is the only other size control, triggered at 20 facts by default, `0` disables (`ms:286-287`, `ms:190-193`). **[page]** "user scope", "prune is separate"; **[verify]** the semantic default scope before stating it, and say "user or org scope" otherwise.
- **Episodes.** Owned by the memory system. Scope `user` by default, or `org` (`ep:69-84`; `ms:171-176`). Stored in the app's store at that scope. Count: at most 200 by default (`ms:172-176`). Hygiene deletes persistent ones and marks permanent ones. **[page]**
- **Both are shared across sessions; the janitor resource is per session.** So a janitor run in one session culls the user's facts for every session, while its record of what it did lives only in the session that ran it. **[page]** (`jn:125-128`, `sm:75-76`, `ep:69-84`). This is the answer to "what can an operator see": the record is in the session that ran the pass, not on the user. A user whose last run happened in another session shows an empty or default snapshot here (`jn:129-135`). **[page]**

## 7. Limits (where a reader would assume otherwise)

- Hygiene never deletes a permanent episode. **[page]**
- Hygiene never deletes working-memory entries or digests; working memory has its own capacity and decay (`jb:75-148` touches semantic and episodic only). **[page]** one clause, linking to the memory catalog page. The digest is rebuilt after the janitor runs on consolidation (`msb:1428-1431`, a code comment). **[verify]**; keep off.
- It does not undo itself: a culled fact does not come back. If the same thing is said again it is captured as a new fact, with fresh `lastReinforced`. The second half is inferred from `addFact` (`sh:20-30`) and is **[verify]**; keep "it does not come back" only.
- It does not look at content. Whether a fact is still true plays no part; only age since reinforcement and stored confidence do. The contradiction and redundancy review is prune, a model step, off unless the fact count reaches `pruneThreshold` (`ms:287`; `hy:164-169`). **[page]**
- Decay is by wall-clock days, not turns, for facts (`jn:84`). **[page]**

## 8. Links the page can make

- `catalog/memory/index` (K-36): the tiers and installing memory. Exists as a draft at `docs/contributing/docs-revamp/pages/catalog/memory/index.md`.
- `catalog/memory/recall-tool` (K-37): ranking and the recall tool; the `llm-filter` strategy shows raw confidence (`rt:36-38`).
- `catalog/memory/relations`: edges pruned when a subject is culled (`apps/docs/docs/memory/relations.md:36`).
- `reference/memory`: every threshold, error string, the `operator` option, the resource schema, the exported names. **[ref]** rows listed above.

## 9. Sources used

`packages/memory/src/janitor.ts`, `janitor-blocks.ts`, `internal/hygiene-config.ts`, `internal/recall.ts`, `memory-system.ts`, `memory-system-blocks.ts`, `memory-capability.ts`, `episodic-memory.ts`, `episodic-memory-helpers.ts`, `semantic-memory.ts`, `semantic-memory-helpers.ts`, `index.ts`; `packages/memory/test/janitor.test.ts`; `apps/docs/docs/memory/hygiene.md`, `configuration.md`, `overview.md`, `recall-tool.md`, `relations.md`; `packages/memory/README.md`; the sibling fact sheet `docs/contributing/docs-revamp/pages/catalog/memory/index.facts.md`. A draft page exists beside this sheet (`hygiene.md`, a copy of the existing page); it is not evidence. No example under `examples/` or `labs/` uses hygiene (searched `apps/kitchen-sink` for `hygiene`, no match in `.ts`).

## 10. Revise round 1 (page changes this sheet now covers)

- The page no longer states the default object, the option tables, the `schedule` values, the `operator` option, the `cullFloor`/`persistentTurns` thresholds as a list, or the `effectiveConfidence` signature. All are **[ref]** (R-37) and the page links `reference/memory`. The page keeps the formula, the 180-day default half-life, the 0.1 floor, the 500-turn and 90-day persistent-episode defaults and the 180-day stale default, because the eighteen-month answer needs them.
- "Persistent" and "permanent" are defined only as the two durabilities of an episode (`ep:36-53`); the page does not say which observations become which (**[gap]**).
- Fallback clause is "from `extractedAt` when a fact has never been reinforced" (`jn:80`).
- `hygiene: false` is stated as behavior (no janitor, raw confidence ranking, unbounded stores) with no before/after framing.
- The page states the default-schedule order (consolidate, janitor, prune) only for the default schedule (flag 7).
- Relation-edge removal is one bullet; its condition (`createImplicitEntities` false) is **[ref]**.
- Worked 548-day figures are derived from the formula, not from a test: 0.5^(548/180) = 0.1213; 0.8 gives 0.097, 0.9 gives 0.109.

## 11. Revise round 2

- Persistent and permanent are now defined before the bullet list: each episode is classified when recorded, a record with no classification counts as persistent (`ep:36-45`, doc comment). Who or what assigns the class stays **[gap]**; the page does not say.
- The standalone sentence after the list is gone; the memory overview link moved into the definition.
- `schedule: "manual"` is stated as "the janitor then runs only when you run it" (`ms:342-344`; `msb:1837-1840`).

## 12. Revise round 3

- New "When it runs" section states the default trigger (`msb:1428-1440`; `ms:178-183`): consolidation after 5 new episodes, at most once every 4 turns, or on persistent eviction from working memory. Page now states these three numbers (**[page]**, promoted from **[ref]**, because the "short session" question needs them). A two-turn, three-episode session does not trigger it.
- Episodic-only app: janitor attaches to the capture pipeline (`msb:1838-1851`), stated in one sentence.
- `onCapture` (`ms:340-342`; `msb:1845-1851`) and `manual` stated as one line each; "Run it yourself" opens on the nightly-regardless case.
