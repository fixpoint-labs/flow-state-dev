# Fact sheet: Memory (R-37, reference, `reference/memory`)

Pass 1. Cites only: existing user docs (`apps/docs/docs/memory/*.md`, `apps/docs/docs/resources/client-access.md`,
`apps/docs/docs/persistence/overview.md`, `apps/docs/docs/advanced/flow-isolation.md`,
`apps/docs/docs/sequencers/composing-blocks.md`), `packages/memory/README.md`, the exported surface and its doc
comments, tests, and the one app that uses it. No spec was read. Every surface here is built.

**[impl]** marks an observable behaviour I could confirm only in non-exported source (an internal block, a counter),
not in an exported doc comment. Pass 5 should confirm each by a test or a run before the page states it.
**[verify]** is not confirmed end to end: keep off the page or soften. **[cut]** is history or design defense.

All paths are under `/home/user/flow-state-dev/packages/memory/` unless they start with `apps/`, `packages/core/`
or `docs/`. Abbreviations:

| Abbr | File |
|---|---|
| `ms` | `src/memory-system.ts` (config types, defaults, `system()`) |
| `mc` | `src/memory-capability.ts` (`createMemoryCapability`, presets) |
| `cfg` | `src/internal/config.ts` (tier defaulting) [impl] |
| `hc` | `src/internal/hygiene-config.ts` (hygiene validation) [impl] |
| `jn` / `jb` | `src/janitor.ts` / `src/janitor-blocks.ts` |
| `eh` / `ep` | `src/episodic-memory-helpers.ts` / `src/episodic-memory.ts` |
| `sh` / `sm` | `src/semantic-memory-helpers.ts` / `src/semantic-memory.ts` |
| `wh` / `wm` / `wb` | `src/working-memory-helpers.ts` / `src/working-memory.ts` / `src/working-memory-blocks.ts` |
| `dm` / `db` | `src/digest-memory.ts` / `src/digest-blocks.ts` |
| `msb` | `src/memory-system-blocks.ts` [impl] |
| `rc` | `src/internal/recall.ts` (`mem.recall()`) [impl] |
| `rt` / `ft` / `ty` / `ct` | `src/tools/recall-tool.ts` / `format-helpers.ts` / `types.ts` / `connect-tool.ts` |
| `lf` / `ge` / `si` | `src/tools/strategies/llm-filter-strategy.ts` / `graph-expand.ts` / `index.ts` |
| `ce` | `src/capture-evaluator.ts` |
| `ca` | `src/capabilities.ts` |
| `fm` | `src/formatter.ts` |
| `ix` | `src/index.ts` (public exports) |
| `T:janitor` `T:rel` `T:recall` `T:cap` `T:sys` | `test/janitor.test.ts`, `test/relations.spec.ts`, `test/tools/recall-tool.test.ts`, `test/capabilities.test.ts`, `test/memory-system.test.ts` |
| `edges` / `trav` / `edge` | `packages/core/src/graph/resource-edges.ts` / `traverse.ts` / `edge.ts` |
| `cf` `hy` `rl` `rtool` `ov` | `apps/docs/docs/memory/` `configuration.md` `hygiene.md` `relations.md` `recall-tool.md` `overview.md` |

## 0. What the page is, the lookups it answers, and the four questions

Reference for `@flow-state-dev/memory`: every option by tier, the hygiene settings, the recall strategies and tool
arguments, relations, presets, what is stored. Tables and signatures only; no narrative. The sitemap lookup is
"What is the default decay?". There are **two** decays with different units and defaults; the table must name both
(section 12):

- Working memory salience: `decay.strategy` `"power-law"`, `decay.rate` `0.5`, measured in turns (`wh:21-26`, `wh:53-64`).
- Semantic fact confidence (hygiene): half-life `180` days (`jn:44-53`).

Four questions per stored part are answered in section 10.

## 1. Two entry points and their top-level options

| Entry | Returns | Writes memory? | Source |
|---|---|---|---|
| `createMemoryCapability(options)` | `MemoryCapability`: a capability plus `sessionResources`, `userResources`, `tiers`, `recallToolBlock`, and `connectToolBlock` (relations only) | Only through the `ctx.cap` helpers it installs (`workingMemory.add/evict/pin/unpin/refresh/tick`, `episodicMemory.encode/markConsolidated`, `semanticMemory.addFact/updateFact/reinforce/removeFact`); no capture, consolidation, prune or janitor pipeline | `mc:100-128`, `mc:418-422`; `cap:63-76`, `cap:126-135`, `cap:193-209` |
| `system(config)` | `MemorySystem`: everything above (as `mem.capability`) plus capture, consolidate, prune, janitor, digest regeneration | Yes | `ms:447-662`, `ms:776-981` |

`system()` builds `createMemoryCapability` internally, so `mem.capability` is the same object the capability factory
returns (`ms:777-791`, comment). `mem.capability === memCap` holds by construction.

### 1.1 `createMemoryCapability(options)` (`CreateMemoryCapabilityOptions`, `mc:65-85`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `model` | `string \| string[]` | required | Model for the recall tool's filter call. An array uses its first entry (`mc:248-252`). Throws if null or an empty array (`mc:181-183`). |
| `working` | `WorkingMemorySystemConfig \| true` | required | |
| `episodic` | `EpisodicMemoryConfig \| true` | omitted = tier off | |
| `semantic` | `SemanticMemoryConfig \| true` | omitted = off | Requires `episodic`. |
| `digest` | `DigestSystemConfig \| true` | omitted = off | Requires `semantic`. |
| `tool` | `MemoryToolConfig` | recall tool defaults | Section 5. |
| `hygiene` | `HygieneConfig \| true \| false` | `true` (defaults) | Only `confidenceDecay` acts here: it sets recall ranking. No janitor is built here (`mc:78-84`, `mc:188-190`). The whole object is still validated (`hc:24-83` runs from `mc:190`). |

### 1.2 `system(config)` adds (`MemorySystemConfig`, `ms:374-433`)

| Field | Type | Default | Notes |
|---|---|---|---|
| `consolidationModel` | `string \| string[]` | `model` | Array = fallback chain on retryable provider errors (`ms:375-388`). |
| `pruneModel` | `string \| string[]` | `model` | `ms:390`. |
| `name` | `string` | `memory/...` names | Prefixes the capture pipeline's block names, e.g. `<name>/observe`, `<name>/janitor` (`msb:722`, `msb:757`, `msb:928`, `jb:63`) [impl]. |
| `source` | `(input, ctx) => string` | reads `ctx.session.items` | Overrides the text the observer reads (`ms:411`; `msb:713`, `msb:1766`) [impl]. |
| `maxAssistantChars` | `number` | `500` | Cap on the assistant text `mem.captureFromItems` includes; longer text is cut and ` [truncated]` appended (`ms:186-188`, `ms:738-741`, `ms:876`). |
| `evaluator` | evaluator block | none | Asked before the observer. Section 11. |
| `inputSchema` | `ZodTypeAny` | none | **Declared (`ms:409`) but nothing reads it** (grep of `src/` finds only the declaration). The existing page `cf:78-79` lists it; it has no effect. Do not document it as working. **[verify]** by a test that passes one and sees it ignored, or leave it off the page. |

The rest of `MemorySystemConfig` is the tier fields, `tool` and `hygiene` of 1.1 (`ms:374-433`).

Tier dependencies are checked at construction, by both entry points (`mc:164-177`, `cf:23`):

| Condition | Error message |
|---|---|
| `semantic` without `episodic` | `Semantic memory requires episodic memory to be configured` |
| `digest` without `semantic` | `Digest requires semantic memory to be configured` |
| `model` missing | `createMemoryCapability requires a \`model\` for the recall tool` |

`working` alone is allowed. `relations` nests under `semantic`, so it needs no separate check (`mc:174-177`).

### 1.3 What `system()` returns (`MemorySystem`, `ms:447-662`, `ms:880-980`)

