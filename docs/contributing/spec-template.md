# Spec template — the two-part contract

A spec has two readers with opposite needs, so it has two parts and a hard divider.

- **Part I — The Case** is for the **human decision-maker** — the product owner, not a peer
  engineer. They review by pattern, smell, and direction, not by absorbing density
  (philosophy tenet 6), and what they can judge that nobody else can is whether this serves
  the objective. So Part I is written in observable behaviour and priced in consequences;
  every ask inside it follows [`asking-for-decisions.md`](asking-for-decisions.md).
  Scannable in a few minutes. It is also the spec-PR description and the Linear lead.
- **Part II — The Build Plan** is for the **implementing agent.** *Directional*, not a
  blueprint: which modules and layers are involved, how they fit, the order to build
  them. Exact signatures and line-level choices are the implementer's, settled in the
  code with `tdd` / `diagnose` and the challenger.

**Authored in one pass**, published as one spec PR opened ready for review, one
approval gate that signs off the whole thing. See `issue-spec` Step 6.

**Approval means directionally correct** — the problem is real, the approach will work,
the Decisions are the ones we want. Not a finished design, and never held open until
nothing is left to nitpick. Below-the-bar feedback goes to §13 for the implementer. The
bar, the dispositions, and the two-round budget are canonical in
[`orchestration.md`](orchestration.md) → "Spec review: the bar and the convergence rule".

> **Anti-addenda rule.** A review-driven pivot gets the affected sections **re-drafted.**
> Never bolt an "AUTHORITATIVE reconciliation" section onto a body that now contradicts
> it — an incoherent spec produces an incoherent implementation (tenet 1).

**Not every issue needs this.** A **bug** skips the spec entirely and goes straight to
implementation — see [`orchestration.md`](orchestration.md) → "Which issues get a spec".
Work that fits on one screen and needs no research uses
[`agent-brief-template.md`](agent-brief-template.md) instead; that brief *is* the contract.

**How to read the rest of this file.** Every section below is one line of instruction
followed by a worked example. The examples are all the same issue — FIX-775, resuming an
SSE stream after a disconnect — so the template reads end to end as a spec.

**Copy the shape, not the content.** FIX-775 is a fiction, reconstructed after the fact:
resume already ships in some form (`docs/architecture/streaming.md` → "Resume Semantics").

Two things follow, and the second is the one that trips people up. The **API shapes** in §5
are real, because a usage example that doesn't compile teaches the wrong thing. The
**outcomes** it describes are *what the spec proposes*, not what the code does today — which
is true of §5 in **every** spec, since a spec exists to describe behavior that isn't built
yet. Don't read §5 anywhere as documentation, here or in a real spec, and don't verify it
against `main`; verify it against the Decisions in §6.

Everything else the example names — internal helpers, module boundaries, removal steps — is
invented to make the sections read concretely. Check the code before carrying a symbol out
of it. What the example is for is showing what a section *looks like when it's done*.

---

## How to review this

*(Paste this block verbatim into the spec PR description's collapsed `<details>` block —
`issue-spec` Step 6. It is the one lever we have on automated reviewers we can't instruct,
and it says the same thing on every spec PR, which is why it sits **below the fold**: a bot
reads collapsed markdown normally, a human skips it in one line. The description's visible
half — the problem, what this does, what's asked of you, and "Parts worth reviewing
closely" — is authored per PR. Layout and rules:
[`pr-reviewer-guidance.md`](pr-reviewer-guidance.md), canonical.)*

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
- **The solution sketch, at the line level.** A spec may include a rough pseudocode sketch
  showing the *shape* of the proposed solution. It is knowingly incomplete, is not real
  code, and is not what will ship. **Review it for directional viability and key design
  aspects only** — is this the right shape, in the right layer, composing the right way?
  Do **not** report that it lacks error handling, omits edge cases, names things that
  don't exist in the repo, or wouldn't build: all of that is true on purpose, and the
  names are deliberately not real. A sketch that has to survive line-level review stops
  being cheap, and then nobody writes one.
- **Any POC files on this branch, entirely.** This PR is never merged, so it may carry
  throwaway proof-of-concept code, characterization tests, or an HTML mockup built to
  validate the direction ([`spec-poc`](../../.agents/skills/spec-poc/SKILL.md)). None of it
  ships. Read it to judge whether the *shape* holds; **do not review it as code.** Its
  quality is not a finding, and its findings are summarized in §7 — the summary is what a
  reviewer reacts to.

