---
---

Conductor (lab, LAB-146): a phase's construction-time check returns what it found instead of storing it, and `implementPhase`'s `repo` option is gone.

`implementPhase()` used to keep the repository its completion probe was pinned to in the phase's own closure. A `conductorFlow` build that then failed a later check — an empty tenant, say — left that pin behind, and the corrected retry was refused as already pinned. Two conductors built from one `PhaseSpec` shared the same closure, so the second repointed the first's completion check.

`PhaseSpec.validate` now returns its finding and `conductorFlow` binds it into that conductor's run contexts as `PhaseRunContext.validated`. The phase stores nothing, so a failed construction leaves nothing behind and two conductors get two wrappers rather than one closure.

**Removed: `ImplementPhaseOptions.repo`.** It was a second answer to the question `validate` now answers, and the two could name different repositories with no safe way to reconcile them. Nothing constructed the phase with it. The completion probe reads the pin off the run context only, and an absent one is refused rather than recovered from — the old recovery re-read `origin` in the checkout after the agent had run, which is the wrong-repository answer the pin exists to prevent. Callers who want to supply their own repository supply their own `prExists`.

Internal to `labs/conductor`; no published package surface changes.
