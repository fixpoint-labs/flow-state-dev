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

**`writeFile` reports a refusal to the model, not only to the logs.** It writes into the run's own workspace either way — that half is never contested — but the durable half can be refused, and returning `success: true` for it is how a model moves on believing an artifact was saved. Its result gains `refused`, a sentence naming what happened, and `success` now means the file reached its collection.

**Two ways a mount could delete the collection it was supposed to sync are closed.** `createBashTool` accepted a collection whose pattern mounts it at `tmp/`, which is the run's scratch prefix — the place filters everything under it out of the listing, so hydrate laid the entries down and the first flush removed every one as locally deleted. It is now refused with a message naming the prefix, as `createBashBlocks` already did.

The directory marker is renamed from `.keep` to `.fsdev-keep` for the same reason. `.keep` is a file people put in repositories, so a collection could hold one at `<prefix>/.keep` — the exact path the marker seeds — and no filter could tell them apart: the listing omitted the collection's copy, and the flush deleted the entry. The new name is reserved. A workspace that already holds a stale `.keep` will see it adopted into its collection once, which is the deliberate direction: adopting a file nobody asked for is recoverable, deleting one is not.

**A collection mounted twice is refused.** Two mounts of one collection are two routes to the same durable rows: the aliases produce the same claim key, but one flush decides both under one holder, so the second is granted a claim the first already holds and the later write wins. Nothing can arbitrate two routes to one row, and nothing can say which path owns it, so the configuration is rejected at construction.

**A write that lands outside every mounted collection is reported as unsuccessful.** `success` means the file reached its collection, and an orphan did not. It is in the workspace and nowhere durable, and the model can retry it under a mounted prefix once told.

**A flush never walks `node_modules` or `.git`.** A run that installs dependencies or initialises a repository inside a writable mount generates thousands of files that are not its work, and `.git` holds binary objects a place reading utf-8 cannot report honestly. The walk this change replaced pruned both; the replacement did not, so an `npm install` under a mount would have filled the collection and could have failed the command during its flush.

On by default, for both the bash tool and the workspace agent capability. The bash tool warns and names the path; the coding-agent capability records a `contested` row in its `workspace-outcomes` collection alongside the `conflict` and `orphan` rows it already writes. In-process only: this is the same scope the baseline already has, and two servers writing one collection is a larger problem this does not claim to solve.
