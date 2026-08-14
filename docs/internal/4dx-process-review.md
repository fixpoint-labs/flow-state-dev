# 4DX process review — what transfers to our loop, and what doesn't

**Date:** 2026-08-14 · **Scope:** `docs/objectives.md`, `epic-pm`, the epic-spec's §1/§4,
the epic report, `plan-day`

**Status: all five adopted (2026-08-14), with one deferral.** R1–R5 landed as written. Two
things changed during implementation, both worth knowing:

- **R3 landed in the report, not in §4.** As proposed, the scoreboard sat in the epic-spec —
  and eight review rounds established it could not be kept true there: nothing triggers a
  refresh on child progress, and the `epic-agent` that would write it works on an unrebased
  branch and can't see `.orchestration/`. The owner chose to move it. *Are we winning* is now a
  line in the **epic report**, computed as **rows at `DONE`** off the coordinator's status
  table — no new field, no trigger — and §4 stayed a pure audit log. See
  [`4dx-process.md`](4dx-process.md) → design calls 2 and 3.
- **R4's variable window** (flagged below as an open worry) is handled by *naming* the span in
  each report rather than pretending to a weekly cadence.
- **Everything the scoreboard accreted was dropped with it** — the cut tally, the imported
  "≤6 measures" ceiling, the five-state Goal check column and its denominator rules. Each was
  a correct fix to a mechanism that shouldn't have been in a document, which is the cheapest
  lesson in this whole review.

The narrative description of the resulting process is
[`4dx-process.md`](4dx-process.md); this file is the reasoning that produced it, kept as
written. Where the two disagree, that one is current.

