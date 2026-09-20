---
name: spec-poc
description: Build an experimental proof-of-concept inside a retained issue or epic spec to validate direction. Publish on its unmerged review PR, or on a new follow-up PR from main after approval. Supports characterization, sketches, UI mockups, end-state compositions, and competing variants; retained evidence stays outside production discovery.
argument-hint: "<ISSUE-ID or epic name> — the question the POC has to answer"
---

# Spec POC

A **spec POC** is experimental code retained with its owning issue or epic spec.
Reviewers and the human at the direction gate are meant to run it. Retention preserves
the evidence, not a production implementation or a maintained API.

Read [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec-branch POCs"
for where this sits in the lifecycle and who dispatches it. This file is how you execute it.

## Which POC skill is this? (split by who is asking)

Three skills build throwaway code. They are not interchangeable, and picking wrong wastes
the whole effort:

| | [`prototype`](../prototype/SKILL.md) | [`settle-claim`](../settle-claim/SKILL.md) | **`spec-poc`** (this) |
|---|---|---|---|
| **The question** | *What should we do?* — yours, undecided | *Who is right?* — contested, twice over | *Is this direction right?* — published for sign-off |
| **Audience** | you | the review thread | spec/epic PR reviewers + the human at the gate |
| **Lives** | `_prototypes/` in a host app | a throwaway worktree | the owning `specs/issues/<ID>/poc/<experiment>/` or `specs/epics/<ID>/poc/<experiment>/` |
| **Output** | an answer, in `NOTES.md` | `CONFIRMED` / `REFUTED` / `INCONCLUSIVE` | a summary in the spec + code a reviewer can run |
| **Survives?** | deleted or absorbed | deleted | retained as isolated evidence with the merged spec |

If nobody but you will read it, it's a `prototype`. If two reviewers keep reversing each
other on a factual claim, it's `settle-claim`. If the point is to show someone the shape so
they can approve or reject a **direction**, it's this one.

## Triggers — the default is no POC

Build one only when a trigger fires. A spec that extends an existing pattern needs no POC,
and "the shape is obvious" is a complete reason to skip (tenet 3 — earn every addition).

**Issue altitude:**

1. **The spec rests on an unverified premise about the current system.** "The store
   preserves ordering here", "this capability composes with a sequencer's state". One
   characterization test settles it, and settling it before the design is drawn is far
   cheaper than after.
2. **The composition is novel** — a block/pattern/capability arrangement with no precedent
   in the repo, where prose describes it but nobody can tell if it holds together.
3. **The ergonomics only become visible in code.** The diff in `SPEC.md` looked fine and you
   don't believe it.
4. **It has a look.** Any devtool, renderer, or kitchen-sink surface where the reviewer's
   real question is *what does it look like* — a question no paragraph answers.
5. **Two shapes are genuinely in contention** and side-by-side would settle it → build
   variants (below).

**Epic altitude** — one more, and it is the strongest reason on this list:

6. **The division of work across the set might be wrong.** Every issue can be individually
   sound while the assembled surface is not: a seam two issues both want to own, one
   decision landing in two places, an end-state nobody would have chosen if they'd seen it.
   This is only visible from the epic, and only *before* the objective gate. Sketch the
   end state — rough, unshipped, all the issues' surfaces together — and look at it.

**Not a trigger:** wanting to start coding, a reviewer asking for more detail (that's
depth-pulled prose, or a review note in the plan), or a claim asserted once (answer it in the
thread).

## The four kinds

Pick by the question. Most POCs are one kind; an epic end-state POC is often two.

### 1. Characterization POC — pin how it *already* works

The cheapest and most under-used. A test asserting current behaviour, written to be
*informative rather than green*: you don't know the answer when you write it.

Run it, read what happened, and record the answer. **If it contradicts the spec's premise,
that finding is the POC's whole value** — fold it into the spec before the gate, not after
implementation discovers it.

This is the one kind that can **graduate**: a premise load-bearing enough to check is often
load-bearing enough to keep. Say so, and let `issue-implement` land it as a real CI spec or
a `goals/` entry — see "Exit".

### 2. Shape POC — write the solution out

Sketch source files showing the composition: the real block kinds, the real seams, enough
wiring to see whether it hangs together. Not the plan's *pseudocode* sketch (which is
deliberately unrunnable) — this is real files that really run, on a branch where nothing
ships.

