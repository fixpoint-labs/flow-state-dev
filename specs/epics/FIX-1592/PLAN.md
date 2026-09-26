# FIX-1592 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

This plan sets the order the work runs in and what each piece involves. How to build a piece is
that issue's own plan. IDs cross-reference [DECISIONS.md](DECISIONS.md) (D-n) and
[BUSINESS-RULES.md](BUSINESS-RULES.md) (ER-n).

## The path

![The path as of 25 September 2026, in steps rather than dates because the epic is unscheduled. Input lane: FIX-1459, PACKAGE.md, in development on another thread; it gates FIX-1585's implementation and FIX-1590, the two that edit agent-worker-flow.ts. FIX-1598, the durable-hire goal check, red on main; it gates the closure run. Step 1: FIX-1585, its spec in review, then its implementation; the now line sits inside the spec bar. Step 2: FIX-1589, the clerk answers. Step 3: FIX-1590, a post reaches its agents. Step 4: FIX-1594, an agent replies in the channel. Step 5: FIX-1601, the closure issue; its QA plan may be written from step 1, its run waits for the other four and FIX-1598; a clean run opens the closure PR, and that PR's merge releases wrap. FIX-1591, the boards, sits below the chain as held, with no bar. The critical path runs from FIX-1459 through FIX-1585's implementation, FIX-1589, FIX-1590, FIX-1594 and FIX-1601's closure PR to wrap.](figures/path.svg)

A straight chain behind two outside inputs: 1585 → 1589 → 1590 → 1594 → 1601, whose closure
PR, once merged, releases wrap. FIX-1585's spec is in review. The next specs may be written
now; each implementation waits for the one before it to merge (ER-14). FIX-1459 gates the two builds that edit `agent-worker-flow.ts` (ER-11); FIX-1589
doesn't touch it. FIX-1598, the durable-hire goal check, red on `main`, gates the closure run.
FIX-1591 is held and off the chain. The dependency graph is in
[the spec](SPEC.md#how-the-issues-flow-into-each-other); this adds order.

## What each issue entails

| Issue | Route | Blocked by | Consumes | Delivers | Releases | Size |
|---|---|---|---|---|---|---|
| **FIX-1585** talk from the page | spec → impl PR | FIX-1459, for its agent-kind line | The shipped channel and seat flows | Two composers, the transcript as posts (its D1), the D3 map (ER-6), the kept message (ER-1), the agent-kind mock entry (ER-7), browser checks | FIX-1589 · FIX-1590 | Medium |
| **FIX-1589** the clerk answers | spec → impl PR | FIX-1585 | The D3 map (`desk-clerk` → `answer`) · the scripted model · the channel's `fileTask` | A model-backed `answer`, the answer-or-file decision, its clerk mock entry, a browser check (ER-20) | FIX-1590 | Small–medium |
| **FIX-1590** a post reaches its agents | spec → impl PR | FIX-1589 · FIX-1585 · FIX-1459 | The D3 map · the notify slot · the scripted model | The agent kind's internal receiver; the wake of member agent seats (ER-2); the no-ping-pong filter (ER-3) | FIX-1594 | Medium |
| **FIX-1594** an agent replies in the channel | spec → impl PR | FIX-1590 | A woken seat · the wake rule · FIX-1585's transcript | A seat's way to post to its channel, authored as itself (ER-4, ER-5); the README (ER-19) | FIX-1601 | Medium |
| **FIX-1601** closure · required | spec (the QA plan) → runs until one is clean → PR | Every other child, merged, on one `main` commit · FIX-1598 green | The four checks and each child's goal check | The QA report, a bug child per failure | Wrap | Medium |

**Linear.** FIX-1585 blocks FIX-1589 and FIX-1590; FIX-1589 blocks FIX-1590 and FIX-1594;
FIX-1590 blocks FIX-1594. All four block FIX-1601, the closure issue. All five are sub-issues
of FIX-1592. FIX-1598 also blocks FIX-1601: FIX-1589's contract needs durable hire green.
FIX-1459 blocks FIX-1585 and FIX-1590; it stays another thread's issue, not a child. FIX-1589
also blocks FIX-1591, which is held and not a child.

## Where it is

[The set table](SPEC.md#the-set--as-of-2026-09-25) is the review-time snapshot. Follow its
links for live state.

## What unblocks what, from here

1. **This amendment is approved and merged** → FIX-1585's spec folds ER-1 (ER-16).
2. **This amendment merges** → FIX-1589's, FIX-1590's and FIX-1594's specs can be written.
3. **FIX-1459 lands and FIX-1585's implementation merges** → FIX-1589 is built.
4. **FIX-1589 merges** → FIX-1590 is built.
5. **FIX-1590 merges** → FIX-1594 is built.
6. **Wrap**, when all of these hold:
   - **ER-17:** FIX-1601's closure PR has merged, closing FIX-1601. A clean run on one `main`
     commit, with FIX-1598 green, is what opens it.
   - **ER-18:** each child's PR was already green before the closure run started.
   - **ER-19:** the README says the three paths.

## Coordination seams to watch

| Seam | Between | Rule |
|---|---|---|
| `agent-worker-flow.ts` | FIX-1585, FIX-1590, FIX-1459 | One child edits it at a time, after FIX-1459. The kept message lands first; the receiver builds on it. FIX-1589 stays off it |
| The clerk and the notify stub | FIX-1589 and FIX-1590 | FIX-1589 changes what `answer` does and keeps its input, `{ note }`, so the D3 map holds. FIX-1590 changes who a post runs and keeps clerks on the name-only line. Neither edits the other's file |
| The notify slot | FIX-1590 and FIX-1594 | FIX-1590 owns the wake and its filter (D2). FIX-1594 only posts; it never wakes anyone itself |
| The scripted model | All four | One resolver, one script file, one marker per scenario (ER-7). Nobody adds a second test resolver |
| The boards | FIX-1589 and FIX-1591 (held) | FIX-1589 files rows through `fileTask` and stops there. Drain, board UI and the boot warning wait for FIX-1591 (ER-13) |
| The channel panel | FIX-1585 and FIX-1594 | FIX-1585 renders `channel-post` items with their author. FIX-1594 adds lines, not a second renderer |

## Not children, deliberately

FIX-1591 (the boards, held for the owner's `escalations` call) · FIX-1459 (PACKAGE.md, the file
fence) · FIX-1415 (channel admin) · FIX-1493 (verified identity) · FIX-1476 (the channel
convention this set runs on, Done). Linked, never re-parented.

## Wrap

When ER-17 to ER-19 hold: run the lessons pass, dispatch docs polish over the kitchen-sink README
and the channel docs, and report the outcome in Linear from the browser evidence. Meaningful
design amendments go in a follow-up PR from `main`, not a final status commit.
