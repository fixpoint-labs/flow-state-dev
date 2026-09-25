# Spec template — one directory, five required documents, retained artifacts

A spec has three readers with different needs, so it is not one document. It is a directory,
`specs/issues/<ISSUE-ID>/`, on branch `spec/<ISSUE-ID>`, holding:

| File | Reader | Reads it to | Budget (prose words, fences excluded) |
|---|---|---|---|
| **`SPEC.md`** | The product owner | See the goal and how we'll know it's met, who feels the change, and sign off | ~850 |
| **`DECISIONS.md`** | Whoever asks *why* — the owner on demand, the reviewer, the implementer when a rule bites | See what was considered, what was chosen, what lost, and what each choice locks in | ~900 |
| **`BUSINESS-RULES.md`** | A human reviewer, then the implementer | Check the cases: when → then → proved by | ~900 |
| **`PLAN.md`** | The implementing agent | Build it: surfaces, order, checks, pinned names, guardrails | ~1,000 |
| **`DOCS.md`** | The reader of the eventual documentation, then the implementer | Review actual proposed prose and examples, with destination operations | Only changed material |
| **`EVOLUTION.md`** (conditional) | The reviewer and implementer | Trace retained, amended or superseded parts of earlier designs | Only relevant lineage |
| **`figures/*.svg`** | Everyone | Look at the pictures where position is the content | — |

The set is longer than the one-file spec it replaces, and that is honest: **no single reader
reads all of it.** The product owner reads the PR body and `SPEC.md`, and opens `DECISIONS.md`
when a sign-off line isn't obvious. The implementer reads `BUSINESS-RULES.md` and `PLAN.md`. A
reviewer reads whichever document the *look here* block points them at. Each document is written
for its reader alone and points at the others rather than repeating them.

**Every document opens on the same nav line**, directly under its H1, with the current document
bold and unlinked:

```md
**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)
```

