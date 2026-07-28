# Spec template — the two-part contract

A spec has two readers with opposite needs, so it has two parts and a hard divider.

- **Part I — The Case** is for the **human decision-maker.** They review by pattern,
  smell, and direction, not by absorbing density (philosophy tenet 6). Part I is
  scannable in a few minutes: the problem, whether it's worth solving, the solution
  in plain terms, the tradeoffs, what using it looks like, and the decisions to sign
  off on. It is also the spec-PR description and the Linear lead.
- **Part II — The Build Plan** is for the **implementing agent.** It is *directional*,
  not a blueprint: it fixes which modules and layers are involved, how they fit, and
  the order to build them — enough that the implementer knows how to proceed and a
  reviewer can judge the direction. It stops short of the finished design. The exact
  signatures, code, and line-level choices are the implementer's, settled in the code
  with `tdd` / `diagnose` and the challenger.

**Authored in one pass.** Part I and Part II are written together and published as a
single spec PR opened **ready for review** (and the Linear lead). There is one
approval gate — an approving human comment or GitHub Review on the spec PR — and it
signs off the whole spec at once. Because Part II is directional rather than an
exhaustive blueprint, it's cheap enough to write alongside the Case; there's no
separate stage to defer it to. See `issue-spec` Step 6.

**Approval means directionally correct.** Sign-off certifies that the problem is real,
the approach will work, and the decisions in Part I are the ones we want. It does not
certify a finished design, and a spec is *not* held open until nothing is left to
nitpick — that target doesn't exist. Feedback below the direction line is recorded in
§13 for the implementer rather than rewritten into the design. The bar, the three
dispositions, and the two-round convergence budget are canonical in
[`orchestration.md`](orchestration.md) → "Spec review: the bar and the convergence rule".

> **Anti-addenda rule.** When spec-PR review forces a major pivot, **re-draft the
> affected sections.** Do not bolt on an "AUTHORITATIVE reconciliation" section that
> contradicts the body — an incoherent spec produces an incoherent implementation
> (tenet 1). Small clarifications can be inline; a changed direction gets rewritten.

Not every issue needs this. If the work fits on one screen and needs no research,
use `agent-brief-template.md` instead — that brief *is* the contract.

---

## For reviewers — what this document is

*(This block is also what leads the spec PR description, so an automated reviewer sees
it before the content — see `issue-spec` Step 6.)*

This is a **direction document**, not an implementation. Reviewing it well means
answering one question: **is this the right approach?**

**In scope to challenge:**

- The problem framing — are we solving the right thing?
- The approach — will it work, does it fit the architecture and `docs/philosophy.md`?
- Any numbered **Decision** in §6 — that's the sign-off surface.
- Missing constraints, edge cases, or dependencies that would **invalidate** the design.
- Scope — a deliverable that shouldn't ship, or one that's missing.

**Out of scope — deliberately unsettled here, and owned by the implementing agent:**

- Names, signatures, file paths, and module layout.
- Local structure: which helper, how a function is decomposed, error-message wording.
- Micro-optimizations and style preferences.
- Test names and internal test structure (the *behaviours* to test are in §10; the tests
  themselves are not).
- Anything Part II left open on purpose — it is directional by design, and a gap at
  that altitude is intended, not an omission.

Feedback in the second list is welcome and gets **recorded verbatim in §13** for the
implementer to weigh against real code. It will not be argued with, and it will not be
folded into the design prose — that would pretend the spec can settle something it
can't. Please don't re-raise it: one mention is enough for it to land in §13.

---

## Part I — The Case *(for the human)*

### 1. Problem — why it matters, why now

- **The problem, in plain language** (2–4 sentences, no file paths or framework
  jargon). What's broken, missing, or worth doing, and for whom.
- **Why now** — one or two sentences on the stakes: who it helps, and whether a
  workaround already covers it. This is light framing, not a heavy gate — but it is
  allowed to conclude the problem isn't worth solving (a rare edge, already handled)
  and stop there. Most specs just establish the stakes and move on to the solution.

### 2. Solution in plain terms

- What we'll do and why, in everyday terms — the shape a reviewer needs before any
  detail.
- **The philosophy that led here.** Name the 1–3 `docs/philosophy.md` tenets this
  solution leans on and how. If the solution is in tension with a tenet, say which
  and why it's justified — don't hide it.

### 3. Tradeoffs & alternatives

- The main alternative(s) weighed, and why this one wins.
- **The simpler approach considered** — and why it's insufficient, or, if we're
  taking it, say so plainly. (Reviewers most want to know a simpler path was looked
  for.)
- **Where the genuine complexity is** — usually not the happy path. Name it.

### 4. Focus practices (1–5)

The practices most load-bearing for *this* change, written for a human to grasp at a
glance, each aligned to a tenet. These set the reviewer's altitude. **Do not re-list
the global BPs** — call out only the few that this change lives or dies by, plus any
change-specific rule that isn't yet a BP.

