# FIX-1500 · the spec's factual base, re-derived

Retained evidence for [the spec set](../../SPEC.md). Throwaway, not production code, not wired
into any suite, and nothing imports it. It reads files and spawns nothing.

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

**C2 · one durable-hire site.** Exactly one file pairs a roster `create()` with
`registerFromRoster()`. This is [D1](../../DECISIONS.md#d1)'s premise: extracting the sequence is
a *move*, not a reconciliation of two copies that have already drifted.

**C3 · fail-closed hire door.** The operator flow is registered only when a credential is
configured, so a default deployment has no hire path at all. This is why the rejected
"ship browse-only" option in D1 does not quietly still work in a clean clone.

## The negative control, and why it exists

`--plant` writes an unclassified collection into the package, runs C1, and removes it. **C1 must
reject it.** A totality assertion that has never been seen to go red is not evidence — the
sibling spec's corpus checker silently passed a planted file on its first version, because a
subtree rule absorbed it, which is the exact failure the assertion existed to prevent happening
*inside* the assertion. So the control is run, not just written.

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
browser-readable at all is [D3](../../DECISIONS.md#d3), and that is a judgement, not a count.
