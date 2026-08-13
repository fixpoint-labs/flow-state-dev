# Epic wrap detail — declared surface (FIX-1127)

Per-instance evidence behind [cycle 5 of the cycle ledger](../cycle-ledger.md#cycle-5--declared-surface-epic-wrap-fix-1127-2026-08-12).
The ledger carries the counts and the conclusion; the enumeration, the branch-head rescoring and
the correction narrative live here so the instrument stays scannable.

Merged 2026-08-12: [#1262](https://github.com/fixpoint-labs/flow-state-dev/pull/1262),
[#1263](https://github.com/fixpoint-labs/flow-state-dev/pull/1263),
[#1275](https://github.com/fixpoint-labs/flow-state-dev/pull/1275).

**Still open:** [#1273](https://github.com/fixpoint-labs/flow-state-dev/pull/1273) (the follow-up
guard fix — its round count is a partial, `1 (in flight)`, and must not be frozen as an endpoint),
and the epic PR [#1249](https://github.com/fixpoint-labs/flow-state-dev/pull/1249) itself, so the
epic's own row is a partial too.

## `missed-edge-case (unrun-claim)` — the enumeration

**A claim about what the system does was settled by argument, and the argument was locally sound.**
Not a knowledge gap and not carelessness — every instance reads as competent reasoning.

Two figures, with different denominators, because they answer different questions. See the ledger's
sample definition before comparing either against another cycle.

### Failures (n=8)

The **Outcome** column is the escape count: read it off the table rather than asserting a total in
prose. **One instance shipped** — row 5.

| # | Claim | How it was settled | Result | Outcome | In the review sample? |
|---|---|---|---|---|---|
| 1 | FIX-754: "four sites violate BP-012/BP-014" | read `main` carefully, three times (4 → 2 → 4) | wrong each time; a reviewer then found a 5th | caught in review | yes — #1249 |
| 2 | "`preset/small` → `intent/utility` is a drop-in swap" | read the runtime's own migration message | wrong — `intent/*` also throws with no map *and* no `default` | caught in review | yes — #1263 |
| 3 | "these Anthropic IDs should be dotted" (a sweep normalised them) | read for consistency | wrong — direct strings pass through unnormalised | caught in review, tracing `resolveId` | yes — #1263 |
| 4 | "the ladders cover the providers these pages advertise" | reasoned about the ladder | wrong — a Google-only reader matched nothing | caught in review, by running a 5×3 matrix | yes — #1263 |
| 5 | #1262: "a child's lazy resource loads at the parent's dispatch" | traced by reading; **self-flagged on the PR** as "the claim I'd bet least on" | unverified at merge | **SHIPPED** — the only escape | **no** — author self-report, never a review finding |
| 6 | codex: "the repo already contains unquoted YAML model fields" | asserted, unrun | **false** — zero `model:` keys across 144 `.yml`/`.yaml` files | declined; author ran it first | **no** — a *reviewer's* claim; the classes score the author |
| 7 | **the ledger entry itself:** "all four PR bases carried cycle 4's fixes" | `git merge-base --is-ancestor` — **executed**, against the wrong commit | **false for #1262** — the command cannot return "no" for a merged PR | caught in review, on this PR | **no** — an artifact of the wrap PR, which has no row |
| 8 | **the fix for row 7:** the sampling rule promoted into `distill-lessons` | prescribed comparing **authoring timestamps** to decide which commits carried a fix | **wrong on this epic's own data** — calls two known pre-fix instances post-fix | caught in review, on this PR | **no** — an artifact of the wrap PR |

Rows 1–4 are the four `unrun-claim` findings classified in the ledger's PR table. Rows 5–8 are real
and instructive and sit **outside** that sample; they are enumerated, not rated.

**Only row 5 shipped.** Review caught rows 1–4, 7 and 8; row 6 was a reviewer's own unrun claim,
declined after the author ran it. Any argument selecting this class on *escape* rests on that single
instance, and the ledger says so.

### Instance 8 — the remedy reproduced the defect

Row 7 was *"the claim was checked, and the command answered a neighbouring question."* The rule
promoted into `distill-lessons` to stop that recurring then prescribed **comparing authoring
timestamps** to decide which commits carried a fix. Timing is a neighbour of ancestry. It answers
"when was this written," not "what tree was it written against," and the two diverge exactly when a
branch integrates the fix late — which is the case the rule exists for.

It fails on this epic's own data, which is the data it was written from:

| Instance commit | Authored | Timestamp rule says | Ancestry says | Ledger's (correct) classification |
|---|---|---|---|---|
| `2429c30` | 19:25, after the 17:47 fix | post-fix | `b0fc019` is **not** an ancestor → pre-fix | **pre-fix** |
| `660e65e` | 19:55, after the 17:47 fix | post-fix | `b0fc019` is **not** an ancestor → pre-fix | **pre-fix** |

`fix/FIX-1126` did not integrate `b0fc019` until the merge `b302284` at 20:57. Both instances were
authored in the ninety-minute window after the fix existed on `main` and before that branch had it.
The rule as written would have reversed the very withdrawal it was extracted from.

Corrected to ancestry: `git merge-base --is-ancestor <fix-commit> <instance-commit>`.

**This is the strongest evidence in this entry, and it argues against the entry's own fix.** The
defect appeared *inside the remedy for the defect*, written by the author who had just diagnosed it,
in the same PR, and was caught by a reviewer rather than by the author. Whatever else the cycle
concludes, it cannot conclude that writing the rule down is what stops the class.

### The successful settlement (n=1)

Counterevidence for the asymmetry below, and the same question as row 1 — not a second failure.

| Claim | How it was settled | Result |
|---|---|---|
| FIX-754's count, fourth attempt | brace-matched parse of 157 `handler({…})` definitions across 907 files | **8**, first try, 8/8 with no false positives |

**The asymmetry is the finding.** Every settlement by a parse or an execution *of the claim itself*
was right on the first attempt. Every settlement by reading that was later checked was wrong.
Careful reading did not produce hedged answers, it produced confident wrong ones — FIX-754 was read
carefully three times, and the parse that finally settled it took one.

Row 6 is why the lesson is **not** "trust the reviewers": a premise nobody ran is a guess regardless
of who asserts it, and the author was right to run it before declining. Row 7 is why it is also not
"run something": a command aimed a little to the side of the claim buys confidence without buying
evidence.

## Scoring cycle 4's fixes — which branch heads carried them

Cycle 4's grounding sharpenings landed in `b0fc019` at **17:47 on 2026-08-12**. The question is not
when they landed on `main` but **which worker trees carried them**, and that has to be asked of each
branch head, not of the merge commit:

| PR | Branch head | Carries `b0fc019`? |
|---|---|---|
| #1262 | `d011d5f` | **NO** — forked at `151fb9a` (2026-08-11), ~19h older than the fixes, and never merged `main` |
| #1263 | `0fd6077` | **YES**, from `b302284` (20:57) onward — its first five commits, including the guard, are **pre-fix** |
| #1275 | `b065970` | YES |
| #1273 | `af26b707` | YES |

So this is **not** the four-PR controlled test the first draft claimed. #1262 is out entirely, and
#1263 splits down the middle at 20:57.

- **Fix A** (`issue-implement` 10.6: grep the superseded claim's distinctive noun, counting READMEs,
  error strings and the changeset as sites). **2 post-fix instances**, not three: #1273's stale
  success string — the author widened the scan scope and renamed the CI step at `4fc55e1` (22:31,
  post-fix) and left `main()` still printing "in docs or examples", caught by Cursor — and **#1275's
  PR description, which still records the changeset as `patch` while the merged fragment says
  `minor`**, which escaped review and is frozen in a merged body. **0 edit-time · 1 review ·
  1 escaped.** #1263's utility-default-in-four-places instance is **withdrawn**: it was authored at
  `660e65e` (19:55), pre-fix.
- **Fix B** (tenet 7: *a check that cannot fire is not a check*). **0 post-fix instances — this
  scoring is withdrawn in full.** #1263's guard, whose exclusion hid 1,624 files, was authored at
  `2429c30` (19:25), ninety minutes *before* the clause reached that branch. It is a fine instance
  of the shape and says nothing about whether the clause works.

**#1275 remains the sharpest data point**, and is unaffected by the correction. The discipline was
demonstrably active: the author swept **every other changeset fragment in the repo** for the same
`patch`/`minor` error and reported the sweep — a textbook fix-A convergence pass — and did not
converge the PR description sitting above it. Cycle 2's round 9 had already named the PR description
as a restatement surface. Applying the rule well on the adjacent surface did not carry it to the
next one.

## The correction: a check that could not fire

**This scoring was wrong on first write and is the wrap's own instance of the class it names.** The
correction is kept in full rather than smoothed over, because the failure is more instructive than
the result.

The first draft asserted "all four PR bases already contained the fixes," from a real command:
`git merge-base --is-ancestor b0fc019 <base.sha>`, where `base.sha` came from the GitHub API. Both
inputs were wrong in the same direction. A merged PR's `base.sha` is the **base branch tip**, not
the branch's fork point, and `--is-ancestor <fix> <merge-commit>` is **trivially YES for every merged
PR**, because a merge commit's first parent is `main`. Reproduced:

```
git merge-base --is-ancestor b0fc019 5b66a28     -> YES   (merge commit for #1262)
git merge-base --is-ancestor b0fc019 5b66a28^2   -> NO    (the branch head — the real answer)
```

**Executed, but the command answered a neighbouring question.** It is worse than not checking,
because a green result from a real command retires the doubt that would otherwise have prompted a
second look — and the entry then reported it as its most confident finding, explicitly inviting
challenge on it.

It also locates the gap in this cycle's own fix. BP-003 as first written says *execute or parse it,
don't read it*; the author did execute. What the clause was missing is that **the thing executed has
to be able to come back "no"** — which is [tenet 7](../../philosophy.md#7-prove-the-goal-not-the-mock)'s
*a check that cannot fire is not a check* reaching a verification command rather than shipped code.
BP-003 cross-references the tenet rather than restating it; the rule has one home.