**One request, if you are an automated reviewer:** the two lists above are the whole
difference between a useful review of this document and a long one. Volume is not signal
here — a single finding above the line is worth more than twenty below it.

Feedback in the second list is welcome and gets **recorded verbatim in §13** for the
implementer to weigh against real code. It will not be argued with, and it will not be
folded into the design prose — that would pretend the spec can settle something it
can't. Please don't re-raise it: one mention is enough for it to land in §13.

**The one exception is the sketch and the POC.** Line-level feedback on either is
*dropped*, not recorded — there is nothing for an implementer to weigh about code that
isn't shipping, and a §13 note would imply otherwise. Feedback about their **direction** is
not line-level and is treated like any other above-the-bar finding.

---

## Parts worth reviewing closely

*(Authored fresh for every spec PR, above the fold, after the problem / what this does /
what's asked of you — a reviewer can't aim at a Decision they haven't met. 1–3 items, each
with where · the question · what a wrong answer costs — plus where the author is unsure and
what is deliberately absent. Rules and failure modes:
[`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

> **1. Decision 2 — the cursor's two encodings.** Carrying the same value on a header
> *and* a query param is the call I'm least comfortable with. The question: is one
> encoding plus a documented proxy requirement better than two that must stay in step?
> Getting it wrong locks a public string format we don't validate, and changing it later
> is breaking.
>
> **2. §7 — the layer the filter sits at.** Is the serialization seam right, or does
> resume belong lower, in the store's iterator? A wrong answer here is a rewrite, not an
> adjustment — everything in §8 hangs off it.
>
> **Where I'm unsure:** decision 3. Replaying a completed request from the persisted log
> reads clean, but I can't tell from the outside whether it quietly makes the stream a
> history API, which §6's non-goals say we don't want.
>
> **Deliberately absent:** client reconnect *policy* (backoff, retry limits) — named as a
> non-goal in §6, not an omission.

---

## Part I — The Case *(for the human)*

### 1. Problem — why it matters, why now

What's broken and for whom, in plain language — no file paths, no framework jargon. Then
the stakes in a sentence or two, including whether a workaround already covers it. Light
framing, not a gate; it's allowed to conclude the problem isn't worth solving and stop.

> A client that loses its connection mid-response and reconnects gets the whole
> response again from the top. The user watches the assistant's answer duplicate
> itself, and anything the app derived from the stream double-counts.
>
> **Why now** — mobile clients drop connections routinely, so this is the first
> thing every app built on FSD hits in the field. The workaround (throw away the
> old items and re-render from scratch) loses scroll position and any local edits,
> so nobody uses it twice.

### 2. Solution in plain terms

What we'll do and why, in everyday terms — the shape a reviewer needs before any detail.
Then name the 1–3 `docs/philosophy.md` tenets it leans on. **If it's in tension with a
tenet, say which and why that's justified** — don't hide it.

> The client already knows the last item it saw. On reconnect it tells the server,
> and the server resumes from the next one instead of starting over. Nothing is
> re-sent, nothing is skipped.
>
> **Philosophy** — tenet 2 (composition over features): resume is a property of the
> existing streaming seam, not a new subsystem beside it. Tenet 3 (earn every
> addition): the cursor rides on a header the SSE spec already defines, so the
> public surface grows by zero options.

### 3. Tradeoffs & alternatives

The main alternative weighed and why this one wins; **the simpler approach considered**
and why it's insufficient (or that we're taking it); and **where the genuine complexity
is** — usually not the happy path.

> **Alternative: server-side session replay buffer.** Keep every item per session
> and serve arbitrary re-reads. Rejected — it turns a stream into a store, and the
> retention question ("how long do we keep it?") has no good answer at framework level.
>
> **The simpler approach: let the client dedupe.** Genuinely tempting, and it needs
> no server change. Insufficient because the duplicate items are *already billed and
> already streamed* — the client can hide them but the cost and the latency are real,
> and any non-UI consumer still double-counts.
>
> **Where the complexity is:** not the filter. It's what the cursor means when the
> original request has *ended* — a reconnect that arrives after completion has
> nothing to resume into. §9 is mostly about that boundary.

### 4. Focus practices (1–5)

The few practices this change lives or dies by, each tied to a tenet. **Do not re-list
the global BPs** — only what's load-bearing here, plus any change-specific rule that
isn't yet a BP.

> 1. **BP-030 (tolerate the old shape)** — a client that sends no cursor is the
>    common case for the whole first release. It must behave exactly as today.
> 2. **BP-035 (second-path checklist)** — the reconnect path is the second path.
>    A test that only covers a clean first connection proves nothing here.
> 3. **One convergence point for the cursor** (tenet 5) — every producer of a
>    sequence number goes through the same allocator, or resume silently skips items.

### 5. What using it looks like (1–5 examples)

The actual code someone writes against the new surface and the observable result.
**Usage, not implementation.** Short before/after when a call site moves. Keep these
small — a fuller worked example belongs in the spec PR (never merged), not the doc.
Skip entirely, with a one-line reason, only when nothing about how code is written
against the framework changes.

> **Reattaching from the client, on reload** *(what this spec proposes — today the same
> call reattaches with no cursor and replays from 1, which is the problem in §1):*
>
> ```ts
> const session = useSession(sessionId, { flowKind: "chat", autoResume: true })
> // The tab reloads while a request is in flight. On mount the hook finds it and
> // reattaches with the cursor it left off at, so session.items picks up at 42.
> ```
>
> **Reattaching by hand, against the stream endpoint:**
>
> ```
> Last-Event-ID: req_8f2:41
> // or, equivalently
> GET …/stream?starting_after=41
> ```
>
> **What a stale cursor does (before / after):**
>
> ```
> before  reattach with any cursor → items 1..N replayed
> after   reattach with cursor 41  → items 42..N
>         reattach with cursor 999 → 200 with no events; the log is exhausted
> ```

### 6. Decisions & rules — the sign-off surface

Numbered, ≤ 8, only the calls that **shape the outcome** — some interpretation room for
the implementer is expected. Each: the decision, the alternative rejected, the
ramification. Part II must not introduce a decision that isn't here.

**Write *Locks in* as a consequence, not a mechanism.** It is the only line that tells a
product owner what signing this off costs them, so it names what we can no longer change
cheaply, who is affected, and when the bill arrives — never just which code would have to
move. "Changing it later is a breaking change to a string we don't validate" prices the
decision; "both entry points would need updating" asks the reader to price it themselves.

**Most of these are being ratified, not decided.** The human is confirming the direction is
the one they want, which is why eight one-liners is a reasonable ask. **A row that is a genuine
live fork** — you can't settle it alone, and the answer turns on something they know — is
**pulled out and asked properly** in the spec PR description (block 3) using the six-part
shape in [`asking-for-decisions.md`](asking-for-decisions.md), with the row itself left in
place so §6 stays the complete sign-off surface. Zero to two per spec; more than that and the
direction isn't ready for review.

> 1. **Resume filters server-side by sequence number.**
>    *Rejected:* client-side dedupe.
>    *Locks in:* every transport we add later needs a monotonic per-request sequence.
>
> 2. **The cursor is `{requestId}:{sequence}`, accepted on `Last-Event-ID` and on a
>    `starting_after` query param; the query param wins when both are sent.**
>    *Rejected:* header only — an intermediary that strips `Last-Event-ID` would silently
>    disable resume, which is worse than carrying two encodings of one value.
>    *Locks in:* the format is load-bearing for any client, ours or not, and both entry
>    points have to stay in step. Changing it later is a breaking change to a string we
>    don't validate.
>
> 3. **A reattach to a completed request replays from the persisted log and closes.**
>    *Rejected:* a distinct "already finished" status code the client has to branch on.
>    *Locks in:* one response shape for every reattach — a cursor past the end of the
>    log is an ordinary empty replay, not an error, so the client needs no special case.
>
> 4. **No cursor means today's behavior, byte for byte.**
>    *Rejected:* defaulting to resume-from-last-seen server-side.
>    *Locks in:* the server holds no per-client state, so nothing to expire.
>
> **Non-goals** — serving a finished response to a client that was never attached (that's
> a history read, and it stays the store's job), and client-side reconnect *policy*
> (backoff, retry limits). Reattaching to a request that completed mid-flight *is* in
> scope — see decision 3.
>
> **Size:** Medium (multi-file, one PR, ~250 LOC).

*(Large only: declare the §8 PR plan and record its shape as a decision here.)*

---

## Part II — The Build Plan *(for the implementing agent)*

Part II carries **shape and sequence**, not the finished design.

> **Depth is pulled, not pushed.** Write each section at the altitude a reviewer needs
> to judge the direction, and no deeper. Deepen a section only when review asks for
> more to sign it off.
>
> **Prefer a diagram to code.** Architecture, data flow, and state machines go in a
> **mermaid diagram** — not in signatures and file trees. A snippet is allowed only
> when it pins something prose can't; label it **illustrative (a sketch, not the
> contract)** and keep it short.
>
> **Where the code contradicts the plan, that's evidence the spec missed something** —
> surface it (fold it in, or escalate). Never force-follow a plan the code says is
> wrong, and never silently deviate.

### 7. Technical design

Which packages/layers are involved and how they talk — as a diagram wherever one fits.
Name the API surface at the level of *what it exposes*, not exact signatures.

> The cursor enters at the HTTP boundary and is applied at the one place items
> are already serialized. Nothing upstream of that seam knows resume exists.
>
> ```mermaid
> flowchart LR
>   C[client reconnect<br/>Last-Event-ID] --> R[HTTP route]
>   R -->|cursor| S[SSE stream seam]
>   E[execution engine] -->|items, already sequenced| S
>   S -->|drop seq <= cursor| C
> ```
>
> - **`@flow-state-dev/engine`** — the stream seam gains a resume cursor and filters
>   on it. The route parses the header and hands it down; it makes no decisions.
> - **`@flow-state-dev/client`** — the reattach path sends the last seen sequence.
>   No new public option.
> - **Untouched:** the execution engine, every block kind, the item taxonomy.
>   Sequence numbers already exist (`docs/architecture/streaming.md`); this reads them.

**Solution sketch — optional, and deliberately rough.** Where the shape of a solution is
easier to *see* than to describe, include a quick sketch of it. Three things it buys: the
reviewer sees the shape instead of reconstructing it from prose, the author has to confront
the design concretely before signing off on it, and the implementer starts from something
rather than a blank file.

**It is not the end state, and it does not have to run.** Quick and dirty is the point —
skip error handling, skip types that don't carry meaning, leave `…` where the detail is
obvious.

**Write the inline one as pseudocode, not as almost-real code.** This is the rule that
makes the rest work. A sketch in plausible-looking API names invites exactly the review it
is trying to avoid: someone checks the names against the repo, finds they don't exist, and
now you are debating a seam nobody proposed. Pseudocode can't be audited, so the shape is
all that's left to react to — which is the whole point. Name the *roles* (`the stream
seam`, `the persisted log`), not functions you think exist.

**When you do want real code, put it on the spec branch** — that's
[`spec-poc`](../../.agents/skills/spec-poc/SKILL.md). Throwaway files under
`spec-poc/<ISSUE-ID>-<slug>/` on the never-merged spec branch are where a real POC belongs: the
author gets to try the design, the reviewer gets something to run, and the implementer gets a
starting point, all without the doc carrying API-shaped claims. **Point at it from here in one
line and say what it showed** — including when the premise held. Link **the spec PR**, not the
branch: closing the PR deletes the branch (BP-037) but leaves the PR's diff viewable. Never
merged, either way — the implementation branch is cut from `origin/main`, so a POC can't ride
along.

**Include one when** the composition is novel, the ergonomics only become visible in code,
or two shapes are genuinely in contention and side-by-side settles it. **Skip it when** the
change extends an existing pattern — pointing at the pattern is better than re-sketching it.

> **Sketch — pseudocode. Illustrative, not the contract. React to the shape.**
>
> ```
> at the stream seam, where items are already serialized:
>
>     for each item about to be written:
>         if cursor is set and item's sequence <= cursor:   ← the whole feature
>             skip it
>         otherwise write it
>
> at the route:      cursor ← query param, else header      (decision 2)
> completed request: same loop, reading the persisted log   (decision 3)
> ```
>
> What this asks a reviewer: *is a filter at the serialization seam the right place, or
> does resume belong lower, in the store's iterator?* That question is the point. It is
> deliberately impossible to tell from this whether the field is called `sequence` or
> `sequence_number` — that is the implementer's to look up, not the reviewer's to catch.

*(If deciding between shapes needed a real experiment rather than a sketch: build it where
reviewers can run it ([`spec-poc`](../../.agents/skills/spec-poc/SKILL.md)) when the choice is
theirs to sign off, or privately ([`prototype`](../../.agents/skills/prototype/SKILL.md)) when
the question is only yours. Either way a sketch distilled from one is a good sketch, and
neither ships.)*

### 8. Implementation sequence

Ordered, independently testable steps. For each: which modules to create / modify /
**remove** (subtraction is part of the change — tenet 3), what to test, what it depends on.

> 1. **Parse and thread the cursor** at the HTTP boundary, in both encodings decision 2
>    names. Nothing filters yet. *Test:* each encoding, their precedence, and a malformed
>    value. *Depends on:* nothing.
> 2. **Filter at the seam.** *Test:* the §5 cases. *Depends on:* 1.
> 3. **The completed-request boundary**, per decision 3. *Test:* reattach after completion,
>    and with a cursor past the end. *Depends on:* 2.
> 4. **Client sends it** on the reattach path. *Test:* end-to-end, reload mid-request.
>    *Depends on:* 3.
> 5. **Remove** the client-side dedupe helper and its tests — it exists only to paper over
>    the duplicates this change eliminates.
>
> *(Each step cites the decision it implements rather than restating it. That's deliberate:
> the contract lives in §6 alone, so a decision that changes in review changes in one place.
> A sequence that re-states semantics is a second copy that silently goes stale.)*

**PR plan (Large / multi-PR only).** Independent = no unmet `depends_on`. The lifecycle
builds independents in parallel and sequences the rest; the DAG must be acyclic. Most
issues are a single-node plan and skip this table. Its *shape* is a §6 decision.

**FIX-775 is Medium, so it has no PR plan.** The table below is a *separate* illustration of
what one looks like on a Large issue — it is not part of the worked example above. Don't paste
it into a Medium spec: the lifecycle reads a declared plan as executable multi-PR routing, so
an example plan left in a one-PR issue really does split it into two.

| sub-PR | deliverables | depends_on |
|---|---|---|
| a | the engine-side half | — |
| b | the client-side half | a |

### 9. Edge cases & error handling

A table, plus the error taxonomy (retryable vs. fatal). Walk the second-path checklist
(BP-035) over the changed surface.

> | Case | Expected |
> |---|---|
> | Malformed cursor | Ignore it, stream from the start — caller-controllable input, so not an error (BP-031) |
> | Cursor from a different request | Ignore it; cursors are request-scoped by construction |
> | Cursor ahead of the stream | Nothing to send yet; hold the connection open |
> | Reattach during an in-flight tool call | Normal — the item is emitted on completion, above the cursor |
>
> **Taxonomy:** every cursor problem is non-fatal and degrades to a full stream. The
> only fatal path is an unreadable request id, which already 404s today.
>
> *(The rows are the cases §6 does **not** already answer — the odd, the hostile, the
> boundary. "No cursor" and "request already completed" are decisions 4 and 3, so they
> aren't repeated here. A table that re-derives the happy path from the decisions is
> the copy that drifts.)*

### 10. Testing strategy

- **Goal & goal check** (real path, real model — the outcome a user cares about), OR an
  explicit "no goal check applies" with a one-line reason (docs-only, pure type change,
  config plumbing).
- **CI specs** (mocked, deterministic) — the behaviours, in observable terms.
- **Discipline:** `tdd` (features) or `diagnose` (bugs) — name the seam.

> **Goal:** kill the connection halfway through a real streamed response and reconnect;
> the assembled transcript equals the uninterrupted one, item for item.
> `goals/resume-after-disconnect/reconnect-midstream/run.mts`, real model.
>
> **CI specs** (the behaviours, not the test names):
> - **one behaviour per decision in §6**, stated in observable terms — what a caller sees,
>   not how it's computed
> - **the second path** (BP-035): every case exercised on a *reattach*, not only on a first
>   connection — that's the path this change adds and the one a naive suite misses
> - **what must not change**: a caller that sends no cursor behaves byte for byte as today
> - **the invariant that is easy to state wrongly**: delivered sequence numbers are strictly
>   increasing, no duplicates, no reset — **not contiguous.** Replay legitimately omits
>   non-replayable events, so gaps are correct; asserting contiguity would fail a good
>   stream, or push the implementer to renumber cursors the whole feature depends on being
>   stable
>
> *(Only the last one spells out a rule, and only because getting it backwards produces a
> confidently wrong test. The rest name **which** behaviours to cover and let §6 say what
> they are — one contract, one place.)*
>
> **Discipline:** `tdd`. The seam is the stream-serialization boundary in
> `@flow-state-dev/engine` — reachable from a vitest spec with the mock context, so
> every behaviour above is a tracer bullet with no HTTP server involved.

### 11. Documentation plan

Per page: CREATE or EXTEND, sidebar placement, outline, cross-links, voice risks — or an
explicit "no docs changes required" with justification. Never a vague "update the README."

> - **EXTEND** `apps/docs/docs/streaming/overview.md` — new section "Resuming after a
>   disconnect" after "Sequence numbers". Covers the cursor format, the three
>   reconnect cases, and the completed-request boundary. One minimal example (the
>   `useSession` one from §5 — resume is automatic for the common case, and that's
>   the headline). Cross-link ← from the client README's reconnect note, → to
>   `docs/architecture/streaming.md`.
>   *Voice risk:* "seamless" is the obvious adjective here. Don't.
> - **EXTEND** `packages/engine/README.md` — one line under the stream seam's entry.
> - **No new page.** Resume is one section under an existing concept, not a term
>   users will search for on its own.

### 12. Dependencies, open questions & follow-ups

Blocking issues/PRs and external dependencies. Open questions that need a decision
*before* implementation.

**An open question here is always a live fork, so it always gets the full ask** — the fork as
a heading, plain terms, the trade-off, **your recommendation**, and what would change your
mind ([`asking-for-decisions.md`](asking-for-decisions.md)). Listing options with no
recommendation is the failure mode this section attracts: it reads as thorough and it hands
the reader an unpriced menu, which costs a round while they ask you what you think.

A question you'd answer the same way whatever they said isn't open. Decide it, make it a §6
Decision, and move on.

> **Dependencies:** none. Sequence numbers already ship.
>
> **Open questions:** none.

**Settled claims** — an empirical question a review contested and a **POC settled**, so
the next reviewer (usually a bot with no memory of the thread) can't reopen it blind.
This is why a settled claim costs zero further rounds. Omit the block when there are none.

> - **Settled:** the store preserves item ordering across a reconnect —
>   **CONFIRMED**: 500 items over three forced reconnects came back in emission order
>   every run. ([thread](https://github.com/o/r/pull/1#discussion_1))
> - **Settled:** `Last-Event-ID` survives our proxy — **REFUTED**: the edge strips it
>   on reconnect, so the cursor also rides a query param. ([thread](https://github.com/o/r/pull/1#discussion_2))

A claim still **in flight** is listed here too, marked `(POC in flight)` — *here* rather
than in the open-questions list above, because an open question blocks implementation
(`issue-implement` Step 2) and an in-flight settlement is non-blocking by design.

> - **In flight:** heartbeat frames do not consume sequence numbers. `(POC in flight)`

**Follow-ups (flagged, not built):**

> - **Deepening:** the route layer now parses two different cursor encodings for
>   historical reasons. Out of scope; follow up via `improve-codebase-architecture`.
> - **Already rejected:** cross-request resume — see `docs/internal/out-of-scope/`
>   rather than restating the case.

### 13. Review notes for the implementer

Below-the-bar spec-PR feedback, **recorded verbatim, not folded into the design** — see
[`orchestration.md`](orchestration.md) → "Spec review". One line each, quoted, with a
thread link. **Omit the section entirely when a spec drew none**; an empty heading is noise.

> - "`resumeFrom` reads better than `cursor` for the parameter name." — bugbot ([thread](https://github.com/o/r/pull/1#discussion_3))
> - "Consider extracting the filter into its own module rather than inlining it at the seam." — codex ([thread](https://github.com/o/r/pull/1#discussion_4))

**For the implementer:** these are *inputs, not instructions.* Each is one reviewer's
guess at code they haven't read. Adopt, adapt, or discard — you owe no justification for
discarding one (§6's Decisions bind you; these don't). The exception: a note that turns
out to reveal a genuine design problem is a spec blind spot — surface it and fold it
back, per the challenger discipline in `issue-implement`.

---

## Spec evolution *(the change story, not an audit log)*

One line per meaningful turn, **newest last**: `- **<trigger>** — <what changed>, because <why>.`
Not a diff and not a changelog — commit history has those. Its job is to let a reviewer
arriving late see the shape of the debate that produced the spec, which is exactly what
the anti-addenda rule strips out of the body. Typo fixes don't earn a line, and a §13
note never does (it changed nothing).

> - **Spec drafted** — framed as resume-after-disconnect; chose sequence-based
>   filtering over a replay buffer; mapped it to the existing streaming seam.
> - **After spec review** — dropped cross-request resume, because a reviewer flagged
>   it as a separate concern with its own retention question.
> - **After POC settlement** — added a query-param fallback for the cursor, because
>   the run showed our edge strips `Last-Event-ID` on reconnect.

A spec authored with no review pivots has one entry. That's fine.
