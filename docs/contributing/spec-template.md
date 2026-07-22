# Spec template — the two-part contract

A spec has two readers with opposite needs, so it has two parts and a hard divider.

- **Part I — The Case** is for the **human decision-maker.** They review by pattern,
  smell, and direction, not by absorbing density (philosophy tenet 6). Part I is
  scannable in a few minutes: the problem, whether it's worth solving, the solution
  in plain terms, the tradeoffs, what using it looks like, and the decisions to sign
  off on. It is also the spec-PR description and the Linear lead.
- **Part II — The Build Plan** is for the **implementing agent.** It maps ~80% of the
  work. The last 20% is the implementer's once they're in the code. It is allowed to
  be dense where density buys precision.

> **Anti-addenda rule.** When spec-PR review forces a major pivot, **re-draft the
> affected sections.** Do not bolt on an "AUTHORITATIVE reconciliation" section that
> contradicts the body — an incoherent spec produces an incoherent implementation
> (tenet 1). Small clarifications can be inline; a changed direction gets rewritten.

Not every issue needs this. If the work fits on one screen and needs no research,
use `agent-brief-template.md` instead — that brief *is* the contract.

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

*(Review feedback that's too in-the-weeds to belong in the spec's prose is recorded
under a "Review notes for the implementer" heading rather than rewritten into the
design — see `fsd:create-spec` Step 6.5.)*

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
PR / 100–500) · Large (multi-PR / >500). If Large, name the PR split.

---

## Part II — The Build Plan *(for the implementing agent)*

> Follow the Decisions in Part I. Where the code contradicts the spec's reasoning,
> that contradiction is evidence the spec missed something — **surface it** (fold
> into the spec or escalate to the human). Do not force-follow a plan the code is
> telling you is wrong, and do not silently deviate.
>
> **For reviewers:** challenge the Decisions (Part I), not Part II's phrasing. The
> last 20% — exact names, local structure, which helper — is the implementer's to
> settle in the code. A nit about Part II wording that doesn't touch a decision is
> out of scope.

### 7. Technical design

Architecture (packages/modules/files involved), data flow, and the API surface —
exact signatures, types, request/response shapes. This is the contract; be precise.

### 8. Implementation sequence

Ordered, independently testable steps. For each: files to create / modify / **remove**
(subtraction is part of the change — tenet 3), what changes, what to test, and
dependencies on earlier steps. Map ~80%; leave the in-the-weeds 20% to the
implementer.

### 9. Edge cases & error handling

Table of edge cases with expected behavior. Error taxonomy (retryable vs. fatal).
Fallback behaviors. Walk the second-path checklist (BP-035) for the changed surface.

### 10. Testing strategy

- **Goal & goal check** (real path, real model — proves the outcome a user cares
  about), OR an explicit "no goal check applies" with a one-line justification
  (docs-only, pure type/schema/internal refactor, config plumbing).
- **CI specs** (mocked, deterministic) — the behaviours to test in observable terms.
- **Discipline:** `fsd:tdd` (features) or `fsd:diagnose` (bugs) — name the seam.

### 11. Documentation plan

Per-page plan (CREATE/EXTEND, sidebar placement, outline, cross-links, voice risks),
or an explicit "no docs changes required" with justification. Never a vague "update
the README."

### 12. Dependencies, open questions & follow-ups

Blocking issues / PRs that must land first; external dependencies. Open questions
that need a decision before implementation, each with options and trade-offs.

**Follow-ups (flagged, not built):**
- **Deepening opportunities** the area surfaced — shallow handlers, capability-shaped
  wiring, patterns that strain a tenet — as follow-ups for
  `fsd:improve-codebase-architecture`. Flagging keeps them visible without expanding
  scope. (Opportunistic in-scope alignment still happens per the philosophy's
  "align as you go"; this is for what's genuinely out of scope.)
- **Already-rejected directions** — before listing a deliberate "won't do," check
  `docs/internal/out-of-scope/` and reference an existing rejection rather than
  restating it.
