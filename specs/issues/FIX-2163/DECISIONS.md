# FIX-2163 · Decisions

[Spec](SPEC.md) · **Decisions**

The shape is settled above this issue. A review is FIX-2129's `waitForUser({ kind: "review" })`
and FIX-2131's two verdicts; a revision's words are the user's steer (FIX-2131 D1); questions hold
and never suspend (ER-1, ER-8, FIX-2132). The product rule (agent-mailbox #46): a harness run that
changed code waits under *Ready for review*, the judge's verdict is information, not approval,
review is never skipped as a fallback, and the existing person-stop deadline is the only clock.
Two calls are left, both about what a host and a person get.

## The tree

```mermaid
flowchart TD
  I["FIX-2163"] --> D1["D1 · review is a manager option a host turns on, off by default"]
  D1 -.->|"rejected · every host waits, a headless one included"| X1["on for every manager"]
  D1 -.->|"rejected · glue every host writes, and the run already succeeded"| X1b["a block the host adds after the manager"]
  I --> D2["D2 · at the deadline the run completes, its output saying no review came"]
  D2 -.->|"rejected · reruns a finished coding run and asks again"| X2["fail the try"]
  D2 -.->|"rejected · the work on the branch is lost to a retry-less error"| X2b["fail the task for good"]
```

Solid edges are what you sign. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Review is a manager option a host turns on, off by default

| | |
|---|---|
| **Instead of** | (a) Every manager waits for review on a run with changes. (b) The host adds its own block after the manager that waits for the review |
| **Because** | (a) changes every host that runs today: DevTeam's `coder`, the conductor lab with its automated review phase, the goal checks, and any headless host with nobody to answer. Each would hold finished work for a week. (b) is glue every host writes again, which the epic forbids in a lab (ER-4); and by the time a block after the manager runs, the run record already says it succeeded and the verdict's reason is gone from the output, so a revision can't continue the run's session on the same try. Inside the settle step the manager has the verdict, the commits and its own steer step |
| **Locks in** | `harnessManager({ reviewChanges: true })`. The lab's harness thread flow sets it (FIX-2157, configuration under ER-1). With it off, every run settles exactly as today. Shift Manager's `coder` turning it on, and its *In review* column, are Shift Manager's own wiring, not this issue |

![D1: a manager option a host turns on, chosen, beside on for every manager and a block the host adds after the manager. Decides it: who waits. Price: Shift Manager's coding runs stay unreviewed until its host turns it on](figures/d1-opt-in.svg)

It comes down to who waits: only a host that has a person to answer.

**What would change my mind:** every host we ship turning it on. Then the default flips to on, and
a headless host turns it off.

<a name="d2"></a>
## D2 · At the person-stop deadline, an unreviewed run completes, and its output says no review came

| | |
|---|---|
| **Instead of** | (a) Letting FIX-2129's deadline fail the try, as an uncaught review deadline does. (b) Failing the task for good |
| **Because** | (a) starts a new try that runs the whole coding run again, only to ask the same review again: three tries are three weeks of asking and three coding runs, then an error. (b) throws away a finished change nobody rejected. Completing keeps the work on its branch, ends the task once, and matches the lab's other threads, which finish at the same deadline (FIX-2157 D2). Nothing merges on completion: the branch still needs whatever the host does next. This is the existing deadline, the host's person-stop default; the manager adds no clock (the product rule) |
| **Locks in** | The manager catches `SuspensionTimeoutError` from its own review and completes the task. Its output gains `review: "accepted" \| "deadline" \| null` (null when no review was asked), so a screen can show *no review came*. A completed run whose `review` is `"deadline"` must never read as approved: `"accepted"` is the only value that means a person accepted it, and a screen shows the deadline case as *not reviewed* (the product lead's condition, agent-mailbox #46). FIX-2157's board settles it under *Resolved* with a visible *not reviewed* mark A revised run that reaches the deadline on its next review completes the same way |

![D2: at the deadline the run completes, marked so, chosen, beside fail the try and fail the task for good. Decides it: what a forgotten review costs. Price: a change nobody looked at reads as done](figures/d2-deadline.svg)

It comes down to what a forgotten review costs: a mark on finished work, or a coding run repeated.

**What would change my mind:** hosts where *done* triggers something irreversible, like a merge.
Then the deadline fails the task for good, and the work stays on its branch.

## Decided, not asked

- **"Made changes" is commits on the run's branch over its base** at the end of the run: the
  count `readRunCommits` already reads, and the output's `commits`. Kept files and an
  uncommitted tree don't count. The test is of the branch, so a revised run is reviewed again
  even if it adds no commit.
- **Where it sits:** the settle step, after the judge. *not-done* fails the try and *ask* holds on
  a question, both as today (FIX-2132). A *done* run, one under the judge's floor, or one with no
  judge goes to review when it has changes and the option is on. A run with no changes completes.
  A failed run never reaches it. This is the convergence point: the review is the manager's only
  `waitForUser` call, and no other path waits for a review.
- **The prompt** names the commit count and subjects (at most 20, as the output already caps them)
  and the judge's verdict, confidence and reason, or that no judge ran. It says the verdict is
  information. It is set once and never changes (FIX-2129 copies it to the row).
- **An accept** writes the run record's success and completes the task, with no harness run. A
  steer that arrived while it waited is not lost: one more run takes it, as FIX-2131 D1 requires,
  and that run is reviewed again if it has changes.
- **A revision** is FIX-2131's revision verdict; its words are already the user's steer on the
  row. The manager goes round through its steer step (`stepForSteer` and its loop back, FIX-2086)
  in the same request: same attempt, resuming the session this attempt confirmed, the words in
  the prompt. When no session was confirmed, the run starts a fresh session told the brief and
  the words. No second loop, and no cap of the manager's own: the words are steers, so the task's
  steer cap bounds them (ER-8's write).
- **A cancel** while it waits: the review resumes `cancelled` (FIX-2129); the manager records
  nothing, starts no run, and the branch and kept files stay. A user's stop cancels the task
  (FIX-2129).
- **The wait holds the claim and not the checkout.** The harness step's `onSettled` already
  released the checkout lease, and FIX-2129's mark drops the task's lease.
- **Durable execution is required** for the wait, as it is for any `waitForUser` (FIX-2063). The
  manager's request is a durable sequencer when the option is on. A host with no durability
  provider that turns the option on fails loudly at the first review; it never completes
  unreviewed.
- **FIX-2132's sweep line** ("`waitForUser` has none in `harness-manager`") becomes "one, the
  review step"; its D1's "the manager itself suspends no request" becomes "suspends only for a
  review of a run's changes, when the host turns it on". Questions still never suspend. This
  merges after FIX-2132. FIX-2132's D1 and its sweep line carry the same amendment, dated, in
  this PR: its implementation keeps no `waitForUser` reference, and this one's makes it one.
- **No new screen work here.** The lab's board, *Resolve* and *Request changes* are FIX-2157's;
  they answer through FIX-2129's route.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A held question instead of a suspension ("Accept or describe changes?") | ER-1: a review suspends and a question holds. The Inbox and the board would show a question, not a review, and *Resolve* would be free text |
| A revision fails the try, its words the next try's feedback (the issue's first wording) | It spends a retry per round of changes and, after a failure, the next try resumes through the retry path instead of the same request. The steer step already continues the session on the same try |
| A separate review timeout on the manager | The product rule: the person-stop deadline is the only clock. Two clocks for one wait |
| Review every *done* run, changes or not | A run with nothing on its branch has nothing to review, and the lab sends it straight to *Resolved* (FIX-2157 D5) |

<a name="settled"></a>
## Settled

- **A review after the coding run resumes without running it again, and a revision loops back
  once — CONFIRMED, traces off and on.** `poc/review-loops-back/` (`bash
  specs/issues/FIX-2163/poc/review-loops-back/run.sh`), on `main` at `31d68caa`: accept, one
  coding run; revise then accept, two, with the words in the second and no state doubled. The
  same harness in FIX-2132's POC printed six runs for three passes before FIX-2137; at `31d68caa`
  it prints three, so the green here is FIX-2137's fix. `ctx.suspend` stands in for
  `waitForUser`, which is not on `main`; the goal check runs the real one.
- **No counted facts carry the approach**, so no checker.

## How it got here

- **Draft** — framed as FIX-2157's gap: the manager's settle step asks FIX-2129's review for a
  run with commits, behind a host option; accept completes with no run, a revision goes round the
  steer step on the same try, and the deadline completes the run marked unreviewed. Builds on
  FIX-2129, FIX-2131 and FIX-2132; a POC re-checked FIX-2137's fix for this shape.
- **Review round 1** — FIX-2132's D1 and its sweep line amended in this PR, with a dated note,
  so the two merged specs agree and each implementation knows its sweep count (FSD Architect).
- **Product review** — D1 and D2 agreed, on one condition folded into D2: a run completed at the
  deadline never reads as approved; its output says so, and FIX-2157's board marks it *not reviewed*.

**Open: none.**
