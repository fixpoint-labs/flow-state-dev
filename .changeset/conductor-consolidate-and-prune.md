---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) — consolidation and
deletion, no behaviour change.

The composition "the artifact this phase is working on" — `artifactKindForPhase`
into `artifactOfKind` — was hand-reconstructed in five places and its PR half in
two more. It now lives once, as `activeArtifact(phase, world)` and
`activePr(phase, world)` in `model/phases`, and every reader calls it.

Deleted: the guidance-change path (`WorldFact "guidance"`, `World.guidanceHashes`,
`ConductorPolicy.onGuidanceChanged`, `ObservationRequest.guidancePaths`, the
`guidance_changed` signal, the `reExamineOpenPrs` action, and both content-hash
readers), which nothing produced and nothing diffed; four signal kinds with no
producers (`issue_settled`, `objective_approved`, `external_status_changed`,
`approval_expressed`); and `nextPhase`, which had no callers. The guidance paths
carried into a phase brief are unaffected.

A ledger row naming one of the removed signal kinds reads back with `signal: null`
and its `signalKind` intact rather than failing to parse (BP-030).