### 5. What using it looks like (1–5 examples)

The actual code a developer or end user writes against the new/changed surface, and
the observable result (return value, emitted items, rendered output). **Usage, not
implementation.** Include a short before/after when an existing call site changes.
Keep the examples *here* small — the smallest thing that conveys the usage. When a
fuller, worked example genuinely helps reviewers, put it in the **spec PR** (which is
never merged) rather than the spec doc, so the implementing agent isn't forced to
wade through it. Skip examples entirely (and say so in one line) only when the change
doesn't alter how anyone writes code against the framework (internal refactor, pure
type change, bug fix restoring documented behavior).

*(Review feedback below the direction line is recorded verbatim in §13 rather than
rewritten into the design — see `issue-spec` Step 6.5.)*

### 6. Decisions & rules — the sign-off surface

Numbered. This is what the human signs off on. Each entry:

- **The decision** — one scannable line.
- **Alternative rejected** — what we're not doing.
- **Ramification** — what it locks in, rules out, or what future cost it carries.

Keep it to the decisions that *shape the outcome* (aim for ≤ 8). Part II must not
introduce a decision that isn't represented here — if it does, that decision belongs
up here where it's visible. Some interpretation room for the implementer is fine and
expected; these are the calls that are *not* theirs to make.

Then a one-line **Non-goals** note — what this deliberately does *not* do (scope
boundaries) — so scope creep is visible to the human at sign-off. (Process-level
follow-ups — deepening opportunities, already-rejected directions — go in §12.)

End with the **size estimate**: Small (1 file / <100 LOC) · Medium (multi-file / 1
PR / 100–500) · Large (multi-PR / >500). If Large, declare the **PR plan** (the sub-PR
DAG in §8) and record its *shape* as a decision here — which parts split into
independent PRs vs. which are sequential.

---

## Part II — The Build Plan *(for the implementing agent)*

Part II is **directional**: it carries the shape and sequence — which modules and
layers are involved, how they fit, the order to build them — not the finished design.
More detail than Part I, much less than a full implementation. The implementer owns
the exact signatures, code, and line-level choices, settled in the code.

> **Keep it light by default; depth is pulled, not pushed.** Write each section at the
> altitude a reviewer needs to judge the direction, and no deeper. Deepen a specific
> section only when review of the spec asks for more to sign it off — not preemptively.
>
> **Prefer a diagram to code.** Carry architecture, data flow, and state machines in a
> **mermaid diagram** (flow / sequence / component / state), not in signatures and file
> trees. Avoid file paths and full function signatures. A small snippet is allowed only
> when it pins a decision prose can't, or sketches a seam — label it **illustrative (a
> sketch, not the contract)**, and keep it a few lines.
>
> Follow the Decisions in Part I. Where the code contradicts the spec's reasoning,
> that contradiction is evidence the spec missed something — **surface it** (fold
> into the spec or escalate to the human). Do not force-follow a plan the code is
> telling you is wrong, and do not silently deviate.
>
> **For reviewers:** challenge the Decisions (Part I) and Part II's *direction*, not
> its phrasing — see "For reviewers" at the top. A gap at the line level is intended
> here; it is not an omission to report.

### 7. Technical design

Architecture (which packages / modules / layers are involved), how they fit, and the
data flow — carried by a **mermaid diagram** wherever one fits. Name the API surface at
the level of *what* it exposes and *how the pieces talk*, not exact signatures and
request/response shapes — those are the implementer's to settle. An illustrative snippet
is fine to pin a seam; label it a sketch.

### 8. Implementation sequence

Ordered, independently testable steps. For each: which modules/layers to create /
modify / **remove** (subtraction is part of the change — tenet 3), what changes, what to
test, and dependencies on earlier steps. Give the sequence and shape; leave the
line-level detail to the implementer.

**PR plan (Large / multi-PR issues only).** When the change is large enough to split
across PRs, declare a **PR plan**: a small table of sub-PRs and their dependencies.
Independent = no unmet `depends_on`. The implementing lifecycle builds the independent
sub-PRs in parallel (each its own branch/PR) and sequences the dependent ones. Keep it
small — most issues are a single-node plan and skip this.

| sub-PR | deliverables | depends_on |
|---|---|---|
| a | <what ships in this PR> | — |
| b | <…> | — |
| c | <…> | a, b |

