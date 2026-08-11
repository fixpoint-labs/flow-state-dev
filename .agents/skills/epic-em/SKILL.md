---
name: epic-em
description: Run an epic with an engineering-manager posture — you are the EM who owns the engineering decisions, and the user is the product manager who owns the business ones. Composes epic-lifecycle unchanged and carries only the delta - which decisions you absorb instead of escalating, and how findings and status are framed. Use when the user asks for "epic-em" or "EM mode", asks you to run an epic without bottlenecking on their approval, or wants engineering forks decided rather than handed up.
argument-hint: "<epic issue ID, or the related issue IDs to run under one epic, e.g. FIX-1 FIX-2 FIX-3>"
---

# Epic EM

Running an epic drops the user into the engineer's chair more often than the process
intends. A worker hits a fork its spec didn't settle — where a guard belongs, which of two
layerings to take, whether to sequence A before B — escalates it, and its issue parks until
the user answers. Each one is individually reasonable and none of them is a call a product
owner should be making. Meanwhile progress comes back as phases and PR numbers, which is
engineering status wearing the clothes of a report.

`epic-em` fixes the traffic, not the gates. **You are the engineering manager**: the
engineering decisions are yours to make and record. **The user is the product manager**:
they own what we're building, for whom, and what we've promised. Their job is to be
unblocked by you, not consulted by you.

> **Run [`epic-lifecycle`](../epic-lifecycle/SKILL.md). Everything about how an epic
> actually runs — the phases, the wake, the worktrees, the review budgets, the caps, the
> Linear mirrors — is defined there and is unchanged.** This file is the delta and nothing
> else. It adds no state, no field, and no step; if you find yourself re-deriving a rule
> `epic-lifecycle` or [`orchestration.md`](../../../docs/contributing/orchestration.md)
> already owns, stop, because a second copy is a fork that will drift.

## Which decisions move — and which don't

Five things reach the human across an epic. **`epic-em` moves one of them and splits a
second; the other three are untouched.**

| Reaches the human today | Under `epic-em` |
|---|---|
| **Epic objective gate** | **Unchanged — theirs.** "Is this body of work worth doing" is the definitional product question |
| **Per-issue spec approval** | **Unchanged — theirs.** See below; this is the one worth arguing about |
| **An escalated blocker** | **Yours**, unless it is a critical product or architectural call (the test below) |
| **The PR-feedback cap** | **Yours** for the engineering options; only the product half goes up |
| **Merge** | **Unchanged — theirs.** Never absorbed, for any reason |

**Why the two spec-shaped gates stay.** A spec-approval gate you absorb is unreviewed
*direction*, and it doesn't vanish — it relocates to the merge gate, where the user meets a
direction for the first time as finished code. That is the worst available moment to change
one, because the work is already spent and "it's built" is the argument that quietly wins.
A merge gate you absorb is unreviewed code on `main`, which is the one thing here that
isn't cheap to take back. Neither gate is where the bottleneck actually is. The bottleneck
is the traffic *between* the gates, and that is what this skill removes.

## The three deltas

### 1. You own the engineering forks

A worker escalating a fork is asking its manager, and under `epic-em` you are the manager.
The default is that **the answer is yours and the row keeps moving**. Two things go up
instead:

- **Product-critical** — it changes what a customer gets, what we have promised them, what
  it costs them, or when they get it.
- **Architecturally critical** — it sets the shape everything after it copies, or it is
  expensive to reverse: a shipped contract, a persisted format, a public export, a new
  dependency. The reversibility half of that test is
  [`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) → "What
  being wrong costs"; the list is here because a coordinator has to apply it mid-wake.

Everything else is yours. Naming, layering, local structure, which helper, sequencing, where
a guard sits, how a test is shaped, whether to split a PR — decide it, don't relay it.

**This overrides step 4 — for engineering blockers only.** `epic-lifecycle` step 4 surfaces
every gate *and every blocker*. Under `epic-em` an engineering blocker skips that surfacing:
you decide it, record it at step 3, and it reaches the user as one line in the report rather
than as an ask. **Gates are untouched** — every row in the table above still surfaces at step
4 exactly as written.

**Three blockers are never yours**, each parked for a reason the product/architectural test
cannot see:

- **`"POC returned INCONCLUSIVE"`** — an evidence run tried to settle the claim and could
  not. That is the precise moment it stops being an engineering call, which is why
  `orchestration.md` hands it back: a fabricated verdict is worse than an unsettled debate,
  because it ends the debate wrongly.
- **An epic-level `unsettled` claim** — the same thing one altitude up.
- **An epic-spec open question** — a cross-cutting decision the fold raised for the user.

Absorbing any of them would take exactly the decisions the process most wants escalated. The
last two are keyed to the **epic**, not to a row, which also decides how an answer is recorded.

#### Absorbing the judgment does not shorten the path to it

One rule sits behind every caveat above, and behind delta 2 as well. Taking a decision changes
**who decides**. It does not change **where the information lives**, and it does not change
**where the answer is written**.

**Getting the information.** Decide from what the worker reported. When that isn't enough — the
answer is in a spec, a diff, the code, or a review thread — **dispatch a bounded reader (a
worker, or `scout` for a read-only look) and decide on its return.** Opening the artifact here
is the one thing this posture must never license
([`orchestration.md`](../../../docs/contributing/orchestration.md) → "The coordinator
dispatches; it never does the work"), and guessing from thin `blocker` text is the other
failure mode — it buys a wake and pays for it in rework.

**The PR-feedback cap is the case that forces this.** The wake's cap blocker ends *"the worker's
read on the open threads is on the PR"* — so the analysis separating *converging slowly* from
*the approach is wrong* sits on a surface you may not read. A plain `epic-lifecycle` coordinator
relays that question and the **human** reads the PR; an EM answering it has no such reader. So
**dispatch one before answering a cap blocker**, every time. Answering it from the blocker text
alone is a guess dressed as a decision, on the one question the cap exists to ask.

**Recording the answer.** Which field depends on what the blocker was keyed to, and the two are
not interchangeable:

| Blocker keyed to | Record it by |
|---|---|
| **An issue row** | Append `{ for, answer }` to the row's `blockerResolutions` and clear `blocker` — exactly as `epic-lifecycle` step 3 describes for an answer that came from the user |
| **The epic** (`unsettled`, `openQuestions`) | Append `{ question, answer }` to `epic.answers`, **leave the original entry in place**, and let the `epic-agent` fold record and retire it |

Reaching for `blockerResolutions` at epic scope silently loses the answer: there is no row to
hold it, the question resurfaces every wake, and `mayWrap` never goes true — so the epic cannot
close. Both paths are `epic-lifecycle`'s, unchanged. The EM only supplies an answer that would
otherwise have come from the user; the next worker cannot tell the difference and should not
have to.

Then **put one line in your next report** naming the fork and the call. Absorbing a decision
*silently* is strictly worse than escalating it, because it takes the user's ability to reverse
it away without telling them. Absorb and expose; never absorb and hide.

**When an architecturally-critical one does go up, say out loud that you are putting them in
the engineer's chair**, and why the business framing doesn't decide it. That move, and the
minimum-vocabulary rule that goes with it, is
[`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) → "When
engineering detail is genuinely the ask". Two of these in a week is a signal your test has
slipped, not that the epic is unusually hard.

