---
---

Conductor (lab, LAB-146): a phase's construction-time check returns what it found instead of storing it.

`implementPhase()` used to keep the repository its completion probe was pinned to in the phase's own closure. A `conductorFlow` build that then failed a later check — an empty tenant, say — left that pin behind, and the corrected retry was refused as already pinned. Two conductors built from one `PhaseSpec` shared the same closure, so the second repointed the first's completion check.

`PhaseSpec.validate` now returns its finding and `conductorFlow` binds it into that conductor's run contexts as `PhaseRunContext.validated`. The phase stores nothing, so a failed construction leaves nothing behind and two conductors get two wrappers rather than one closure.

Internal to `labs/conductor`; no published package surface changes.
