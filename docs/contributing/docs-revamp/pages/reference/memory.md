---
title: Memory
type: reference
description: "Every option of @flow-state-dev/memory by tier, the hygiene settings, recall and its strategies, relations, presets, subjects, and what memory stores."
---

# Memory

`@flow-state-dev/memory` keeps what a conversation produced and puts the useful part back in front of the model on the next turn. It has four stores called tiers: working memory (this session), episodic memory (what happened), semantic memory (facts about a user) and the digest (a short summary of the other two).

This page lists every option, default, tool argument and stored part. The [Memory concept page](../concepts/memory.md) explains the model.

The examples use a support desk. `mem` is the memory of the `support` flow: it remembers what each customer has told the agent.

```ts title="src/flows/support/memory.ts"
import { system } from "@flow-state-dev/memory";

export const mem = system({
  model: "openai/gpt-6-luna",
  working: true,
  episodic: { significanceThreshold: 0.6 },
  semantic: { consolidation: { episodicThreshold: 5 } },
  digest: true,
  hygiene: { confidenceDecay: { halfLife: 90 } },
  tool: { defaults: { limit: 5 } },
});
```

```ts title="src/flows/support/flow.ts"
import { z } from "zod";
import { defineFlow, generator } from "@flow-state-dev/core";
import { mem } from "./memory";

const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Be brief and specific.",
  inputSchema: z.string(),
  user: (input) => input,
  uses: [mem.capability],
});

export default defineFlow({
  kind: "support",
  resources: { ...mem.sessionResources, ...mem.userResources },
  actions: { reply: draftReply },
});
```

`working: true` takes every default for a tier. `draftReply` installs the memory with `uses: [mem.capability]`.

## Quick answers