| Member | Present when | What it is |
|---|---|---|
| `capability` | always | The composed capability (`uses: [mem.capability]`). |
| `capture` | always | Capture pipeline sequencer: observe, reflect, tick; plus consolidate and prune side chains when `semantic` is set (`msb:1816-1855`). `inputSchema: z.any()`; reads unread session `message` items first and uses a string input only when there are none (`msb:1798-1800`, `msb:602-632`). |
| `captureFromItems` | always | `capture` with its input read from session items: the last user message, up to 3 prior user messages as context, and the assistant reply after it (`ms:688-746`, `ms:877`). Use after the generator with `.sideChain()` (`ms:450-451`). |
| `consolidate`, `prune` | `semantic` set | Standalone sequencers (`ms:855-861`). |
| `janitor`, `janitorResource` | `hygiene` not `false` and `semantic` or `episodic` set | Section 4.5 (`ms:847-849`, `ms:919-922`; `T:janitor:515-552`). |
| `regenerateDigest` | `digest` set | Digest regeneration pre-bound with `force: true` (`ms:970-974`). |
| `recall(ctx, cue?)` | always | Cross-store ranked recall (`mem.recall()`, section 5.5). |
| `contextFormatter` / `formatContext` | always | Digest plus working sections by default (`ms:866-873`, `ms:468-483`). |
| `working`, `episodic`, `semantic`, `digest` | per tier | `{ resource, helpers }` (`ms:880-977`). |
| `sessionResources` | always | `workingMemory`, `memorySystem`, and `janitor` when the janitor exists (`ms:900-903`). |
| `userResources` | per tier | `episodicMemory`, `semanticMemory`, `digestMemory` (`ms:904`, `mc:385-389`). |
| `workingMemoryCapability`, `episodicMemoryCapability`, `semanticMemoryCapability`, `digestMemoryCapability` | per tier | The per-tier capabilities (`ms:905-906`, `ms:939-978`). |
| `tool.recall()` | always | The recall tool block. `tool.connect()` only with relations (`ms:907-912`). |

Register the resources on the flow: `resources: { ...mem.sessionResources, ...mem.userResources }` (`ms:542-548`,
`cf:51-55`). When `hygiene` is explicit, `schedule` is not `'manual'`, and neither `semantic` nor `episodic` is set,
`system()` logs `[memory] hygiene is enabled but neither semantic nor episodic memory is configured — janitor will no-op.`
(`ms:799-814`).

## 2. Options by tier

Defaults exported: `DEFAULT_WORKING_MEMORY_CONFIG`, `DEFAULT_EPISODIC_CONFIG`, `DEFAULT_CONSOLIDATION_CONFIG`,
`DEFAULT_OBSERVER_CONFIG`, `DEFAULT_PRUNE_CONFIG`, `DEFAULT_DIGEST_CONFIG`, `DEFAULT_HYGIENE_CONFIG`
(`ix:31`, `ix:88-95`, `ix:140`, `ix:216`). Pass `true` for any tier to take every default (`cfg:146-211`).

### 2.1 `working` (`WorkingMemorySystemConfig`, `ms:206-210`; defaults `wh:21-26`; resolved `cfg:147-158`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `capacity` | `number` | `7` | Entries held. At capacity, adding evicts the lowest-salience unpinned entry. If every entry is pinned, the new one is added anyway and capacity is exceeded (`wh:98-106`, `wh:136-152`). |
| `maxPinnedSlots` | `number` | `2` | `pin` returns `false` when that many are already pinned (`wh:181-208`). |
| `decay.strategy` | `"power-law" \| "exponential" \| "none"` | `"power-law"` | Factor for `elapsed` turns: power-law `(1 + elapsed)^-rate`, exponential `exp(-rate * elapsed)`, none `1`; negative elapsed counts as 0 (`wh:43-64`). |
| `decay.rate` | `number` | `0.5` | Rate in those formulas. |

Salience is `importance * decay(turns since last access)`, clamped to [0, 1] (`wh:66-78`). It is recomputed each time the
turn counter advances (`wh:252-270`). `refresh` resets an entry's last-access turn. Explicit `evict` removes a pinned entry
(`wh:166-179`).

Behaviours of the unified capture that touch these settings [impl]: an observation with importance 0.85 or above is
pinned automatically, if a slot is free (`msb:809-812`). Working memory is session-scoped, so its turn counter resets with
each session.

Standalone capture, `workingMemoryCapture(config?)` (`wb:15-34`, `wb:268-293`): `name`, `model` (default `'gpt-6-luna'`),
`capacity`, `maxPinnedSlots`, `decay`, `maxExtractPerTurn` (default `3`). It runs its own observer, independent of
`system()`. Takes a string.

### 2.2 `episodic` (`EpisodicMemoryConfig`, `ms:213-226`; defaults `ms:172-176`; resolved `cfg:160-169`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `scope` | `"user" \| "org"` | `"user"` | Where episodes are stored. |
| `flowIsolation` | `boolean` | omitted: follows the flow | Section 3. |
| `significanceThreshold` | `number` | `0.6` | An observation becomes an episode only when it is persistent or permanent and its importance is at or above this (`msb:818-824`) [impl]. |
| `maxEpisodes` | `number` | `200` | At the cap, a new episode evicts the oldest consolidated episode, else the oldest of all (`eh:20-68`, `eh:45-58`). |

An episode (`ep:6-53`): `id`, `content`, `occurredAtTurn`, `encodedAt`, `significance` [0, 1], `category`
(`identity`, `event`, `preference`, `task`, `relationship`, `profession`, `belief`, `attribute`, `pattern`), `subject`
(default `'user'`), `context { sessionId, precedingTopic? }`, `consolidated` (default `false`), `durability`
(`'persistent' | 'permanent'`, default `'persistent'`), `stale` (default `false`). The resource also keeps `totalEncoded`
(`ep:59-64`).

### 2.3 `semantic` (`SemanticMemoryConfig`, `ms:269-296`; defaults `ms:179-194`; resolved `cfg:171-187`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `scope` | `"user" \| "org"` | the episodic scope, else `"user"` | `cfg:173-175`. Standalone `createSemanticMemoryCapability` defaults to `"user"` (`ca:168-170`). |
| `flowIsolation` | `boolean` | omitted: follows the flow; not inherited from episodic | Section 3 (`ms:277`, doc comment). |
| `consolidation.episodicThreshold` | `number` | `5` | New episodic writes since the last consolidation that trigger one. |
| `consolidation.onEviction` | `boolean` | `true` | Also trigger when a persistent or permanent working-memory entry has been replaced by a richer overlapping observation since the last consolidation; capacity evictions do not count (`msb:787-797`). See the note below. |
| `consolidation.minInterval` | `number` | `4` | Turns that must pass since the last consolidation. The existing page says "framework default" (`cf:187`); the number is 4 (`ms:179-183`). |
| `pruneThreshold` | `number` | `20` | Prune runs when the fact count reaches this. `0` disables it (`msb:1485`, `msb:1502`). |
| `relations` | `boolean \| RelationsConfig` | off | Section 7. |

Consolidation trigger [impl] (`msb:1018-1026`): `turnsSinceConsolidation >= minInterval` **and** (`episodicWritesSince >= episodicThreshold`
**or** (`onEviction` and `evictedPersistentSince > 0`)). Turns are working-memory turns. `onEviction` counts a
persistent or permanent working-memory entry that is replaced by a newer, partly-overlapping observation (`msb:788-797`,
counter at `msb:903`). The counter is not incremented anywhere else, including when `add` evicts a low-salience entry at
capacity. The doc comment says "persistent items evicted from WM" (`ms:281`); pass 5 should check the wording against
`T:sys:834` (the one test that sets `onEviction: false`). **[verify]**

A fact (`sm:18-37`): `id`, `subject` (default `'user'`), `content`, `confidence` [0, 1], `category` (`identity`,
`relationship`, `preference`, `belief`, `profession`, `attribute`, `pattern`), `sourceEpisodeIds`, `extractedAt`,
`lastReinforced?`, `reinforcementCount` (min 1). The resource also keeps `totalExtracted` and `totalConsolidations`
(`sm:43-50`). New facts get `lastReinforced` equal to `extractedAt`; `reinforce` and `updateFact` reset it and bump the
count (`sh:18-108`; `T:janitor:205-220`). `reinforce` adds `0.05` confidence by default, capped at 1 (`sh:82-102`).

