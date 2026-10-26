# Spec template — one directory, two documents, retained artifacts

A spec settles **direction**: the goal, what changes and for whom, the decisions that shape
it, and what it does to the code that's already there. It does not plan the build. It is a
directory, `specs/issues/<ISSUE-ID>/`, on branch `spec/<ISSUE-ID>`, holding:

| File | Reader | Reads it to | Budget (prose words, fences excluded) |
|---|---|---|---|
| **`SPEC.md`** | The product owner, then everyone | See the goal and how we'll know it's met, who feels the change, what it does to what's already here and the debt, and sign off | ~1,000 |
| **`DECISIONS.md`** | Whoever asks *why* — the owner on demand, the reviewer, the implementer when a decision bites | See what was considered, what was chosen, what lost, what each choice locks in, and the review notes left for the implementer | ~900 |
| **`figures/*.svg`** | Everyone | Look at the pictures where position is the content | — |

**The implementer plans the build.** There is no plan document, no list of rules, and no docs
draft. Implementation runs on Opus, reading the approved spec against the real code, and it
works out the order, the file-level changes, the tests, the edge cases, the docs prose and the
PR split itself ([`issue-implement`](../../.agents/skills/issue-implement/SKILL.md)). A plan
written before the code is read goes stale, and it pulls review down to an altitude the spec
can't settle. What the spec owes the implementer is a direction it can't misread: the goal, the
decisions, and the debt verdict it must not quietly break.

**Every document opens on the same nav line**, directly under its H1, with the current document
bold and unlinked:

```md
**Spec** · [Decisions](DECISIONS.md)
```