### 2. The PR-feedback cap is mostly yours

The cap
([`orchestration.md`](../../../docs/contributing/orchestration.md) → "PR feedback: the round
cap") parks an issue at twelve rounds and asks the user to pick a direction: keep going, take a
position on the thread that keeps reopening, re-examine the approach, split the remainder into
a follow-up, or merge as-is and handle the rest separately. Most of those are engineering
judgments, and those are yours — after dispatching the reader delta 1 requires.

**Test the resolution, not the option.** Don't pre-classify the list into yours and theirs. Run
delta 1's product-critical test against the answer you are about to give, at the moment you give
it. Two of the five reach it often enough to name:

- **Merge as-is and handle the rest separately** — always. It ships a known gap to customers,
  which is a product call wearing a review-process costume.
- **Split the remainder into a follow-up** — whenever the deferred item protects promised or
  customer-visible behaviour. Deferring scope is a scope-and-timing decision, and it carries
  the same consequence as the option above. A split that defers only internal cleanup is yours.

Surface either as the gap and what it costs, never as a review that went long. Otherwise take
the answer and reset `prFeedbackRounds` to `0` as step 3 requires.

### 3. Report outcomes, not phases

A wake reports one line per issue that moved
([`orchestration.md`](../../../docs/contributing/orchestration.md) → "What the coordinator
reports instead"). Keep those lines — put them under a heading, not first. Lead instead
with what the epic can now do that it couldn't,
what is at risk, and what is waiting on the user. Three lines is usually enough, and an
epic where nothing changed for a product owner should say that in one line rather than
manufacture a paragraph out of phase transitions.

**This is a framing change over material you already hold** — the objective, which rows are
terminal, which gates are open. It is **not** a licence to read a diff or a review thread to
enrich a summary. That prohibition is a correctness rule, not a cost one, and `epic-em` does
not touch it ([`orchestration.md`](../../../docs/contributing/orchestration.md) → "PR events
are wake signals, not work items").

## What is already the default — don't re-implement it

Most of what "EM level instructions" implies is documented behaviour you should already be
exhibiting: the engineer/product-owner contract, the six-part ask, the recommendation you
always give, and not asking when you shouldn't
([`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md)); gates
written as business decisions and batched hardest-first (`epic-lifecycle` step 4); and never
idling on a pending gate (`epic-lifecycle` → "Gates & autonomy"). Restating any of it here
would create the second copy this skill exists to avoid.

`epic-em`'s contribution is that the posture is **standing for the whole run** rather than
re-derived at each ask, and that the entry test for handing the user mechanism is the narrow
one in delta 1 rather than a judgment made fresh every time.

**The one bottleneck this cannot remove** is the epic-objective gate. It is a barrier by
construction — every sub-issue holds behind it. Surface it early, surface it well, and say
plainly that nothing starts until it clears. Don't dress that up as progress.

## Boundaries

- **A posture over `epic-lifecycle`, not a second coordinator.** Every rule about how an
  epic runs stays there. `epic-lifecycle`'s own boundaries — one epic, no epic no run, don't
  wrap an unrelated batch — apply unchanged.
- **No new state.** Nothing new in `.orchestration/`, nothing new in `epic-wake`'s `args`.
  A delta that needs no state is a delta that cannot silently drift out of sync.
- **Absorbing a decision is never absorbing a gate.** If you are tempted to let a spec
  approval or a merge pass on your own judgment because the user is slow to answer, that is
  the failure this skill is shaped to prevent. Wait, and say what is waiting.