Prune [impl]: an LLM step that returns removals and merges for the full fact set (`msb:1457-1470`, `msb:1515-1530`). A merge
is refused unless all source facts share one subject (`msb:1630-1647`). Facts are grouped by subject in
the prompt. It runs as its own side chain after consolidate (`msb:1831-1835`).

### 2.4 `digest` (`DigestSystemConfig`, `ms:229-241`; defaults `ms:196-199`; resolved `cfg:192-208`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `maxTokens` | `number` | `400` | Cap passed to the digest model call (`db:319`); the prompt also asks for "roughly" that many (`db:304`). |
| `topN.facts` | `number` | `30` | Facts fed to regeneration, most reinforced first (`db:241`, `sh:138-140`). |
| `topN.episodes` | `number` | `10` | Episodes fed to regeneration, ranked by `rankEpisodesForDigest` (`db:250`). |

There is no `digest.scope` and no `digest.flowIsolation`: scope is the semantic tier's (`ms:399-404` doc comment, `cfg:194`,
`dm:53-61`). Isolation is derived (section 3.2). Stored shape (`dm:29-51`): `digest { content, generatedAt, generatedAtTurn,
sourceSignature { semanticFactCount, semanticReinforcementSum, episodeCount } }`, `totalGenerated`.

Regeneration [impl]: runs as the last step of the consolidation chain and of the prune chain (`msb:972-980`, `msb:1443`, `msb:1688`).
It skips when the stored `sourceSignature` equals the current one (fact count, reinforcement sum, episode count) unless
`force` is set (`db:62-65`, `db:227-237`; `dm:44-58` helpers, exported from the package root as `digestIsStale` and `computeDigestSourceSignature`, `ix:178-181`; also `mem.digest.helpers.isStale` and `.computeSourceSignature`). A
facts-only or consolidate-only run that changes nothing leaves the digest alone. The digest describes the primary user
(`subject=user`); other people appear in relation to them (`db:140-180`, `db:289-296` prompt) [impl, prompt content]. Per the
standard, the page states "describes the user; other people appear in relation to them" and not the prompt.

### 2.5 Capture pipeline settings that sit outside any tier

`system()` only. `maxAssistantChars` (500), `source`, `name`, `evaluator` (section 1.2). Capture reads the last user message
plus up to 3 prior user messages for context (`ms:688`, `priorTurns = 3`).

## 3. Scope and flow isolation

### 3.1 The rule per tier

| Tier | Scope | `flowIsolation` option | Source |
|---|---|---|---|
| Working | session | none (session scope rejects it) | `wm:54-59`; `cf:245` |
| Episodic | `user` or `org`, default `user` | yes | `ms:213-226` |
| Semantic | `user` or `org`, default the episodic scope | yes | `cfg:173-175` |
| Digest | the semantic tier's scope | derived, no option | `cfg:194`, `cfg:117-135` |

`flowIsolation` per tier: `true` keeps the tier per flow copy (each registered flow, each named copy of a collection flow)
even when the flow shares its user or org state; `false` shares it across every flow for that user or org even when the flow
sets `isolateUserState: true` (`isolateOrgState` at org scope); omitted takes the flow's setting (`cf:214-222`;
`ms:215-221` doc comment; `apps/docs/docs/advanced/flow-isolation.md:28-53`). Each tier is set on its own: `semantic` does not
pick up `episodic`'s value (`cf:245`, `ms:271-277`).

### 3.2 Digest isolation (derived, `cfg:117-135`)

| Episodic | Semantic | Digest |
|---|---|---|
| `flowIsolation: true` | any | isolated (`true`) |
| any | `flowIsolation: true` | isolated |
| `false` | `false` | shared (`false`) |
| omitted, and scope differs from semantic's | anything else | isolated |
| otherwise | | follows the flow |

The existing page `cf:204` states this in prose; the table is the same logic. Composing tiers by hand skips the rule: pass
`flowIsolation: true` to `createDigestMemoryResource` / `createDigestMemoryCapability` whenever either source is isolated
(`ca:205-213`, `cf:247`).

### 3.3 Factory signatures that take it (`resource-options.ts:6-19`, `ca:99-153`, `ep:85`, `sm:69-73`, `dm:62`)

- `createEpisodicMemoryResource(scope, options?)`, `createDigestMemoryResource(scope, options?)`, `createSemanticMemoryResource(scope, relations?, options?)`, with `options: MemoryResourceOptions = { flowIsolation?: boolean }`.
- `createEpisodicMemoryCapability(config?)` (`scope`, `maxEpisodes` default 200, `flowIsolation`), `createSemanticMemoryCapability(config?)` (`scope`, `edges?: EdgeSlotConfig`, `flowIsolation`), `createDigestMemoryCapability(config?)` (`scope`, `flowIsolation`), `createWorkingMemoryCapability(config?)` (working helper config). Default instances: `workingMemoryCapability`, `episodicMemoryCapability`, `semanticMemoryCapability`, `digestMemoryCapability` (`ca:92`, `ca:136`, `ca:198`, `ca:242`).

## 4. Hygiene settings

`HygieneConfig` (`ms:308-346`). `hygiene` accepts `true` (defaults), `false` (off), or an object; omitted means `true`
(`hc:24-31`). Partial objects merge onto defaults, field by field (`hc:36-62`; `T:janitor:554-563`).

### 4.1 Defaults (`DEFAULT_HYGIENE_CONFIG`, `jn:44-53`, exported `ix:136-141`)

```ts
{
  confidenceDecay: { halfLife: 180, cullFloor: 0.1 },
  episodicTTL: { persistentTurns: 500, persistentDays: 90, operator: 'OR', permanentStaleDays: 180 },
  schedule: 'onConsolidation',
}
```

The page shows these values as a file-titled `satisfies HygieneConfig` declaration (`HygieneConfig` is exported, `ix:221`; `operator` is `'OR' | 'AND'`, `schedule` is `'onConsolidation' | 'onCapture' | 'manual'`, `ms:330`, `ms:345`) so the block type-checks.

### 4.2 `confidenceDecay` (`boolean | { halfLife?, cullFloor? }`; `hc:32-48`)

| Field | Default | Valid | Meaning |
|---|---|---|---|
| `halfLife` | `180` | `> 0`; else throws `hygiene.confidenceDecay.halfLife must be > 0, got <n>` | Days for effective confidence to halve. |
| `cullFloor` | `0.1` | `[0, 1)`; else throws `hygiene.confidenceDecay.cullFloor must be in [0, 1), got <n>` | Facts whose effective confidence is below this are deleted. `0` never culls. A fact exactly at the floor is kept (`sh:161`, `>=`; `T:janitor:237`). |

`confidenceDecay: false` skips the semantic branch: no decay, no cull, and `mem.recall()` ranks on raw `fact.confidence`
(`hc:33-34`; `rc:59-61`; `jb:91`; `T:janitor:485-495`, `T:janitor:655-670`). `true` or omitted means the defaults.
The hygiene validator's own doc comment says `cullFloor` "in `[0, 1]`" (`hc:19`); the code is `[0, 1)` (`hc:44`). **Code wins.**

### 4.3 Effective confidence (`effectiveConfidence(fact, now?, halfLife?)`, `jn:55-91`, exported `ix:137`)

`effective = confidence * 0.5 ^ (elapsedDays / halfLife)`. Computed when read; the stored `confidence` never changes
(`jn:9-11`). `elapsedDays` runs from `fact.lastReinforced`, else `fact.extractedAt` (`jn:80`). At one half-life the value is
half, at two a quarter (`T:janitor:160-170`). Result is clamped to `[0, fact.confidence]`: zero or negative elapsed time
(clock skew) and an unparsable timestamp both return the raw confidence (`jn:82-90`; `T:janitor:188-192`). `halfLife`
defaults to 180 (`jn:78`).

