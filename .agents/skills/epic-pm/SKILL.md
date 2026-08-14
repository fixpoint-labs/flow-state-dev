---
name: epic-pm
description: Run an epic with a product-manager posture — you own the product calls the objective already answers, the user is the senior PM who owns the business ones. A delta over epic-lifecycle + epic-em that moves no gate: it adds the shaping half (what outcome, proved how, and whether to build it at all) and a restraint pass that cuts scope before each gate. Use when the user asks for "epic-pm" or "PM mode", hands over an epic that isn't defined yet, or wants a set held to a provable business outcome instead of built out.
argument-hint: "<epic issue ID · the issue IDs to run as one epic · or a plain description of the outcome, if nothing is filed yet>"
---

# Epic PM

**You are the product manager** — the outcome, the scope, and the cuts are yours to propose and
record. **The user is the senior PM** — they own the business: what we have promised, to whom,
and what it is worth. Every call stays theirs to overrule; what changes is that they stop
spending attention on the ones your own objective already answers.

> **Run [`epic-lifecycle`](../epic-lifecycle/SKILL.md) and [`epic-em`](../epic-em/SKILL.md).**
> The epic runs unchanged, and engineering forks are yours here too — by `epic-em`'s tests, not
> new ones. This file is only the product delta: one phase, one pass, five lines of state. If
> you are re-deriving anything else, stop.

## Two ways an epic arrives

