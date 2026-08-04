---
name: spec-poc
description: Build a throwaway proof-of-concept ON a never-merged spec or epic PR so a direction can be validated before it is implemented — a characterization test pinning how the system already behaves, sketch source files showing the shape of a solution, a self-contained HTML mockup of a UI, or (at epic altitude) a rough end-state showing what the whole set looks like once every issue has landed. Also builds 2–3 competing variants when a direction fork is genuinely contested, so the choice is made on evidence. Use when a spec or epic-spec rests on a premise nobody has checked, when the ergonomics or the look only become visible in code, or when the division of work across an epic's issues might be wrong.
argument-hint: "<ISSUE-ID or epic name> — the question the POC has to answer"
---

# Spec POC

A **spec POC** is throwaway code committed to a **never-merged** spec or epic PR, so we
learn what we need to learn *before* implementing. The reviewers on that PR and the human
at the approval gate are **meant to look at it** — that is what separates it from every
other kind of throwaway code we write.

Read [`orchestration.md`](../../../docs/contributing/orchestration.md) → "Spec-branch POCs"
for where this sits in the lifecycle and who dispatches it. This file is how you execute it.

## Which POC skill is this? (split by who is asking)

Three skills build throwaway code. They are not interchangeable, and picking wrong wastes
the whole effort:

| | [`prototype`](../prototype/SKILL.md) | [`settle-claim`](../settle-claim/SKILL.md) | **`spec-poc`** (this) |
|---|---|---|---|
| **The question** | *What should we do?* — yours, undecided | *Who is right?* — contested, twice over | *Is this direction right?* — published for sign-off |
| **Audience** | you | the review thread | spec/epic PR reviewers + the human at the gate |
| **Lives** | `_prototypes/` in a host app | a throwaway worktree | the never-merged `spec/` or `epic/` branch |
| **Output** | an answer, in `NOTES.md` | `CONFIRMED` / `REFUTED` / `INCONCLUSIVE` | a summary in the spec + code a reviewer can run |
| **Survives?** | deleted or absorbed | deleted | closes with the PR, unmerged |

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
3. **The ergonomics only become visible in code.** Part I §5's usage examples looked fine
   and you don't believe them.
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
depth-pulled prose, or a §13 note), or a claim asserted once (answer it in the thread).

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
wiring to see whether it hangs together. Not the spec's *pseudocode* sketch (§7, which is
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
- The PR description therefore gives **the literal command**: `open poc/FIX-820-timeline/variant-a.html`.
  No dev server, no `pnpm install`, no build.

Several variants are several files in the same directory, plus one `README.md` comparing
them.

### 4. End-state POC — what the whole set looks like (epic only)

Rough changes across the set's real surface showing where things land once **every** issue
under the epic has merged. Its output is a scoping judgment, not working software: does the
division into issues hold, does one issue's deliverable make another's redundant, is there a
seam that needs an owner named in the epic's themes.

Deliberately incomplete and deliberately not per-issue-clean — it exists to be *looked at*
and then thrown away. Summarize what it showed in the epic-spec's **§3 Shape of the whole**
(four lines: built · see it · showed · changed) and delete nothing until the objective gate
has passed.

## Variants — when the fork is contested

When two or three shapes are genuinely in contention, build them side by side rather than
arguing. Four rules, and the second is the one that gets broken:

1. **Radically different, not variations.** Two shapes differing in a parameter teach
   nothing. If you can describe variant B as "A but with…", it isn't a variant.
2. **Equal effort on each.** A strawman is worse than no variant — it manufactures consent
   for the option you already preferred and puts a human's name on it. If you notice you're
   building one properly and one carelessly, stop: you've already decided, so write the
   decision down and skip the variants.
3. **One comparison page** (`poc/<ID>-<slug>/README.md`): what each variant does
   differently, what each is better at, what each costs, and the **question the choice turns
   on**. Not a recommendation-free dump — say which you'd pick and why, then let it be
   argued with.
4. **The chosen variant becomes a numbered §6 Decision** in the spec, citing the POC. A
   variant comparison that doesn't end in a Decision was a tour, not a fork.

Two or three. Four is a sign the question is under-specified.

## Where it lives, and why CI stays green

**`poc/<ISSUE-ID>-<slug>/`** at the repo root — e.g. `poc/FIX-775-resume-seam/`,
`poc/epic-stream-resilience/`.

That location is chosen for one mechanical reason: **`poc/` is not a pnpm workspace
package** (`pnpm-workspace.yaml` lists `packages/*`, `apps/*`, `examples/*`,
`examples/guides/*`, `labs/*`, `goals`), and both `pnpm typecheck` and `pnpm test` run
through `turbo`, per package. Code outside every workspace is never typechecked and never
collected as a test. This matters because **CI runs on every PR into `main`, including spec
PRs** — and a POC is quick and dirty by design, so anywhere inside a package it would turn
the spec PR red and the coordinator reads that CI signal.

Rules that keep it that way:

- **Never put a POC inside `packages/*`.** Those ship to consumers.
- **Never add `poc/` to `pnpm-workspace.yaml`**, and give it no `package.json` — that is
  exactly what would pull it into turbo's graph.
