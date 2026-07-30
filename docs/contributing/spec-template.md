# Spec template — the two-part contract

A spec has two readers with opposite needs, so it has two parts and a hard divider.

- **Part I — The Case** is for the **human decision-maker.** They review by pattern,
  smell, and direction, not by absorbing density (philosophy tenet 6). Scannable in a
  few minutes. It is also the spec-PR description and the Linear lead.
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
SSE stream after a disconnect — so the template reads end to end as a spec. **Copy the
shape, not the content.** The issue itself is a fiction reconstructed after the fact:
resume already ships (`docs/architecture/streaming.md` → "Resume Semantics"), which is why
the API and cursor format in the examples are the real ones. Don't read it as a live
proposal, and don't copy an API out of it without checking the code — the point of the
example is what a section *looks like when it's done*, not what to build.

---

## For reviewers — what this document is

*(Paste this block verbatim at the top of the spec PR description — `issue-spec` Step 6.
It is the one lever we have on automated reviewers we can't instruct.)*

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

> **Resuming from the client (no API change — the client does it):**
>
> ```ts
> const session = useSession(sessionId, { flowKind: "chat" })
> // Connection drops at item 41. The client reconnects on its own and
> // session.items continues at 42 — no duplicates, no gap.
> ```
>
> **Resuming by hand, against the stream endpoint:**
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
> before  reconnect with any cursor → items 1..N replayed
> after   reconnect with cursor 41  → items 42..N
>         reconnect with cursor 999 → 204, request already complete
> ```

### 6. Decisions & rules — the sign-off surface

Numbered, ≤ 8, only the calls that **shape the outcome** — some interpretation room for
the implementer is expected. Each: the decision, the alternative rejected, the
ramification. Part II must not introduce a decision that isn't here.

> 1. **Resume filters server-side by sequence number.**
>    *Rejected:* client-side dedupe.
>    *Locks in:* every transport we add later needs a monotonic per-request sequence.
>
> 2. **The cursor is `{requestId}:{sequence}`, carried on `Last-Event-ID`.**
>    *Rejected:* a bespoke `?resume=` query param.
>    *Locks in:* the format is now load-bearing for any client, ours or not. Changing
>    it later is a breaking change to a string we don't validate.
>
> 3. **A reconnect to a completed request returns 204, not a replay.**
>    *Rejected:* replaying from the store so late clients still get the answer.
>    *Locks in:* resume is a *stream* feature, not a history feature. Fetching a
>    finished response stays the store's job, and we'll be asked for it eventually.
>
> 4. **No cursor means today's behavior, byte for byte.**
>    *Rejected:* defaulting to resume-from-last-seen server-side.
>    *Locks in:* the server holds no per-client state, so nothing to expire.
>
> **Non-goals** — cross-request resume (reconnecting after the original request ended),
> and client-side reconnect *policy* (backoff, retry limits) — the client already has
> both, and this spec changes neither.
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
> - **`@flow-state-dev/client`** — its existing reconnect sends the last seen
>   sequence. No new public option.
> - **Untouched:** the execution engine, every block kind, the item taxonomy.
>   Sequence numbers already exist (`docs/architecture/streaming.md`); this reads them.

### 8. Implementation sequence

Ordered, independently testable steps. For each: which modules to create / modify /
**remove** (subtraction is part of the change — tenet 3), what to test, what it depends on.

> 1. **Parse and thread the cursor.** Route reads `Last-Event-ID`, hands an optional
>    cursor to the stream seam. Nothing filters yet. *Test:* a malformed header is
>    ignored rather than fatal. *Depends on:* nothing.
> 2. **Filter at the seam.** Drop items at or below the cursor. *Test:* the three
>    cases in §5 (fresh, mid-stream, stale). *Depends on:* 1.
> 3. **Completed-request boundary.** 204 when the cursor names a finished request.
>    *Test:* reconnect after completion. *Depends on:* 2.
> 4. **Client sends it.** Existing reconnect path attaches the cursor. *Test:*
>    end-to-end, connection killed mid-stream. *Depends on:* 3.
> 5. **Remove** the client's `dedupeIncomingItems` helper and its tests — it exists
>    only to paper over the duplicates this change eliminates.

**PR plan (Large / multi-PR only).** Independent = no unmet `depends_on`. The lifecycle
builds independents in parallel and sequences the rest; the DAG must be acyclic. Most
issues are a single-node plan and skip this table. Its *shape* is a §6 decision.

| sub-PR | deliverables | depends_on |
|---|---|---|
| a | engine: cursor parsing + filter | — |
| b | client: attach cursor on reconnect | a |

### 9. Edge cases & error handling

A table, plus the error taxonomy (retryable vs. fatal). Walk the second-path checklist
(BP-035) over the changed surface.

> | Case | Expected |
> |---|---|
> | No cursor | Stream from the start — today's behavior exactly |
> | Malformed cursor | Ignore it, stream from the start. Not an error: it's caller-controllable input (BP-031) |
> | Cursor from a different request | Ignore it. Cursors are request-scoped by construction |
> | Cursor ahead of the stream | Nothing to send yet; hold the connection open |
> | Request already completed | 204, no body |
> | Reconnect during an in-flight tool call | Resume normally — the item is emitted when it completes, and its sequence is above the cursor |
>
> **Taxonomy:** every cursor problem is non-fatal and degrades to a full stream. The
> only fatal path is an unreadable request id, which already 404s today.

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
> - a reconnect with a mid-stream cursor emits only items above it
> - a reconnect with no cursor emits every item
> - a reconnect after completion emits nothing and closes
> - sequence numbers stay contiguous across the reconnect
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
*before* implementation, each with options and trade-offs.

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
