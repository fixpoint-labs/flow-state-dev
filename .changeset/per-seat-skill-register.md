---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

Give each worker on a roster its own skills (FIX-1362).

Two workers on one roster used to read the same bucket, and nothing filled that bucket from a worker's own folders — so a skills folder dropped beside a worker did nothing, and the skills a worker could reach were everyone's.

**workforce.** `readWorkforce` reads the tree and hands back records that already carry their own skills (the org ∪ team ∪ own-folder union), which `hireWorkforce` imposes on the seat as its `seatSkills` setting the way a body is imposed as `instructions`. `WorkerManifest` grows an optional `skills`. A `WORKER.md` declaring `seatSkills:` itself is refused by name at the loader and the hire step both. The built-in `agent` kind reads that set into its own isolated catalog and gains two switches: `skills.active` (always-on by name) and `skills.activateTool` (let the model pull a skill in mid-turn, off by default).

**orchestration.** `defineSkillsCollection` and `SkillsLibraryOptions.collectionConfig` forward `flowIsolation`, so each registered copy of a flow can hold its own catalog. `initialSkills` now also takes a function of the execution, for a catalog that belongs to the copy rather than the definition — under one, binding a skill by name is refused rather than left unvalidated. `refreshSeededSkills` pulls a source edit onto a catalog that already holds a copy, replacing a touched skill's folder whole so a supporting file withdrawn upstream cannot outlive the withdrawal. `SkillsLibraryOptions.toolSeatFence` lets a host cap which catalog keys a delegated board worker may be seated with.

Existing callers are unaffected: every new option is opt-in, and a plain `initialSkills` array behaves exactly as before.
