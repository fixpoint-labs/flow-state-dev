---
"@flow-state-dev/memory": patch
---

Memory now keeps distinct people distinct. Every memory carries a subject that is assigned once and carried through the episodic, semantic, and digest tiers, so the primary user and other people they mention are no longer cross-attributed. Consolidation and prune refuse to rewrite or merge a fact across subjects, and the digest narrates the primary user with others described in relation to them rather than collapsed into one persona.
