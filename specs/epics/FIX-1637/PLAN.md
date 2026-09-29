# FIX-1637 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

An epic plan sequences the work and says what each piece entails. It does not say how to
write the page; that's FIX-1639's own spec. IDs cross-reference [DECISIONS.md](DECISIONS.md)
(D-n) and [BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path, as of 29 September 2026: an input lane for FIX-1634 under FIX-1635, not scheduled and not waited on. This epic spec in review at the now line. FIX-1639's spec, then the page, after the gate. FIX-1638 and FIX-1640 with no bars, marked proposed fold pending D1. The closure plan written beside FIX-1639, and its run after the page merges. The critical path runs gate, FIX-1639 spec, the page, the closure run](figures/path.svg)

A straight line with one wait: the gate, where D1 decides whether FIX-1639 writes alone. The
closure's QA plan is written while the page is, and its run waits for the page to merge.
FIX-1634 is drawn as an input that nothing waits on. The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds time.

## What each issue entails

| Issue | Route | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|
| **FIX-1639** the page | spec → docs PR | The eight reference pages on `main` · D1–D3 · this epic's [DOCS.md](DOCS.md) draft | The page, the table, the terms, drift fixes and links on existing pages, the contributor line | The closure run | Medium |
| **FIX-1638** config matrix | proposed fold (D1) | — | Under a re-split: the table, as its own page | The closure run | Small |
| **FIX-1640** terms | proposed fold (D1) | — | Under a re-split: the terms block and the contributor line | The closure run | Small |
| **FIX-1642** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child, merged, on one `main` commit · a BullMQ host with Redis | The committed checks and the QA report; a child for every finding | The epic's wrap | Small, repeats per finding |

All three work issues carry no Kind label in Linear, so their route defaults to spec. The
Architect's note on FIX-1638 suggests no spec unless a fork appears; that's the coordinator's
call to make by labelling, not this spec's.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-29) is the review-time snapshot; follow its
Linear links for live state. The one input from another epic, FIX-1634, is Backlog under
FIX-1635. Nothing here waits on it.

## What unblocks what, from here

1. **The owner answers D1 at the gate, and the spec merges** → FIX-1639's spec starts. On a
   fold, FIX-1638 and FIX-1640 close as folded, and their blocks on FIX-1642 go with them. On a
   re-split, all three spec in parallel and a cross-spec pass follows.
2. **FIX-1639's spec states which way the kill line reads** (ER-16) → if the page would be
   mostly "not yet", stop and file the gap. If it's all a nav edit, FIX-1639 shrinks to that.
3. **The page merges** → FIX-1642's first run, on the published page.
4. **FIX-1634 ships at any point** → its own docs work updates the fence sentence (ER-14). No
   child here re-sequences.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The `{ id }` fence sentence | FIX-1639 and FIX-1634 | FIX-1639 states it as the runtime has it; FIX-1634 owns changing it |
| *Work that outlives the turn* | FIX-1639 and that guide | The guide stays the step-3 map; the page links it, never repeats its table |
| *Inbound transports → Known sources* | FIX-1639 and FIX-453 | FIX-1639 removes the stale `notification` row; FIX-453's later architecture pass inherits the fix |
| Terms vs the table (only on a re-split) | FIX-1638 and FIX-1640 | Each reads the other's draft before publishing; the page links both |

## Not children, deliberately

FIX-1634 and FIX-1635 (the runtime fence) · FIX-453 (inbound transports' long form, Backlog) ·
FIX-1506 and FIX-1622 (live UI) · FIX-1197, FIX-1230, FIX-1231 (Relay, canceled). Linked from
the rules, never re-parented.

## Wrap

When FIX-1642's run is clean: the lessons pass, docs polish over the guides and the pages the
set touched, and a completion report in Linear. A meaningful change to this set goes through a
follow-up PR, not a final status commit.