Source: [Perdoo's 4DX guide](https://www.perdoo.com/resources/online-guides/4dx).

---

## The short version

`epic-pm` disciplines **scope at the gate**. It has nothing that tells you, mid-flight,
whether the epic is *winning*.

That is the gap 4DX is actually good at, and it is one gap, not four. Two of the four
disciplines transfer with real force, one transfers partially, and one shouldn't be
imported at all. The recommendations below are five edits to documents that already
exist. None of them adds a skill, a gate, or a meeting.

The one new word worth adopting is **lead measure**. We have no term for it, and the
distinction it names is the whole value of the framework.

---

## 1. What 4DX is, in one screen

Four disciplines, meant to close the gap between a strategy and its execution:

1. **Focus on the Wildly Important Goal.** One or two per team, never more. Every WIG
   carries a finish line in the form *"X to Y by when."*
2. **Act on the lead measures.** A **lag** measure is the result — you learn it too late
   to change it. A **lead** measure is predictive of the lag *and* directly influenceable
   by the team. Weight is the lag; calories and gym hours are the lead.
3. **Keep a compelling scoreboard.** A *players'* scoreboard, not a coach's: ≤6 measures,
   lead and lag side by side, and a five-second read of *are we winning?*
4. **Create a cadence of accountability.** A weekly session on the WIG only — **Account**
   (did last week's commitments land?) → **Review** (what does the scoreboard say?) →
   **Plan** (the one or two things I'll do this week to move the lead measure).

The enemy the whole framework is built against is the **whirlwind**: the urgent day job
that eats the strategic goal.

**The assumption that doesn't hold for us.** We have no whirlwind. Our failure mode is the
inverse — agents have no competing urgency and will execute anything you point them at,
indefinitely and in parallel. So the disciplines that transfer are the ones about
**discrimination** (D1, D2), not the ones about **protecting attention from urgency** (D4).
That is the lens for everything below.

---

## 2. Where we already do this

More than a first read suggests. This is not a framework we lack; it is one we apply to
half our surface.

| 4DX | Ours today | Verdict |
|---|---|---|
| **D1 — a goal with a finish line** | `epic-pm`'s objective lines — at review time four (Outcome · Proof · Not doing · Kill line); **five since adoption**, the Lead measure being what R2 added. The **Kill line** is a genuine improvement on 4DX — it demands the goal be *falsifiable*, which 4DX never asks for | Strong at epic altitude. **Absent above it** |
| **D2 — lead vs lag** | `distill-lessons` runs this correctly, on the process: *"rounds-to-approval and `design-off` frequency trending down — that downward trend **is** the proof the harness is improving."* That is textbook lead-measure reasoning, and the ledger even guards its own gaming (*"score the method, not the outcome"*) | Correct — but applied **only to the loop, never to the product outcome** |
| **D3 — scoreboard** | Epic-spec §4 running index; the coordinator's status table; `cycle-ledger.md` | The ledger is a real scoreboard (retrospective, per-cycle). §4 and the status table are **audit logs of activity** — they cannot answer *are we winning* |
| **D4 — cadence** | Event-driven wakes · gates · epic wrap (auto-dispatches `distill-lessons` + `polish-docs`) · `plan-day` | Cadence exists and is bound to the **right thing** (the epic cycle, not the calendar). What's missing is the **Account** half, everywhere |

---

## 3. The gaps, ranked

1. **No lead measure for the product outcome.** `epic-pm`'s Proof line is a lag measure by
   construction — *"the observable check that says it worked"*, singular, at the end.
   Between the objective gate and the wrap, which is weeks, the only signal is the status
   table, and the status table counts **activity**. An epic can look healthy the entire
   way and land on a Proof that fails.
2. **Nothing caps concurrent epics.** `epic-lifecycle` sizes issue concurrency to the VM.
   Nothing sizes *objective* concurrency to anything. This is D1's actual rule, and we have
   no version of it.
3. **`docs/objectives.md` has no finish line.** Four goals and a non-goals list — a
   strategy statement, not a goal. No X, no Y, no when. Nothing in it can be false, so
   nothing in it can be finished, so no epic can be tested against it.
4. **No Account step anywhere.** `epic-em`/`epic-pm` reports are Review + a cut list.
   `plan-day` is pure Plan — it reads Linear and open PRs and picks up to 8 tasks, and
   never asks what the last plan committed to or whether it landed.

---

## 4. Recommendations

Five edits. Each names the file, and each is derivable from data we already produce — a
measure that needs manual upkeep will go stale and lie, which is worse than no measure
(the ledger's own warning: *"an unmeasured shape reads as a solved one"*).

### R1 — Give `docs/objectives.md` a finish line, and cap concurrent epics at two

**Change.** Rewrite `## Current Focus` as a single objective in *X to Y by when* form. Add
one line to `epic-lifecycle`'s objective gate: *which project objective does this epic
serve, and how much of the gap does it close?* Cap concurrent epics at **2**.

**Why.** Today an epic's objective is tested against nothing above it. "Is this worth
doing" is asked in a vacuum, which is exactly the vacuum the epic-spec exists to remove
one altitude down.

**The axis distinction, because it will be misread.** 4DX's cap is on **goals**, not work
items. Eight issues in parallel under one epic is not a violation — that is one goal with
throughput. Four concurrent epics under four objectives is the violation. The cap goes on
epics; `epic-lifecycle`'s VM-sized issue concurrency is untouched.

**Cost.** A cap can strand real work. Mitigation is the same one 4DX uses: the third epic
isn't cancelled, it's queued, and the queue is visible.

### R2 — Add a fifth line to `epic-pm`'s objective: the lead measure

**Change.** After **Proof**, add:

> **Lead measure** — the thing we can watch *weekly* that predicts the Proof, readable off
> work the epic already produces. Not a count of issues merged.

**Why.** This is the highest-value item on the list. It is also the one that most needs
its constraint stated, because a lead measure we have to build an instrument for will not
survive contact with the loop. The Proof line already carries exactly the right constraint
— *"it must be something the work already produces … not a measurement apparatus we would
have to build"* — and the lead measure inherits it verbatim.

**The candidate that already exists.** Goal verification is already part of done
(`epic-lifecycle` → "Goal verification is part of done"). So:

> **the count of issues whose real-model goal check passes** — not the count merged.

Merging is activity. A passing goal check is the only per-issue evidence we produce that
predicts the epic's Proof, and it is tenet 7 (*prove the goal, not the mock*) read as a
running measure instead of a completion criterion.

**Earning a fifth line (tenet 3).** Four lines answer *should we build this*. None answers
*is it working while we build it*, and the answer arrives at the wrap either way. That is a
distinct question with no current home, which is the test.

### R3 — Make epic-spec §4 a scoreboard, not just an index

**Change.** Three lines above the running index, refreshed from the coordinator's status
table like the index already is:

> **Outcome:** a dropped connection is a non-event for an app built on FSD.
> **Winning when:** the reconnect goal check passes end to end. **Now:** not yet.
> **Lead:** goal checks passing **1 / 3** · cut this epic: 1 issue, 2 knobs.

*(As proposed. The cut half was **removed** during implementation — the folding agent cannot
derive it. Copy the shipped shape from `epic-spec-template.md` §4, not this line.)*

**Why.** §4 today is *Issue · delivers · route · spec PR · impl PR · state*. Every column
is activity. A reader cannot tell from it whether the epic is winning, which is D3's only
test.

**Note the second lead term.** `epic-pm` already mandates reporting *"what left the scope
this turn"*. Under a restraint posture, cut volume **is** a lead measure — it is
influenceable, and it predicts an outcome that ships instead of sprawling. We are already
producing it; it just has nowhere to be seen.

### R4 — Shape the epic report as Account → Review → Plan

**Change.** Three lines, not three sections. `epic-em`'s existing framing becomes Review;
`epic-pm`'s cut list stays; the two additions are **Account** (what the last report said
would happen, and whether it did) and **Plan** (the one or two things that will move the
lead measure before the next report).

**Why.** A report with no Account is a status update — nothing in it can be wrong, so
nothing in it is checked. The Account line is the cheapest instrument on this list and the
one that makes R2 and R3 load-bearing rather than decorative.

### R5 — `plan-day`: add the Account step, and mark which tasks serve the objective

**Change.** A step before Step 3: read yesterday's todos and report what landed, what
didn't, and why. And in the Step 5 plan, mark the tasks that serve the current project
objective.

**Why.** `plan-day` cleans stale todos (Step 2) but never accounts for them — a todo whose
issue is still open is silently regenerated, and a plan that was wrong yesterday is
indistinguishable from one that was right.

**On the ceiling of 8.** It is defensible and I am not proposing changing it. 4DX caps at
1–2 because a human team splits its attention; we run 8 in isolated worktrees and pay no
such cost. The cap belongs on objectives (R1), not on throughput. But *which of the 8 move
the objective* is currently unanswerable, and that is worth one column.

---

## 5. What not to take

Stated explicitly, because 4DX is a complete system and importing it wholesale is exactly
the accretion tenet 3 and `distill-lessons`' anti-bloat gate exist to stop.

- **No WIG session.** There is no team to convene, and our event-driven wakes are strictly
  better than a weekly cadence for agents. Take D4's *shape* (R4), not its meeting.
- **Don't cascade objectives down to sub-issues.** 4DX cascades WIGs to team WIGs. Our
  version of that is the per-issue goal check, which already exists. A second vocabulary
  over it is pure restatement — and tenet 5 is explicit that a decision restated in ten
  places is corrected in none.
- **Don't adopt the vocabulary wholesale.** Take **lead measure** (we have no word for it).
  Skip **WIG** — we have "objective", it is used in `epic-pm`, `epic-lifecycle`, the
  epic-spec template and `orchestration.md`, and renaming it buys nothing and breaks every
  cross-reference.
- **No hand-maintained scoreboard.** Every measure above is derivable from Linear, GitHub,
  or goal-check output. A number a human has to update is a number that will be wrong.
- **Watch the lead measure for Goodhart.** 4DX is genuinely vulnerable here: a lead measure
  becomes a target and gets gamed. "Goal checks passing" degrades into weak goal checks the
  moment it is scored. The ledger already knows the antidote — *score the method, not the
  outcome* — and the same discipline has to travel with R2, or R2 becomes a way to look
  like we are winning.

---

## 6. What was asked *(closed — answered yes on 2026-08-14; kept as the record)*

**The fork: adopt the lead measure, or keep Proof as the only outcome signal?**

*In plain terms.* Right now, we find out whether an epic delivered its outcome at the very
end. Adding a lead measure means we get a weekly read on whether it is on track, using
evidence the work already produces.

*The trade-off.* One more line in every epic's objective, and one more thing that can be
gamed. Against: today an epic can look healthy for weeks and land on a Proof that fails,
and the first moment we learn that is the wrap.

*My recommendation: adopt R2 and R3 together, and treat R1's cap as the contested one.*
R2 and R3 are cheap, derivable, and fix the one gap `epic-pm` genuinely has. R4 and R5 are
small and I would take them, but they are not why this review exists.

*What would change my mind.* If epics are typically short enough that the wrap *is* the
weekly read, R2 is ceremony and should be dropped. I don't have the data on typical epic
duration; `cycle-ledger.md` measures rounds, not elapsed time.

*What being wrong costs.* R2/R3 wrong: two lines per epic that nobody reads — cheap to
delete. R1 wrong: a real epic sits queued behind two others, which is a scheduling cost
paid in weeks, and it is the one recommendation here that can actually block work.

---

*Adopted 2026-08-14. §6's ask below is **closed** — it is kept as the record of the decision
that was put, not as a live gate; the answer was yes to all five. For what the process
currently is, read [`4dx-process.md`](4dx-process.md), which is the owner-linked narrative and
is maintained. This file is not.*
