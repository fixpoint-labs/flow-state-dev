---
name: settle-claim
description: Settle ONE disputed factual claim about how the system behaves by building a quick, throwaway POC — a goal-shaped check that makes the claim falsifiable, run on the real path — and returning a CONFIRMED / REFUTED / INCONCLUSIVE verdict with reproducible evidence. Use when a spec review (or a cross-spec conflict) is flip-flopping on "does X actually work that way": the second time a claim is argued, stop arguing and run it. Non-blocking and throwaway; opens a PR only when the POC found something worth a human's eyes.
argument-hint: "<the claim slice — the disputed claim, why it's load-bearing, and what would falsify it>"
---

# Settle Claim

You are given **one disputed claim about how the system behaves** and your job is to end the
debate with evidence rather than argument.

**Two ways this runs.** Dispatched by an orchestrator, it runs as the **`poc-agent`** worker
(`.claude/agents/poc-agent.md` — its own worktree, so it can't collide with the issue branch a
sibling worker is pushing to, and it never prompts). Invoked directly by a human, it runs
in-context — no worktree needed, nobody else is on the branch, and you can ask a question if
the claim is ambiguous. The procedure below is the same either way. Prose has already failed on this claim — that is
why you were dispatched — so do not add more of it. Write code that runs, and report what
happened.

