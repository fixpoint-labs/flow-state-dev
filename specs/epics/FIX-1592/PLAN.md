# FIX-1592 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

This plan sets the order the work runs in and what each piece involves. How to build a piece is
that issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 25 September 2026, in steps rather than dates because the epic is unscheduled. Input lane: FIX-1459, PACKAGE.md, in development on another thread; every child's edit to agent-worker-flow.ts waits for it. Step 1: FIX-1585, its spec in review and folding the kept message, then its implementation; the now line sits inside the spec bar. Step 2: FIX-1590, a post reaches its agents. Step 3: FIX-1594, an agent replies in the channel. Then wrap. The critical path is the whole chain, gated by FIX-1459.](figures/path.svg)

A straight chain behind one outside input. FIX-1585's spec is in review; nothing else starts
until its implementation merges (ER-14). FIX-1459 is on the critical path now: FIX-1585 and
FIX-1590 each edit `agent-worker-flow.ts` (ER-11). The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds order.

## What each issue entails

| Issue | Route | Blocked by | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|---|
| **FIX-1585** talk from the page | spec → impl PR | FIX-1459, for its agent-kind line | The shipped channel and seat flows | Two composers, the transcript as posts (its D1), the D3 map (ER-6), the kept message (ER-1), the agent-kind mock entry (ER-7), browser checks | FIX-1590 | Medium |
| **FIX-1590** a post reaches its agents | spec → impl PR | FIX-1585 · FIX-1459 | The D3 map · the notify slot · the scripted model | The agent kind's internal receiver; the wake of member agent seats (ER-2); the no-ping-pong filter (ER-3) | FIX-1594 | Medium |
| **FIX-1594** an agent replies in the channel | spec → impl PR | FIX-1590 | A woken seat · the wake rule · FIX-1585's transcript | A seat's way to post to its channel, authored as itself (ER-4, ER-5); the README (ER-19) | Wrap | Medium |

**Linear.** FIX-1585 blocks FIX-1590; FIX-1590 blocks FIX-1594. All three are sub-issues of
FIX-1592. FIX-1459 is related, not a blocker in Linear, because it belongs to another thread.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-25) is the review-time snapshot. Follow its
links for live state.

## What unblocks what, from here

1. **This amendment is approved and merged** → FIX-1585's spec folds ER-1 (ER-16).
2. **FIX-1459 lands and FIX-1585's implementation merges** → FIX-1590 is specced and built.
3. **FIX-1590 merges** → FIX-1594 starts.
4. **All three browser checks hold** (ER-17, ER-18) and the README says the three paths
   (ER-19) → wrap.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| `agent-worker-flow.ts` | FIX-1585, FIX-1590, FIX-1459 | One child edits it at a time, after FIX-1459. The kept message lands first; the receiver builds on it |
| The notify slot | FIX-1590 and FIX-1594 | FIX-1590 owns the wake and its filter (D2). FIX-1594 only posts; it never wakes anyone itself |
| The scripted model | All three | One resolver, one script file, one marker per scenario (ER-7). Nobody adds a second test resolver |
| The channel panel | FIX-1585 and FIX-1594 | FIX-1585 renders `channel-post` items with their author. FIX-1594 adds lines, not a second renderer |

## Not children, deliberately

FIX-1589 (the clerk's model answer) and FIX-1591 (the boards), follow-ons since the re-scope ·
FIX-1459 (PACKAGE.md, the file fence) · FIX-1415 (channel admin) · FIX-1493 (verified identity) ·
FIX-1476 (the channel convention this set runs on, Done). Linked, never re-parented.

## Wrap

When ER-17 to ER-19 hold: run the lessons pass, dispatch docs polish over the kitchen-sink README
and the channel docs, and report the outcome in Linear from the browser evidence. Meaningful
design amendments go in a follow-up PR from `main`, not a final status commit.