A reader may land on either document from a PR or Linear link. Authored `assets/` and
`poc/<experiment>/` stay beside `figures/` under this owner. The storage, authority and
lifecycle contract is
[`orchestration.md` → Spec retention and authority](orchestration.md#spec-retention-and-authority).

**The goal follows the problem, before any solution.** Right after the people table,
`SPEC.md` states the goal in one sentence, a check that it is the right goal, a figure of how
we'll know it's met, and the exact check that proves it, with a control that must fail. The PR
body carries the same block in the same place. A reader who stops there knows what done means
and how it will be proved. See [`SPEC.md` → The goal](#the-goal-and-how-well-know-its-met).

**The debt is stated, never implied.** `SPEC.md` names what already exists that the change
touches or overlaps, what it removes, what it adds that someone will later call debt, and the
net. Every package addition names the existing piece it considered
([`orchestration.md`](orchestration.md#compose-existing-pieces)). The net is a sign-off line. See
[`SPEC.md` → What's already here, and the debt](#whats-already-here-and-the-debt).

**The pictures carry the meaning; the prose reads them.** Both documents open on a table or
figure, and every figure has one sentence under it saying what to look at. What a figure is,
which each document carries, and how one is drawn and checked is canonical in
[`spec-figures.md`](spec-figures.md).

**Authored in one pass**, published as one spec PR opened ready for review, one approval gate
that signs off the whole set. See `issue-spec` Step 6.

**Approval means directionally correct** — the problem is real, the approach will work, the
decisions are the ones we want, and the debt verdict is honest. Not a finished design, and never
held open until nothing is left to nitpick. Below-the-bar feedback goes to
`DECISIONS.md → Notes from review` for the implementer. The bar, the dispositions, and the
two-round budget are canonical in [`orchestration.md`](orchestration.md) → "Spec review: the bar
and the convergence rule".

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

**Where the older documents went.** Specs retained before this shape carry five documents, and
sometimes a sixth. Leave them as they are. An implementer reads every document such a set
carries as input, and an open review PR in that shape is not re-drafted into this one.

| Was | Now |
|---|---|
| `PLAN.md` — surfaces, sequence, checks, the PR plan, the sketch, *at implement time* | The implementer's, worked out against the code. The goal check stays in `SPEC.md` |
| `PLAN.md` → guardrails, pinned names | A decision card's *Locks in*, or a line in `DECISIONS.md` → *Decided, not asked* — only the ones that hold the direction |
| `PLAN.md` → notes from review, the POC line, follow-ups | `DECISIONS.md` → *Notes from review* and *Settled*; follow-ups are filed issues named in the debt table |
| `BUSINESS-RULES.md` — the cases | A case a person sees is a row in the people table. The rest are the implementer's tests |
| `DOCS.md` — proposed prose | One *docs* line in `SPEC.md` → *What changes*. The prose is written at implementation, against what shipped |
| `EVOLUTION.md` — predecessor designs | `SPEC.md` → *What's already here*, one row per prior decision the change keeps, amends or supersedes |

**How to read the rest of this file.** Every document below is its instruction followed by a
worked example. The examples are the same issue — FIX-775, resuming an SSE stream after a
disconnect — so the template reads end to end as a spec set.

**Copy the shape, not the content.** FIX-775 is a fiction, reconstructed after the fact: resume
already ships in some form (`docs/architecture/streaming.md` → "Resume Semantics"). The API
shapes in the diff are real, because a surface that doesn't compile teaches the wrong thing; the
outcomes are *what the spec proposes*, not what the code does today — which is true of every
spec, since a spec describes behaviour that isn't built yet. Don't verify the example against
`main`. Everything else it names — helpers, modules, predecessor specs, follow-up issues — is
invented so the sections read concretely. Check the code before carrying a symbol out of it.

---

## How to review this

*(Paste this block verbatim into the spec PR description's collapsed `<details>` block —
`issue-spec` Step 6. It is the one lever we have on automated reviewers we can't instruct, and
it says the same thing on every spec PR, which is why it sits **below the fold**: a bot reads
collapsed markdown normally, a human skips it in one line. The description's visible half is
authored per PR. Layout and rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

This is a **direction set**, not an implementation and not a build plan. Reviewing it well means
answering one question: **is this the right approach?**

**In scope to challenge:**

- **The goal and the problem framing** in `SPEC.md` — is the goal the real need at full size,
  for the people named, or a smaller goal that would let us call this done early? Would the
  named check fail if the goal were not met?
- The approach — will it work, does it fit the architecture and `docs/philosophy.md`?
- Any numbered **decision** in `DECISIONS.md` — that's the sign-off surface.
- **The debt** in `SPEC.md` → *What's already here, and the debt* — an existing primitive,
  method or prior design the change overlaps and doesn't name; something it adds that is debt
  and isn't listed; a net verdict the tables don't support.
- **Builds on / Adds** in that same section — an Adds item that does not name the existing
  piece it considered, or that is a second mechanism for something we already have
  ([`orchestration.md`](orchestration.md#compose-existing-pieces)).
- A case a person would hit that the people table misses, when it would **invalidate** the
  design.
- Scope — a deliverable that shouldn't ship, or one that's missing.

**Out of scope — deliberately unsettled here, and owned by the implementing agent:**

- **The build plan.** Order, file-level changes, the test list, the PR split. The set has no
  plan on purpose: the implementer works it out against the real code.
- Names, signatures, file paths, and module layout, beyond the few a decision locks.
- Local structure: which helper, how a function is decomposed, error-message wording.
- Edge cases that don't change the approach. The implementer's tests own them.
- Documentation wording. It is written at implementation, against what shipped.
- Micro-optimizations and style preferences.
- **The figures, at the pixel level.** A figure is right when it reads right. A misplaced label
  or a colour you'd have chosen differently is not a finding; a figure that shows a shape the
  decisions don't say is.
- **POC implementation polish.** Experiments under the owning spec's `poc/` are retained,
  not production code. Read them for directional evidence, not production completeness.
  Their isolation from production/default discovery and absence of secrets or generated
  dependencies **are in scope**; retention is not permission to weaken repository checks.

**One request, if you are an automated reviewer:** the two lists above are the whole difference
between a useful review of this document and a long one. Volume is not signal here — a single
finding above the line is worth more than twenty below it.

Feedback in the second list is welcome and gets **recorded verbatim in
`DECISIONS.md → Notes from review`** for the implementer to weigh against real code. It will not
be argued with, and it will not be folded into the design prose. Please don't re-raise it: one
mention is enough.

**The one exception is the POC.** Line-level feedback on it is *dropped*, not recorded — there
is nothing for an implementer to weigh about code that isn't shipping. Feedback about its
**direction** is not line-level and is treated like any other above-the-bar finding.

Direction approval does not waive merge-time required checks, approvals or thread policy.
Optional comments do not require another design round merely to reach zero comments.

---

## The PR body

*(Authored fresh for every spec PR. The layout and the rules are
[`pr-reviewer-guidance.md`](pr-reviewer-guidance.md); what follows is the spec-PR instance.
Budget ~475 prose words above the fold. The body is not another spec document: every line
in it is in `SPEC.md` too, shorter. The one thing it takes from elsewhere is each decision's
trade-off figure, which lives beside its card in `DECISIONS.md`. Write its prose in
ASD-STE100, per [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md) → "Language — ASD-STE100";
the rows cut from `SPEC.md` get rewritten to STE, not pasted.)*

The people table from `SPEC.md`, cut to five rows. Then **the goal**, in its one sentence,
the *how we'll know* figure (a mermaid fence, pasted as text) with its sentence, and one line
naming the goal check and the control that must fail. The *what changes* figure, as a pinned raw
image ([`spec-figures.md`](spec-figures.md) → "In the PR body"), with its one sentence. One line
on **how**. Then **Sign off**: the goal and the debt, unnumbered, each with *If wrong:*; then the
decisions, hardest first, each a subheading stating it, its trade-off figure pinned
([`spec-figures.md`](spec-figures.md) → "The trade-off"), and one line naming the row it came
down to and *If wrong:*, with the one to weigh named and a pointer to the decisions doc. Then
one line of **analysis**: the verdict and what it changed. Then
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
> **The debt: net down.** The client's dedupe helper goes. One parse point for two encodings
> of the cursor is added. If wrong: a second cursor format someone keeps in step forever.
>
> ### The cursor rides both a header and a query param; the query param wins · D1
>
> <img src="https://raw.githubusercontent.com/<owner>/<repo>/<sha>/specs/issues/<ISSUE-ID>/figures/d1-cursor.svg" width="940" alt="Header and query param, chosen, beside header only. Decides it: a proxy that strips the header. Price: two entry points. Locks in a public format in two places; flips if no proxy strips the header" />
>
> It comes down to a proxy that strips the header: header-only stops resuming, with no error.
> **If wrong:** a public string format we don't validate, locked in, with two entry points to
> keep in step.
>
> ### A reconnect to a finished request replays the tail and closes · D2
>
> <img src="https://raw.githubusercontent.com/<owner>/<repo>/<sha>/specs/issues/<ISSUE-ID>/figures/d2-finished.svg" width="940" alt="Replay the tail and close, chosen, beside a distinct already-finished status. Decides it: what every client has to write. Price: the log stays complete for the request's life" />
>
> It comes down to client code: a distinct status is a branch in every client. **If wrong:**
> the stream quietly becomes a history API, which the store is supposed to be.
>
> ### No cursor means today, byte for byte · D3
>
> <img src="https://raw.githubusercontent.com/<owner>/<repo>/<sha>/specs/issues/<ISSUE-ID>/figures/d3-no-cursor.svg" width="940" alt="Today's behaviour without a cursor, chosen, beside resume from last-seen on the server. Decides it: per-client state the server must expire. Price: resume is opt-in, forever" />
>
> It comes down to server state: resuming by default means remembering every client.
> **If wrong:** the server holds per-client state, and something has to expire it.
>
> **Open: none.** D1 is the one to weigh. Reasoning and what lost:
> [DECISIONS.md](DECISIONS.md).
>
> **Analysis:** right approach. Nothing changed. [DECISIONS.md → Analysis](DECISIONS.md#analysis).
>
> ## Reviewers · look here
>
> - **Decisions → D1.** Is one encoding plus a documented proxy requirement better than two
>   encodings that must stay in step?
> - **Spec → what's already here.** Removing the client's dedupe helper: does anything outside
>   the UI rely on it hiding duplicates?
> - **Decisions → decided, not asked.** The filter sits at the serialization seam, not in the
>   store's iterator. A wrong answer is a rewrite, not an adjustment.
>
> **Not here:** client reconnect *policy* (backoff, retry limits) — a named non-goal.
>
> [Spec](SPEC.md) · [Decisions](DECISIONS.md) · Linear FIX-775 · no epic · amends FIX-701 D2
> · merges after human approval and required checks
>
> <details>
> <summary><b>How to review this</b> — altitude, what's in scope, what's deliberately unsettled</summary>
>
> *(the block above, verbatim)*
>
> </details>
> ```

The sign-off is the compact form of [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md) → §3;
a live fork is never compact and takes the full shape from
[`asking-for-decisions.md`](asking-for-decisions.md).

---

## `SPEC.md` — what changes, for whom, and what it costs the code

The document the product owner reads. It answers *who feels this, what do they see before and
after, what happens to what we already have, and what am I signing*, in observable behaviour with
as few file paths as the debt section allows. Sections, in order:

1. **People, before and after** — a table: someone who… · today · after. Three to six rows.
   Each row is a person doing one thing and what they see. This table is the spec's problem
   statement and its solution statement at once, and the PR body cuts it to five rows. A case
   that changes what a person sees — a stale input, a finished request, a missing option — is a
   row here, not a rule elsewhere. It comes first: nothing sits between the nav line and it.
2. **The goal, and how we'll know it's met** — the section below this list says what it owes.
   It sits right after the problem because every section after it is judged against it.
3. **What changes** — the one figure, with its sentence. Then any surface a person edits, **as
   a diff**: a config file, a worker file, a call site. The diff is the highest-density form we
   have for a file-shaped surface, and it is what a person will actually type. Then **one docs
   line**: the reader-facing pages that change (create, update or remove, by destination), or
   *no documentation impact* with the reason. "Docs later" is not a reason.
4. **Optionally, one more figure** where a quantity carries the argument — what a turn costs,
   what a request carries — and **one mermaid** for the mechanism as a path through layers.
5. **What stays as it is** — the neighbours a reader would otherwise assume changed.
6. **What's already here, and the debt** — the section below this list says what it owes.
7. **Sign off** — here, one-liners with no figures; the trade-offs stay beside their cards, and
   only the PR body pins them (see "The PR body"). **The goal first**, unnumbered, with its *If
   wrong:*: approval certifies the goal's size as much as the approach. **The debt second**,
   unnumbered: the net verdict, what it adds and removes in a clause, and *If wrong:*. Then the
   numbered decisions as one-liners linking to their cards, each with *If wrong:*, and the one to
   weigh named. **Open: none**, or the live forks named.
8. **The facts line** — kind · packages · size · epic. Last, for the reason a PR body's links
   line is last: a reader wants it only after deciding to go deeper, and above the problem it is
   a label they must read past ([`writing-for-humans.md`](writing-for-humans.md) → "The rule").

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
     PR's goal verdict). If it needs a real browser, say so: the implementer tries it first,
     and hands it to `fsd-qa` over the mailbox only if it can't
     ([`agent-mailbox`](../../.agents/skills/agent-mailbox/SKILL.md) → "Hand a browser check to `fsd-qa`").
   - **Signal** — the observable pass condition, with its threshold.
   - **Input** — the fixture, and what a different valid input would look like; a correct
     implementation must pass on it too.
   - **Anti-game** — what a hollow pass would look like, and therefore what the check must not
     assert on.
   - **Control that must fail** — a named `GOAL_CONTROL`, or today's `main` when the feature is
     absent there, and the signal it must fail, by name — not only its leg, which goes red on
     any of its assertions. The implementation PR shows this FAIL before the PASS counts. A
     check nobody has seen fail has verified nothing (BP-003).

**When no goal check applies** (a pure refactor, docs only), the goal and *is it the right
goal?* still apply. Replace the figure and table with one line on what proves the goal instead,
and why no goal check fits, with the same *control that must fail* where one exists. "No goal
check" is a statement with a reason, never a blank.

### What's already here, and the debt

The section that lets a reader trust the change doesn't quietly make the codebase worse. It
has four parts, in order. The compose-existing-pieces rule those parts enforce is
[`orchestration.md`](orchestration.md#compose-existing-pieces) — do not restate it here.

1. **What's already here** — a table: already here · what this does with it. One row for every
   existing primitive, method, pattern or prior design the change touches or overlaps, and the
   treatment: **builds on** · **extends** · **replaces** · **removes** · **leaves alone**. Two
   kinds of row are owed even when they are uncomfortable:
   - **Whatever already does this job** — the list `issue-spec` Step 3.5's question 7 produces,
     across packages, with the closest entry named. "None" is a claim like any other (BP-003):
     the row carries the searches that found nothing.
   - **Prior designs** — a retained spec decision the change **keeps**, **amends** or
     **supersedes in part or whole**, cited by its exact anchor, with what replaces it and what
     changes for callers. Several predecessors is normal; a dependency is not a supersession,
     and changing one decision does not supersede a whole spec. When the design has no
     retained file, cite its real PR or Linear source; never invent a local path.
2. **Builds on / Adds** — a table, one row per item this spec adds to a package (a hook, a
   cap, a marker, a record, a path, a public method): **Adds** · **Existing piece considered** ·
   **Why that doesn't fit, or how this is composed from it**. The Adds list is as short as
   possible. An empty table is allowed when the spec only removes or extends; "none" still
   carries the searches. A dedicated [`reuse-review`](../../.agents/skills/reuse-review/SKILL.md)
   checks each row against the code.
3. **The debt** — a table with three rows, each a list:
   - **Removes** — what goes: code, a helper, a second way of doing the job, a special case
     (tenet 3). A spec that removes nothing says so.
   - **Adds** — everything a later reader would call debt: a second way to do a job, a
     compatibility shim or a branch kept for old callers, a special case, a workaround for
     something upstream, a cleanup deferred. Each with why it is accepted now, and — unless it
     is permanent by design — the filed issue that pays it. A shim with no issue has no owner
     once the spec merges. **A second way of doing an existing thing counts here**, even when
     the Builds on / Adds row argues it is composed — the debt line is where the count lives.
   - **Leaves** — debt already in the area that this change doesn't pay, with its issue when
     one exists. Naming it is how a reviewer knows it was seen rather than missed.
4. **Net** — one line: **down**, **flat** or **up**, and the reason in a clause. This is the
   debt line on the sign-off. *Up* is allowed; it is never quiet. Any second way of doing an
   existing thing weights the net toward **up** unless a matching Remove pays it.

> # FIX-775 · Resume a stream after a disconnect
>
> **Spec** · [Decisions](DECISIONS.md)
>
> ## Five people, before and after
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
> | **Control that must fail** | `GOAL_CONTROL=ignore-cursor`, and today's `main`. Both must FAIL on *zero duplicate items*, and the PR shows it before the PASS |
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
> **Docs:** update the streaming overview with a *Resuming after a disconnect* section (the
> cursor, its precedence, the finished-request boundary), and add one line to the engine
> README. No new page.
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
> store's iterator is under [decided, not asked](DECISIONS.md#decided-not-asked).
>
> ## What stays as it is
>
> - The execution engine, every block kind, the item taxonomy. Sequence numbers already exist
>   (`docs/architecture/streaming.md`); this reads them.
> - Client reconnect *policy*: backoff and retry limits are the app's.
> - Serving a finished response to a client that was never attached. That is a history read,
>   and it stays the store's job.
>
> ## What's already here, and the debt
>
> | Already here | What this does with it |
> |---|---|
> | Sequence numbers on every item | **Builds on.** Resume reads them; nothing new is numbered |
> | The stream seam, where items are serialized | **Extends.** The one place the cursor is applied |
> | The client's dedupe helper | **Removes.** It hides the duplicates this change stops sending |
> | Anything else that delivers missed items | **None for a live stream.** Searched `resume`, `replay`, `since`, `after` across `packages/`. The store's history read serves finished requests to new readers and stays that way |
> | FIX-701 D2: recover by replaying the whole response | **Amended**, reconnect delivery only, by [D1](DECISIONS.md#d1). Its no-cursor path is kept ([D3](DECISIONS.md#d3)). Cursor clients must persist the last item ID |
> | FIX-702's rule that a finished request can't be reattached | **Superseded in part** by [D2](DECISIONS.md#d2), for clients that were attached. Never-attached clients are still refused |
>
> | Adds | Existing piece considered | Why it doesn't fit / how composed |
> |---|---|---|
> | Two encodings of one cursor (header + query param) | Sequence numbers; the stream seam | Composed: resume reads existing sequence numbers at the existing seam. The second encoding is one cursor, two transports ([D1](DECISIONS.md#d1)), not a second resume |
>
> | The debt | |
> |---|---|
> | **Removes** | The client's dedupe helper and its tests |
> | **Adds** | Two encodings of one cursor, a header and a query param, parsed at one point ([D1](DECISIONS.md#d1)). Permanent by design: header-only breaks silently behind a proxy |
> | **Leaves** | The route layer already parses two older cursor formats. Not touched here; FIX-781 |
>
> **Net: down.** One helper and its tests go; one parse point is added.
>
> ## Sign off
>
> **[The goal](#the-goal-and-how-well-know-its-met), at that size:** nothing repeated and nothing
> missing, measured on what the client assembled. If wrong: we ship a resume the user can't
> feel, or hold the issue open for heartbeats it was never meant to deliver.
>
> **[The debt](#whats-already-here-and-the-debt), net down:** the dedupe helper goes, one parse
> point is added. If wrong: a second cursor format someone keeps in step forever.
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
> each locks in is in [DECISIONS.md](DECISIONS.md).
>
> Feature · `engine` + `client` · medium · no epic

**Size is a count, not an adjective.** The facts line's *medium* is read off *what changes* and
the debt table — packages touched, public surfaces changed, things removed — and written last.
A label written before those are finished is a guess.

---

## `DECISIONS.md` — what was considered, what was chosen, what it locks in

The document for whoever asks *why*, and the implementer's second stop. It opens on the tree,
then carries one card per decision, then everything decided without being asked, then what was
considered and dropped, then what is open or settled, then how the document got here, then the
review notes left for the implementer. Sections, in order:

1. **The tree** — one mermaid: the issue, its decisions as solid edges, what each rejected as a
   dashed edge with the reason on the label. Solid edges are what the reader is signing.
2. **One card per decision**, anchored `<a name="dN"></a>` so `SPEC.md` can link to it. A table
   with three rows — **Instead of** · **Because** · **Locks in** — then its **trade-off figure**,
   `figures/dN-<slug>.svg`, with the sentence naming the row it came down to
   ([`spec-figures.md`](spec-figures.md) → "The trade-off"), unless the filters sent the card to
   the engineering block. The PR body pins the same file under the decision's sign-off heading.
   A second figure only when the decision's mechanism is itself positional (a layer boundary, a
   grid of moments). **At most three decisions**, only the calls that shape the outcome; each is
   a business decision or it does not belong here (the filters in
   [`asking-for-decisions.md`](asking-for-decisions.md) → "What reaches them at all").
   **Write *Locks in* as a consequence**: what we can no longer change cheaply, who is affected,
   when the bill arrives — never which code would have to move. A public name the decision
   fixes is named here; every other name is the implementer's.
3. **Decided, not asked** — calls that were obvious, or the implementer's but load-bearing for
   the direction, recorded in a line each so nobody re-derives them. When the change introduces
   or tightens an invariant — a cap, a guard, a uniqueness rule — its **convergence point** goes
   here, with every writer that must pass through it, legacy helpers included (tenet 5). A
   restatement of what the solution does is not one.
4. **Considered and dropped** — the alternatives that lost, one row each with why. The simpler
   approach considered belongs here even when it lost.
5. **Open / settled** — a live fork gets the full six-part ask; a claim a POC settled gets the
   verdict and the evidence link, so the next reviewer can't reopen it blind, **including when
   the premise held**; a claim still in flight is marked `(POC in flight)`. Omit the section
   when there is nothing in it and say **Open: none** at the bottom instead.
6. **Analysis** — what the [`analysis`](../../.agents/skills/analysis/SKILL.md) pass
   found before the spec went to review: the date, the watermark it read new factors from,
   the verdict, one line per objective (the reuse line links *Builds on / Adds*, whose
   verdicts it reads), and each finding's disposition (folded · recorded · open). Always present, including when the verdict is "right approach"; the next analysis
   reads its date. See [`orchestration.md`](orchestration.md#analysis-and-review).
7. **How it got here** — one line per meaningful turn, newest last: draft, each review round
   that moved a decision, each settlement. A round that changed only prose earns no line.
8. **Notes from review** — below-the-bar spec-PR feedback, verbatim, one line each with a
   thread link. Inputs for the implementer, not instructions. Omit the section when there are
   none.

> # FIX-775 · Decisions
>
> [Spec](SPEC.md) · **Decisions**
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
> | **Locks in** | The format and the name `starting_after` are load-bearing for any client, ours or not, and both entry points have to stay in step. Changing either later is a breaking change to a string we don't validate |
>
> ![Where a reconnecting client puts its resume cursor: header and query param, chosen, beside header only. Decides it: a proxy that strips the header. Price: two entry points. A browser client is a tie](figures/d1-cursor.svg)
>
> It comes down to a proxy that strips the header: header-only stops resuming, with no error.
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
> ![What a reattach to a finished request gets: replay the tail and close, chosen, beside a distinct already-finished status. Decides it: what every client has to write. Price: the log stays complete for the request's life](figures/d2-finished.svg)
>
> It comes down to client code: a distinct status is a branch in every client, forever.
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
> ![What happens without a cursor: today's behaviour, chosen, beside resume from last-seen on the server. Decides it: per-client state the server must expire. Price: resume is opt-in, forever](figures/d3-no-cursor.svg)
>
> It comes down to server state: resuming by default means remembering every client.
>
> ## Decided, not asked
>
> - **The filter sits at the serialization seam**, not in the store's iterator. Nothing upstream
>   learns resume exists, and the finished-request path reuses the same loop over the persisted
>   log.
> - **Every producer of a sequence number goes through the one allocator.** It is the
>   convergence point for "increasing, no duplicates"; two allocators and resume silently skips
>   items. Delivered numbers are increasing but **not contiguous**: replay legitimately omits
>   non-replayable events.
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
> - **The seam sees every item with its sequence attached** — **CONFIRMED** by
>   `poc/resume-seam/`: the filter is one predicate. The premise held; nothing changed.
>
> ## Analysis
>
> 2026-08-14 · watermark 2026-08-02 (issue filed) · **Right approach.**
>
> 1. **Reuse** — `reuse-review`: both *Adds* rows extend existing pieces (the persisted item
>    log, the sequence allocator); none is new. See
>    [Builds on / Adds](SPEC.md#whats-already-here-and-the-debt).
> 2. **Prior art** — the SSE spec's own reconnection model resumes by event id with no
>    per-client state on the server, and so do the two event-streaming libraries checked
>    (links in the analysis return). Confirms D3.
> 3. **Other shapes** — client-side dedupe; weaker, recorded in *Considered and dropped*.
> 4. **New factors** — 6 issues since the watermark; none touches the stream path.
> 5. **Necessity** — earns its place: the duplicates are billed tokens, not a cosmetic issue.
> 6. **Ergonomics** — nothing new to learn: a reconnecting client resumes with no extra code,
>    and the optional query param uses the name the SSE spec already teaches.
> 7. **Concerns** — none. Recorded, nothing folded.
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
> ## Notes from review
>
> - "`resumeFrom` reads better than `cursor` for the parameter name." — bugbot ([thread](https://github.com/o/r/pull/1#discussion_3))
> - "Consider extracting the filter into its own module rather than inlining it at the seam." — codex ([thread](https://github.com/o/r/pull/1#discussion_4))
>
> These are inputs, not instructions. Adopt, adapt, or discard; you owe no justification for
> discarding one. A note that turns out to reveal a design problem is a spec blind spot —
> surface it and fold it back, per the challenger discipline in `issue-implement`.
>
> **Open: none.**

---

## What the implementer brings

The spec stops at direction, so the implementer owns everything below it and is trusted with it.
**Where the code contradicts the spec, that's evidence the spec missed something** — surface it,
never force-follow a direction the code says is wrong, and never silently deviate. A change that
would alter a decision card, the goal, or the debt verdict is a direction change: it goes back
through an amendment, not into the code.

**Prefer a diagram to code in the spec.** Architecture and data flow go in mermaid, not in
signatures and file trees. **Real code belongs on the spec branch** as a POC
([`spec-poc`](../../.agents/skills/spec-poc/SKILL.md)), never in a document.

## Publishing and later amendments

The repository set is canonical. Link it and its review PR from Linear rather than
concatenating a second editable copy. Merge and subsequent amendments follow
[Merging and amending a spec](orchestration.md#merging-and-amending-a-spec).