Keep the piece that answers the question **portable** — the candidate block, pattern, or
capability should sit where it could one day become real code, so the implementer starts
from something. The flow or harness around it is the throwaway shell.

### 3. Visual POC — a self-contained HTML file

For anything with a look. **One file, fully self-contained**: inlined CSS and JS, no build
step, no external fetches, data hardcoded at real shape and real cardinality (an empty
state and a 200-row state both lie). A reviewer opens it in a browser and reacts.

Self-contained is the load-bearing constraint, not a style preference:

- **We have no hosted PR preview.** GitHub serves committed HTML as plain text and does not
  render it, so the reviewer's path is *pull the branch and open the file* — and that only
  works if opening the file is the whole of it.
- The PR description gives the literal command: `open specs/issues/FIX-820/poc/timeline/variant-a.html`.
  No dev server, no `pnpm install`, no build.

Several variants are several files in the same directory, plus one `README.md` comparing
them.

### 4. End-state POC — what the whole set looks like (epic only)

Rough changes across the set's real surface showing where things land once **every** issue
under the epic has merged. Its output is a scoping judgment, not working software: does the
division into issues hold, does one issue's deliverable make another's redundant, is there a
seam that needs an owner named in the epic's themes.

Deliberately incomplete and deliberately not per-issue-clean — it exists to be *looked at*
and then thrown away. Summarize what it showed in the epic-spec's `DECISIONS.md` → **What the
end-state POC showed** (four lines: built · see it · showed · changed) and delete nothing until
the objective gate has passed.

## Variants — when the fork is contested

When two or three shapes are genuinely in contention, build them side by side rather than
arguing. Four rules, and the second is the one that gets broken:

1. **Radically different, not variations.** Two shapes differing in a parameter teach
   nothing. If you can describe variant B as "A but with…", it isn't a variant.
2. **Equal effort on each.** A strawman is worse than no variant — it manufactures consent
   for the option you already preferred and puts a human's name on it. If you notice you're
   building one properly and one carelessly, stop: you've already decided, so write the
   decision down and skip the variants.
3. **One comparison page** (`<owning-spec>/poc/<experiment>/README.md`): what each variant does
   differently, what each is better at, what each costs, and the **question the choice turns
   on**. Not a recommendation-free dump — say which you'd pick and why, then let it be
   argued with.
4. **The chosen variant becomes a decision card** in `DECISIONS.md`, citing the POC. A
   variant comparison that doesn't end in a decision was a tour, not a fork.

**Two or three — deliberately tighter than [`prototype`](../prototype/SKILL.md)'s UI default of
3 (cap 5).** Not drift: every variant here is a published artifact a reviewer has to open and
form an opinion on, so the cost of a fourth falls on *them*, not on you. A private exploration
can afford five; a review surface can't. Four is a sign the question is under-specified.

## Where it lives, and why CI stays green

Use **`specs/issues/<ISSUE-ID>/poc/<experiment>/`** or
**`specs/epics/<EPIC-ISSUE-ID>/poc/<experiment>/`**. Other authored figures and assets
stay under that same spec. Do not move unrelated historical root POCs.

These experiments are not workspace packages or production modules. Keep them out of
production imports, package exports, default builds, test/lint discovery, and knip's
production scan. Exclusions must target retained `poc/` subtrees, not hide production code.
Keep generated dependencies and secrets out of git; do not add workspace membership,
package manifests, or root execution scripts for a POC.

Run directly with its documented command, e.g.
`pnpm tsx specs/issues/FIX-775/poc/resume-seam/run.ts`, or open its self-contained HTML.
CI still runs on the spec PR; fix a failed required check rather than bypassing it.

## Publishing it — the reviewer has to be able to run it

A POC nobody looks at is waste with extra steps. So the **PR description** carries a POC
block, and it is not optional:

```
## POC on this branch

`specs/issues/FIX-820/poc/timeline/` — three variants of the run timeline.

  open specs/issues/FIX-820/poc/timeline/variant-a.html  # one row per block
  open specs/issues/FIX-820/poc/timeline/variant-b.html  # collapsed by phase
  open specs/issues/FIX-820/poc/timeline/variant-c.html  # flame-graph

Comparison + my pick: specs/issues/FIX-820/poc/timeline/README.md
The question it turns on: does a reader scan for *what ran* or for *what was slow*?

Experimental evidence retained with the spec, not production code. Review direction, not polish.
```

