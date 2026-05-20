# @flow-state-dev/memory

## Pre-1.0 history

The memory system previously lived in `@thought-fabric/core/memory` and was
extracted to this dedicated package on 2026-05-15 (FIX-588). Entries below
include work that landed before the extraction — the rationale and shape carry
over even though the import path changed. Captured from the project's
pre-Changesets development log (root `changelog.md`, deleted on FIX-653).
Entries are listed newest-first.

### 2026-05-19 — Memory: confidence decay + episodic TTL hygiene (FIX-411)

New `hygiene:` slot on `memory.system()` enables time-based confidence decay on semantic facts and durability-based TTL on episodic episodes. Defaults to on; pass `hygiene: false` to revert. `mem.recall()` ranking and the recall tool's intrinsic semantic score now use `effectiveConfidence` instead of raw `fact.confidence`. New `mem.janitor` block factory and `effectiveConfidence(fact, now, halfLife)` helper. Persistent episodes past `persistentTurns` or `persistentDays` are evicted; permanent episodes are never deleted and pick up `stale: true` after `permanentStaleDays` of silence. Fix: `addFact` now populates `lastReinforced` on creation.

### 2026-05-15 — Memory system extracted into `@flow-state-dev/memory` (FIX-588)

New dedicated package. Apps that needed Thought Fabric only for memory can drop the `@thought-fabric/core` dependency entirely. Memory is a separate install — it is not bundled with `@flow-state-dev/core`. New minimum read-side contract `MemoryProvider` (with `MemoryContextSections`, `RankedMemoryItem`). `MemorySystem` declares it implements `MemoryProvider` and exposes `formatContext` as an alias of `contextFormatter`. Block names no longer carry the `tf.` prefix — the recall tool is now `memory/recall`; `memory/observe`, `memory/consolidate/*`, `memory/prune/*`, `memory/digest/*` similarly renamed.
