---
"@flow-state-dev/workforce": minor
---

A workforce tree can declare read-only documents in `references/` beside the writable ones in `resources/`. A reference's body is served from its file on every execution context rather than from a stored row, so editing the file is the edit; `writable`, `llmWritable`, `render` and `flowIsolation` are derived by the folder and refused in frontmatter. A seat reaches the references at or above its place in the tree — the org's, its own team's and its own folder's — with no install-side filter, narrowed further by a `references:` list in its `WORKER.md`. `resources/` behaviour is unchanged. `clearShadowedReferences({ references, orgId, content, installedOn })` migrates a tree where a document was written before it moved — `installedOn` names the flow so the stored content is addressed where it actually lives rather than guessed at (FIX-1467).
