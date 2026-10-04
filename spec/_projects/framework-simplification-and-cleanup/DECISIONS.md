# Decisions — Framework simplification & cleanup

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

Calls that bind **more than one epic**. A call that touches one epic belongs to that epic's own
`DECISIONS.md`; absorbing it here would make this a design nobody signed off.

## Cards

None yet. No call so far binds two epics that are both still to run: the two wrapped epics
settled their own questions, and the two live ones share a seam ([Plan](PLAN.md)) and one rule
([Rules](BUSINESS-RULES.md) → PR-1), not a new decision.
The first call a second epic would otherwise have to make again gets card PD-1.

## Decided once

Answered at project altitude, so a later epic reads the answer instead of re-litigating it. Each
carries where it was settled.

1. **The block kinds are not collapsed.** Four when the review was written, five since the
   evaluator joined. The review proposed merging them; the validation pass went to the code and
   retracted it. *From the project's original description.*
2. **The state scopes are not collapsed, and scope state is not deprecated.** The review
   retracted the collapse. FIX-1157 then tested the narrower version, deprecating session, user
   and org state, and abandoned it: request scope keeps the same machinery anyway, so the removal
   buys about a third of the prize while deleting the client-facing half. The trial removal of org
   state was closed unmerged. *Validation pass; FIX-1157, Aug 20.*
3. **The two durable-storage primitives stay two: symmetry, not merger.** Where scope state and
   resources can offer the same verb without importing each other's semantics, they do. Where they
   must differ, the reason lives in one place. **Rejected, do not re-derive:** splitting them by
   scope range (request scope is multi-writer), and splitting them by persistence (both persist).
   The two conflict-retry drivers cannot be shared, only eliminated, because the stores model
   deletion differently. *FIX-1157, wrapped Aug 28.*
4. **Capabilities, skills, tools, `ui` and thought-fabric are not removed.** Retracted by the
   validation pass. *Original description.*
5. **The sequencer's public surface is not cut.** The review named two exceptions: `validate()`,
   which is still on the surface, and `background()`, since renamed `sideChain` under its own
   spec. *Original description; the rename settled separately.*
6. **Client data is private by default.** "Expose everything, with a hidden list" was rejected;
   a scope names what crosses to the client. *Original description.*

The source reports the original description names, a team synthesis and a validation synthesis
under `docs/internal/review*`, are not on `main` today. Where they disagreed, the validation
synthesis won; the list above is what it concluded.

## Open

### Does this project end at the public release, or stay open as the standing cleanup bucket?

**Plain terms.** This project was a three-week pass with a May 22 target. That pass is done bar
two package extractions. Since August it has become where "FSD says one thing, does another" fixes land: four
epics, 58 open issues, 52 under no epic. Nothing says when it is finished, so no epic can be
tested against a finish, and the bug count in [the outcome](SPEC.md) has no date to reach zero by.

**The trade-off.** Ending it at the public release gives it a finish line and forces one triage of
the 52: each either ships before release, moves to Public Launch's hard gates, or moves to a
post-release project. That costs a triage pass and some issues changing project. Keeping it as a
standing bucket costs nothing now, but it can never be called done, and it becomes a label.

**My recommendation.** End it at the public release. FIX-1127 made the case in August that the surface is
cheapest to make true before people build on it; the public release is the last point where that
holds, and after it each fix here is a breaking change for somebody outside. Set the Linear target to the release date once there is one; Public Launch
has none yet.

**What would change my mind.** If the release is a quarter or more away, tying this project to it
is a bucket with a date on it, and a narrower finish ("the 26 bugs") is the better line. Or if
cleanup is already tracked another way you would rather keep.

**What being wrong costs.** Low and reversible: a date and a label. The costly failure is the
other one, a project nobody can ever call done.
