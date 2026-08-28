---
"@flow-state-dev/workspace": minor
"@flow-state-dev/tools": minor
"@flow-state-dev/claude-code": minor
---

Two runs can no longer write the same file at the same time without one of them being told (FIX-150).

The baseline answers "has this path changed since I last wrote it". It cannot answer "is somebody else writing it right now" — a second projection that has never committed the path holds no baseline for it and reads the collection as untouched. Both would write, the later would win, neither would know.

A projection now claims each entry it commits, and the claim covers the whole read-compare-write rather than only the write. A second writer reaching a claimed entry gets a `contested` outcome naming the path instead of writing. Two runs sharing a collection while touching disjoint files both land and neither is refused — that case is the point of the design, not a gap in it.

Two things about a claim decide whether it arbitrates the right pair, and both are narrower than the obvious choice.

**A claim belongs to the operation, not to the projection.** A session-scoped workspace is one registry entry, so every request that overlaps in it shares one projection. A holder identifying the projection is then the same holder for all of them: each is granted a key somebody already holds, all of them read the same base, and they commit over each other with everyone told they wrote — the exact loss the claim exists to stop.

**A claim names a durable entry, not a path.** `artifacts/report.md` is a naming convention. Keyed on the path, two sessions writing their own copy refuse each other over a row they do not share, while one collection mounted under two prefixes evades arbitration over a row that genuinely is one. `Mount.collectionId` carries what the collection IS; `principalFromContext` and `collectionIdFor` derive it from an execution context, and `unscopedCollectionId` covers the door that has none. New required field on `Mount`.

That id is close to the engine's storage key without being equal to it: the engine also folds per-resource flow isolation into where a user- or org-scoped resource lands, and that rule is the engine's rather than this package's. So two flows isolating one user's resources from each other share an id here while their rows are separate, and one of them can be told `contested` over a row it does not share. That is the safe direction — a refusal is reported and retryable, a missed claim is a silent overwrite — and making it exact needs a public accessor for the storage key itself.

On by default, for both the bash tool and the workspace agent capability. The bash tool warns and names the path; the coding-agent capability records a `contested` row in its `workspace-outcomes` collection alongside the `conflict` and `orphan` rows it already writes. In-process only: this is the same scope the baseline already has, and two servers writing one collection is a larger problem this does not claim to solve.