Worked figures, computed from the formula (not from a test), for the page's lookup column: a fact at 0.8 falls below the
0.1 floor at `180 * log2(8) = 540` days; at 548 days the factor is `0.5^(548/180) = 0.1213`, so 0.8 becomes 0.097 (removed) and
0.9 becomes 0.109 (kept). **[verify]** by one scratch call to `effectiveConfidence` before the page ships them.

Where it is read:

| Reader | Uses effective confidence? | Source |
|---|---|---|
| `mem.recall()` / `ctx.cap.memory.recall()` | Yes, with the configured `halfLife`; raw confidence when `confidenceDecay` is off or `hygiene: false` | `rc:59-61`, `rc:164-173`; `T:janitor:627-670` |
| The janitor's cull | Yes | `sh:161` |
| Built-in `llm-filter` recall tool | **No.** Every semantic fact is a candidate and the model sees raw `confidence` | `lf:239-240`, `lf:339-347` |
| `intrinsicSemanticScore(fact, now?, halfLife?)` | Yes, default half-life 180 unless passed, `false` skips decay; **not called by the built-in strategy**, exported for custom strategies | `lf:81-91`; `ix:275`; `T:janitor:618-625` |

### 4.4 `episodicTTL` (`boolean | { persistentTurns?, persistentDays?, operator?, permanentStaleDays? }`; `hc:50-76`)

| Field | Default | Valid | Meaning |
|---|---|---|---|
| `persistentTurns` | `500` | `> 0` | Turn age at or past which a persistent episode is culled. Age is `max(0, currentTurn - occurredAtTurn)`. |
| `persistentDays` | `90` | `> 0` | Days since `encodedAt` at or past which a persistent episode is culled. |
| `operator` | `'OR'` | `'OR' \| 'AND'` | `'OR'` culls when either test fires; `'AND'` only when both do. |
| `permanentStaleDays` | `180` | `> 0` | Days since `encodedAt` at or past which a permanent episode gets `stale: true`. |

Errors: `hygiene.episodicTTL.persistentTurns must be > 0, got <n>`, same for `persistentDays` and `permanentStaleDays`
(`hc:67-75`; `T:janitor:585-612`). Both tests use `>=` (`eh:132-133`, `eh:169`). `episodicTTL: false` skips the episodic
branch (`hc:51-53`; `jb:125`; `T:janitor:497-512`).

Turn leg across sessions: `currentTurn` is read from session-scoped working memory and resets each session; episodes persist
across sessions, so an episode from an earlier session is aged against the current session's counter: age is max(0, currentTurn - occurredAtTurn), so 0 while the current turn is at or below occurredAtTurn and otherwise the gap; the days test usually fires first in a new session (`eh:123-128`) [impl]. Permanent episodes are never deleted by the
janitor; marking is one-time and idempotent, and nothing else about the episode changes (`eh:100-105`, `eh:149-176`;
`T:janitor:322-386`). The age is measured from `encodedAt`, not from last use (nothing resets it). Nothing in the package
reads `stale` back: recall and the context formatter do not filter on it (grep of `src/`). **State only "marked `stale: true`";
do not claim it affects recall.**

### 4.5 `schedule` and the janitor

| Value | Behaviour | Source |
|---|---|---|
| `'onConsolidation'` (default) | The janitor is a `.tap()` in the consolidation chain, after persist and before digest regeneration, so it runs whenever consolidation triggers. With `episodic` set and no `semantic` there is no consolidation chain, so the janitor runs every turn as a `.sideChain()` of the capture pipeline instead. | `msb:1428-1443`, `msb:1842-1851` [impl]; `ms:335-345` |
| `'onCapture'` | Every capture, as a `.sideChain()` step after the other side chains. The doc comment calls it rarely worth the cost. | `msb:1845-1851`; `ms:335-345` |
| `'manual'` | Never wired. Run `mem.janitor` yourself. | `msb:1837-1840`; `ms:335-345` |

`mem.janitor` is a handler block: `inputSchema: z.any()`, no output (`jb:62-65`), so it fits as a step in a sequencer
(`hy:129-131`). It is `undefined` when `hygiene: false` or when neither `semantic` nor `episodic` is set (`ms:847-849`,
`T:janitor:527-552`), so the type is optional and callers write `mem.janitor!`. It declares its own resources, so it works
wherever it is used (`jb:66-74`). It makes no model call (`jb:75-148`). A branch that throws is caught and `console.warn`ed,
and the run still records its result (`jb:95-97`, `jb:120-122`, `jb:129-136`) [impl].

A run does, in order: cull facts (if `confidenceDecay` on); prune dangling relation edges (if relations on and
`createImplicitEntities` is false); cull persistent episodes and mark permanent ones stale (if `episodicTTL` on); write the
`janitor` resource (`jb:85-147`).

**Order versus prune.** Inside the consolidation chain the order is generate, persist, janitor, digest regeneration
(`msb:1428-1443`). Prune is a separate side chain on the capture pipeline (`msb:1831-1835`), and side chains run in parallel,
not in order (`apps/docs/docs/sequencers/composing-blocks.md:203`). So "consolidate, then janitor, then prune" is **not** a
guarantee. See row H14 in section 13.

### 4.6 The `janitor` resource (`janitorResource`, `jn:93-137`, exported `ix:136-142`)