A reader may land on any document from a PR or Linear link. The nav line, on the third
line of each file, links the siblings; append `[Evolution](EVOLUTION.md)` only when it
exists. Authored `assets/` and `poc/<experiment>/` stay beside `figures/` under this owner.
The storage, authority and lifecycle contract is
[`orchestration.md` → Spec retention and authority](orchestration.md#spec-retention-and-authority).

**The goal follows the problem, before any solution.** Right after the people table,
`SPEC.md` states the goal in one sentence, a check that it is the right goal, a figure of how
we'll know it's met, and the exact check that proves it, with a control that must fail. The PR
body carries the same block in the same place. A reader who stops there knows what done means
and how it will be proved. See [`SPEC.md` → The goal](#the-goal-and-how-well-know-its-met).

**The pictures carry the meaning; the prose reads them.** The spec, decisions and rules open on
a table or figure, and every figure has one sentence under it saying what to look at. What a
figure is, which each document carries, and how one is drawn and checked is canonical in
[`spec-figures.md`](spec-figures.md). The plan carries no figures, on purpose: it is written for
an agent, which reads tables and a DAG faster than a picture.

**Authored in one pass**, published as one spec PR opened ready for review, one approval gate
that signs off the whole set. See `issue-spec` Step 6.

**Approval means directionally correct** — the problem is real, the approach will work, the
decisions are the ones we want. Not a finished design, and never held open until nothing is left
to nitpick. Below-the-bar feedback goes to `PLAN.md → Notes from review` for the implementer. The
bar, the dispositions, and the two-round budget are canonical in
[`orchestration.md`](orchestration.md) → "Spec review: the bar and the convergence rule".

Approval precedes merge; required checks and required review-thread policy still apply.
Implementation starts only after confirmed merge. See
[Merging and amending a spec](orchestration.md#merging-and-amending-a-spec) for later changes.

> **Anti-addenda rule.** A review-driven pivot gets the affected document **re-drafted.** Never
> bolt an "AUTHORITATIVE reconciliation" section onto a body that now contradicts it — an
> incoherent spec produces an incoherent implementation (tenet 1). A pivot that moves a figure
> redraws the figure.

**Not every issue needs this.** A **bug** skips the spec entirely and goes straight to
implementation — see [`orchestration.md`](orchestration.md) → "Which issues get a spec". Work
that fits on one screen and needs no research uses
[`agent-brief-template.md`](agent-brief-template.md) instead; that brief *is* the contract.

**Where the old sections went.** Specs written before this shape were one file in two parts.
Everything they carried still exists; it moved to the document whose reader wants it:

| Was | Now |
|---|---|
| §1 Problem · §2 Solution · §5 What using it looks like | `SPEC.md` — the people table, the figures, the file-shaped surface as a diff |
| §6 Decisions · §3 Tradeoffs & alternatives · §12 Open questions & settled claims | `DECISIONS.md` — the cards, *considered and dropped*, *open / settled*, *how it got here*; prior-design lineage goes in conditional `EVOLUTION.md` |
| §9 Edge cases & error handling · the acceptance criteria | `BUSINESS-RULES.md` |
| §4 Focus practices | `PLAN.md → Guardrails`, each with a *because* |
| §7 Technical design · §8 Sequence & PR plan · §10 Testing · §13 Review notes | `PLAN.md`; §11 Docs plan becomes concrete proposed prose in `DOCS.md` |
| The explainer | Retired. Its panels became the figures in `SPEC.md` and `DECISIONS.md` |

**How to read the rest of this file.** Every document below is its instruction followed by a
worked example. The examples are all the same issue — FIX-775, resuming an SSE stream after a
disconnect — so the template reads end to end as a spec set.

**Copy the shape, not the content.** FIX-775 is a fiction, reconstructed after the fact: resume
already ships in some form (`docs/architecture/streaming.md` → "Resume Semantics"). The API
shapes in the diff are real, because a surface that doesn't compile teaches the wrong thing; the
outcomes are *what the spec proposes*, not what the code does today — which is true of every
spec, since a spec describes behaviour that isn't built yet. Don't verify the example against
`main`. Everything else it names — helpers, modules, removal steps — is invented so the sections
read concretely. Check the code before carrying a symbol out of it.

---

## How to review this

*(Paste this block verbatim into the spec PR description's collapsed `<details>` block —
`issue-spec` Step 6. It is the one lever we have on automated reviewers we can't instruct, and
it says the same thing on every spec PR, which is why it sits **below the fold**: a bot reads
collapsed markdown normally, a human skips it in one line. The description's visible half is
authored per PR. Layout and rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

This is a **direction set**, not an implementation. Reviewing it well means
answering one question: **is this the right approach?**

**In scope to challenge:**

- **The goal and the problem framing** in `SPEC.md` — is the goal the real need at full size,
  for the people named, or a smaller goal that would let us call this done early? Would the
  named check fail if the goal were not met?
- The approach — will it work, does it fit the architecture and `docs/philosophy.md`?
- Any numbered **decision** in `DECISIONS.md` — that's the sign-off surface.
- A case `BUSINESS-RULES.md` misses, or a rule that would **invalidate** the design.
- Scope — a deliverable that shouldn't ship, or one that's missing.
- The reader-facing promises in `DOCS.md` and their fit with the rules; a missing or
  misleading lineage claim in conditional `EVOLUTION.md`.

**Out of scope — deliberately unsettled here, and owned by the implementing agent:**

- Names, signatures, file paths, and module layout beyond the few `PLAN.md` pins on purpose.
- Local structure: which helper, how a function is decomposed, error-message wording.
- Micro-optimizations and style preferences.
- Test names and internal test structure (the *behaviours* are the rules; the tests are not).
- Anything `PLAN.md` left open on purpose — it is directional by design, and a gap at that
  altitude is intended, not an omission.
- **The figures, at the pixel level.** A figure is right when it reads right. A misplaced label
  or a colour you'd have chosen differently is not a finding; a figure that shows a shape the
  decisions don't say is.
- **The solution sketch, at the line level.** `PLAN.md` may include a rough pseudocode sketch
  showing the *shape* of the proposed solution. It is knowingly incomplete, is not real code,
  and is not what will ship. **Review it for directional viability only.** Do **not** report
  that it lacks error handling, omits edge cases, names things that don't exist in the repo, or
  wouldn't build: all of that is true on purpose.
- **POC implementation polish.** Experiments under the owning spec's `poc/` are retained,
  not production code. Read them for directional evidence, not production completeness.
  Their isolation from production/default discovery and absence of secrets or generated
  dependencies **are in scope**; retention is not permission to weaken repository checks.

**One request, if you are an automated reviewer:** the two lists above are the whole difference
between a useful review of this document and a long one. Volume is not signal here — a single
finding above the line is worth more than twenty below it.

Feedback in the second list is welcome and gets **recorded verbatim in `PLAN.md → Notes from
review`** for the implementer to weigh against real code. It will not be argued with, and it
will not be folded into the design prose. Please don't re-raise it: one mention is enough.

**The one exception is the sketch and the POC.** Line-level feedback on either is *dropped*, not
recorded — there is nothing for an implementer to weigh about code that isn't shipping. Feedback
about their **direction** is not line-level and is treated like any other above-the-bar finding.

Direction approval does not waive merge-time required checks, approvals or thread policy.
Optional comments do not require another design round merely to reach zero comments.

---

## The PR body

*(Authored fresh for every spec PR. The layout and the rules are
[`pr-reviewer-guidance.md`](pr-reviewer-guidance.md); what follows is the spec-PR instance.
Budget ~475 prose words above the fold. The body is not another spec document: every line
in it is in `SPEC.md` too, shorter.)*

The people table from `SPEC.md`, cut to five rows. Then **the goal**, in its one sentence,
the *how we'll know* figure (a mermaid fence, pasted as text) with its sentence, and one line
naming the goal check and the control that must fail. The *what changes* figure, as a pinned raw
image ([`spec-figures.md`](spec-figures.md) → "In the PR body"), with its one sentence. One line
on **how**. Then **Sign off**: the decisions, numbered, hardest first, each a bold line and an
*If wrong:* clause, with the one to weigh named and a pointer to the decisions doc. Then
**Reviewers · look here**: one to three items, each naming where and the question, plus what is
deliberately not here. Then the links line: the document set, Linear issue, epic, what
it builds on, and that merge follows approval and required checks. Then the collapsed contract.

> ```md
> # spec(FIX-775): resume a stream after a disconnect
>
> | Someone who… | Today | After |
> |---|---|---|
> | **loses the connection mid-answer on a phone** | Watches the whole answer duplicate itself | Picks up at the next item |
> | **derives a total from the stream** | Double-counts every reconnect | Counts each item once |
> | **reconnects after the answer finished** | Gets the answer again, from the top | Gets the tail they missed, then a clean close |
> | **sends no cursor at all** | Today's behaviour | Today's behaviour, byte for byte |
> | **runs a proxy that strips headers** | Nothing to strip yet | Resume still works: the cursor also rides a query param |
>
> **Goal:** a client that loses its connection mid-answer reconnects and ends up with exactly
> the answer it would have had, with nothing repeated and nothing missing.
>
> ```mermaid
> flowchart LR
>   I["a real streamed answer · held-out"] --> D["drop at a random item · reconnect on the real path"]
>   D --> T["the transcript the client assembled"]
>   T -->|"equals the uninterrupted run, item for item"| P["PASS · goal met"]
>   C["control · server ignores the cursor"] -.-> D
>   T -.->|"under the control"| F["must FAIL · duplicates named"]
> ```
>
> The check reads what the client assembled, not what the server meant to send. Under the
> control it must fail, or it proves nothing. Check: `goals/resume-after-disconnect/reconnect-midstream/`,
> real model, control `GOAL_CONTROL=ignore-cursor`. Why this goal and not a smaller one:
> [SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met).
>
> <img src="https://raw.githubusercontent.com/<owner>/<repo>/<sha>/specs/issues/<ISSUE-ID>/figures/resume.svg" width="940" alt="Two timelines: today a reconnect replays from item 1; after, it continues from the item after the cursor" />
>
> Same request, two reconnects. The top row is today; the bottom is what the cursor buys.
>
> **How:** the client already knows the last item it saw. On reconnect it says so, and the
> stream seam skips everything up to it. Nothing upstream of that seam learns resume exists.
>
> ## Sign off
>
> **The goal, at that size.** If wrong: we ship a resume the user can't feel, or hold the issue
> open for a need it was never meant to meet.
>
> 1. **The cursor rides both a header and a query param; the query param wins.** If wrong: a
>    public string format we don't validate, locked in, with two entry points to keep in step.
> 2. **A reconnect to a finished request replays the tail and closes.** If wrong: the stream
>    quietly becomes a history API, which the store is supposed to be.
> 3. **No cursor means today, byte for byte.** If wrong: the server holds per-client state.
>
> **Open: none.** Number 1 is the one to weigh. Reasoning and what lost:
> [DECISIONS.md](DECISIONS.md). The cases: [BUSINESS-RULES.md](BUSINESS-RULES.md).
>
> ## Reviewers · look here
>
> - **Decisions → D1.** Is one encoding plus a documented proxy requirement better than two
>   encodings that must stay in step?
> - **Plan → where the filter sits.** The serialization seam, or lower in the store's iterator?
>   A wrong answer is a rewrite, not an adjustment.
> - **Rules → BR-7.** Delivered sequence numbers are increasing, not contiguous. Easy to test
>   wrongly.
>
> **Not here:** client reconnect *policy* (backoff, retry limits) — a named non-goal.
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
> · Linear FIX-775 · no epic · merges after human approval and required checks
>
> <details>
> <summary><b>How to review this</b> — altitude, what's in scope, what's deliberately unsettled</summary>
>
> *(the block above, verbatim)*
>
> </details>
> ```

Two things about that body. **The sign-off lines are the compact form** of
[`pr-reviewer-guidance.md`](pr-reviewer-guidance.md) → §3: a ratified decision is one bold line
plus its cost, because the reader is confirming a direction, not weighing a fork. **A live fork
is not compact**: it gets the full six-part shape from
[`asking-for-decisions.md`](asking-for-decisions.md), under its own heading, above the ratified
ones. Zero to two per spec; more than that and the direction isn't ready for review.

---

## `SPEC.md` — what changes, for whom

The document the product owner reads. It answers *who feels this, what do they see before and
after, and what am I signing*, in observable behaviour with no file paths. Sections, in order:

1. **The header line** — kind · packages · size · PR count · epic, and sibling links.
2. **People, before and after** — a table: someone who… · today · after. Three to six rows.
   Each row is a person doing one thing and what they see. This table is the spec's problem
   statement and its solution statement at once, and the PR body cuts it to five rows.
3. **The goal, and how we'll know it's met** — the section below this list says what it owes.
   It sits right after the problem because every section after it is judged against it.
4. **What changes** — the one figure, with its sentence. Then any surface a person edits, **as
   a diff**: a config file, a worker file, a call site. The diff is the highest-density form we
   have for a file-shaped surface, and it is what a person will actually type.
5. **Optionally, one more figure** where a quantity carries the argument — what a turn costs,
   what a request carries — and **one mermaid** for the mechanism as a path through layers.
6. **What stays as it is** — the neighbours a reader would otherwise assume changed.
7. **Sign off** — **the goal first**, unnumbered, with its *If wrong:*: approval certifies the
   goal's size as much as the approach. Then the numbered decisions as one-liners linking to
   their cards, each with *If wrong:*, and the one to weigh named. **Open: none**, or the live
   forks named.

### The goal, and how we'll know it's met

A spec that doesn't say what done looks like gets declared done when the code is merged. This
section is what stops that. It has four parts, in order, and none is optional.

1. **The goal** — one sentence: what someone can do or see after this that they can't now. In
   their terms, observable, no framework vocabulary. The same sentence is the goal check's
   **Outcome** in `goal.md` ([`goals/README.md`](../../goals/README.md)).
2. **Is it the right goal?** — a table with three rows, sometimes four:
   - **The real need** — what the requester or the epic actually needs, in their words, linked.
     The goal must meet it, not a part of it that happens to be easier.
   - **Smaller, and rejected** — the undersold goal: the weaker version that would let us call
     this done early, and why it falls short of the real need. Name it even when it is obvious.
     If the smaller goal is what we are shipping, say so, and it becomes the sign-off's hardest
     line.
   - **Bigger, and not this issue's** (when there is one) — the neighbouring goal a reader
     might expect, and who owns it.
   - **Not done if** — the states that look done and aren't: the suite is green but the goal
     check never ran; it passes only on the easy input; something downstream hides the failure.
3. **How we'll know** — the figure, a mermaid `flowchart LR` of the goal check: what is run, on
   what input, what outcome counts as PASS, and the control that must FAIL, as a dashed path.
   One sentence under it saying what the check reads. This figure goes in the PR body
   ([`spec-figures.md`](spec-figures.md)).
4. **How we verify** — a table with these rows, each specific enough to run. The rows are the
   goal check's `goal.md` fields, copied there when it is written; what each field owes is
   canonical in [`goals/README.md`](../../goals/README.md), and this list only says what the
   spec must pin before the check exists:
   - **Goal check** — the `goals/<describe>/<it>/` path, model or `n/a`, who runs it and when
     (the implementing agent, at completion), and where the verdict lands (the implementation
     PR's goal verdict).
   - **Signal** — the observable pass condition, with its threshold.
   - **Input** — the fixture, and what a different valid input would look like; a correct
     implementation must pass on it too.
   - **Anti-game** — what a hollow pass would look like, and therefore what the check must not
     assert on.
   - **Control that must fail** — a named `GOAL_CONTROL`, or today's `main` when the feature is
     absent there, and the leg it must fail. The implementation PR shows this FAIL before the
     PASS counts. A check nobody has seen fail has verified nothing (BP-003).

**When no goal check applies** (a pure refactor, docs only), the goal and *is it the right
goal?* still apply. Replace the figure and table with one line on what proves the goal instead,
and why no goal check fits, with the same *control that must fail* where one exists. "No goal
check" is a statement with a reason, never a blank.

> # FIX-775 · Resume a stream after a disconnect
>
> **Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> Feature · `engine` + `client` · medium · 1 PR · no epic
>
> ## Three people, before and after
>
> | Someone who… | Today | After |
> |---|---|---|
> | **loses the connection mid-answer on a phone** | Watches the assistant's answer duplicate itself from the top. Anything the app derived from the stream double-counts | Picks up at the next item. Nothing re-sent, nothing skipped |
> | **reconnects after the answer already finished** | Gets the whole answer again | Gets the items they missed, then a clean close. A cursor past the end is an ordinary empty replay |
> | **reconnects with a stale or malformed cursor** | n/a | Streams from the start, as today. Caller-controllable input is never an error |
> | **runs behind a proxy that strips `Last-Event-ID`** | n/a | Resume still works: the same cursor rides a query param, which wins when both are sent |
> | **sends no cursor** | Today's behaviour | Today's behaviour, byte for byte |
>
> Mobile clients drop connections routinely, so this is the first thing every app built on FSD
> hits in the field. The workaround — throw away the old items and re-render — loses scroll
> position and local edits, so nobody uses it twice.
>
> ## The goal, and how we'll know it's met
>
> **A client that loses its connection mid-answer reconnects and ends up with exactly the
> answer it would have had, with nothing repeated and nothing missing.**
>
> | Is it the right goal? | |
> |---|---|
> | **The real need** | Apps on phones survive a network blip without the user noticing ([FIX-770](https://linear.app/…/FIX-770), the epic's objective) |
> | **Smaller, and rejected** | "The server accepts a resume cursor." Hittable while the client still renders duplicates, so nobody would notice we shipped it |
> | **Bigger, and not this issue's** | "A connection that dies silently is noticed and resumed." Needs heartbeats; FIX-776 owns it |
> | **Not done if** | The suite is green and the goal check never ran on a real model · it passes only when the drop lands between items · the client dedupes to hide duplicates the server still sends |
>
> ```mermaid
> flowchart LR
>   I["a real streamed answer · held-out"] --> D["drop at a random item · reconnect on the real path"]
>   D --> T["the transcript the client assembled"]
>   T -->|"equals the uninterrupted run, item for item"| P["PASS · goal met"]
>   C["control · server ignores the cursor"] -.-> D
>   T -.->|"under the control"| F["must FAIL · duplicates named"]
> ```
>
> The check reads what the client assembled, not what the server meant to send. The dashed path
> is the same run with resume switched off, and it must fail.
>
> | How we verify | |
> |---|---|
> | **Goal check** | `goals/resume-after-disconnect/reconnect-midstream/` · real model · run by the implementer at completion · verdict in the implementation PR |
> | **Signal** | The assembled transcript equals the uninterrupted run: zero duplicate items, zero missing items |
> | **Input** | A recorded prompt with a long answer. A different prompt, or a drop at a different item, must pass too |
> | **Anti-game** | Don't assert on the seam's filter output or on a mocked stream. Both pass while the client still double-renders |
> | **Control that must fail** | `GOAL_CONTROL=ignore-cursor`, and today's `main`. Both must FAIL on the duplicates leg, and the PR shows it before the PASS |
>
> ## What changes
>
> ![Two request timelines, items 1 to N with a drop after item 41; today's reconnect replays from 1, the new one continues from 42, and a reconnect after completion replays 42 to N then closes](figures/resume.svg)
>
> Same request, three reconnects. Position along the row is the sequence number. The top row
> is today; the middle is a mid-stream reconnect with a cursor; the bottom is a reconnect after
> the request finished, which is the case that needed a decision ([D2](DECISIONS.md#d2)).
>
> **The reconnect, as the client writes it:**
>
> ```diff
>   const session = useSession(sessionId, { flowKind: "chat" })
> + // On mount the hook finds the in-flight request and reattaches with the cursor it left off at.
> + // session.items picks up at 42.
> ```
>
> **And by hand, against the stream endpoint:**
>
> ```diff
> + Last-Event-ID: req_8f2:41
> + // or, equivalently, and winning when both are sent
> + GET …/stream?starting_after=41
> ```
>
> ## How it reaches the stream
>
> ```mermaid
> flowchart LR
>   C["client reconnect · Last-Event-ID"] --> R["HTTP route"]
>   R -->|"cursor"| S["stream seam"]
>   E["execution engine"] -->|"items, already sequenced"| S
>   S -->|"drop seq ≤ cursor"| C
> ```
>
> The cursor enters at the HTTP boundary and is applied at the one place items are already
> serialized. Nothing upstream of that seam knows resume exists. Why that seam and not the
> store's iterator is [D1](DECISIONS.md#d1)'s neighbour, in the plan.
>
> ## What stays as it is
>
> - The execution engine, every block kind, the item taxonomy. Sequence numbers already exist
>   (`docs/architecture/streaming.md`); this reads them.
> - Client reconnect *policy*: backoff and retry limits are the app's.
> - Serving a finished response to a client that was never attached. That is a history read,
>   and it stays the store's job.
>
> ## Sign off
>
> **[The goal](#the-goal-and-how-well-know-its-met), at that size:** nothing repeated and nothing
> missing, measured on what the client assembled. If wrong: we ship a resume the user can't
> feel, or hold the issue open for heartbeats it was never meant to deliver.
>
> 1. **[D1](DECISIONS.md#d1) · The cursor is `{requestId}:{sequence}`, on `Last-Event-ID` and on
>    `starting_after`; the query param wins.** If wrong: a public string format we don't
>    validate, with two entry points that must stay in step. Changing it later is breaking.
> 2. **[D2](DECISIONS.md#d2) · A reattach to a completed request replays the tail from the
>    persisted log and closes.** If wrong: one more status code every client has to branch on,
>    or a stream that quietly became a history API.
> 3. **[D3](DECISIONS.md#d3) · No cursor means today's behaviour, byte for byte.** If wrong:
>    the server holds per-client state, and something has to expire it.
>
> **Open: none.** Number 1 is the one to weigh. The full reasoning, what was rejected, and what
> each locks in is in [DECISIONS.md](DECISIONS.md). The cases the code must satisfy are in
> [BUSINESS-RULES.md](BUSINESS-RULES.md).

**Size is a count, not an adjective.** The header line's *medium* is read off `PLAN.md` —
surfaces, checks, doc surfaces, PR count — and written last. A label written before the plan is
finished is a guess.

---

## `DECISIONS.md` — what was considered, what was chosen, what it locks in

The document for whoever asks *why*. It opens on the tree, then carries one card per decision,
then everything decided without being asked, then what was considered and dropped, then what is
open or settled, then how the document got here. Sections, in order:

1. **The tree** — one mermaid: the issue, its decisions as solid edges, what each rejected as a
   dashed edge with the reason on the label. Solid edges are what the reader is signing.
2. **One card per decision**, anchored `<a name="dN"></a>` so `SPEC.md` can link to it. A table
   with three rows — **Instead of** · **Because** · **Locks in** — then a paragraph reading the
   card, and a figure beside the decision when position carries it (a layer boundary, a grid of
   moments). **At most three decisions**, only the calls that shape the outcome; each is a
   business decision or it does not belong here (the filters in
   [`asking-for-decisions.md`](asking-for-decisions.md) → "What reaches them at all").
   **Write *Locks in* as a consequence**: what we can no longer change cheaply, who is affected,
   when the bill arrives — never which code would have to move.
3. **Decided, not asked** — calls that were obvious, or the implementer's, recorded in a line
   each so nobody re-derives them. A restatement of what the solution does is not one.
4. **Considered and dropped** — the alternatives that lost, one row each with why. The simpler
   approach considered belongs here even when it lost.
5. **Open / settled** — a live fork gets the full six-part ask; a claim a POC settled gets the
   verdict and the evidence link, so the next reviewer can't reopen it blind; a claim still in
   flight is marked `(POC in flight)`. Omit the section when there is nothing in it and say
   **Open: none** at the bottom instead.
6. **How it got here** — one line per meaningful turn, newest last: draft, each review round
   that moved a decision, each settlement. A round that changed only prose earns no line.

> # FIX-775 · Decisions
>
> [Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> What was considered, what was chosen, why, and what each choice locks in. Three decisions are
> the sign-off surface. Everything else here is context for them.
>
> ## The tree
>
> ```mermaid
> flowchart TD
>   I["FIX-775"] --> D1["D1 · cursor on header and query param<br/>query param wins"]
>   D1 -.->|"rejected"| X1["header only<br/>a proxy that strips it disables resume silently"]
>   I --> D2["D2 · a finished request replays the tail and closes"]
>   D2 -.->|"rejected"| X2["a distinct already-finished status<br/>every client branches on it"]
>   I --> D3["D3 · no cursor means today, byte for byte"]
>   D3 -.->|"rejected"| X3["resume from last-seen server-side<br/>per-client state to expire"]
> ```
>
> Solid edges are what you're signing. Dashed edges lost, and the label says why.
>
> <a name="d1"></a>
> ## D1 · The cursor is `{requestId}:{sequence}`, accepted on `Last-Event-ID` and on a `starting_after` query param; the query param wins when both are sent
>
> | | |
> |---|---|
> | **Instead of** | Header only |
> | **Because** | An intermediary that strips `Last-Event-ID` would silently disable resume, which is worse than carrying two encodings of one value. The SSE spec already defines the header, so the common path adds no public option |
> | **Locks in** | The format is load-bearing for any client, ours or not, and both entry points have to stay in step. Changing it later is a breaking change to a string we don't validate |
>
> **What would change my mind:** evidence that no proxy we run behind strips the header. Then
> one encoding is strictly better, and the query param is dropped before it ships.
>
> <a name="d2"></a>
> ## D2 · A reattach to a completed request replays the tail from the persisted log and closes
>
> | | |
> |---|---|
> | **Instead of** | A distinct "already finished" status code the client has to branch on |
> | **Because** | One response shape for every reattach. A cursor past the end of the log is an ordinary empty replay, not an error, so the client needs no special case |
> | **Locks in** | The persisted log is read on the stream path, so it has to stay complete for a request's lifetime. Serving a request the client was *never* attached to stays refused: that is a history read |
>
> ![A grid of three reattach moments by two request states: mid-flight replays from the cursor, finished replays the tail then closes, never-attached is refused](figures/reattach-grid.svg)
>
> Read the columns. The middle one is this decision: a finished request is served, once, from
> where the client left off. The right column is the boundary the spec refuses to cross.
>
> <a name="d3"></a>
> ## D3 · No cursor means today's behaviour, byte for byte
>
> | | |
> |---|---|
> | **Instead of** | Defaulting to resume-from-last-seen server-side |
> | **Because** | The server would hold per-client state, and something would have to expire it. A client that sends no cursor is the common case for the whole first release |
> | **Locks in** | Resume is opt-in by the client, forever. A client that wants it says so |
>
> ## Decided, not asked
>
> - **The filter sits at the serialization seam**, not in the store's iterator. Nothing upstream
>   learns resume exists. The plan names the seam; the exact function is the implementer's.
> - **A malformed cursor is ignored, never an error.** Caller-controllable input (BP-031).
>
> ## Considered and dropped
>
> | Alternative | Why not |
> |---|---|
> | A server-side session replay buffer serving arbitrary re-reads | Turns a stream into a store, and "how long do we keep it" has no good answer at framework level |
> | Let the client dedupe | Needs no server change, and is insufficient: the duplicate items are already billed and already streamed, and a non-UI consumer still double-counts |
> | Cross-request resume | A separate concern with its own retention question. Already rejected in `docs/internal/out-of-scope/` |
>
> ## Settled
>
> - **The store preserves item ordering across a reconnect** — **CONFIRMED**: 500 items over
>   three forced reconnects came back in emission order every run. ([thread](https://github.com/o/r/pull/1#discussion_1))
> - **`Last-Event-ID` survives our proxy** — **REFUTED**: the edge strips it on reconnect. D1
>   carries the query param because of this. ([thread](https://github.com/o/r/pull/1#discussion_2))
>
> ## How it got here
>
> - **Draft** — framed as resume-after-disconnect; sequence-based filtering over a replay
>   buffer; mapped to the existing streaming seam.
> - **Review** — dropped cross-request resume, because a reviewer flagged it as a separate
>   concern with its own retention question.
> - **POC settlement** — D1 gained the query param, because the run showed our edge strips
>   `Last-Event-ID` on reconnect.
>
> **Open: none.**

---

## `BUSINESS-RULES.md` — the cases, as rules

The document a human reviews for missed cases and the implementer turns into checks. Every rule
is one row: **when** a person or the system does something, **then** what happens, **proved by**
which kind of check. Grouped under headings that name the area, not the mechanism. The rows are
the cases the decisions do *not* already answer — the odd, the hostile, the boundary — plus the
happy path stated once. A figure sits beside a group when a fence or a grid carries it, with the
mermaid companion when the figure could be misread. Then the **failure taxonomy** in a paragraph
(what is fatal, what degrades, what retries) and the **acceptance criteria this issue owns**.

> # FIX-775 · Business rules
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> The cases, written as rules. Each says what a person or the system does and what happens. The
> *proved by* column is the check the plan runs. A human reviews this page; the plan turns it
> into work.
>
> ## Reconnecting
>
> | # | When | Then | Proved by |
> |---|---|---|---|
> | BR-1 | A client reconnects with a cursor mid-request | Items above the cursor are delivered; nothing below it is | CI · goal check on a real model |
> | BR-2 | A client reconnects with no cursor | Every item from 1, exactly as today | CI, byte-for-byte against a recorded stream |
> | BR-3 | A cursor is sent on both the header and the query param | The query param wins | CI |
> | BR-4 | A cursor is malformed, or names a different request | Ignored; the stream starts from 1. Not an error | CI |
> | BR-5 | A cursor is ahead of the stream | Nothing to send yet; the connection stays open | CI |
> | BR-6 | A reconnect arrives during an in-flight tool call | Normal: the item is emitted on completion, above the cursor | CI |
>
> ## What the client can rely on
>
> | # | When | Then | Proved by |
> |---|---|---|---|
> | BR-7 | Any stream is delivered, resumed or not | Sequence numbers are strictly increasing, with no duplicates and no reset. **Not contiguous**: replay legitimately omits non-replayable events | CI · asserted on the invariant, never on contiguity |
> | BR-8 | The same request is reattached twice | Both reattaches see the same items above their cursors | CI |
>
> ## After the request finished
>
> | # | When | Then | Proved by |
> |---|---|---|---|
> | BR-9 | A client reattaches to a finished request with a cursor | The tail from the persisted log, then a clean close | CI |
> | BR-10 | The cursor is past the end of the log | An empty replay and a clean close. Not an error | CI |
> | BR-11 | A client that was never attached asks for a finished request | Refused, as today. That is a history read | Existing suite |
>
> ![A dashed vertical line between the stream path and the store; the reattach path crosses at one gate, the never-attached path is stopped](figures/history-fence.svg)
>
> Left of the line is what the stream will serve. One path crosses, at the one gate; the
> never-attached read is stopped, which is BR-11. The mermaid below is the same two paths by name.
>
> ```mermaid
> flowchart LR
>   A["reattach with a cursor"] -->|"the one gate"| L["persisted log"]
>   N["never-attached read"] -.->|"refused · a history read"| L
> ```
>
> ## Failure taxonomy
>
> Every cursor problem is non-fatal and degrades to a full stream. The only fatal path is an
> unreadable request id, which already 404s today. Nothing retries.
>
> ## Acceptance criteria this issue owns
>
> [The goal](SPEC.md#the-goal-and-how-well-know-its-met): a client that drops mid-stream and
> reconnects assembles a transcript equal to the uninterrupted one, item for item, on a real
> model, and the same run fails under its control. The plan runs it last.

BR-7 is the one row that spells out a rule rather than a case, and only because getting it
backwards produces a confidently wrong test. The rest name **which** behaviours hold and let the
decisions say why — one contract, one place.

---

## `PLAN.md` — written for the implementing agent

Tables and one DAG. IDs everywhere, so a check can cite a surface and a surface can cite a rule.
No figures, no prose that restates the spec. Sections, in order:

1. **The header** — the discipline (`tdd` or `diagnose`), the PR count, and the seam if it is
   two PRs.
2. **Surfaces** — a table: ID · package · file or role · the change · the rules it serves. Name
   what is **removed** too (tenet 3). Roles over symbols where the symbol is the implementer's.
3. **Sequence** — one mermaid DAG over the surface IDs, and the seam. **A PR plan for a Large
   issue** is a table of sub-PRs with `depends_on`; the lifecycle reads it as executable routing,
   so a one-PR issue carries none.
4. **Checks** — a table: ID · runs after which surface · passes when. The goal check is the
   one `SPEC.md` → *The goal* names, cited by path rather than restated, and its control's FAIL
   is part of passing it. Or a stated "no goal check applies" with the reason. **One check per decision** at
   least, and the second path (BP-035) named.
5. **Pinned names** — the few names the spec fixes, each with why. Everything else is the
   implementer's.
6. **Guardrails** — a table: the rule · **because**. The focus practices that this change lives
   or dies by, each tied to a reason, never a re-list of the global BPs.
7. **Docs** — link `DOCS.md`; name when its drafts are reconciled and published, not a
   second prose draft or a list standing in for one.
8. **The sketch, if any** — pseudocode, roles not function names, illustrative. And the POC
   line: what was built, what it showed, including when the premise held.
9. **At implement time** — what to re-check against the repo before building: a sibling that
   may have landed, a rename in flight.
10. **Notes from review** — below-the-bar spec-PR feedback, verbatim, one line each with a
    thread link. Inputs, not instructions. Omit the section when there are none.
11. **Follow-ups** — filed or flagged, one line each.

> # FIX-775 · Plan
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)
>
> Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
> (BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. One PR.
>
> ## Surfaces
>
> | ID | Package · role | Change | Rules |
> |---|---|---|---|
> | S1 | `engine` · the HTTP route | Parse the cursor from `starting_after`, else `Last-Event-ID`; hand it down, decide nothing (D1) | BR-3 BR-4 |
> | S2 | `engine` · the stream seam, where items are already serialized | Drop items with `seq ≤ cursor` | BR-1 BR-5 BR-6 BR-7 |
> | S3 | `engine` · the completed-request path | Same loop over the persisted log, then close (D2). Never-attached stays refused | BR-9 BR-10 BR-11 |
> | S4 | `client` · the reattach path | Send the last seen sequence. No new public option | BR-1 BR-8 |
> | S5 | `client` · the dedupe helper | **Remove** it and its tests; it papers over the duplicates this change eliminates | — |
> | S6 | Docs | `apps/docs/docs/streaming/overview.md` EXTEND · `packages/engine/README.md` one line · one `minor` changeset for both packages | — |
>
> ## Sequence
>
> ```mermaid
> flowchart TD
>   S1["S1 · parse and thread the cursor"] --> S2["S2 · filter at the seam"]
>   S2 --> S3["S3 · the completed-request boundary"]
>   S3 --> S4["S4 · client sends it"]
>   S4 --> S5["S5 · remove the dedupe helper"]
>   S4 --> S6["S6 · docs"]
> ```
>
> ## Checks
>
> | ID | Runs after | Passes when |
> |---|---|---|
> | V1 | S1 | Each encoding parses; precedence holds (BR-3); a malformed value is ignored (BR-4) |
> | V2 | S2 | BR-1, BR-5, BR-6. BR-7 asserted on the invariant: increasing, no duplicates, **not** contiguous |
> | V3 | S3 | BR-9, BR-10; BR-11 unchanged |
> | V4 | S4 | BR-8. Reload mid-request end to end |
> | VG | S4 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met): `goals/resume-after-disconnect/reconnect-midstream/run.mts` PASSES on a real model, after the same run FAILED under `GOAL_CONTROL=ignore-cursor` |
> | V5 | S5 | The helper is gone and nothing imports it |
>
> ## Pinned names · the only two
>
> | Where | Name | Why pinned |
> |---|---|---|
> | Query param | `starting_after` | Public. A client types it |
> | Cursor format | `{requestId}:{sequence}` | Public. D1 locks it |
>
> Everything else is yours to name.
>
> ## Guardrails
>
> | Rule | Because |
> |---|---|
> | A client that sends no cursor behaves byte for byte as today (BP-030) | It is the common case for the whole first release, and D3 promises it |
> | Every case is exercised on a *reattach*, not only on a first connection (BP-035) | The reconnect is the second path, and a suite that covers only a clean first connection proves nothing here |
> | Every producer of a sequence number goes through the one allocator (tenet 5) | Two allocators and resume silently skips items |
> | The route decides nothing; it parses and hands down | Resume is a property of the seam, not a new subsystem beside it (tenet 2) |
>
> ## Docs
>
> Reconcile and publish [DOCS.md](DOCS.md) after the reconnect checks pass. Its destination
> operations own the changed prose; this plan only sequences publication. No new page.
>
> ## Sketch · pseudocode, illustrative, react to the shape
>
> ```
> at the stream seam, where items are already serialized:
>     for each item about to be written:
>         if cursor is set and item's sequence ≤ cursor:   ← the whole feature
>             skip it
>         otherwise write it
> at the route:      cursor ← query param, else header      (D1)
> completed request: same loop, reading the persisted log   (D2)
> ```
>
> **POC:** `poc/resume-seam/` inside this spec, cited from the spec PR. It showed the
> seam already sees every item with its sequence attached, so the filter is one predicate. The
> premise held; nothing changed.
>
> ## At implement time
>
> - The store's iterator may have gained a `from` option since this was written. If so, the
>   filter still sits at the seam (decided, not asked); use the option only if it is strictly
>   cheaper.
> - Compare [Evolution](EVOLUTION.md)'s predecessor claims with current architecture docs
>   and code; approved intent alone does not establish shipped behavior.
>
> ## Notes from review
>
> - "`resumeFrom` reads better than `cursor` for the parameter name." — bugbot ([thread](https://github.com/o/r/pull/1#discussion_3))
> - "Consider extracting the filter into its own module rather than inlining it at the seam." — codex ([thread](https://github.com/o/r/pull/1#discussion_4))
>
> These are inputs, not instructions. Adopt, adapt, or discard; you owe no justification for
> discarding one. A note that turns out to reveal a design problem is a spec blind spot —
> surface it and fold it back, per the challenger discipline in `issue-implement`.
>
> ## Follow-ups
>
> - The route layer now parses two cursor encodings for historical reasons. Out of scope;
>   `improve-codebase-architecture`.

**The plan is directional.** It fixes the shape and the sequence, not the finished design.
Signatures, local structure and line-level choices are the implementer's, settled in the code
with `tdd` / `diagnose` and the challenger. **Where the code contradicts the plan, that's
evidence the spec missed something** — surface it, never force-follow a plan the code says is
wrong, and never silently deviate.

**Prefer a diagram to code.** Architecture and data flow go in the spec's mermaid, not in
signatures and file trees. A snippet is allowed only when it pins something prose can't, and it is
labelled illustrative. **Real code belongs on the spec branch** as a POC
([`spec-poc`](../../.agents/skills/spec-poc/SKILL.md)), never in the document.

---

## `DOCS.md` — proposed documentation, not a plan

Apply the [canonical documentation contract](orchestration.md#spec-retention-and-authority).
For each operation, identify the destination and section, then write only the changed
reader-facing material. The following continues the fictional FIX-775 example; its
destinations and prose are illustrative, not a statement of current behavior.

> # FIX-775 · Documentation draft
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)
>
> ## UPDATE · `apps/docs/docs/streaming/overview.md` · after “Sequence numbers”
>
> ### Resuming after a disconnect
>
> Save the last item ID you received. To resume, reconnect to the same request with
> that ID in `starting_after` or `Last-Event-ID`. If both are present, `starting_after`
> wins. For example, after item `request-a:41`, send `Last-Event-ID: request-a:41`;
> the response starts with the next available item, not item 41.
>
> A malformed cursor or one from another request is ignored: the stream starts from
> the beginning. A cursor beyond the final item produces an empty replay. Sequence
> numbers increase but need not be contiguous, so a gap in numbering is not evidence
> that an item was lost.
>
> A client reconnecting after its request finished receives the remaining persisted
> items and then a clean close. This does not let a new client read an old response
> it was never attached to; use the store's history API for that.
>
> Existing callers that send no cursor keep their current behavior. When adopting
> resume, stop appending a replay from the beginning as new content: carry the cursor
> across reconnects instead. Reconnect timing and retry limits remain the app's policy.
>
> ## UPDATE · `packages/engine/README.md` · stream seam
>
> The stream seam resumes from a supplied item cursor without changing producers.
> See the streaming guide for cursor precedence and completed-request boundaries.
>
> ## Publication ownership
>
> FIX-775 publishes these changes after checking them against the real reconnect path;
> it does not duplicate the unchanged sequence-number introduction. If an epic owns the
> overview's shared introduction, reconcile with that draft before publishing.

For a change with no reader-facing impact, replace the operations with a specific
justification, for example: “No documentation impact: this changes only the internal
allocation of the existing cursor parser; syntax, precedence and failure behavior stay
unchanged.” “Docs later” is not a no-impact statement.

## `EVOLUTION.md` — conditional, precise design lineage

Use the [canonical lineage contract](orchestration.md#spec-retention-and-authority).
Do not create this file merely to list dependencies. The example below extends the
fictional FIX-775 story with two **invented predecessor designs**, not actual repository
artifacts. Link syntax is shown as code to avoid pretending the predecessors exist.
In a real set, use verified clickable links with precise anchors; when only historical
PR/Linear material exists, cite its real URL and section instead.

> # FIX-775 · Evolution
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**
>
> | Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
> |---|---|---|---|---|
> | FIX-701 D2: recover by replaying the whole response; source `../FIX-701/DECISIONS.md#d2` | **Amended**, only reconnect delivery; the original no-cursor path is retained | The resume-seam experiment (`poc/resume-seam/`) shows the seam already receives sequenced items | [D1](DECISIONS.md#d1), implemented by BR-1: client supplies the cursor, seam skips earlier items | No-cursor clients unchanged; cursor clients must persist the last delivered ID |
> | FIX-702 BR-4: a completed request cannot be reattached; source `../FIX-702/BUSINESS-RULES.md#br-4` | **Superseded in part** for previously attached clients; refusal for never-attached clients retained | Existing persisted items make tail replay possible; validate the completed-request boundary in PLAN V3 | [D2](DECISIONS.md#d2) | No history API is added; empty tails close normally |
>
> Neither predecessor is wholly superseded. The store-history issue is a dependency,
> not a replaced design. Before implementation, compare these intents against current
> `docs/architecture/streaming.md` and code; the experiment does not prove the full
> proposed reconnect contract has shipped.

When a predecessor has no retained file, replace the local-source cell with, for example,
the **actual** original spec PR's file/section permalink or its Linear document URL plus
decision ID. Record that provenance gap, not an invented `specs/` path. Keep predecessors
historical; no registry or mandatory backlink edits.

## Publishing and later amendments

The repository set is canonical. Link it and its review PR from Linear rather than
concatenating a second editable copy. Merge and subsequent amendments follow
[Merging and amending a spec](orchestration.md#merging-and-amending-a-spec).
