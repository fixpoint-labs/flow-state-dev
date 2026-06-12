---
"@flow-state-dev/memory": minor
---

Add an opt-in relations (knowledge graph) tier to semantic memory. Enable with `semantic: { relations: true }` (or an object for `vocabulary` / `maxEdges` / `createImplicitEntities`). When enabled, consolidation extracts typed directed edges between subjects (e.g. `user --married to--> moni`) in the same LLM call and stores them on the semantic resource's edge graph; the hygiene janitor prunes edges whose endpoints were culled. Relations default off and add zero behaviour when omitted — the existing personalization path is unchanged. New export: `RelationsConfig`.
