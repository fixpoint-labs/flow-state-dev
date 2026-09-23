# FIX-1500 · the spec's factual base, re-derived

Retained evidence for [the spec set](../../SPEC.md). **Authoring-time, and that is its whole
status**: throwaway, not production code, not wired into any suite, not a gate, and nothing
imports it. It reads files and spawns nothing. A review round pointed out that the plan had also
made it a permanent check, which contradicted this paragraph — the check was dropped, not this
paragraph.

This spec rests on three counted or enumerated claims, and a hand-derived count is the class of
evidence that does not converge by being argued about — each review round corrects one number and
leaves the ones nobody looked at. So the base got a checker before it got a reviewer.

```bash
node specs/issues/FIX-1500/poc/evidence/check.mjs           # assert
node specs/issues/FIX-1500/poc/evidence/check.mjs --plant   # negative control, must FAIL
```

Run from the repository root.

## What it asserts

**C1 · totality, not a spot check.** Every resource collection defined under
`packages/workforce/src` is classified by the spec's own table — browser-readable, or deliberately
withheld with a reason — and a collection in neither column fails the run. It asserts in both
directions, so a table row naming something the tree does not define fails too. A checker that
only verifies the collections it already knows about cannot report the one nobody listed.

**C2 · one durable-hire site.** Exactly one file pairs a hired-roster `create()` with a
`registerFromRoster()` within 40 lines of it. At authoring this was the premise of the plan's
extraction — a *move*, not a reconciliation of two copies that had already drifted. It no longer
holds; see [the re-run](#re-run-at-the-amendment--two-of-three-no-longer-pass).

**What C2's predicate supports, and what it does not.** It is source-level and proximity-based,
not semantic. It requires a file to reference the hired roster, a `create()` on a roster-shaped
receiver, and a registration nearby — so it can say *"one file in these three trees pairs a roster
create with a registration in one sequence"*, and it cannot say *"the durable-hire sequence is
semantically unique in the repository"*. Its first version was looser still — any `.create(`
anywhere in a file that also mentioned `registerFromRoster` — which is a **neighbour of the
claim** rather than the claim, and passed only because one file happened to match. Review caught
that; it is tightened and the claim is stated at the width the predicate actually supports.

**C3 · fail-closed hire door.** The operator flow is registered only when a credential is
configured, so a default deployment has no hire path at all. This is why the rejected
"ship browse-only" option in D1 does not quietly still work in a clean clone.

## Which checks are falsifiable — exactly one of the three

**C1 has a negative control.** `--plant` writes an unclassified collection into the package, runs
C1, and removes it. **C1 must reject it.** A totality assertion never seen to go red is not
evidence — the sibling spec's corpus checker silently passed a planted file on its first version,
because a subtree rule absorbed it, which is the exact failure the assertion existed to prevent
happening *inside* the assertion. So the control is run, not just written.

**C2 and C3 have none.** They are one-shot counts against the current tree with no red path in
this script. That is a real limit on what they are worth, and it is stated rather than softened:
an earlier version of this README and of the script's header claimed a negative control for *all
three*. It was true of one. A falsifiability claim that was itself never checked, inside the
artifact whose whole purpose is to stop unchecked claims — caught in review, and recorded in
[EVOLUTION.md](../../EVOLUTION.md#unchecked-falsifiability) rather than quietly corrected.

## What it found

All three claims held as drafted. It also **corrected two errors in the spec's own table before
review saw them**, which is the whole argument for building it at authoring time:

- the membership collection's pattern is `inventory/members/**`, not `inventory/members/*` — the
  double star is what admits the `/` in a `<seatId>/<channelId>` topic, and the single-star
  spelling was this spec's first draft;
- `definePersona` defines a collection whose pattern its **caller** supplies, so it fixes no
  address and had gone unclassified entirely.

## What it does not settle

It says nothing about runtime behaviour — not what a browser receives, not what a boot rebuilds,
not whether a read is refused. Those are [PLAN.md](../../PLAN.md#checks)'s checks, and they run
against a server. This is a claim about what is in the tree.

Its C1 classification is also only as good as the spec's table: it proves the table and the tree
agree, not that the table's *reasons* are right. Whether the live inventory should be
browser-readable at all is a judgement, not a count, and it moved to FIX-1539 with
[D3](../../DECISIONS.md#d3).

## Re-run at the amendment — two of three no longer pass

Run again against `origin/main` `ffe2b6e26`, unmodified:

- **C1 fails**: `defineHiredRosterPrivateCollection`, added since, is in neither column. Its
  subject moved to FIX-1539, so the spec does not re-classify it here.
- **C2 fails, and in the misleading direction**: it reports **zero** sites, while the tree has
  **two** — `workforce-admin`'s handler, now writing through a private roster ref, and the
  seat-hire capability's `hire`, which registers through `registerHiredSeat` rather than
  `registerFromRoster`. The predicate matches neither spelling. The claim it guarded, *exactly
  one site*, is false for the opposite reason from the one the check reports.
- **C3 passes.**

The script is left as it was: it is authoring-time evidence, and a record of what it checked is
worth more than a quietly updated one. What replaced C2's premise is
[DECISIONS.md → Settled](../../DECISIONS.md#settled).