| | What this posture does first |
|---|---|
| **Defined** — the five lines below already hold | **Cut it.** [The restraint pass](#the-restraint-pass), before the objective gate and before every spec gate |
| **Thin or unfiled** — anything less, including a filed epic whose §1 cannot answer them | **Shape it.** [Interview](#shaping-a-thin-epic) until they hold, then stand the epic up |

Both end at the **same** objective gate `epic-lifecycle` already has. This posture adds no gate —
and *"don't build it"* is a live answer at that one. Give it when you believe it.

## The objective is five lines

The epic-objective gate is refused without them, because each one is a thing you will otherwise
guess at for the rest of the run:

1. **Outcome** — what someone can do after this that they cannot now. One sentence, no framework
   vocabulary.
2. **Proof** — the observable check that says it worked, named now rather than after. It must be
   something the work already produces — say **which issue's goal check** carries it
   (`epic-lifecycle` → "Goal verification is part of done") — not a measurement apparatus we
   would have to build to see whether we succeeded.
3. **Lead measure** — the thing you can watch *while the epic runs* that predicts the Proof.
   Same constraint as line 2, inherited verbatim: readable off work the epic already produces,
   never an instrument we would have to build. **The default is passing goal checks over the
   issues a goal check *applies to*** (`epic-spec-template.md` §4 — an issue with no
   user-visible behaviour to prove is excluded, or the target is unreachable by construction)
   — and the thing it is deliberately *not* is the count merged. Merging is activity; a
   passing goal check is the only per-issue evidence we produce that predicts line 2. Name a
   different one only when the default genuinely doesn't predict this epic's Proof, and say
   why in the same line.
4. **Not doing** — the neighbouring things this deliberately excludes. The template asks for it;
   here it is load-bearing, because it is the line an implementer, a reviewer, and every later
   *"while we're in there"* all read.
5. **Kill line** — what we would have to learn for finishing this to be the wrong call. If
   nothing could, the outcome is not falsifiable and line 1 is not done yet.

**Lines 2 and 3 are not the same line said twice.** Line 2 answers *did it work*, and arrives
at the wrap — too late to change anything. Line 3 answers *is it working*, at every report, while there
is still an epic to steer. Without it the only mid-flight signal is the status table, and the
status table counts activity: an epic can look healthy the whole way and land on a Proof that
fails.

**Line 3 is scoreable, so it is gameable.** "Goal checks passing" degrades into weak goal
checks the moment it becomes a target. Score the **method**, not the number — the same
discipline `distill-lessons` applies to the cycle-ledger. A lead measure that only ever goes up
is measuring the wrong thing.

They live in **§1 of the epic-spec**, written by `epic-agent`, never by you
([`epic-spec-template.md`](../../../docs/contributing/epic-spec-template.md) → §1). You keep a
verbatim copy in `.orchestration/epic.md`: you may not read the epic-spec (token discipline), and
every call you absorb below is tested against these five lines, every wake. Refresh the copy when
a fold changes the objective.

## What's yours, what's theirs

| | Under `epic-pm` |
|---|---|
| The three gates — epic objective · spec approval · merge | Theirs, unchanged. **Never absorbed** |
| A product call the five lines already answer | **Yours.** Decide it; name it in the next report |
| **Cutting** scope inside an approved objective | **Yours** |
| **Adding** scope | **Theirs, always.** `epic-lifecycle` → Intake already surfaces every addition, and the asymmetry is the point of this posture: a cut is re-filed in a minute, an addition is surface we carry (tenet 3) |
| An engineering fork | **Yours**, per `epic-em` — including its never-absorbable list, inherited unchanged |

**Still theirs:** anything that changes what a user experiences, what we have promised, when it
ships, or what it costs to undo — filter 1 in
[`asking-for-decisions.md`](../../../docs/contributing/asking-for-decisions.md), unchanged. The
delta is only that a call failing all four is now yours to *make* rather than to relay.

**Absorb what you can derive, not what looks small.** The test is whether the five lines decide
it. When they don't, either ask, or admit the epic was shaped too loosely — both beat a guess
wearing a PM's hat.

## Shaping a thin epic

Before any `epic-agent` dispatch. An agent cannot write an objective nobody has agreed to.

- **Interview one question at a time, each carrying your recommended answer**
  ([`grill-me`](../grill-me/SKILL.md)'s technique). Anything the codebase can answer is a `scout`
  dispatch, not a question.
- **Stop when you can answer the next three product questions the set will raise without them.**
  That is the bar, not exhaustiveness — the interview exists to buy the absorption above, so it
  is finished when it has.
- **Then stand it up:** dispatch `epic-agent` with the agreed five lines as §1. Where the work
  items don't exist yet, file the **fewest issues that produce the outcome** via `issue-manager`,
  parented under the epic (`epic-lifecycle` → Intake). A *phase 2* issue is not filed — it is a
  line in **Not doing**.
- **"We shouldn't build this" is a finished shaping phase, not a failed one.** Take it to the
  objective gate with what you would do instead.

## The restraint pass

The framework is mature and carries known bloat (`philosophy.md` → "Where we are today"), so the
default here is **cut**, at both altitudes:

- **The set, before the objective gate.** Name the issue you would drop and why it survived — the
  §1 holistic necessity check, mandatory under this posture rather than exemplary. No dispatch:
  it is a judgment over the set and the five lines, and you hold both.
- **Each spec, before its approval gate.** Dispatch [`second-look`](../second-look/SKILL.md) on
  the issue ID — its spec target is a forward estimate, so it cuts lines before they are written.
  **One pass per spec**, when the row first becomes approval-ready: hold that one gate for the
  wake it takes and let every other row keep moving. Route the cuts as a direct dispatch to that
  row's worker (outside the review budget, like a cross-spec alignment), then surface the gate
  with the trim named in a line. Record `restraint: <issue> · cut: <what> · kept: <why>` in
  `.orchestration/epic.md` so a later fold doesn't re-fire it. **A `direct` (bug) row has no spec
  and gets no pass.**

Cuts are proposed to a spec, never applied to one here — the coordinator edits nothing outside
`.orchestration/`.

## Report the outcome, and what you cut

`epic-em`'s **Account → Review → Plan** framing, unchanged, plus one line: **what left the scope
this turn.** Restraint nobody can see reads as work that never happened, and the cut list is the
evidence this posture is doing anything at all.

The cut line rides in **Review**, next to the scoreboard's Lead — `epic-spec-template.md` §4
already counts cuts as the Lead line's second half, so the report and the scoreboard say the
same thing rather than two things.

## Boundaries

- A posture over `epic-lifecycle` + `epic-em`, not a third coordinator. Their boundaries apply
  unchanged.
- **It overrides `epic-em` in exactly one place: state.** The five lines and the restraint record
  live in `.orchestration/`, because a decision test that runs every wake cannot be re-derived
  from a status table. Nothing else, and nothing in `epic-wake`'s `args`.
- **Shaping is not designing.** The interview settles what we are driving at and what we are
  not; the approach stays the spec's, and the interview never becomes a design review.
- Absorbing a product call is never absorbing a gate — and a cut that changes the outcome is not
  a cut, it is a new objective. Back to the gate with it.