Session-scoped, `ref: 'janitor'`. Fields: `lastRunTurn` (int, default 0), `lastRunAt` (ISO datetime, absent until the first
run), `totalRuns` (cumulative for the session), `lastCulledFactIds`, `lastCulledEpisodeIds`, `lastMarkedStaleEpisodeIds`
(string arrays, default `[]`). Each run overwrites the three arrays, so a run that touches nothing sets them to `[]`
(`jb:139-147`). It holds ids only, not the content removed. Inspect via DevTool or the resource registry (`jn:119-123`).
Several janitor instances in one system (the consolidation chain's and `mem.janitor`) share this one resource, so it shows
whichever ran last (`ms:841-846`, comment) [impl]. The janitor does not touch working memory or digests (`jb:75-148`).

## 5. Recall

### 5.1 Installing it

`recall` is a preset on `mem.capability` and on the capability from `createMemoryCapability`, default on. `recall: false`
turns it off. It installs the `memory/recall` tool and a hint sentence in the `<memory>` context block telling the model to
call `memory_recall` before saying it does not know (`mc:352-362`, `mc:316-377`; `T:cap:488-508`). The preset is installed
whatever tiers are configured (`mc:357-362`: `tools: () => [recallToolBlock]`, unconditional). A generator that declares its
own `tools:` list gets only that list; name the tool in it: `tools: [lookupOrder, mem.tool.recall()]` (`rtool:11`;
`cf:274`; `ms:641-650`).

**Working-only.** With only `working` configured the recall tool still installs, but the built-in strategy reads only
semantic facts and episodes (`lf:165-190`), never working memory (`ms:644-647` doc comment), so every call comes back
`No memories matched "<query>".` (`ft:30-36`, `T:recall:271`). The preset's own doc comment says "No-op when neither
episodic nor semantic is configured" (`mc:353-356`); the code does not do that. **Code wins.** Leave `recall` off for a
working-only setup. The existing page `rtool:32` says the tool's description string says "semantic facts + past episodes";
the description constant says nothing of the kind (`ty:216-220`). Do not repeat that.

### 5.2 Tool arguments (`recallToolInputSchema`, `ty:73-88`)

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `query` | `string`, min length 1 | required | Natural-language query. |
| `limit` | integer 1 to 20 | `tool.defaults.limit`, else `5` | Clamped into [1, 20] (`rt:102`; `T:recall:310-325`). |
| `sinceTurn` | integer >= 0 | none | Only episodes with `occurredAtTurn >= sinceTurn`; semantic facts and relation edges are not filtered (`lf:235-237`). |

### 5.3 Result (`RecallToolResult`, `ty:185-207`; `ft:95-124`)

Success: `{ results, query, strategy, totalMatched, truncatedTo }`. Each result: `{ id, content, source:
'semantic' | 'episodic' | 'relation', score, metadata, truncated }`. `score` is position-based, `1 - i / n` (top result is 1)
(`ft:106-116`). Metadata: semantic `{ subject, category, confidence, reinforcementCount, lastReinforced }`; episodic
`{ category, occurredAtTurn, significance, encodedAt }` (`ft:73-93`). Error: `{ error, query, strategy }`; any exception in
the pipeline becomes this, the tool never throws into the generator (`rt:127-143`, `rt:159`). What the **model** reads is a
summary string, not the envelope: `- <content>` per result, plus `(n of m matches shown; re-query with narrower terms for
more)` when `totalMatched > truncatedTo`; `No memories matched "<query>".` when empty; `Recall failed: <error>` on error
(`ft:30-43`, `rt:161-167`). The full envelope is kept in the items log and DevTool.

### 5.4 `MemoryToolConfig` (`tool`, `ms:353-371`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `strategy` | `'llm-filter' \| RetrievalStrategy` | `'llm-filter'` | `si:27` (`BuiltInStrategyName` is only `'llm-filter'`). An unknown string throws `Unknown recall strategy: <name>` (`si:54`). |
| `model` | `string` | `model` (first entry if an array) | Model for the strategy's filter call (`mc:248-252`). |
| `defaults.limit` | `number` | `5` | Used when the agent omits `limit` (`ft:49`; `rt:93`). |
| `defaults.perItemCharCap` | `number` | `400` | Result content longer than this is cut. The cut text ends with `TRUNCATION_MARKER`, `… [truncated, re-query with narrower terms for full content]`, and the item gets `truncated: true`. If the cap is no longer than the marker, content is hard-cut with no marker (`ft:45-71`; `T:recall:327-365`, `T:recall:500-520`). |

The exact-phrase pass-through of `llm-filter` (default on) cannot be turned off through `tool`; only
`createLlmFilterStrategy({ model, exactPhrasePassThrough })` sets it (`lf:396-417`, `si:30-35`, `si:49-52`).

### 5.5 `mem.recall(ctx, cue?)` (cross-store helper, `ms:466`, `rc:24-153`) [impl]

Reads semantic facts, working memory and episodes, then returns `RankedMemoryItem[]` sorted by relevance, highest first.
Different from the tool: it includes working memory. Relevance: semantic `effective_or_raw_confidence * (0.5 + 0.5 *
min(1, reinforcementCount / 10))`, plus `0.4 * tokenOverlap` with the cue, capped at 1; working `salience`, plus `0.2 *
overlap`; episodic `significance * (0.5 + 0.5 * occurredAtTurn / maxTurn)`, plus `0.3 * overlap`. A working or episodic item
is dropped when its token overlap exceeds 0.6: a working entry against any semantic result, an episode against any working or semantic result; facts are always kept; working entries are not compared with each other nor episodes with each other (`recall.ts:90-98`, `:118-123`)
(`rc:42-151`). The page should list the ranking in one sentence and the weights only if it keeps a row for them. **[verify]**
the weights with `T:janitor:627-653` and `T:sys` before stating.

### 5.6 The strategy contract (`RetrievalStrategy`, `ty:134-169`)

| Member | Required | Input | Output |
|---|---|---|---|
| `name` | yes | | Shown as `strategy` on results. |
| `prepareBlock` | yes | `PrepareInput`: `{ query, limit, sinceTurn?, strategyName, perItemCharCap }`, limit already defaulted and clamped (`ty:100-107`; `rt:99-107`) | `PrepareEnvelope`: `{ query, limit, candidates: MemoryItem[], shouldFilter, strategyName, sinceTurn?, perItemCharCap }` (`ty:117-132`) |
| `filterBlock` | no | `{ query, limit, candidates }` | `{ selectedIds: string[] }` |
| `formatBlock` | no | `PrepareEnvelope & { selectedIds? }` | `RecallToolResult` |

Pipeline (`rt:148-159`): prepare, then filter only when `shouldFilter` is true and the strategy has a `filterBlock`, then
format. No `filterBlock` means the prepare order is returned as is. Default format (`ft:137-165`): no candidates gives an empty
result with `totalMatched: 0`; with `selectedIds`, ids not among the candidates are dropped and the rest are kept in the
returned order, `totalMatched` is the count kept; without `selectedIds`, the candidate order is used and `totalMatched` is
the candidate count. Set through `tool.strategy` on `system()` or `createMemoryCapability`, or `strategy` on
`createRecallTool({ strategy, defaults })` (`rt:48-58`). Exported for custom strategies: `capContent`, `buildResult`,
`buildResultMetadata`, `defaultFormatBlock`, `semanticToMemoryItem`, `episodeToMemoryItem`, `intrinsicSemanticScore`,
`intrinsicEpisodicScore`, `extractExactPhrases`, `exactPhraseMatches`, `PRE_RANK_EPISODIC_CAP`, `RECENCY_HALF_LIFE`,
`EXACT_PHRASE_CAP`, `resolveStrategy` (`ix:251-281`).

`MemoryItem` (`ty:22-51`): `id`, `content`, `source`, semantic fields (`subject`, `category`, `confidence`,
`reinforcementCount`, `lastReinforced`), episodic fields (`occurredAtTurn`, `significance`, `encodedAt`), relation fields
(`from`, `to`, `relationType`; `confidence` reused). Relation content renders `"<from> <type> <to>"` (`ty:60-70`).

**The existing page's custom-strategy example is wrong** (`rtool:44-60`): it builds a `handler` that returns
`{ results }` and types it as `RetrievalStrategy`. A strategy is an object with `name` and `prepareBlock` (`ty:144-169`).
Its prose "a block factory that produces a handler-shaped block" (`rtool:42`) is also wrong. Code wins; the reference row
gives the contract above.

### 5.7 The built-in `llm-filter` strategy (`lf:1-418`)

| Part | Behaviour | Source |
|---|---|---|
| Candidates | Every semantic fact; the top `30` episodes (`PRE_RANK_EPISODIC_CAP`) by `significance * exp(-(currentTurn - occurredAtTurn) / 50)` (`RECENCY_HALF_LIFE` 50); up to `5` (`EXACT_PHRASE_CAP`) extra episodes outside the top 30 whose text contains a distinctive phrase from the query; with relations on, up to `10` relation edges (section 7.4) | `lf:53-59`, `lf:99-103`, `lf:228-308`, `ge:27` |
| Empty stores | No model call; the empty result | `lf:251-262`; `T:recall:271` |
| Filter | One generator call returning `{ selectedIds }`, ordered most relevant first, at most `limit`, only ids from the candidate list | `lf:314-336`, `lf:367-390` |
| What the model sees per candidate | `[id] (source) {metadata} content`. Semantic metadata is raw `confidence`, not decayed | `lf:339-347`, `lf:374-386` |
| Visibility | The filter generator's items are hidden from the client and from history (`itemVisibility: { client: false, history: false }`) | `lf:388` |
| Why bounded | The candidate list is bounded by episode cap and `pruneThreshold`, so the filter call's size does not grow with the store [impl] | `lf:22-24` (cut the rationale) |

`sinceTurn` applies before the episode scoring (`lf:235-237`). Semantic facts do not pass through the episode cap
(`T:recall:609-640`).

### 5.8 `memory/connect` (relations only; `ct:1-151`)

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `from` | `string`, min 1 | required | Entity to start from. |
| `to` | `string` | none | With it: shortest path between the two. Without: everything connected to `from`. |
| `depth` | integer 1 to 6 | `2` | Max hops (`ct:31-46`, `ct:55`). |

Returns the recall envelope with `strategy: 'graph'`, each edge as a result with metadata `{ from, to, relationType,
confidence }` (`ct:67-92`). Unreachable returns empty results, not an error (`ct:136`; `ct` test `connect-tool.test.ts:158`).
With relations off it returns `{ error: 'The relations graph is not enabled for this memory. Enable the relations tier to use
connect.', query, strategy }` (`ct:119-127`). Entities are lowercased and trimmed (`ct:129-134`). Installed by the `connect`
preset, default on only when relations is on, also `mem.tool.connect()` (`mc:363-376`, `ms:907-912`; `T:cap:785-806`).

## 6. Capability presets and per-tier capabilities

Presets on the composed capability (`MEMORY_CAPABILITY_PRESETS` lists `digest`, `working`, `semantic`, `episodic`, `recall`, `ms:156-162`; `connect` is a sixth preset defined at `mc:325-330`, not in the constant; exported `ix:216`):

| Preset | Default | What it does | When the tier is missing |
|---|---|---|---|
| `digest` | on | Adds `<memory><digest>` with the digest text | empty (`mc:323-325`; `T:cap:510-523`) |
| `working` | on | Adds `<memory><working>`: entries by salience, `- (pinned) content` (`fm:114-124`, `wh:294-304`) | always wired |
| `recall` | on | Installs `memory/recall` and the context hint (5.1) | still installs (5.1) |
| `semantic` | off | Adds `<memory><semantic>`: top 10 facts by reinforcement count, `- (category) [subject=x] content` (`fm:44`, `fm:131-146`, `fm:243-247`) | empty |
| `episodic` | off | Adds `<memory><episodic>`: 5 most recent episodes by `occurredAtTurn`, `- (category, turn n) content` (`fm:47`, `fm:155-170`, `fm:249-253`) | empty |
| `connect` | on only with relations | Installs `memory/connect` (`mc:363-376`) | empty no-op |

Turn them on or off with `mem.capability.with({ recall: false })` or `.presets({ ... })` (both exist:
`packages/core/src/capability/define-capability.ts:146-160`). The default-on set is `['digest', 'working', 'recall']`, plus
`'connect'` with relations (`mc:374-376`; `T:cap:469-486`). Presets only change what one block's prompt and tools contain;
the capture pipeline runs for every configured tier regardless (`ms:131-150`, doc comment). The `ctx.cap` helpers and the
resources are installed whatever the presets say (`mc:277-315`; `cf:265-269`).

For a non-default `topN` or `limit`, call `createMemoryContextFormatter({ digest?, working?, semantic?: boolean |
{ topN? }, episodic?: boolean | { limit? } })` and register it under `context: { memory: ... }` (`fm:69-80`,
`fm:187-237`; `ms:156-163` doc comment). It returns `undefined` when every section is empty, so no `<memory>` block is
rendered (`fm:234`). Exported builders: `createDigestEntry`, `createWorkingEntry`, `createSemanticEntry`,
`createEpisodicEntry`, `DEFAULT_SEMANTIC_TOP_N` (10), `DEFAULT_EPISODIC_LIMIT` (5) (`ix:196-204`).

`ctx.cap` helpers (`mc:281-315`, `ca:55-243`):

| Capability name | Helpers |
|---|---|
| `memory` | `recall(cue?)`, `connections(entity, opts?)`, `relate(from, to, opts?)`, `egoGraph(entity, opts?)` |
| `workingMemory` | `add`, `evict`, `pin`, `unpin`, `refresh`, `tick`, `items`, `format` |
| `episodicMemory` | `encode`, `recent(limit?)`, `markConsolidated` |
| `semanticMemory` | `addFact`, `updateFact`, `reinforce`, `removeFact`, `allFacts(subject?)`, `query(q, limit?, subject?)` |
| `digestMemory` | `get()`, `content()` (regeneration is `mem.regenerateDigest`, not a helper: `ca:215-222`) |

Per-tier capabilities for a setup without `system()`: `workingMemoryCapability` has no presets, so it installs everywhere,
and with `workingMemoryCapture` it is the working-only route (`ca:46-54`, `ca:92`; `T:cap:95-96`). The same factories exist
for the other tiers (section 3.3).

## 7. Relations

### 7.1 Options (`RelationsConfig`, `ms:251-267`; resolved `cfg:49-56`, `cfg:105-115`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `relations` on `semantic` | `boolean \| RelationsConfig` | off | `true` = defaults; omitted or `false` = off: no `edges` field on the semantic resource, no `connect` tool, no extraction (`cfg:105-109`; `T:rel:168-258`). |
| `vocabulary` | `string[]` | none (free text) | Edge types outside it are dropped with a `console.warn` when applied; the extraction prompt is told to use only these (`msb:293-297`, `msb:1070-1072`; `T:rel:516-545`). Memory owns the check; only `maxEdges` is forwarded to the core edge slot (`mc:207-222`; `T:rel:230-258`). |
| `maxEdges` | `number` | none | Cap on **stored** edges, superseded ones included. Section 7.3. |
| `createImplicitEntities` | `boolean` | `false` | With it, an edge endpoint that is not a known fact subject is added as a new node instead of the edge being dropped. |

Requires the semantic tier, which requires episodic (`mc:174-177`).

### 7.2 The stored edge (`edgeSchema`, `edge:35-45`)

`id`, `from`, `to`, `type`, `confidence` (default 1), `validFrom` (nullable), `validUntil` (null while current), `source`
(episode ids), `createdAt`. Edges are stored in the `edges` array on the `semanticMemory` resource's state (`sm:55-68`).
Extraction happens in the consolidation pass, so edges appear only after a consolidation (`msb:1371-1379`). An edges-only
consolidation (no fact changes) applies the edges, does not reset `episodicWritesSinceLastConsolidation` or `lastConsolidationTurn` and does not add to `totalConsolidations` (`msb:1392`; `T:rel:393-418`).

### 7.3 Endpoint rules, supersession, caps (`msb:205-350` [impl])

| Rule | Behaviour | Source |
|---|---|---|
| Canonical form | Endpoints are trimmed and lowercased. "NVDA" and "nvda" are one node; "NVDA" and "Nvidia" are two | `internal/helpers.ts:16-18`; `msb:242-244` |
| Known endpoints | An endpoint must equal the canonical subject of some stored fact; an edge naming an unknown one is dropped with a warning, unless `createImplicitEntities` is true | `msb:231-250`, `msb:286-291`; `T:rel:547-577` |
| New edge, existing match | A `new` proposal with an active edge of the same from, to and type is treated as a reinforce: the old record is superseded and a replacement added at confidence `+0.05`, capped at 1, with the source episode ids merged | `msb:236-263`, `msb:303-312`; `T:rel:303-330` |
| Supersede | A changed relationship sets `validUntil` on the old edge (it is kept) and adds the new one. If the model gives no usable id, the active edge with the same `from` and `type` is closed | `msb:325-346`; `edges:174-182`; `T:rel:331-392`, `T:rel:470-515` |
| `maxEdges` overflow | Superseded edges are dropped first, oldest `createdAt` first; if still over, active edges by lowest confidence, ties oldest first. The edge just added is never the one dropped | `edges:66-123`; `T:rel:598-640` |
| Hygiene | On every janitor run with relations on and `createImplicitEntities` false, the janitor removes edges whose endpoint is not a current fact subject, whether or not any fact was culled (`confidenceDecay: false` included); with it true the prune is skipped, because minted nodes are not fact subjects | `jb:100-123`; `T:rel:641-720` |

Each reinforce leaves a superseded record behind, and superseded records count toward `maxEdges`. Source: `msb:256-262`,
`edges:164-168`.

### 7.4 Reading the graph

- **Handlers**, via `ctx.cap.memory` (`mc:281-315`). Each returns an empty result when relations is off. The entity is
  canonicalized (trim, lowercase). `connections(entity, opts?)` returns the 1-hop edges, `opts` is `TraversalOpts` without
  `depth`; `relate(from, to, opts?)` returns `Edge[]` for the shortest path or `null`; `egoGraph(entity, opts?)` returns
  `{ nodes, edges }`. `TraversalOpts`: `depth` (default 2, max 6), `direction` (`"out" | "in" | "both"`, default `"both"`),
  `relationTypes`, `at` (ISO time, default now; only edges active then) (`trav:15-28`).
- **The `memory/connect` tool**: section 5.8.
- **Graph-expanded recall**: `llm-filter` adds up to `10` edges (`GRAPH_EXPAND_CAP`) to its candidates. Focal nodes are edge
  endpoints named in the query: a single-word endpoint of at least 2 characters equal to a query word, or a multi-word endpoint
  found in the query; the subject `user` never matches. Edges within 2 hops of each focal node are added unless already
  candidates (`ge:24-102`; `lf:281-295`; `T` `tools/graph-expand.test.ts`). **It adds edges, not facts**, and a fact two hops
  away is not pulled in. The existing pages say "nearby facts and edges" (`rl:45`; README); code wins, only edges.

### 7.5 Limits

Relations add edges to the consolidation call's output and more stored state per user (`msb:168-181`: the facts-only schema
is used when relations is off). Traversal runs in memory over the stored array (`edges:131-142`, `edges:191-200`), depth
capped at 6. The existing page's "hundreds to thousands of edges" sizing (`rl:55`) has no measurement behind it in code or
tests: **[verify]**, or drop the number.

