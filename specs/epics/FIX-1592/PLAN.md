# FIX-1592 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

This plan sets the order the work runs in and what each piece involves. How to build a piece is
that issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 25 September 2026, in steps rather than dates because the epic is unscheduled. Input lane: FIX-1459, PACKAGE.md, in development on another thread, fencing agent-worker-flow.ts. Step 1: FIX-1585, spec in review, then its implementation; the now line sits inside it. Step 2: FIX-1589, the clerk. Step 3, side by side: FIX-1590, posts wake seats, and FIX-1591, the boards work. Then wrap. The critical path runs through FIX-1585, FIX-1589 and FIX-1591.](figures/path.svg)

A chain with one fork at the end. Only FIX-1585 is moving, and its spec is in review. Nothing
else starts until its implementation merges (ER-15). FIX-1591 is on the critical path because
the Proof reads it; FIX-1590 runs beside it and could be cut without moving the wrap. The
dependency graph is in [the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds order.

## What each issue entails

| Issue | Route | Blocked by | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|---|
| **FIX-1585** talk from the page | spec → impl PR | — | The shipped channel and seat flows | The two composers, the transcript expose line (ER-7), the D3 map (ER-6), two browser checks | FIX-1589 · FIX-1590 | Medium |
| **FIX-1589** the clerk | spec → impl PR | FIX-1585 | The seat composer · the channel's `fileTask` · test mode's model | `answer` calls a model and answers or files (ER-1, ER-2, ER-8); both branches driven keyless; one real-model goal (ER-18) | FIX-1590 · FIX-1591 | Medium |
| **FIX-1590** posts wake seats | spec → impl PR | FIX-1589 | The D3 map · core's dispatcher | A dispatcher per member in `workforce/channel-notify.ts` (ER-3), no re-entry (ER-4) | Wrap | Small; collapse trigger in D1 |
| **FIX-1591** the boards work | spec → impl PR | FIX-1589 | Rows from the clerk · the board panel | Pick up an `escalations` row; run the `followups` drain from the board (ER-5); the retired demo (D3, ER-19); the README (ER-20) | Wrap | Medium |

**Linear.** FIX-1585 already blocks FIX-1589. This spec adds FIX-1589 blocks FIX-1590 and
FIX-1591. All four are sub-issues of FIX-1592; none had another parent.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-25) is the review-time snapshot. Follow its
links for live state. The one outside input: FIX-1459 is In Development on another thread and
fences `agent-worker-flow.ts` (ER-11). No child here needs that file today.

## What unblocks what, from here

1. **This spec is approved and merged** → nothing starts yet; FIX-1585 is already running.
2. **FIX-1585's implementation merges** → FIX-1589 is specced and built.
3. **FIX-1589 merges** → FIX-1590 and FIX-1591 start, side by side.
4. **FIX-1591's browser check and FIX-1589's goal pass** → wrap, whether or not FIX-1590 is cut.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| The D3 map's module | FIX-1585 and FIX-1590 | FIX-1585 places it. If the fan-out can't import it, FIX-1590 moves it; nobody copies it (D2) |
| `desk-clerk.ts` and `desk-note.ts` | FIX-1589 and FIX-1590 | FIX-1589 owns the action's shape. FIX-1590 calls `answer { note }` as mapped and edits neither file |
| The board panel | FIX-1585 and FIX-1591 | FIX-1585 leaves boards read-only. FIX-1591 adds the pickup and drain verbs there, not in the seat panel |
| The workforce goal and README | FIX-1590 and FIX-1591 | V14 is FIX-1590's to keep green; V8, V9 and the README's escalations section are FIX-1591's |

## Not children, deliberately

FIX-1459 (PACKAGE.md, the file fence) · FIX-1415 (channel admin) · FIX-1493 (verified identity) ·
FIX-1476 (the channel and board convention this set runs on, Done). Linked, never re-parented.

## Wrap

When ER-17 to ER-20 hold: run the lessons pass, dispatch docs polish over the kitchen-sink README
and the channel docs, and report the outcome in Linear from the goal and browser evidence.
Meaningful design amendments go in a follow-up PR from `main`, not a final status commit.
