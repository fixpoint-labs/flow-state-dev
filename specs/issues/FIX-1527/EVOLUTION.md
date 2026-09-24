# FIX-1527 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

One predecessor design. It exists only on an unmerged explore PR, so it's cited by that PR's
head rather than by a local path.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1480 explore, `PLAN.md` proposed ship ticket **SHIP-C**: "A file-declared manager with `tools: [hire]`. Prove a teammate appears on `discover` after the tool runs." Source: [PR #2074](https://github.com/fixpoint-labs/flow-state-dev/pull/2074) head `8d589df3a54abe8e9cbfa55675fed3fe3a629b50`, `specs/issues/FIX-1480/PLAN.md` line 27 | **Retained, amended in two places.** Kept: a file-declared seat, the tool named in `tools:`, the capability on the kind, `discover` after the hire. Amended: the seat names `fire` too, and the `discover` proof runs under a named organization rather than in the default app | SHIP-A and SHIP-B landed as FIX-1525/1526 in [#2079](https://github.com/fixpoint-labs/flow-state-dev/pull/2079). [`poc/manager-seat/`](poc/manager-seat/README.md) P2 and leg R show the default app can't hire at all, which SHIP-C didn't anticipate | [D1](DECISIONS.md#d1), [F1](DECISIONS.md#f1) | None. Nothing shipped under SHIP-C |

Two neighbours are dependencies, not predecessors, and nothing here changes them.
FIX-1475's durable roster and operator action are consumed as-is. FIX-1475's earlier rule that
a runtime hire gets no inventory row was changed by #2079, not by this spec.

<a name="amendment-named-org"></a>
## Amendment after merge: kitchen-sink runs as one named organization

The original review is [#2112](https://github.com/fixpoint-labs/flow-state-dev/pull/2112). This
amendment is a new PR from `main`. It is shared with FIX-1500's amendment because one owner
decision moved both specs, and it does not reopen #2112.

**Why.** On 2026-09-24 the product owner chose, for FIX-1500, that kitchen-sink runs as one named
organization set by host code ([FIX-1455 D9](../../epics/FIX-1455/DECISIONS.md#d9); its mechanism
is [FIX-1500 D6](../FIX-1500/DECISIONS.md#d6)). That is the "real
organization" F1's hold branch was waiting for. It arrives in FIX-1500's PR-B, not in this issue.

| What | Treatment | Why |
|---|---|---|
| D1, D2, the seat, the composition on the `agent` kind | **Retained**, unchanged | This amendment changes neither the approach nor the surfaces |
| F1 | **Closed: answered *ship*** | The owner merged #2112 with that recommendation |
| VG | **Amended.** The refusal form stays as it is. Once FIX-1500's PR-B lands, VG re-runs and passes on a hire followed by `discover` listing it, as the hold branch already said. It gains a zero-model roster read, and its success form goes through the app's HTTP router | `fsdev run` pins the development organization (`packages/cli/src/commands/run.ts:373`) and never reaches the app's resolver, so the success form cannot run from the CLI. "Written" has to be read from the store, not from the model's transcript |
| V2 | **Retained** as a unit test under `DEFAULT_ORG_ID` | The refusal is still the package's behaviour, and the CLI still reaches it |
| S1 and S4 | **Amended**: the shared `kitchenSinkSeatHireOptions`, an `unregister` guarded by `isFromRoster` (new BR-13 and V9), and an S4 test that imports the app's real exports rather than rebuilding them | One options object for the rail and mara. The capability's `fire` checks kind, not provenance (FIX-1500's POC, N6) |
| BR-2, the people table, the failure taxonomy, DOCS' last paragraph | **Amended**: "every default kitchen-sink run" stays true only until PR-B lands, and after that only of `fsdev run` | FIX-1500's retraction-sweep rule, applied here |
| Considered and dropped: "a resolver on mara's flow" | **Retained**, with a note | The owner's host-level organization reaches mara with nothing on her flow |
| `figures/manager-seat.svg` | **Amended**: the gate's passing branch names kitchen-sink's organization | The figure shows where the app's hires will go |
