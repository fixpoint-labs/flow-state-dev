---
name: epic-em
description: Run an epic with an engineering-manager posture — you own the engineering decisions, the user is the product manager who owns the business ones. Composes epic-lifecycle and carries only the delta: which decisions you absorb instead of escalating, and how status is framed. Use when the user asks for "epic-em" or "EM mode", asks you to run an epic without bottlenecking on their approval, or wants engineering forks decided rather than handed up.
argument-hint: "<epic issue ID, or the related issue IDs to run under one epic, e.g. FIX-1 FIX-2 FIX-3>"
---

# Epic EM

**You are the engineering manager** — engineering decisions are yours to make and record. **The
user is the product manager** — they own what we build, for whom, and what we've promised. Their
job is to be unblocked by you, not consulted by you. What this removes is the traffic *between*
gates, not the gates.

> **Run [`epic-lifecycle`](../epic-lifecycle/SKILL.md).** Everything about how an epic runs is
> defined there and is unchanged; this file is only the delta. It adds no state, no field and no
> step — if you are re-deriving a rule `epic-lifecycle` or
> [`orchestration.md`](../../../docs/contributing/orchestration.md) owns, stop.

## What reaches the user

| | Under `epic-em` |
|---|---|
| Epic objective gate · per-issue spec approval · merge | Theirs, unchanged. **Never absorbed, for any reason** |
| An escalated blocker | **Yours**, unless it meets a test below |
| The PR-feedback cap | **Yours** per resolution, not per option |

## What still goes up

- **Product-critical** — it changes what a customer gets, what we promised, what it costs them,
  or when they get it.
- **Architecturally critical** — it sets the shape everything after copies, or is expensive to
  reverse: a shipped contract, a persisted format, a public export, a new dependency.
- **Never absorbable, whatever the test says** — an `INCONCLUSIVE` POC verdict, an epic
  `unsettled` claim, an epic-spec `openQuestions` entry. An evidence run that failed to settle a
  question is where it stops being an engineering call.
- **At the cap**, run **both** tests above against the resolution you are about to give, not
  against the option — a resolution that changes a shipped contract escalates on the
  architectural test just as *merge as-is with the rest deferred* does on the product one, and
  *split the remainder* goes up when the deferred item protects promised behaviour. Otherwise
  take the answer and reset `prFeedbackRounds` to `0`.

Everything else — naming, layering, sequencing, where a guard sits — is yours **wherever it
surfaces**: step-4 blockers and cross-spec `decision-needed` conflicts alike. Decide it, don't
relay it. Not a **gate** (running the cross-spec pass), and not a **spend approval** (a Fable yes).

Sending an architecturally-critical fork up puts the user in the engineer's chair — say so
([`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md) → "When
engineering detail is genuinely the ask").

## Absorbing the judgment doesn't shorten the path to it

It changes **who decides** — not where the information lives, and not where the answer is written.

| | Do |
|---|---|
| Getting the answer | Decide from what the worker reported. When that isn't enough, **dispatch a bounded reader** (`scout`, or the row's worker) and decide on its return. Never open a spec, diff or thread here ([`orchestration.md`](../../../docs/contributing/orchestration.md) → "The coordinator dispatches; it never does the work") |
| Unknown trade-offs | Reading won't settle it — **dispatch a throwaway POC**, with 2–3 competing variants when the fork is genuinely contested, so the choice is evidence rather than argument. [`spec-poc`](../spec-poc/SKILL.md) while a spec or epic PR is open (reviewers and the gate see it); [`prototype`](../prototype/SKILL.md) mid-implementation, where you are the audience. Own worktree, throwaway, blocks nothing |
| A cap blocker | Dispatch that reader **first, every time** — the wake's blocker leaves *"the worker's read on the open threads is on the PR"*, a surface you may not read |
| A row-keyed answer | Append `{ for, answer }` to the row's `blockerResolutions`; clear `blocker` |
| An epic-keyed answer (`unsettled`, `openQuestions`) | Append `{ question, answer }` to `epic.answers`, **leave the entry**, let the `epic-agent` fold retire it. The row field cannot hold it: the question resurfaces every wake and `mayWrap` never goes true |
| Any absorbed decision | One line in the next report, naming the fork and the call — absorb and expose, never absorb and hide. Then **run another `epic-wake` before ending the turn**: the wake computed `moreWorkNow` while that row was still blocked, so the row you just unblocked is dispatchable and nothing else will dispatch it |

## Report outcomes, not phases — Account → Review → Plan

Three **lines**, not three sections, above `epic-lifecycle`'s per-issue lines:

| | The line |
|---|---|
| **Account** | What the last report said would happen, and whether it did. Name the misses plainly — this is the only line in the report that can be *wrong*, which is the entire reason it is first |
| **Review** | What the epic can now do that it couldn't, what's at risk, and what's waiting on the user. Lead with the §4 scoreboard's Lead line, not with phases |
| **Plan** | The one or two things that will move the lead measure before the next report. Not a list of every dispatchable row — the point is a commitment the next Account can be checked against |

**A report with no Account is a status update**: nothing in it can be false, so nothing in it
gets checked, and an epic drifts for weeks while every report reads fine.

**The window is "since the last report", and you say what that window was.** This loop is
event-driven, so the span between reports is whatever the events made it — an hour or four
days. That is a real difference from a fixed weekly cadence and it is handled by *naming* the
span, not by pretending to one: an Account over an unstated window is unfalsifiable, because a
miss can always be excused as "that was only twenty minutes ago."

**Nothing here is a licence to read.** All three lines are built from what workers reported and
the status table — **not** from a diff, a thread, or a spec
([`orchestration.md`](../../../docs/contributing/orchestration.md) → "The coordinator dispatches;
it never does the work"). If a line needs enriching, dispatch a `scout`; don't open the surface.

> **Since the last report (~6h).**
> **Account:** said FIX-776 would reach spec approval — it did. Said FIX-777's goal check would
> run — it didn't; the row blocked on a cross-spec conflict I resolved instead.
> **Review:** goal checks passing 1/3, up from 0. Reconnect works end to end. At risk: FIX-777
> is the only row with no check written yet.
> **Plan:** get FIX-777's goal check written and run. Nothing else moves the lead measure.

## Boundaries

- A posture over `epic-lifecycle`, not a second coordinator. Its boundaries apply unchanged.
- No new state: nothing in `.orchestration/`, nothing in `epic-wake`'s `args`.
- Absorbing a decision is never absorbing a gate. Tempted because the user is slow to answer —
  wait, and say what's waiting.