## 8. Subjects

Every observation, episode, semantic fact and relation endpoint carries a subject string: `user` for the primary user, a
lowercase name for anyone else (`moni`), a lowercase hyphenated name for an organisation (`ep:19-28`, `sm:21-22`,
`msb:116`, `msb:814-816`). The observer assigns it; it is lowercased at reflect (`msb:816`). **Working-memory entries have
no subject field** (`wm:8-29`). The overview's "carried through every tier" is therefore wrong for working memory; it is
carried to episodic, semantic, relations and into the digest's input. **Corrected.**

Guards [impl]: consolidation `reinforce` and `update` are skipped when the target fact's subject differs from the proposed
one, with a warning, and the source episodes then stay unconsolidated (`msb:1318-1340`, `msb:1360-1365`). `invalidate`
across subjects is still applied, with a warning (`msb:1346-1356`). Prune refuses a merge whose sources span subjects
(`msb:1630-1647`). Dedup of new facts compares only against facts of the same subject (`msb:1294`,
`msb:848-860`). `allFacts(ref, subject?)` and `query(..., subject?)` filter by subject (`sh:125-131`, `sh:178-195`). The
digest is about `subject=user` and describes others relative to them (section 2.4). Test: `test/subject-attribution.spec.ts`.
The page says "consolidation and prune never merge facts of different subjects"; do not say they "never rewrite across
subjects" without the `invalidate` exception.

