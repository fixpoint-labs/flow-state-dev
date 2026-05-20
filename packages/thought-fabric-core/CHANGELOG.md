# @thought-fabric/core

## Pre-1.0 history

The memory system used to live in this package under `@thought-fabric/core/memory`
and was extracted to the dedicated `@flow-state-dev/memory` package on
2026-05-15 (FIX-588). Entries below that predate the extraction describe work
that originally landed here. Captured from the project's pre-Changesets
development log (root `changelog.md`, deleted on FIX-653). Entries are listed
newest-first.

### 2026-05-19 — Memory: confidence decay + episodic TTL hygiene (FIX-411)

Hygiene work originally landed alongside the memory subpath that lived here; it now ships from `@flow-state-dev/memory`. See that package's changelog for the full entry.

### 2026-05-15 — Memory system extracted (FIX-588)

`@thought-fabric/core/memory` is removed. The `memory` namespace no longer ships from this package; the subpath export and re-export shim are deleted. Until Thought Fabric ships its own cognitive memory variants on top of the shared contract, it doesn't address memory at all. The package continues to host attention, identity, and metacognition.

### 2026-05-07 — Memory: structured-output repair (FIX-570)

Memory consolidation and prune generators now register a `repairOutput` hook recovering from common mis-shapes (bare arrays wrapped under the envelope key, narrative text wrapping a JSON code block, mid-stream truncation recovered by walking back to the last balanced `}`, partial objects defaulted to `[]`). Unrecoverable strings degrade to an empty envelope with a `[tf.memory]` warning so a single bad cycle doesn't crash the background `.work()` step. `MemorySystemConfig.model` accepts `string | string[]`; arrays build a `createFallbackModel` chain. New optional `consolidationModel` and `pruneModel` fields.

### 2026-05-06 — Generator: log unparseable candidates

`tf.memory/consolidate/generate`'s repair attempts raised from the default 1 to 3 so transient structured-output drift on small models recovers before the background task fails.

### 2026-05-05 — Recall tool: per-source pre-rank

`prepareBlock` no longer pools both stores under one cap. Semantic facts pass through unconditionally; episodes are intrinsically pre-ranked and capped at `PRE_RANK_EPISODIC_CAP` (default 30). Stage 1.5 exact-phrase pass-through still runs but only over episodes that didn't make the cap. `PRE_RANK_CAP` is deprecated; custom strategies that imported it should switch to `PRE_RANK_EPISODIC_CAP`.

### 2026-05-05 — Recall tool: `RetrievalStrategy` block-factory shape [BREAKING]

`RetrievalStrategy` is now `{ name, prepareBlock, filterBlock?, formatBlock? }`. The old `rank()` method is removed. Removed public types: `RankedResult`, `RetrievalStrategyContext`, `RetrievalStrategyOptions`. New public types: `PrepareInput`, `PrepareEnvelope`. New exports: `defaultFormatBlock`, `buildResult`, `buildResultMetadata`, `capContent`, `TRUNCATION_MARKER`.

### 2026-05-05 — Memory capability: orthogonal section presets (FIX-513)

Replaces role-named `agent` / `worker` presets with five orthogonal section presets: `digest`, `working`, `semantic`, `episodic`, `recall`. Default-on set is `['digest', 'working', 'recall']`. New `createMemoryContextFormatter(options?)` factory. Inclusion is independent of processing — the capture pipeline still runs for whichever tiers are configured on `memorySystem({...})`.

### 2026-05-02 — Memory pipeline + naming reliability fixes

`contextFormatter` now returns an object (`{ digest?, working? }`) rather than a pre-formatted string so the framework's context aggregator nests proper child tags under `<memory>`. Digest now regenerates as a top-level `.work()` step when `digest` is configured, instead of riding inside the consolidation / prune gates. Framework-namespaced tool blocks like `tf.memory/recall` are aliased to `^[a-zA-Z0-9_-]+$` form before submission to providers (OpenAI). Recall tool prompt wording is more directive about personal/user-specific details.

### 2026-05-02 — Memory: simplified `contextFormatter` (FIX-407)

`mem.contextFormatter` now emits a single `<memory>` block containing only the rolling digest (when configured) and current working-memory entries. Semantic facts and recent episodes are no longer pre-injected into the prompt — agents retrieve them on demand via the recall tool. Returns `undefined` when both are empty. No `maxTokens` / `topN` / `strategy` knobs on the formatter API.

### 2026-05-02 — Memory: rolling digest tier (FIX-408)

New `digest` tier — a single LLM-generated narrative paragraph that summarises stable knowledge about the user. Regenerates as a side effect of `consolidate` and `prune`; a source-state signature short-circuits the LLM call when nothing has changed. `memory.system({ digest: true | { maxTokens, topN } })`; default `maxTokens` is 400. `mem.regenerateDigest` provides a manual escape hatch.

### 2026-05-02 — Memory: agent-invocable `recall` tool (FIX-409)

New `mem.tool.recall()` factory on `memory.system()` returns a handler block agents install on a generator with `tools: [mem.tool.recall()]`. Searches stored memory — semantic facts and past episodes — on demand. Working memory excluded. Pluggable `RetrievalStrategy` interface; v1 ships `'llm-filter'`: query-blind intrinsic pre-rank (top 50) followed by a single LLM filter call over the bounded candidate set. Per-item char cap (default 400) with a truncation marker.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Memory and perspective resource scopes renamed `project` → `org`.