Read [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Settling a disputed
claim (POC settlement)" for when this fires, what it costs, and where the record lands. That
is canonical; this file is how you execute it.

**Not this skill: validating a direction before the gate.** A settlement is *reactive* — it
arbitrates between two parties who have already stopped converging, which is why it's an
independent worker and why its output is a verdict. Building throwaway code *proactively*, so
reviewers and the human at the approval gate can see the shape a spec proposes, is
[`spec-poc`](../spec-poc/SKILL.md): it fires on a trigger rather than a loop, lives published on
the never-merged spec branch rather than in a deleted worktree, and answers *"is this direction
right?"* rather than *"who is right?"*. A trigger noticed during authoring is the cheap case; by
the time you're here, prose has already cost two rounds.

**What justifies running at all: a loop, not an assertion.** This is for a claim that has been
asserted and counter-asserted **at least twice** — it came back after being answered, the spec
flipped on it, or two review rounds concluded opposite things. A claim asserted once gets
answered in the thread, not experimented on. If you're invoked directly and the claim in front
of you has only been asserted once, say so and check whether reading the code (Step 2) settles
it before building anything.

## The one rule that matters

**You are answering an empirical question, not winning an argument.** The failure mode that
makes this skill worse than useless is a POC that confirms whatever the dispatcher already
believed, because it was built to succeed. That produces confident false evidence, which
closes a debate *wrongly* — strictly worse than leaving it open. So:

- Design the check so that **PASS and FAIL both mean something**. If you can only imagine
  one outcome, you are writing a demo, not an experiment.
- Write the **anti-game** line before you write any code (below). It's the same field
  `goals/README.md` makes required, for the same reason, and it is the structural guard here.
- **`INCONCLUSIVE` is a first-class, respectable outcome.** Never round it up to a verdict.

## Step 1: Restate the claim as a falsifiable check

Before touching code, write these five lines. If you cannot, stop at Step 1 and return
`INCONCLUSIVE` with the reason — an unfalsifiable claim is a decision for the human, not an
experiment.

```
claim:      <the disputed assertion, in the form "X does / does not Y">
load:       <what in the spec's approach depends on it>
check:      <the smallest runnable thing whose outcome discriminates>
confirms:   <the observation that means the claim is TRUE>
refutes:    <the observation that means the claim is FALSE>
anti-game:  <what a hollow pass would look like, and what the check must therefore not assert on>
```

Two traps to name explicitly in `anti-game`, because they're the common ones here:

- **Asserting on the mechanism you're testing.** A check that calls the internal function and
  asserts on its return value can pass while the observable behavior is broken. Assert on the
  user-visible surface — emitted items, state values, the action's output, a real side effect.
  (`goals/README.md` → "Script techniques" is the reference.)
- **A check that can only pass.** If a bug in the thing under test would still produce your
  PASS observation, the check proves nothing. Sanity-test that: break the premise on purpose
  (pass the wrong shape, remove the wiring) and confirm the check *fails*. A check you have
  never seen fail is not evidence.

## Step 2: Read before you run

A POC is the **second** resort. Spend a few minutes first on:

- the code the claim is about, and its tests — an existing spec may already assert exactly
  the behavior under dispute;
- `docs/architecture/*.md` for the contract, if the claim is about a locked one;
- `goals/*/*/goal.md` — an existing goal may already prove (or disprove) it, in which case
  the settlement is a link, not a build.

If you find the answer in the repo, **stop and report it** with the citation. That's a full
settlement at a fraction of the cost, and the verdict is stronger for resting on committed
code rather than on something you just wrote.

## Step 3: Build the POC — quick, dirty, and throwaway

Follow [`prototype`](../prototype/SKILL.md) → "Rules that apply to both" for the scaffolding
(location, no polish, in-memory store, one command to run), under
`_prototypes/settle-<ISSUE-ID>-<slug>/`. Three things it doesn't cover:

- **Drive the real path and never mock the thing under dispute** — `fsdev run` against the
  prototype flow (`AGENTS.md` → "Verifying flow changes"), or a `run.mts`-shaped script on
  `goals/lib`. Mocking the disputed behavior settles nothing; that's the whole of tenet 7.
- **Assert on the observable surface**, per `goals/README.md` → "Script techniques" — emitted
  items, state values, the action's output, a real side effect. Not the internals of the
  mechanism you're testing.
- **Prefer model-free.** Most claims about composition, state, routing, and streaming need no
  model, and a model-free check is cheaper, faster, and less noisy. When the claim does need
  one, `openai/gpt-5.4-mini` unless it's specifically about a stronger model.

Keep it small. If the POC is growing past a couple of files, the claim was too broad — narrow
it to the part that's actually disputed and say in the verdict what you narrowed to.

## Step 4: Run it and read the result honestly

Run it. Then read what actually happened, not what you expected:

- Print an **explicit verdict line** from the check itself (`PASS — <evidence>` /
  `FAIL — <what was observed>`), the same protocol `goals/lib`'s `runGoal` uses.
- Capture the raw evidence — the `fsdev run --capture` file, the NDJSON excerpt, the script's
  stdout. The verdict quotes it; a verdict with nothing quotable is an opinion.
- **Run it more than once** if a model is in the loop, and say how many times and how it
  varied. A single sample of a nondeterministic path is not a settlement.
- If the result is ambiguous — the run failed for an unrelated reason, the check passed for a
  reason unrelated to the claim, the behavior varied — that is `INCONCLUSIVE`. Say what you
  saw and what you'd need to discriminate.

## Step 5: Decide the exit shape

| Exit | When | What you do |
|---|---|---|
| **Verdict only** *(the default)* | The run settled it and produced nothing worth keeping | **Delete the prototype directory.** Return the verdict block; the caller posts it. Nothing is committed, no PR. |
| **Draft PR** | The POC found something worth a human's eyes | Commit the POC (or the graduated goal) on `poc/<ISSUE-ID>-<slug>` and open a **draft** PR. Lead the description with **the claim in one plain sentence** and one line on why this earned a PR at all — that pair is the problem and the ask. The verdict block follows as the evidence. This is the one PR body that does *not* take the full layout ([`pr-reviewer-guidance.md`](../../../docs/contributing/pr-reviewer-guidance.md) → "The layout"): it seeks no direction review, so the compact form is the point. |
| **Inconclusive** | Step 1 or Step 4 didn't discriminate | Delete the prototype. Return `INCONCLUSIVE` with what you tried and what would settle it. |

A POC earns a **draft PR** in exactly three cases, and you should be reluctant about all
three:

1. **It uncovered a framework bug or genuinely surprising behavior.** The reproduction is
   worth having. Also file the bug through `issue-manager` (related to the source issue) so
   it doesn't live only in a PR description.
2. **The check is worth keeping as a durable regression goal.** The claim was load-bearing
   enough that we'd want to know if it stops holding — so graduate it into
   `goals/<describe>/<it>/` properly (`goal.md` with a real **Anti-game** field + `run.mts`,
   per `goals/README.md`) and let the PR be that. This is the one case where throwaway code
   becomes real code, and it's the best possible outcome of a settlement.
3. **The POC's shape is the seed of the implementation** and the reviewers or the human
   should look at it before the spec is approved.

Otherwise: **no PR.** The verdict and its evidence are the deliverable. Throwaway code that
gets reviewed has stopped being throwaway, and a stack of `_prototypes/` PRs is exactly the
accretion tenet 3 exists to prevent.

## Return format (compact — the caller holds this, not your transcript)

```
verdict:  CONFIRMED | REFUTED | INCONCLUSIVE
claim:    <the claim, verbatim as given>
check:    <the smallest description of what you ran>
evidence: <the observation, quoted — the verdict line, the item, the state value, the error>
runs:     <n runs · model: <id|none> · varied? yes/no>
implication: <one line: what this means for the spec's approach — for REFUTED, what has to change>
artifact: none (deleted) | draft PR #<n> (<why it earned one>)
filed:    none | <ISSUE-ID> (<bug filed via issue-manager>)
```

Keep it to that block. If you're writing paragraphs, you're doing the caller's job — the
caller decides what to do with the verdict; you decide what's true.

## Boundaries

- **One claim.** If the dispute turns out to be two claims, settle the load-bearing one and
  say in `implication` that the other is unsettled. Don't quietly widen the experiment.
- **You settle behavior, never direction.** "Does X work?" is yours. "Should we build X?" is
  the human's, and no run answers it. If the claim you were handed turns out to be a value
  judgment in empirical clothing, return `INCONCLUSIVE` and say that's what it is.
- **You never edit the spec, comment on the PR, or touch Linear** (beyond filing a genuine
  bug via `issue-manager`). The caller owns the thread reply, the §12 record, and the fold —
  same read-only-to-the-artifact discipline as `cross-spec-review`.
- **You never prompt the user.** You return a verdict; the coordinator surfaces it.
- **Leave nothing behind on the verdict-only path.** `_prototypes/` must stay genuinely
  temporary. A settled claim's value is the verdict, not the scaffolding that produced it.
