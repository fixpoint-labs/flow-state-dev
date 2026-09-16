# spec(FIX-1362): per-seat skills in the built-in worker kind

| Someone who… | Today | After |
|---|---|---|
| **drops a skill folder beside a worker** | Nothing happens | That worker holds it. Nobody else. `/name` uses it |
| **gives two workers different skills** | Both read one org-wide bucket | Each has its own drawer |
| **wants a skill in every prompt** | Can't say so | One line in the worker file |
| **fixes a typo in a company skill** | Everyone sees it | Running workers keep their copy until refreshed |
| **runs a turn with no skill** | Free | Still free |

![Today one shared drawer with no levels; after, two aligned drawers with org, team, own bands](https://raw.githubusercontent.com/fixpoint-labs/flow-state-dev/claude/spec-pr-doc-formats-trwy46/docs/internal/spikes/spec-formats/FIX-1362/e-svg-poc/figures/drawers.svg)

Each seat gets its own drawer, filled from its own folders. The band a skill sits in is where it came from. `house-style` is in both drawers as two copies, which is the refresh decision below.

**How:** the loader's per-seat union rides the worker record and arrives at hire as a setting, the way a body arrives as instructions. No new primitive.

## Sign off

1. **A skill beside a worker is reachable, not always-on.** If wrong: the first thing people try looks broken.
2. **A seat holds a copy. Refresh is deliberate and replaces the folder whole.** If wrong: withdrawn instructions stay live, or a refresh destroys edits someone expected to keep.
3. **Skills ride the worker record, fixed at roster read.** If wrong: the kind's wiring is a rewrite.

**Open: none.** Number 1 is the one to weigh. Reasoning and rejected alternatives: [DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).

## Reviewers · look here

- **Why not always-on?** Is "drop a folder, type `/name`" a good enough first experience?
- **Rules → the fence.** A seat's own skill can now declare `agents:`. Check BR-15 and where the plan closes it.
- **Rules → refresh, bottom-right cell.** A refresh destroys a worker's own edits inside that folder. The honest reading of "the copy matches the source", and the half I'm least sure of.

**Not here:** FIX-1390 · classifier · keyword tier · FIX-1364 · FIX-1366.

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · Linear FIX-1362 · Epic FIX-1359 · builds on #1754 · never merges

<details>
<summary><b>How to review this</b> — altitude, what's in scope, what's deliberately unsettled</summary>

*(the spec-PR contract, pasted verbatim from `spec-template.md`)*

</details>
