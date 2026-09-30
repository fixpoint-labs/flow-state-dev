# FIX-1472 · Recorder success/error paths have converged and should share their write-correlation mechanism

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

Improvement (refactor, no behaviour change) · `orchestration` · small · 1 PR · no epic · builds on [FIX-963](https://linear.app/fixpoint-labs/issue/FIX-963) (Done)

## People, before and after

| Someone who… | Today | After |
|---|---|---|
| **fixes how the task board checks its own result write** | Makes the fix twice, in two recorders that have to be kept identical by hand | Makes it once. Both recorders pick it up |
| **reads a recorder to learn why a failure did or didn't stop the run** | Reads two long bodies where the shared steps and the exits are interleaved | Reads a short body per recorder where every exit is written out in order. The shared part is two named steps |
| **runs a task board in an app** | Today's behaviour | Today's behaviour, exactly: same row states, same persisted entries, same errors, same lease timing |
| **hits a report that could not be delivered** | The run fails immediately, at every site | Unchanged, and still written out as its own rule |
| **hits a bookkeeping failure in a batch, or at a hand-off** | The batch fails at the drain's tail once siblings finish; the hand-off fails where it stands | Unchanged, and still written out as its own rule |

Most of this is already shared. FIX-963 extracted the classification and the release. What is
still spelled twice is the part a write-correlation fix touches: take the baseline, make the
write, classify what it did, then report and raise or defer. That is what this moves.

## The goal, and how we'll know it's met

**A change to how the task board checks and reports its own result writes is made in one place,
and every run behaves exactly as it does today.**

| Is it the right goal? | |
|---|---|
| **The real need** | "Every future recorder fix has to be made twice and kept in sync by hand" … "share the mechanism without collapsing the two containment behaviours into one" ([FIX-1472](https://linear.app/fixpoint-labs/issue/FIX-1472)) |
| **Smaller, and rejected** | "The recorders call a few more shared helpers." Hittable while the baseline, write, classify, report sequence is still written twice, so it still drifts |
| **Bigger, and not this issue's** | De-duplicating the two recorder-failure test harnesses. [FIX-1473](https://linear.app/fixpoint-labs/issue/FIX-1473) owns it |
| **Not done if** | The suite is green but some recorder-and-outcome case was never exercised · the shared step takes an argument that picks which exit to take (the rejected flag, renamed) · a test was edited to make it pass |

**No goal check applies.** This is a pure refactor: nobody can do anything after it that they
can't do now. What proves it instead is equivalence. Every case in
[BUSINESS-RULES.md](BUSINESS-RULES.md) is pinned as a characterization test **on `main`, before
any code moves**, and the same tests pass unedited afterwards, alongside the existing unit and
integration suites. **Control that must fail:** planted deviations in the exit rules (renewal
stopped before the success recorder's rethrow, a report-delivery failure swallowed by `onError`,
the site check dropped from the recorder-failure guard) each turn the matrix red. The
implementation PR shows those reds before the green counts ([PLAN V2](PLAN.md#checks)).

## What changes

![Two recorders, before and after. Before: each column stacks its own baseline, write, classify, report and raise steps between its exits, with the shared-looking steps duplicated in both. After: the two columns keep only their exits, in order, and both call two shared steps drawn once between them](figures/what-changes.svg)

Read the middle. The two steps drawn once are the mechanism; everything left in each column is
that recorder's own exit rules, still in their own order.

**The success recorder's write, as a maintainer reads it.** Illustrative: the names are the
implementer's.

```diff
-  const write = beginTaskWrite(readTaskQuietly(collection, claim.taskId));
-  let recorderFailure;
-  try {
-    await advisoryComplete(collection, claim.taskId, output, { ifAllowed: true, claim, refuseWhenParked: true, write });
-  } catch (err) {
-    recorderFailure = await classifyAndRelease({ ctx, collection, claim, recorder: "complete", write, err, wiring });
-  }
+  // Rethrows the write's own error when it saved nothing — this recorder's exit, below, is skipped.
+  const recorderFailure = await <the shared write step>(collection, claim, "complete",
+    (write) => advisoryComplete(collection, claim.taskId, output, { ifAllowed: true, claim, refuseWhenParked: true, write }));
   stopLeaseRenewal();
   await ctx.sequencer!.patchState({ currentClaim: undefined });
-  if (recorderFailure !== undefined) {
-    await reportRecorderFailure(ctx, recorderFailure);
-    if (raisesHere(wiring)) throw new TaskBoardRecorderFailureError([recorderFailure]);
-  }
+  if (recorderFailure !== undefined) await <the shared surface step>(ctx, recorderFailure, wiring);
```

## What stays as it is

- Every observable outcome: row states, the persisted `task-board-recorder-failure` entry, the
  two error classes, `onError`, and when lease renewal stops.
- The public surface. `createRecordSuccess`, `createRecordError`, their options, and every
  export of the task board are untouched. The shared steps are not exported.
- The two containment rules and where they live: a report that could not be delivered is fatal
  at every site; a recorder failure defers to the drain's tail except at the hand-off gate.
  Both stay as their own explicit statements in the error recorder.
- The raise-or-defer wiring option. It already exists and is set by the composition site.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** one place to change, and no
behaviour change, proved by a matrix pinned before the move. If wrong: we ship a "refactor" that
quietly changed when a run fails, or keep two copies that drift.

1. **[D1](DECISIONS.md#d1) · Share the write and its report; each recorder keeps its own exits
   written out.** If wrong: exit rules stay slightly duplicated (about ten lines each), or a
   reader still has to trace two bodies to see where they differ.

**Open: none.** D1 is the only call, and the fence already settled its neighbour (one recorder
with a mode flag). Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).
