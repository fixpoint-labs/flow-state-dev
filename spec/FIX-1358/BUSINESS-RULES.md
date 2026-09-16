# FIX-1358 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, written as rules. A docs change's rules are about what a reader can conclude: each row
says what someone arrives looking for and what the page tells them. The *proved by* column is the
check the plan runs — for most rows that is
[the checker on this branch](../../spec-poc/FIX-1358-atlas-honesty/tree-teach-check.mjs), which
derives both sides rather than trusting a list.

## What the tree teaches

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A reader looks for where a channel is declared | The §06 tree shows `teams/<teamId>/channels/<name>/CHANNEL.md`, tagged as shipping, with `#1793` naming what landed it | Checker · the *drawn ⊇ reader-backed* direction |
| BR-2 | A shipped reader walks a slot | That slot is on the tree, or is named in the checker's exceptions table with a reason | Checker · totality, both directions |
| BR-3 | The tree draws a slot | A shipped reader walks it, or its tag says which issue is still coming, or it is a declared exception | Checker · totality, both directions |
| BR-4 | A reader looks at any one slot | Its tag says exactly one of `exists`, `proposed · FIX-n`, or `named gap`. No slot is untagged | Read by eye at review · the tag vocabulary is §-wide |
| BR-5 | A reader looks for `org/workers/` | Nothing. It appears on no figure, in no table, in no sentence | Checker · asserted explicitly (D7 · ER-13) |
| BR-6 | A reader looks for `org/channels/` | It is on the tree, tagged **named gap · no reader**, with one sentence saying the door is locked open and where to declare a channel instead | Read by eye · the sentence is the whole point of D1 |
| BR-7 | A new slot is added to the tree with nothing behind it | The checker fails and names it | Checker · negative control, run |

## What the W3 rows and the closing summary say

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A reader scans the §03 roadmap table for W3 | The row separates what shipped from what has not, rather than tagging the whole epic `proposed · next` | Read by eye at review |
| BR-9 | A reader reaches the §06 note that today reads *"W3 can put ChannelFlow files in the tree at the level they belong"* | It names the path that ships and the kind it binds to, in the present tense | Read by eye at review |
| BR-10 | A reader scans the build-out row or the closing summary | Neither says W3 is next while three of its conventions are merged | Read by eye at review |
| BR-11 | A reader arrives at §06 wanting to know how a declared channel becomes a conversation | One sentence points at §08, and §08 is unchanged | Read by eye at review |

## What is not touched

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | The PR is reviewed for blast radius | Exactly one file changed: `docs/atlas/workforce.html` | `git diff --stat` on the PR |
| BR-13 | A reader opens §08 or §14 | Unchanged. Delivery topology and the later Collab roster still stand as two views of one noun | `git diff` |
| BR-14 | A reader looks for the rooms-and-L2-channels dual the issue describes | Zero occurrences, as on `main` today. The change does not reintroduce one | Checker · claim A |

![Three readings of org slash channels traced to what an author does — see DECISIONS.md for the full figure](figures/org-channels-grid.svg)

BR-6 is the row that figure exists for: the middle column is what happens if the tree simply omits
the slot, and it is not better than the left one.

## Failure taxonomy

Nothing here can fail at runtime — it is one HTML file with no build step
(`docs/atlas/README.md`). The failure modes are a stale tag (caught by BR-2/BR-3, which is why the
checker derives rather than lists), a figure that renders in one theme only (caught by rendering
both before commit), and a tag vocabulary that drifts from the rest of the page (caught by eye,
because it is judgment).

## Acceptance criteria this issue owns

A reader who has never seen the epic opens `docs/atlas/workforce.html`, reads §06, and can say —
without opening `packages/` — which parts of a workforce tree they can declare in files **today**,
which are coming and under which issue, and which one door is locked open with nothing behind it.
The checker holds, including its negative control. That discharges
[ER-22](https://github.com/fixpoint-labs/flow-state-dev/pull/1703).