## 9. Capture evaluator (`system({ evaluator })`)

Documented on `cf:81-149`. Facts for the reference rows: `captureEvaluator(model: string | EvaluationModel)` returns core's
`evaluator` named `memory/capture-evaluator` with `captureQuestions` (`ce:62-85`); `captureQuestions = { capture: choice(...,
{ remember, skip }) }` (`ce:25-40`). `remember` runs the observer; `skip` writes nothing and marks the messages read; an
evaluator error fails the capture and leaves the messages unread, never falling back to the observer (`ms:424-431` doc comment;
`cf:114-119`). A hand-built evaluator that does not answer `capture` with `remember` or `skip` throws
`memory capture: the evaluator did not answer the "capture" question with "remember" or "skip". Build the evaluator with captureQuestions (or captureEvaluator(model)).`
(`ce:93-104`). Extra questions are allowed and ignored (`ce:48-59`). Exports: `captureEvaluator`, `captureQuestions`,
`CaptureEvaluatorBlock`, `CaptureQuestions`, `CaptureChoice` (`ix:233-234`). The `memorySystem` resource's `readMessages` field
tracks messages an evaluated capture has judged (`ms:76-118`).

## 10. What memory stores: the four questions for every part

All parts are defined with `defineResource`. None declares `client`, `llmReadable` or `llmWritable` (grep of `src/`), and a
resource with no `client` config is invisible to the browser (`apps/docs/docs/resources/client-access.md:7`, `:33`). Blocks
read them on the server. A model sees memory only through the `<memory>` context block and the tools above. The app registers
them with `resources: { ...mem.sessionResources, ...mem.userResources }`; "owner" below is the package that defines the
shape, and the app owns the registration. Storage is the flow's configured store, a persistent one (filesystem, SQLite,
Postgres) keeping them across restarts and the in-memory one not (`apps/docs/docs/persistence/overview.md:56`,
`:113`).

| Part (resource key) | Scope | Owner (who writes) | Who can see | How many |
|---|---|---|---|---|
| `workingMemory` (`entries`, `currentTurn`) | session (`wm:54-59`) | The capture pipeline and the working-memory helpers; the app through `ctx.cap.workingMemory` | Server blocks; the model through the `<memory><working>` block | One per session. Entries up to `capacity` (7), more only when all are pinned (`wh:136-152`) |
| `memorySystem` (`lastProcessedIndex`, `readMessages`, `episodicWritesSinceLastConsolidation`, `evictedPersistentSinceLastConsolidation`, `lastConsolidationTurn`) | session (`ms:76-118`) | The capture pipeline's bookkeeping | Server blocks only | One per session; always in `sessionResources` (`ms:900-903`) |
| `janitor` | session (`jn:125-137`) | The janitor | Server blocks; DevTool; the resource registry (`jn:119-123`) | One per session, overwritten each run. A new session starts from the default |
| `episodicMemory` (`episodes`, `totalEncoded`) | `user` (default) or `org` (`ep:85-92`) | Capture (reflect) writes; consolidation marks `consolidated`; the janitor deletes persistent and flags permanent episodes | Server blocks; the model through `<memory><episodic>` (off by default) and the recall tool | One per user (or org), shared by that user's sessions; by default across the flows on the server, per flow with `flowIsolation`. Up to `maxEpisodes` (200) episodes |
| `semanticMemory` (`facts`, `totalExtracted`, `totalConsolidations`, plus `edges` with relations) | `user` (default) or `org` (`sm:69-83`) | Consolidation and prune write; the janitor culls; direct extraction writes persistent or permanent observations in any category except `event` and `task` as facts at capture, without waiting for consolidation (`msb:840-880`); `ctx.cap.semanticMemory` helpers | As above; `<memory><semantic>` off by default; the recall tool; the connect tool | One per user (or org). Fact count has no cap; prune (LLM) acts at `pruneThreshold` (20), the janitor culls by decay |
| `digestMemory` (`digest`, `totalGenerated`) | the semantic tier's scope (`dm:62-71`) | Digest regeneration | `<memory><digest>` (on by default) | One digest per user (or org); each regeneration replaces it |

Persistent stores keep user-scope parts across sessions. The memory resources have no `client` projection, so a browser
reads none of them unless the app adds its own route or flow action. **Note for the page:** the janitor's record sits in the
session that ran it, while the facts and episodes it culls are shared across the user's sessions (`jn:125-128`, `sm:69-83`,
`ep:85-92`), so a janitor run in session A deletes a fact for session B, and B's `janitor` resource shows nothing about it.

**[verify]** that an unconfigured `client` means the browser has no read path for these six keys by reading one manifest
response of a running app. The doc says so (`client-access.md:7`, `:33`) and the code declares nothing, which is enough to
state it, but no memory test asserts it.

## 11. Lookups the table form should answer

| Question | Answer | Source |
|---|---|---|
| What is the default decay? | Working: power-law, rate 0.5, per turn. Semantic confidence: half-life 180 days, floor 0.1 | section 0 |
| How many items does working memory hold? | 7, 2 pinned | `wh:21-26` |
| When does consolidation run? | 5 new episodes and at least 4 turns since the last one | `ms:179-183` |
| When does prune run? | Fact count at or above 20 (0 = never) | `ms:191-193` |
| How many episodes are kept? | 200 | `ms:172-176` |
| How big is the digest? | 400 tokens; 30 facts and 10 episodes in | `ms:196-199` |
| What does recall return by default? | 5 results, 400 characters each, max 20 results | section 5 |
| What is injected by default? | digest, working, plus the recall tool | `mc:374-376` |
| How long do episodes live? | Persistent: 500 turns or 90 days, whichever first. Permanent: never deleted, marked stale after 180 days | section 4.4 |
| Where do these live? | Section 10 | |

## 12. Corrections to the existing pages (code wins)

1. `cf:78-79` lists `inputSchema` as a capture-pipeline option. Nothing reads it (section 1.2).
2. `cf:187` says `consolidation.minInterval` defaults to "framework default". It is 4.
3. `cf:212` / `hy:148-160`: `hygiene: false` means "stores grow without bound" and "pre-hygiene behaviour". Episodes are still
   capped by `maxEpisodes` (200) and facts can still be pruned at `pruneThreshold`; what stops is age-based culling and decay
   ranking (`ms:172-176`, `msb:1485`). The "pre-hygiene" wording is diff narrative: cut.