Conventions the lifecycle relies on: sub-PR branches are `fix/<ISSUE>-<id>`; a
**dependent** sub-PR branches off its dependency so review can start before the dep
merges (rebase on merge); the DAG must be acyclic. The plan's *shape* (how many PRs,
what's independent vs. sequential) is a load-bearing decision — record it in Part I §6
too (that's what the human signs off on); this table is the executable detail.

### 9. Edge cases & error handling

Table of edge cases with expected behavior. Error taxonomy (retryable vs. fatal).
Fallback behaviors. Walk the second-path checklist (BP-035) for the changed surface.

### 10. Testing strategy

- **Goal & goal check** (real path, real model — proves the outcome a user cares
  about), OR an explicit "no goal check applies" with a one-line justification
  (docs-only, pure type/schema/internal refactor, config plumbing).
- **CI specs** (mocked, deterministic) — the behaviours to test in observable terms.
- **Discipline:** `tdd` (features) or `diagnose` (bugs) — name the seam.

### 11. Documentation plan

Per-page plan (CREATE/EXTEND, sidebar placement, outline, cross-links, voice risks),
or an explicit "no docs changes required" with justification. Never a vague "update
the README."

### 12. Dependencies, open questions & follow-ups

Blocking issues / PRs that must land first; external dependencies. Open questions
that need a decision before implementation, each with options and trade-offs.

**Settled claims (empirical questions this spec no longer has open):**

A claim about how the system behaves that a review contested and a **POC settled** is
recorded here as a *resolved* question, with its evidence — see
[`orchestration.md`](orchestration.md) → "Settling a disputed claim (POC settlement)". This is
what stops the next reviewer (usually a bot, with no memory of the thread) from reopening it
blind, and it is why a settled claim costs zero further review rounds.

Format — one line each:

`- **Settled:** <the claim> — **<CONFIRMED|REFUTED>**: <the observation>. (<evidence link — the thread, the capture, or the graduated goal>)`

Omit the block when no claim needed settling.

A claim still **in flight** is listed here too, marked `(POC in flight)`, so a reader knows an
answer is coming. Record it **here rather than in the open-questions list above** — an open
question blocks implementation until it's answered (`issue-implement` Step 2), and an in-flight
settlement is non-blocking by design. Putting it in the blocking list would reinstate exactly
the wait the mechanism exists to avoid.

**Follow-ups (flagged, not built):**
- **Deepening opportunities** the area surfaced — shallow handlers, capability-shaped
  wiring, patterns that strain a tenet — as follow-ups for
  `improve-codebase-architecture`. Flagging keeps them visible without expanding
  scope. (Opportunistic in-scope alignment still happens per the philosophy's
  "align as you go"; this is for what's genuinely out of scope.)
- **Already-rejected directions** — before listing a deliberate "won't do," check
  `docs/internal/out-of-scope/` and reference an existing rejection rather than
  restating it.

### 13. Review notes for the implementer

Below-the-bar spec-PR feedback, **recorded verbatim, not folded into the design.** This
is where a reviewer's line-level observation lands so it reaches the implementer without
distorting the spec — see [`orchestration.md`](orchestration.md) → "Spec review: the bar
and the convergence rule".

**For the implementer:** these are *inputs, not instructions.* Each is one reviewer's
guess at the code, made without having read it. Weigh each against what you actually
find; adopt it, adapt it, or discard it — and you owe no justification for discarding one
(the spec's Decisions are binding, these are not). A note that turns out to reveal a
genuine design problem is different: that's a spec blind spot — surface it and fold it
back, per the challenger discipline in `issue-implement`.

Format — one line each, quoted, with a pointer back to the thread:

`- "<the feedback, verbatim>" — <reviewer> ([thread](<url>))`

Omit the section entirely when a spec drew no below-the-bar feedback. An empty heading is
noise.

---

## Spec evolution *(the change story, not an audit log)*

A short, reader-facing timeline of how this spec got to where it is — kept at the bottom,
updated whenever the spec changes meaningfully. It is **not** a diff and **not** a
changelog (commit history already carries those, in full). One line per meaningful turn:
*what changed and why*, in plain terms a human skims in a few seconds. Its job is to let a
reviewer coming to the spec late see the shape of the debate that produced it — which is
exactly what the anti-addenda rule strips out of the body.

- The first entry is the **spec drafted** — the Case and the Build Plan authored in one pass.
- Each later entry is a **review-driven pivot** — the same rewrite the anti-addenda rule
  demands in the body, recorded here as a one-line "what/why" so the evolution stays
  legible without leaving reconciliation scars in the design.

Format — **newest last**, each entry one line:

`- **<trigger>** — <what changed>, because <why>.`

Example:

- **Spec drafted** — framed the problem as resume-after-disconnect; chose sequence-based replay over full re-send; mapped the streaming seam and split into 2 PRs (engine, then client).
- **After spec review** — dropped multi-region scope; a reviewer flagged it as a separate concern.
- **After spec review** — swapped the in-memory cursor for the store's sequence, per reviewer.

Keep it to meaningful turns. Typo fixes and wording nits don't earn a line. If the spec
was authored with no review pivots, the single **spec drafted** entry is the whole
timeline — that's fine.