Three requirements:

1. **One runnable/openable command per artifact**, verbatim and copy-pasteable.
2. **The question it answers**, stated. A reviewer who has to infer what they're looking
   for reviews the code quality instead — which is the exact feedback we don't want.
3. **Say it is experimental, not production.** Retention does not require production
   polish; direction and the reliability of the claimed evidence remain reviewable.

Then the **spec** gets the durable record: `PLAN.md`'s POC line points at the POC and states
what it showed; `DECISIONS.md → Settled` records a premise it settled (with the same "resolved,
don't reopen" force a `settle-claim` verdict has); *How it got here* gets a line **only if the
POC moved the design** — `- **POC** — <what changed>, because the run showed <what>.` At epic
altitude the record is `DECISIONS.md → What the end-state POC showed` instead.

**Report a POC that changed nothing.** "Built it, the premise held, no change" is a real
result and it belongs on the plan's POC line. Only recording POCs that found problems teaches
the next reader that a quiet POC was a failure.

## Retention and later experiments

Human approval authorizes merging the reviewed spec after required checks and
repository thread policy; confirmed merge precedes implementation. The original PR
then preserves review history, while its artifacts remain in the owning spec on `main`.

### Building one after approval

Start a new branch from fresh `main` and open a follow-up PR, adding the POC under the
same owning spec and reconciling its plan/decision/evolution records. Never reopen or
push the original approved/merged PR. If approval arrived before the original merge,
finish that reviewed merge first; do not quietly attach new experiments to its approval.
Material direction changes require renewed human approval on the new head. A standing
label cannot authorize changed content; required checks still apply.

Retained POCs are present in implementation checkouts, but must stay out of production
imports and default discovery. If an experiment deserves production adoption, implement
it through the ordinary discipline on the implementation branch rather than importing
the experimental file.

What crosses the line, and how:

| Outcome | Where it goes |
|---|---|
| **A premise it settled** | `DECISIONS.md → Settled`, as resolved-with-evidence. Costs a later reviewer zero rounds to reopen. |
| **A characterization test worth keeping** | Named in the plan's checks as a CI spec to write, or graduated into `goals/<describe>/<it>/` properly (`goal.md` with a real anti-game field). Re-written under `tdd` on the impl branch — not copied. |
| **The shape** | Cite the retained POC path and original review/amendment PR. The implementer learns from the experiment without importing it into production. |
| **A chosen variant** | A decision card in `DECISIONS.md`. |
| **A refuted premise** | Fold it into the spec **before** the gate. This is the cheapest possible version of that discovery. |
| **A framework bug it uncovered** | File it via `issue-manager`, related to the source issue. Don't let it live only in a PR description. |

## Failure modes

- **The POC that can only succeed.** Built to demonstrate rather than to test, it confirms
  whatever the author already believed and puts evidence behind it. Before building, write
  down what would make you *abandon* this direction — `settle-claim`'s anti-game rule, and
  it applies here for the same reason.
- **Polish creep.** Error handling, types that carry no meaning, a test suite. A POC that
  grows specs has stopped being a POC; it's code, and it needs `tdd` on a real branch.
- **The POC nobody reads.** If you can't name who looks at it and what they'd decide
  differently afterwards, don't build it.
- **The POC that becomes production by accident.** Retaining an experiment does not
  authorize importing it into shipped code. Implement production behavior through its
  ordinary review and verification discipline, not a shortcut around it.
- **A POC standing in for a decision.** No run answers "should we build this?" That's the
  human's call at the gate, and a POC informs it rather than replacing it.

## Boundaries

- **Non-blocking, like a settlement.** The spec keeps converging while a POC is built, and
  the approval gate stays reachable. But **disclose it**: a gate surfaced while a
  load-bearing POC is still in flight must say so, or the human approves on a premise nobody
  mentioned was contested.
- **Use the owning spec's review PR before approval; afterward use a new follow-up PR.**
  Never reopen or push the original merged PR. Required checks apply to both.
- **You never prompt the user when dispatched** (as `issue-worker` or `epic-agent` running
  this step) — return the summary and let the coordinator surface it. Invoked directly by a
  human, ask when the question is ambiguous.
- **One question per POC.** If it's answering two, the second one's answer is the one you'll
  get wrong. Say in the summary what you didn't cover.