4. `rtool:32`: the recall description string does not say "semantic facts + past episodes" (`ty:216-220`).
5. `rtool:42-60`: the strategy shape (section 5.6).
6. `rtool:38`, `hy:29`: effective confidence is not "the recall tool's intrinsic semantic score" for the built-in strategy
   (table in 4.3).
7. `hy:44`, `ep:47-50`: "silence" is age since `encodedAt` (`eh:166-169`).
8. `hy:41-42`: both TTL tests use `>=`, not "more than" (`eh:132-133`).
9. `hy:169`, `rl:45`, README `Graph-expanded recall`: the order "consolidate, janitor, prune" is not guaranteed; graph expansion
   adds edges only (4.5, 7.4).
10. `rl:36`, README: "canonicalized to known subjects so the same entity doesn't fork into 'NVDA' and 'Nvidia'" implies alias
    resolution. It is trim and lowercase only (7.3).
11. `ov:43`: subjects are not carried through working memory (section 8).
12. `hy:63`, `jn:28-31`: the "180 days is conservative" rationale is design defense: **[cut]**. Keep one line: a shorter
    `halfLife` decays faster.
13. Code comments cite tracker ids and prior behaviour (`FIX-411`, `FIX-745`, "pre-FIX-411", "V1 bug fix"): **[cut]**.

## 13. The 31 rows other pages' depth passes moved here (`→ R-37`)

Each row checked against the code. "Carried" means every part is true and goes on the page. Row ids are mine
(`H` hygiene, `I` index, `L` relations, `C` recall tool, `G` glossary).

| # | Row (short) | Verdict | Where / note |
|---|---|---|---|
| H1 | Effective confidence formula, fallback, half and quarter | **Carried** | 4.3. Add the clamp and clock-skew case |
| H2 | Where effective confidence is used: `mem.recall()` and "the recall tool's semantic score" | **Carried, second half dropped** | The built-in recall tool shows raw confidence; only `mem.recall()` and the exported `intrinsicSemanticScore` use the decay (4.3) |
| H3 | `cullFloor` default 0.1; 0 disables | **Carried** | 4.2. Add `[0, 1)` and "exactly at the floor is kept" |
| H4 | Persistent TTL: 500, 90, `operator`, counted from occurrence and from encoding, `>=`, turn test never fires across sessions | **Carried** | 4.4. Verified `eh:123-136` |
| H5 | Permanent never deleted; `stale` after 180 days from encoding | **Carried** | 4.4 |
| H6 | Default hygiene object | **Carried, rationale dropped** | 4.1. The "conservative" argument is cut |
| H7 | `hygiene` passed on `system()`, partial overrides merge | **Carried, widened** | Also accepted on `createMemoryCapability`, where only `confidenceDecay` acts but the whole object is validated (1.1) |
| H8 | `confidenceDecay` table, `false` skips | **Carried** | 4.2 |
| H9 | `episodicTTL` table, `false` skips | **Carried** | 4.4 |
| H10 | `schedule` values incl. episodic-only fallback | **Carried** | 4.5 |
| H11 | Manual janitor, `mem.janitor` | **Carried** | 4.5. The sequencer example moves to the catalog page if kept; here one row |
| H12 | The `janitor` resource, session-scoped, overwritten | **Carried** | 4.6 and section 10 |
| H13 | `hygiene: false`: no janitor, raw ranking, "stores grow without bound" | **Carried, last clause corrected** | Episodes remain capped and prune still runs (section 12 item 3) |
| H14 | Maintenance order consolidate, janitor, prune; janitor deterministic | **Carried, order dropped** | Deterministic: yes (`jb:75-148`). The janitor runs inside the consolidation chain before digest regeneration. Prune is a separate side chain and side chains run in parallel, so "then prune" is not a guarantee. Prune is optional, LLM-driven and gated by `pruneThreshold` (2.3). `onCapture` janitor is also a side chain, so "runs after both" is not guaranteed either: **dropped** |
| I1 | Hygiene settings summary (runs when semantic or episodic set; on by default; `false` off) | **Carried** | 1.3, 4. Also true: a `working`-only setup has no janitor |
| I2 | Subjects | **Carried, "every tier" corrected** | Section 8 |
| I3 | Capability presets and per-tier capabilities | **Carried, corrected** | Section 6. Add the `connect` preset; `workingMemoryCapability` has no presets |
| L1 | Relations options and the tier requirement | **Carried** | 7.1 |
| L2 | Stored edge record; "same LLM call, no second round-trip" cut | **Carried** | 7.2. The edge also carries `id`, `validFrom`, `validUntil`, `createdAt` |
| L3 | Edge endpoint rules | **Carried** | 7.3. Verified `jb:116-123` |
| L4 | Superseded edges, culled first on overflow | **Carried** | 7.3. Add the second phase (lowest confidence) |
| L5 | Handler access `connections`, `relate`, `egoGraph`; "also generated under reference/api/memory" | **Carried, last sentence unverified** | 7.4. `apps/docs/docs/api/` has no memory page today; I could not confirm a generated one. **[verify]** or drop the cross-reference |
| L6 | Relations limits: cost, state, in-memory traversal, hundreds to thousands | **Carried, number flagged** | 7.5 |
| C1 | Recall preset on by default; `recall: false`; read-only flow | **Carried** | 5.1 |
| C2 | Tool arguments, default strategy, candidates, capped list | **Carried, candidate list extended** | 5.2, 5.7. Candidates also include up to 5 exact-phrase episodes and up to 10 relation edges |
| C3 | `perItemCharCap` 400, `TRUNCATION_MARKER`, `tool.defaults.limit` | **Carried** | 5.4 |
| C4 | Working-only: tool installs but returns nothing | **Carried** | 5.1. "Pre-existing, tracked separately" is history: dropped |
| C5 | Ranking: effective confidence times a reinforcement factor in `mem.recall()` | **Carried, widened** | 5.5. `mem.recall()` also ranks working and episodic items |
| C6 | `llm-filter` shows raw confidence; `effectiveConfidence` exported | **Carried** | 4.3, 5.7. "Bounded by `pruneThreshold`" is internal and the fact count is not capped by it: dropped from the page |
| C7 | `RetrievalStrategy` contract | **Carried** | 5.6 |
| G1 | Memory tiers: the four tiers, scope of each, one resource per tier | **Carried** | Section 10. Plus the two session bookkeeping resources (`memorySystem`, `janitor`) |

No row is dropped whole. Pieces dropped: H2's second half; H14's ordering; C6's "bounded by `pruneThreshold`"; C4's history
phrase; L5's api cross-reference until confirmed.

## 14. Gaps and things pass 5 must settle

1. **Prune merge refusal** (`msb:1630-1647`): the guard reads each source fact's subject from the live store and refuses the merge when subjects differ or an id is missing; confirmed by reading lines 1630-1647. A test that asserts it is not in `test/` (grep for `merge refused`). Add one or state it as [impl].
2. **`onEviction` wording** (2.3): the counter increments only when a persistent working entry is replaced by an overlapping
   observation. Settle with a test against `T:sys`.
3. **`mem.recall()` weights** (5.5): internal, no test pins every constant. Keep off the page or confirm.
4. **Worked decay figures** (4.3): derived, not tested.
5. **Whether a stale permanent episode is still recalled**: no test; by reading `rc` and `lf` nothing filters it. State only
   what the janitor does.
6. **Browser reach of memory resources** (10): documented, untested.
7. **`inputSchema`** (1.2): declared and unused; decide whether the reference lists it at all.
8. **Org scope behaviour** (`scope: 'org'`): the package accepts it everywhere; nothing here tests memory at org scope.
   The page should state the option and not describe org-specific behaviour.
9. **An example that uses it**: `apps/kitchen-sink/flows/chat-agent/run/cognition.ts` and `labs/knowledge-hub/src/inbox.ts`
   import the package; neither was read in full for this sheet. The reference page needs no example beyond one `system()`
   call per row group.
10. No Reference row needs a figure. No row in sections 2 to 10 depends on a spec.