- **Run it directly**: `pnpm tsx poc/<dir>/run.ts`, `pnpm fsdev run …`, or open the HTML.
  Don't wire a root `package.json` script; a script implies it's maintained.
- **Imports resolve or CI complains.** `pnpm knip:ci` gates on unresolved imports and
  undeclared dependencies across the root workspace, so `poc/**` is listed in `knip.json`'s
  root `ignore`. Don't remove that line, and don't rely on it to hide a POC that imports
  something that doesn't exist — prefer imports that actually resolve.
- **If CI still goes red, fix the POC, don't disable the check.** A red spec PR is a broken
  gate signal, and the whole point of this location is that no config had to be weakened.

## Publishing it — the reviewer has to be able to run it

A POC nobody looks at is waste with extra steps. So the **PR description** carries a POC
block, and it is not optional:

```
## POC on this branch

`poc/FIX-820-timeline/` — three variants of the run timeline.

  open poc/FIX-820-timeline/variant-a.html      # one row per block
  open poc/FIX-820-timeline/variant-b.html      # collapsed by phase
  open poc/FIX-820-timeline/variant-c.html      # flame-graph

Comparison + my pick: poc/FIX-820-timeline/README.md
The question it turns on: does a reader scan for *what ran* or for *what was slow*?

Throwaway — never merges, closes with this PR. Please don't review it as code.
```

Three requirements:

1. **One runnable/openable command per artifact**, verbatim and copy-pasteable.
2. **The question it answers**, stated. A reviewer who has to infer what they're looking
   for reviews the code quality instead — which is the exact feedback we don't want.
3. **Say it's throwaway.** The contract block in `spec-template.md` already excludes POC
   files from review; repeating it here is cheap and it works.

Then the **spec** gets the durable record: §7 points at the POC in one line and states what
it showed; §12 records a premise it settled (with the same "resolved, don't reopen" force a
`settle-claim` verdict has); *Spec evolution* gets a line **only if the POC moved the
design** — `- **After POC** — <what changed>, because the run showed <what>.` At epic
altitude the record is §3 instead.

**Report a POC that changed nothing.** "Built it, the premise held, no change" is a real
result and it belongs in §7. Only recording POCs that found problems teaches the next reader
that a quiet POC was a failure.

## Exit — it never merges

The spec PR closes **unmerged** when implementation starts and its branch is **deleted**
(BP-037), so the POC's working life ends there. **Its value is meant to be consumed before
that point** — a POC exists to inform the gate, and by the time implementation starts the gate
has passed. What survives is the record: the spec's §7/§12 summary, and the closed PR, whose
diff GitHub keeps viewable after the branch is gone. **Cite the PR, never the branch.**

That the POC can't leak into the codebase rests on one mechanical fact worth stating: the
implementation branch is cut from **fresh `origin/main`**, never from the spec branch (see
`orchestration.md` → "Worktree branching"). The approved spec *document* is landed onto the
implementation branch as its own commit; **the POC is not, ever.** If you find yourself
copying `poc/` files onto a `fix/` branch, stop — either it's real code and needs `tdd`, or
it's throwaway and it stays behind.

What crosses the line, and how:

| Outcome | Where it goes |
|---|---|
| **A premise it settled** | Spec §12, as resolved-with-evidence. Costs a later reviewer zero rounds to reopen. |
| **A characterization test worth keeping** | Named in §10 as a CI spec to write, or graduated into `goals/<describe>/<it>/` properly (`goal.md` with a real anti-game field). Re-written under `tdd` on the impl branch — not copied. |
| **The shape** | §7 cites **the spec PR URL** plus the path inside it — *not* the branch. `issue-implement` deletes the spec branch when it closes the PR (BP-037), but GitHub keeps a closed PR's commits and diff view reachable, so the PR link stays readable and a branch link goes dead. The implementer starts *from* it; they don't inherit it. (An **epic** branch is never deleted, so an epic POC can cite either.) |
| **A chosen variant** | A numbered §6 Decision. |
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
- **The POC that becomes the implementation.** Committing real work to an unapproved,
  never-merged branch means it either gets rewritten or it smuggles unreviewed code past the
  gate. Both are worse than starting clean.
- **A POC standing in for a decision.** No run answers "should we build this?" That's the
  human's call at the gate, and a POC informs it rather than replacing it.

## Boundaries

- **Non-blocking, like a settlement.** The spec keeps converging while a POC is built, and
  the approval gate stays reachable. But **disclose it**: a gate surfaced while a
  load-bearing POC is still in flight must say so, or the human approves on a premise nobody
  mentioned was contested.
- **You never merge the POC, and you never open a separate PR for it.** It lives on the spec
  or epic branch that already has one.
- **You never prompt the user when dispatched** (as `issue-worker` or `epic-agent` running
  this step) — return the summary and let the coordinator surface it. Invoked directly by a
  human, ask when the question is ambiguous.
- **One question per POC.** If it's answering two, the second one's answer is the one you'll
  get wrong. Say in the summary what you didn't cover.