| Question | Answer |
|---|---|
| What is the default decay? | Working memory: power-law, rate `0.5`, per turn. Semantic fact confidence: half-life `180` days, culled below `0.1`. See [Working](#working) and [Confidence decay](#confidence-decay). |
| How many items does working memory hold? | `7`, of which `2` can be pinned. |
| How many episodes are kept? | `200`. |
| When does consolidation run? | At least `4` turns since the last one, and `5` new episodes. |
| When does prune run? | When the fact count reaches `20`. `0` turns it off. |
| How big is the digest? | `400` tokens, built from `30` facts and `10` episodes. |
| What does recall return by default? | `5` results of at most `400` characters each. The maximum is `20`. |
| What does the model see without a tool call? | The digest and working memory. Semantic and episodic sections are off. |
| How long does an episode live? | Persistent: `500` turns or `90` days, whichever comes first. Permanent: never deleted, marked stale after `180` days. |
| Where does each part live? | See [What memory stores](#what-memory-stores). |

## Entry points

| Entry | Returns | Writes memory |
|---|---|---|
| `createMemoryCapability(options)` | A capability plus `sessionResources`, `userResources`, `tiers`, `recallToolBlock`, and `connectToolBlock` when relations is on | Only through the `ctx.cap` helpers (for example `workingMemory.add`, `episodicMemory.encode`, `semanticMemory.addFact`). It has no capture, consolidation, prune or janitor pipeline. |
| `system(config)` | A `MemorySystem`: everything above as `mem.capability`, plus capture, consolidation, prune, the janitor and digest regeneration | Yes |

`system()` builds `createMemoryCapability` itself, so `mem.capability` is the object the factory returns.

### `createMemoryCapability` options

| Field | Type | Default | Meaning |
|---|---|---|---|
| `model` | `string \| string[]` | required | Model for the recall tool's filter call. An array uses its first entry. |
| `working` | `WorkingMemorySystemConfig \| true` | required | Working tier. |
| `episodic` | `EpisodicMemoryConfig \| true` | tier off | Episodic tier. |
| `semantic` | `SemanticMemoryConfig \| true` | tier off | Semantic tier. Needs `episodic`. |
| `digest` | `DigestSystemConfig \| true` | tier off | Digest tier. Needs `semantic`. |
| `tool` | `MemoryToolConfig` | recall defaults | See [Tool configuration](#tool-configuration). |
| `hygiene` | `HygieneConfig \| true \| false` | `true` | Here only `confidenceDecay` acts, on recall ranking. No janitor is built. The whole object is validated. |

### `system()` adds

| Field | Type | Default | Meaning |
|---|---|---|---|
| `consolidationModel` | `string \| string[]` | `model` | Model for consolidation. An array is a fallback chain on retryable provider errors. |
| `pruneModel` | `string \| string[]` | `model` | Model for prune. |
| `name` | `string` | `memory/...` names | Prefix for the capture pipeline's block names, such as `<name>/observe` and `<name>/janitor`. |
| `source` | `(input, ctx) => string` | reads `ctx.session.items` | The text the observer reads. |
| `maxAssistantChars` | `number` | `500` | Characters of assistant text `mem.captureFromItems` includes. Longer text is cut and ` [truncated]` is appended. |
| `evaluator` | evaluator block | none | Asked before the observer. See [Capture evaluator](#capture-evaluator). |

### Construction errors

Both entry points check tier dependencies when they are built.

| Condition | Error |
|---|---|
| `semantic` without `episodic` | `Semantic memory requires episodic memory to be configured` |
| `digest` without `semantic` | `Digest requires semantic memory to be configured` |
| `model` null or an empty array | `createMemoryCapability requires a \`model\` for the recall tool` |

`working` alone is allowed.

### What `system()` returns

| Member | Present when | What it is |
|---|---|---|
| `capability` | always | The composed capability, for `uses`. |
| `capture` | always | Sequencer: observe, reflect, tick, plus consolidate and prune as side chains when `semantic` is set. It reads the session's unread `message` items. A string input is used only when there are none. |
| `captureFromItems` | always | `capture`, reading its input from session items: the last user message, up to 3 earlier user messages as context, and the assistant reply. Run it after the generator with `.sideChain()`. |
| `consolidate`, `prune` | `semantic` set | Standalone sequencers. |
| `janitor`, `janitorResource` | `hygiene` not `false`, and `semantic` or `episodic` set | See [The janitor](#the-janitor). |
| `regenerateDigest` | `digest` set | Digest regeneration, with `force: true`. |
| `recall(ctx, cue?)` | always | Cross-store ranked recall. See [`mem.recall`](#memrecall). |
| `contextFormatter`, `formatContext` | always | The digest and working sections by default. |
| `working`, `episodic`, `semantic`, `digest` | per tier | `{ resource, helpers }`. |
| `sessionResources` | always | `workingMemory`, `memorySystem`, and `janitor` when the janitor exists. |
| `userResources` | per tier | `episodicMemory`, `semanticMemory`, `digestMemory`. |
| `workingMemoryCapability`, `episodicMemoryCapability`, `semanticMemoryCapability`, `digestMemoryCapability` | per tier | The per-tier capabilities. |
| `tool.recall()`, `tool.connect()` | always, and with relations only | The tool blocks. |

When `hygiene` is set explicitly, `schedule` is not `'manual'`, and neither `semantic` nor `episodic` is set, `system()` logs `[memory] hygiene is enabled but neither semantic nor episodic memory is configured — janitor will no-op.`

## Options by tier

The defaults are exported as `DEFAULT_WORKING_MEMORY_CONFIG`, `DEFAULT_EPISODIC_CONFIG`, `DEFAULT_CONSOLIDATION_CONFIG`, `DEFAULT_OBSERVER_CONFIG`, `DEFAULT_PRUNE_CONFIG`, `DEFAULT_DIGEST_CONFIG` and `DEFAULT_HYGIENE_CONFIG`.

### Working

| Field | Type | Default | Meaning |
|---|---|---|---|
| `capacity` | `number` | `7` | Entries held. Adding past capacity evicts the lowest-salience unpinned entry. If every entry is pinned, the new one is added anyway and capacity is exceeded. |
| `maxPinnedSlots` | `number` | `2` | `pin` returns `false` when that many are already pinned. |
| `decay.strategy` | `"power-law" \| "exponential" \| "none"` | `"power-law"` | The factor for `elapsed` turns: `(1 + elapsed)^-rate`, `exp(-rate * elapsed)`, or `1`. Negative elapsed counts as `0`. |
| `decay.rate` | `number` | `0.5` | The rate in those formulas. |

Salience is `importance * decay(turns since last access)`, clamped to `[0, 1]`, and is recomputed each time the turn counter advances. `refresh` resets an entry's last-access turn. `evict` removes a pinned entry. An observation with importance `0.85` or above is pinned when a slot is free. Working memory belongs to the session, so its turn counter starts again in each session.

`workingMemoryCapture(config?)` is the standalone capture for a setup without `system()`. It takes `name`, `model` (default `'gpt-6-luna'`), `capacity`, `maxPinnedSlots`, `decay` and `maxExtractPerTurn` (default `3`), runs its own observer, and takes a string.

### Episodic

| Field | Type | Default | Meaning |
|---|---|---|---|
| `scope` | `"user" \| "org"` | `"user"` | Where episodes are stored. |
| `flowIsolation` | `boolean` | follows the flow | See [Scope and flow isolation](#scope-and-flow-isolation). |
| `significanceThreshold` | `number` | `0.6` | An observation becomes an episode only when it is persistent or permanent and its importance is at or above this. |
| `maxEpisodes` | `number` | `200` | At the cap, a new episode evicts the oldest consolidated episode, else the oldest of all. |

An episode has `id`, `content`, `occurredAtTurn`, `encodedAt`, `significance` in `[0, 1]`, a `category` (`identity`, `event`, `preference`, `task`, `relationship`, `profession`, `belief`, `attribute`, `pattern`), a `subject` (default `'user'`), `context { sessionId, precedingTopic? }`, `consolidated` (default `false`), `durability` (`'persistent'` or `'permanent'`, default `'persistent'`) and `stale` (default `false`). The resource also keeps `totalEncoded`.

### Semantic

| Field | Type | Default | Meaning |
|---|---|---|---|
| `scope` | `"user" \| "org"` | the episodic scope, else `"user"` | Where facts are stored. |
| `flowIsolation` | `boolean` | follows the flow | Not inherited from `episodic`. |
| `consolidation.episodicThreshold` | `number` | `5` | New episodic writes since the last consolidation that trigger one. |
| `consolidation.onEviction` | `boolean` | `true` | Also trigger when, since the last consolidation, a persistent or permanent working-memory entry has been replaced by a richer overlapping observation. Entries pushed out by the capacity limit do not count. |
| `consolidation.minInterval` | `number` | `4` | Turns that must pass since the last consolidation. |
| `pruneThreshold` | `number` | `20` | Prune runs when the fact count reaches this. `0` disables it. |
| `relations` | `boolean \| RelationsConfig` | off | See [Relations](#relations). |

Consolidation runs when `minInterval` turns have passed and either `episodicThreshold` writes have accumulated or `onEviction` applies. Turns are working-memory turns.

Prune is a model step that returns removals and merges for the full fact set. A merge is refused unless every source fact has the same subject. It runs as a side chain after consolidate.

A fact has `id`, `subject` (default `'user'`), `content`, `confidence` in `[0, 1]`, a `category` (`identity`, `relationship`, `preference`, `belief`, `profession`, `attribute`, `pattern`), `sourceEpisodeIds`, `extractedAt`, `lastReinforced?` and `reinforcementCount` (at least 1). The resource also keeps `totalExtracted` and `totalConsolidations`. A new fact's `lastReinforced` equals its `extractedAt`. `reinforce` and `updateFact` reset `lastReinforced` and raise the count, and `reinforce` adds `0.05` confidence by default, capped at 1.

### Digest

| Field | Type | Default | Meaning |
|---|---|---|---|
| `maxTokens` | `number` | `400` | Cap on the digest model call. The prompt also asks for roughly that many. |
| `topN.facts` | `number` | `30` | Facts fed to regeneration, most reinforced first. |
| `topN.episodes` | `number` | `10` | Episodes fed to regeneration. |

There is no `digest.scope` and no `digest.flowIsolation`. A digest takes the semantic tier's scope, and its isolation is derived (see the [isolation table](#scope-and-flow-isolation)). The digest describes the user; other people appear in relation to them. It holds `digest { content, generatedAt, generatedAtTurn, sourceSignature { semanticFactCount, semanticReinforcementSum, episodeCount } }` and `totalGenerated`.

Regeneration is the last step of the consolidation chain and of the prune chain. It is skipped when the stored `sourceSignature` equals the current one, unless `force` is set, so a run that changes nothing leaves the digest alone. `digestIsStale` and `computeDigestSourceSignature` are exported from the package root.

## Scope and flow isolation

| Tier | Scope | `flowIsolation` option |
|---|---|---|
| Working | session | none |
| Episodic | `user` or `org`, default `user` | yes |
| Semantic | `user` or `org`, default the episodic scope | yes |
| Digest | the semantic tier's scope | derived, no option |

`flowIsolation: true` keeps the tier separate per flow, even when the flow shares its user or org state (see the isolation flags in [Flows and actions](./flows.md)). `false` shares it across every flow for that user or org, even when the flow sets `isolateUserState: true` (`isolateOrgState` at org scope). Omitted, the tier follows the flow's setting. Each tier is set on its own.

The digest's isolation follows its sources:

| Episodic | Semantic | Digest |
|---|---|---|
| `flowIsolation: true` | any | isolated |
| any | `flowIsolation: true` | isolated |
| `false` | `false` | shared |
| omitted, with a scope that differs from the semantic tier's | any | isolated |
| otherwise | | follows the flow |

Setting up tiers by hand skips this rule. Pass `flowIsolation: true` to `createDigestMemoryResource` or `createDigestMemoryCapability` whenever either source is isolated.

| Factory | Signature |
|---|---|
| `createEpisodicMemoryResource` | `(scope, options?)` |
| `createDigestMemoryResource` | `(scope, options?)` |
| `createSemanticMemoryResource` | `(scope, relations?, options?)` |
| `createEpisodicMemoryCapability` | `(config?)`: `scope`, `maxEpisodes` (default `200`), `flowIsolation` |
| `createSemanticMemoryCapability` | `(config?)`: `scope`, `edges?`, `flowIsolation` |
| `createDigestMemoryCapability` | `(config?)`: `scope`, `flowIsolation` |
| `createWorkingMemoryCapability` | `(config?)`: the working helper config |

`options` is `{ flowIsolation?: boolean }`. The default instances are `workingMemoryCapability`, `episodicMemoryCapability`, `semanticMemoryCapability` and `digestMemoryCapability`.

## Hygiene

`hygiene` accepts `true` (defaults), `false` (off) or an object, and is `true` when omitted. A partial object merges onto the defaults field by field. Hygiene runs when `semantic` or `episodic` is set. With `hygiene: false` there is no janitor and recall ranks on raw `fact.confidence`. Age-based culling and decay stop. Episodes are capped by `maxEpisodes` and facts are pruned at `pruneThreshold`. A setup with only `working` has no janitor.

`DEFAULT_HYGIENE_CONFIG` holds these values. Passing them explicitly is the same as `hygiene: true`:

```ts title="src/flows/support/hygiene.ts"
import type { HygieneConfig } from "@flow-state-dev/memory";

export const hygiene = {
  confidenceDecay: { halfLife: 180, cullFloor: 0.1 },
  episodicTTL: { persistentTurns: 500, persistentDays: 90, operator: "OR", permanentStaleDays: 180 },
  schedule: "onConsolidation",
} satisfies HygieneConfig;
```

### Confidence decay

`confidenceDecay` is `boolean | { halfLife?, cullFloor? }`. A shorter `halfLife` decays facts faster.

| Field | Default | Valid | Meaning |
|---|---|---|---|
| `halfLife` | `180` | greater than `0` | Days for effective confidence to halve. Otherwise it throws `hygiene.confidenceDecay.halfLife must be > 0, got <n>`. |
| `cullFloor` | `0.1` | `[0, 1)` | Facts whose effective confidence is below this are deleted. `0` never culls, and facts only rank lower. A fact exactly at the floor is kept. Otherwise it throws `hygiene.confidenceDecay.cullFloor must be in [0, 1), got <n>`. |

`confidenceDecay: false` skips the semantic branch: no decay, no cull. `true` or omitted takes the defaults.

Effective confidence is `confidence * 0.5 ^ (elapsedDays / halfLife)`. It is computed when read, and the stored `confidence` never changes. `elapsedDays` counts from `fact.lastReinforced`, and from `fact.extractedAt` for a fact without one. At one half-life the value is half, at two a quarter. The result is clamped to `[0, fact.confidence]`: zero or negative elapsed time and an unparsable timestamp both return the raw confidence. `effectiveConfidence(fact, now?, halfLife?)` is exported.

| Reader | Uses effective confidence |
|---|---|
| `mem.recall()` and `ctx.cap.memory.recall()` | Yes, with the configured `halfLife`. Raw confidence when `confidenceDecay` is off or `hygiene` is `false`. |
| The janitor's cull | Yes |
| The built-in `llm-filter` recall tool | No. Every semantic fact is a candidate and the model sees raw `confidence`. |
| `intrinsicSemanticScore(fact, now?, halfLife?)` | Yes, with a default half-life of `180`. The built-in strategy does not call it. It is exported for custom strategies. |

### Episode expiry

`episodicTTL` is `boolean | { persistentTurns?, persistentDays?, operator?, permanentStaleDays? }`. `false` skips the episodic branch.

| Field | Default | Valid | Meaning |
|---|---|---|---|
| `persistentTurns` | `500` | greater than `0` | Turn age at or past which a persistent episode is culled. Age is `max(0, currentTurn - occurredAtTurn)`. |
| `persistentDays` | `90` | greater than `0` | Days since `encodedAt` at or past which a persistent episode is culled. |
| `operator` | `'OR'` | `'OR' \| 'AND'` | `'OR'` culls when either test fires. `'AND'` only when both do. |
| `permanentStaleDays` | `180` | greater than `0` | Days since `encodedAt` at or past which a permanent episode is marked `stale: true`. |

A value of zero or less throws `hygiene.episodicTTL.<field> must be > 0, got <n>`.

`currentTurn` comes from session-scoped working memory and starts again each session, while episodes outlive sessions. An episode from an earlier session is aged against the current session's counter: its age is `0` while the current turn is at or below the episode's `occurredAtTurn`, and otherwise the gap, which can be small. In a new session the day test usually fires first. The janitor never deletes a permanent episode. It marks one stale once, and changes nothing else about it. Age counts from `encodedAt`, and nothing resets it. Recall and the context formatter do not filter on `stale`.

### The janitor

`schedule` decides when the janitor runs.

| Value | Behaviour |
|---|---|
| `'onConsolidation'` (default) | A step in the consolidation chain, after persist and before digest regeneration. It runs whenever consolidation triggers. With `episodic` set and no `semantic`, there is no consolidation chain, so it runs every turn as a `.sideChain()` of the capture pipeline. |
| `'onCapture'` | Every capture, as a `.sideChain()` step after the other side chains. Adds a janitor run, with its store reads and writes, to every turn. |
| `'manual'` | Never wired. Run `mem.janitor` yourself. |

Prune is a separate side chain, and side chains run in parallel, so the order of the janitor and prune is not fixed (see [Sequencer methods](./sequencer-methods.md)).

`mem.janitor` is a handler block with `inputSchema: z.any()` and no output, so it fits as a step in a sequencer. It is `undefined` when `hygiene` is `false` or when neither `semantic` nor `episodic` is set, so call it as `mem.janitor!`. It declares its own resources and makes no model call. If a step of a run (below) throws, the error is logged with `console.warn`, the other steps run, and the `janitor` resource is written as usual.

In order, a run culls facts when `confidenceDecay` is on; removes dangling relation edges when relations is on and `createImplicitEntities` is `false`; culls persistent episodes and marks permanent ones stale when `episodicTTL` is on; and writes the `janitor` resource. It does not touch working memory or digests.

The `janitor` resource is session-scoped, with `ref: 'janitor'`.

| Field | Meaning |
|---|---|
| `lastRunTurn` | Integer, default `0`. |
| `lastRunAt` | ISO datetime. Absent until the first run. |
| `totalRuns` | Runs in this session. |
| `lastCulledFactIds`, `lastCulledEpisodeIds`, `lastMarkedStaleEpisodeIds` | String arrays, default `[]`. Each run overwrites all three, so a run that touches nothing sets them to `[]`. Ids only, not the removed content. |

Read it in DevTool or the resource registry. The janitor in the consolidation chain and `mem.janitor` share this one resource, so it shows whichever ran last. A janitor run in one session deletes facts and episodes that every session of that user shares, and another session's `janitor` resource shows nothing about it.

## Recall

### Installing it

`recall` is a preset on `mem.capability` and on the capability from `createMemoryCapability`, on by default. `recall: false` turns it off. It installs the `memory/recall` tool and a sentence in the `<memory>` context block telling the model to call `memory_recall` before saying it does not know. The tool searches the episodic and semantic tiers that are configured. A generator that declares its own `tools:` list gets only that list, so name the tool in it: `tools: [lookupOrder, mem.tool.recall()]`.

With only `working` configured, the tool installs but reads only semantic facts and episodes, never working memory, so every call returns `No memories matched "<query>".` Turn `recall` off for a working-only setup.

### Tool arguments

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `query` | `string`, at least 1 character | required | Natural-language query. |
| `limit` | integer, 1 to 20 | `tool.defaults.limit`, else `5` | Results to return. Clamped into `[1, 20]`. |
| `sinceTurn` | integer, 0 or more | none | Only episodes with `occurredAtTurn >= sinceTurn`. Semantic facts and relation edges are not filtered. |

### Result

On success the tool returns `{ results, query, strategy, totalMatched, truncatedTo }`. Each result is `{ id, content, source, score, metadata, truncated }`, where `source` is `'semantic'`, `'episodic'` or `'relation'`. `score` is position-based, `1 - i / n`, so the top result is `1`.

| Source | `metadata` |
|---|---|
| semantic | `{ subject, category, confidence, reinforcementCount, lastReinforced }` |
| episodic | `{ category, occurredAtTurn, significance, encodedAt }` |

On failure it returns `{ error, query, strategy }`. Any exception in the pipeline becomes this shape, and the tool never throws into the generator (other error shapes are in [Errors](./errors.md)).

The model reads a summary string, not the envelope: `- <content>` per result, with `(n of m matches shown; re-query with narrower terms for more)` when `totalMatched > truncatedTo`. An empty result reads `No memories matched "<query>".` and an error reads `Recall failed: <error>`. The full envelope stays in the items log and DevTool.

### Tool configuration

`tool` on `system()` and `createMemoryCapability` is a `MemoryToolConfig`.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `strategy` | `'llm-filter' \| RetrievalStrategy` | `'llm-filter'` | How candidates are found and chosen. An unknown string throws `Unknown recall strategy: <name>`. |
| `model` | `string` | `model`, first entry of an array | Model for the strategy's filter call. |
| `defaults.limit` | `number` | `5` | Used when the agent omits `limit`. |
| `defaults.perItemCharCap` | `number` | `400` | Longer result content is cut and ends with `… [truncated, re-query with narrower terms for full content]` (`TRUNCATION_MARKER`). The result gets `truncated: true`. If the cap is at most the marker's length, content is cut with no marker. |

### The `llm-filter` strategy

| Part | Behaviour |
|---|---|
| Candidates | Every semantic fact. The top `30` episodes by `significance * exp(-(currentTurn - occurredAtTurn) / 50)`. Up to `5` more episodes whose text contains a distinctive phrase from the query. With relations on, up to `10` relation edges. |
| Empty stores | No model call. The empty result. |
| Filter | One generator call that returns `{ selectedIds }`, most relevant first, at most `limit`, only ids from the candidates. |
| What the model sees | `[id] (source) {metadata} content`. Semantic metadata is raw `confidence`. |
| Visibility | The filter generator's items are hidden from the client and from history. |

`sinceTurn` applies before the episode scoring. Semantic facts do not pass through the episode cap.

The extra exact-phrase episodes in Candidates are always on through `tool`. Only `createLlmFilterStrategy({ model, exactPhrasePassThrough })` turns them off.

### Custom strategies

A `RetrievalStrategy` is an object set through `tool.strategy`, or through `strategy` on `createRecallTool({ strategy, defaults })`.

| Member | Required | Input | Output |
|---|---|---|---|
| `name` | yes | | Shown as `strategy` on results. |
| `prepareBlock` | yes | `{ query, limit, sinceTurn?, strategyName, perItemCharCap }`, with `limit` already defaulted and clamped | `{ query, limit, candidates: MemoryItem[], shouldFilter, strategyName, sinceTurn?, perItemCharCap }` |
| `filterBlock` | no | `{ query, limit, candidates }` | `{ selectedIds: string[] }` |
| `formatBlock` | no | the prepare output plus `selectedIds?` | `RecallToolResult` |

The pipeline runs prepare, then filter only when `shouldFilter` is `true` and the strategy has a `filterBlock`, then format. Without a `filterBlock`, the prepare order is returned as is. The default format returns an empty result with `totalMatched: 0` for no candidates. With `selectedIds`, ids that are not candidates are dropped and the rest keep their order. Without them, candidate order is used.

A `MemoryItem` has `id`, `content`, `source`, the semantic fields (`subject`, `category`, `confidence`, `reinforcementCount`, `lastReinforced`), the episodic fields (`occurredAtTurn`, `significance`, `encodedAt`), and for relations `from`, `to` and `relationType`. Relation content reads `"<from> <type> <to>"`.

Exported for custom strategies: `capContent`, `buildResult`, `buildResultMetadata`, `defaultFormatBlock`, `semanticToMemoryItem`, `episodeToMemoryItem`, `intrinsicSemanticScore`, `intrinsicEpisodicScore`, `extractExactPhrases`, `exactPhraseMatches`, `PRE_RANK_EPISODIC_CAP`, `RECENCY_HALF_LIFE`, `EXACT_PHRASE_CAP` and `resolveStrategy`.

### `mem.recall`

`mem.recall(ctx, cue?)` is a helper, not the tool. It reads semantic facts, working memory and episodes and returns `RankedMemoryItem[]`, most relevant first. Semantic facts rank by effective confidence scaled by a reinforcement factor, and a fact is always kept. A working entry is dropped when its token overlap with any semantic result is above `0.6`. An episode is dropped when its overlap with any working or semantic result is above `0.6`. Working entries are not compared with each other, nor are episodes.

### `memory/connect`

Installed by the `connect` preset, which is on only when relations is on, and as `mem.tool.connect()`.

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `from` | `string`, at least 1 character | required | Entity to start from. |
| `to` | `string` | none | With it, the shortest path between the two. Without it, everything connected to `from`. |
| `depth` | integer, 1 to 6 | `2` | Maximum hops. |

It returns the recall envelope with `strategy: 'graph'`, each edge a result with metadata `{ from, to, relationType, confidence }`. Entities are lowercased and trimmed. An unreachable pair returns empty results. With relations off it returns `{ error: 'The relations graph is not enabled for this memory. Enable the relations tier to use connect.', query, strategy }`.

## Presets and capabilities

Presets on the composed capability. `MEMORY_CAPABILITY_PRESETS` exports `digest`, `working`, `semantic`, `episodic` and `recall`; `connect` is a sixth preset that is not in it.

| Preset | Default | What it does |
|---|---|---|
| `digest` | on | Adds `<memory><digest>` with the digest text. Empty without the tier. |
| `working` | on | Adds `<memory><working>`: entries by salience, as `- (pinned) content`. |
| `recall` | on | Installs `memory/recall` and its context hint. Installs even when no episodic or semantic tier is configured (see [Installing it](#installing-it)). |
| `semantic` | off | Adds `<memory><semantic>`: the top 10 facts by reinforcement count, as `- (category) [subject=x] content`. Empty without the tier. |
| `episodic` | off | Adds `<memory><episodic>`: the 5 most recent episodes by `occurredAtTurn`, as `- (category, turn n) content`. Empty without the tier. |
| `connect` | on with relations | Installs `memory/connect`. A no-op without relations. |

Switch them with `mem.capability.with({ recall: false })` or `.presets({ ... })`. Presets change only what one block's prompt and tools contain (see [Capabilities](./capabilities.md)). The capture pipeline runs for every configured tier whatever the presets say, and the `ctx.cap` helpers and resources are installed regardless.

For another `topN` or `limit`, call `createMemoryContextFormatter({ digest?, working?, semantic?: boolean | { topN? }, episodic?: boolean | { limit? } })` and register the result under `context: { memory: ... }`. It returns `undefined` when every section is empty, so no `<memory>` block is rendered. `DEFAULT_SEMANTIC_TOP_N` (`10`) and `DEFAULT_EPISODIC_LIMIT` (`5`) are exported, with `createDigestEntry`, `createWorkingEntry`, `createSemanticEntry` and `createEpisodicEntry`.

`workingMemoryCapability` has no presets: every block that uses it gets the working section and helpers. With `workingMemoryCapture` it is the working-only setup without `system()`.

| Capability name on `ctx.cap` | Helpers |
|---|---|
| `memory` | `recall(cue?)`, `connections(entity, opts?)`, `relate(from, to, opts?)`, `egoGraph(entity, opts?)` |
| `workingMemory` | `add`, `evict`, `pin`, `unpin`, `refresh`, `tick`, `items`, `format` |
| `episodicMemory` | `encode`, `recent(limit?)`, `markConsolidated` |
| `semanticMemory` | `addFact`, `updateFact`, `reinforce`, `removeFact`, `allFacts(subject?)`, `query(q, limit?, subject?)` |
| `digestMemory` | `get()`, `content()` |

Regenerating a digest is `mem.regenerateDigest`, not a helper.

## Relations

Relations store links between the things a user mentions, such as `acme` and `acme-eu`, as edges on the semantic resource. They are extracted during consolidation, so edges appear only after a consolidation. They need the semantic tier, which needs episodic.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `relations` on `semantic` | `boolean \| RelationsConfig` | off | `true` takes the defaults. Off means no `edges` field, no `connect` tool and no extraction. |
| `vocabulary` | `string[]` | free text | Edge types outside it are dropped with a `console.warn`. The extraction prompt is told to use only these. |
| `maxEdges` | `number` | none | Cap on stored edges, superseded ones included. |
| `createImplicitEntities` | `boolean` | `false` | An edge endpoint that is not a known fact subject is added as a new node instead of the edge being dropped. |

A stored edge has `id`, `from`, `to`, `type`, `confidence` (default `1`), `validFrom` (nullable), `validUntil` (`null` while current), `source` (episode ids) and `createdAt`, in the `edges` array of the `semanticMemory` state. A consolidation that returns edges and no fact changes applies the edges. It does not reset `episodicWritesSinceLastConsolidation` or `lastConsolidationTurn`, and does not add to `totalConsolidations`.

| Rule | Behaviour |
|---|---|
| Canonical form | Endpoints are trimmed and lowercased. `NVDA` and `nvda` are one node. `NVDA` and `Nvidia` are two. |
| Known endpoints | An endpoint must equal the subject of some stored fact. An edge naming an unknown one is dropped with a warning, unless `createImplicitEntities` is `true`. |
| New edge, existing match | A new edge with an active edge of the same `from`, `to` and type is treated as a reinforce. The old record is superseded and a replacement is added at confidence `+0.05`, capped at 1, with the source episode ids merged. |
| Supersede | A changed relationship sets `validUntil` on the old edge, which is kept, and adds the new one. If the model gives no usable id, the active edge with the same `from` and `type` is closed. |
| `maxEdges` overflow | Superseded edges go first, oldest `createdAt` first. If over after that, active edges go by lowest confidence, ties oldest first. The edge added by this write is never the one dropped. |
| Hygiene | On every janitor run with `createImplicitEntities` `false`, the janitor removes edges whose endpoint is not a current fact subject, whether or not a fact was culled. |

Each reinforce leaves a superseded record behind, and superseded records count toward `maxEdges`.

Handlers read the graph through `ctx.cap.memory`. Each helper returns an empty result when relations is off, and entities are trimmed and lowercased.

| Helper | Returns |
|---|---|
| `connections(entity, opts?)` | The 1-hop edges. `opts` is `TraversalOpts` without `depth`. |
| `relate(from, to, opts?)` | `Edge[]` for the shortest path, or `null`. |
| `egoGraph(entity, opts?)` | `{ nodes, edges }`. |

`TraversalOpts`: `depth` (default `2`, maximum `6`), `direction` (`"out"`, `"in"` or `"both"`, default `"both"`), `relationTypes`, and `at` (an ISO time, default the present, so only edges active then).

Graph-expanded recall adds up to `10` edges to the `llm-filter` candidates. Focal nodes are edge endpoints named in the query: a single-word endpoint of at least 2 characters equal to a query word, or a multi-word endpoint found in the query. The subject `user` never matches. Edges within 2 hops of each focal node are added. It adds edges, not facts.

Relations add output to the consolidation call and more stored state per user.

## Subjects

Every observation, episode, fact and relation endpoint carries a subject: `user` for the primary user, a lowercase name for anyone else (`moni`), and a lowercase hyphenated name for an organisation. The observer assigns it. Working-memory entries have no subject.

- Consolidation skips a `reinforce` or `update` when the target fact's subject differs from the proposed one, logs a warning, and leaves the source episodes unconsolidated. An `invalidate` across subjects is applied, with a warning.
- Prune refuses a merge whose sources span subjects.
- A new fact is checked for duplicates only against facts of the same subject.
- `allFacts(subject?)` and `query(q, limit?, subject?)` filter by subject.

## Capture evaluator

`system({ evaluator })` asks an evaluator whether a conversation is worth capturing before the observer runs. `captureEvaluator(model)` builds one: an evaluator named `memory/capture-evaluator` that answers `captureQuestions`, a single `capture` choice of `remember` or `skip`.

| Answer | Effect |
|---|---|
| `remember` | The observer runs. |
| `skip` | Nothing is written and the messages are marked read. |
| evaluator error | The capture fails and the messages stay unread. It never falls back to the observer. |

An evaluator that does not answer `capture` with `remember` or `skip` throws `memory capture: the evaluator did not answer the "capture" question with "remember" or "skip". Build the evaluator with captureQuestions (or captureEvaluator(model)).` Extra questions are allowed and ignored. Exported: `captureEvaluator`, `captureQuestions`, `CaptureEvaluatorBlock`, `CaptureQuestions`, `CaptureChoice`. The `memorySystem` resource's `readMessages` records the messages an evaluated capture has judged.

## What memory stores

Every part is a resource declared by the package and registered by the app, as `resources: { ...mem.sessionResources, ...mem.userResources }`. None declares a `client` config, so a browser reads none of them unless the app adds its own route or flow action (see [Resources and collections](./resources.md)). A model sees memory only through the `<memory>` context block and the tools. Storage is the flow's configured store. A persistent one (filesystem, SQLite, Postgres) keeps the parts across restarts, and the in-memory one does not (see [Stores](./stores.md)).

| Part | Scope | Written by | Seen by | How many |
|---|---|---|---|---|
| `workingMemory` (`entries`, `currentTurn`) | session | The capture pipeline and the working helpers, and the app through `ctx.cap.workingMemory` | Server blocks. The model, through `<memory><working>`. | One per session. Up to `capacity` entries, more only when all are pinned. |
| `memorySystem` (`lastProcessedIndex`, `readMessages`, `episodicWritesSinceLastConsolidation`, `evictedPersistentSinceLastConsolidation`, `lastConsolidationTurn`) | session | The capture pipeline's bookkeeping | Server blocks only | One per session. Always in `sessionResources`. |
| `janitor` | session | The janitor | Server blocks, DevTool, the resource registry | One per session, overwritten each run. |
| `episodicMemory` (`episodes`, `totalEncoded`) | `user` (default) or `org` | Capture writes. Consolidation marks `consolidated`. The janitor deletes persistent episodes and flags permanent ones. | Server blocks. The model, through `<memory><episodic>` (off by default) and the recall tool. | One per user or org, shared by that user's sessions. Per flow with `flowIsolation`. Up to `maxEpisodes`. |
| `semanticMemory` (`facts`, `totalExtracted`, `totalConsolidations`, and `edges` with relations) | `user` (default) or `org` | Consolidation and prune. The janitor culls. At capture, a persistent or permanent observation in any category except `event` and `task` also becomes a fact straight away, without waiting for consolidation. The `ctx.cap.semanticMemory` helpers. | As above, plus `<memory><semantic>` (off by default) and the connect tool | One per user or org. The fact count has no cap. Prune acts at `pruneThreshold`, and the janitor culls by decay. |
| `digestMemory` (`digest`, `totalGenerated`) | the semantic tier's scope | Digest regeneration | `<memory><digest>` (on by default) | One per user or org. Each regeneration replaces it. |
