# Project-spec template — the standing artifact for one Linear project

A **project-spec** is the coordination artifact for a *Linear project* — the container an epic
belongs to. It sits one altitude above [`epic-spec-template.md`](epic-spec-template.md) and obeys
the same law: it is **not** an implementing spec, and the epics under it do **not** derive from it.
They *reference and align* to it, and each still runs its own `epic-lifecycle` and its own gate.

Where it lives and how it is driven is canonical in [`orchestration.md`](orchestration.md) → "The
project-spec". The short version:

| | |
|---|---|
| **The project** | A **Linear project**. An epic's project is its epic issue's `project` — native, no registry |
| **Where** | `spec/_projects/<slug>/` on branch `project/<slug>`, mirrored to the Linear project's **`content`** |
| **The PR** | Never merged, never deleted. Open for the life of the project |
| **Author** | `project-agent`, one bounded update per dispatch. It **never starts over** — the set is the state |
| **The gate** | **None.** The epic objective gate is the only gate. A change to the project outcome is an ask, surfaced by whichever epic-lifecycle is running |
| **Refreshed** | On **epic-level** transitions only — an epic is created, approved, or wraps. Never on issue churn |

**There is no project-lifecycle, and that is deliberate.** Nothing drives a project the way
`epic-lifecycle` drives an epic. Projects outlive sessions, run for months, and hold epics that
start and finish years apart. What they need is not a loop but a **surface that is true whenever
you look at it** — so the artifact is maintained by whichever epic is running, and is correct in
between because its status is *derived*, never accumulated (see "Why a dropped refresh is safe").

**Not every project gets one.** There are dozens of Linear projects and most are dormant. A
project-spec is stood up the first time an epic runs under its project, and then lives for as long
as the project does.

## The four documents, at project altitude

Projects keep the original four-document shape below; the issue/epic template's added
`DOCS.md` and conditional `EVOLUTION.md` do not migrate this standing project artifact.
Budgets are **smaller than an epic's**, not larger — a project-spec that out-weighs the epic
it is supposed to orient has lost its altitude.

| File | At epic altitude | At project altitude | Budget |
|---|---|---|---|
| `SPEC.md` | The objective for the teams who feel it · the box · the set · the dependency graph | **The outcome** the project is driving at and how we'd know · **the territory** as one figure · **the epics, with live status** · **what this project is not** | ~700 |
| `DECISIONS.md` | Cross-cutting calls across issues · ownership matrix | Calls that bind **more than one epic** · what was **decided once** so no epic reopens it | ~900 |
| `BUSINESS-RULES.md` | ER-n: rules every issue obeys | **PR-n: rules every epic obeys**, with owner and where each is checked · what no epic may do | ~600 |
| `PLAN.md` | The path: issues against time | **The arc**: epics against time · what each epic consumes and releases · what is deliberately not next | ~700 |
| `figures/` | Three the PR body carries | **Two** the PR body carries: the territory, and the arc once there are two epics. A third — the rule × epic matrix — only once `BUSINESS-RULES.md` carries three or more rules | — |

**Project navigation keeps its four-document line.** Line 3 of every project document is
`[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)` with
the current one bold and unlinked.

### Why `BUSINESS-RULES.md` is not optional here

The rules that bind several epics are the thing that has had no home. W3's seven inherited shape
rules — which every file-convention epic obeys — survived only inside one issue's spec §7, a rule
set living inside a document it governs, where a sibling epic could not find it and a correction to
two of the rules ended up as a comment on a Linear issue. That is what a missing altitude looks
like. If a rule binds one epic it is that epic's; if it binds two it is the project's.

### The bootstrap shape — what the first stand-up actually contains

A project-spec is stood up when the *first* epic runs under it, so the common first case is **one
epic and no cross-epic anything**. Writing four full documents then would be mostly scaffolding,
and scaffolding is what teaches people the artifact is busywork.

So the first stand-up is deliberately thin, and the documents earn their content:

| Document | At one epic | Earns its content when |
|---|---|---|
| `SPEC.md` | **Full** — the outcome, the territory, the epics table. This is the whole value on day one | — |
| `DECISIONS.md` | The heading and *decided once*, empty | The first call binds a **second** epic |
| `BUSINESS-RULES.md` | The heading, empty | A rule binds two epics — which is the trigger, not a count of rules |
| `PLAN.md` | The arc with one lane, and *what is deliberately not next* | A second epic gives the arc an order to show |
| `figures/` | The territory only | The arc becomes a figure at two epics; the matrix at three rules |

**An empty section with its heading in place is correct, not unfinished.** It says the question was
asked and the answer is currently *none* — which is what stops the next epic from inventing a
private answer. A document that is missing says nothing at all.

The one thing never deferred is `SPEC.md`'s outcome. A project whose outcome is written down only
once it has two epics has already made the decision that needed writing down.

### What does *not* go in

- **Anything one epic owns.** Its objective, its issue division, its internals. That is its
  epic-spec, and duplicating it here creates the second surface that goes stale.
- **Repo-wide grounding.** `docs/philosophy.md`, the best practices, `orchestration.md` bind every
  project; restating them here is the drift this file exists to prevent. Link, never copy.
- **Per-issue status.** The epics table carries epics. An issue's state is its epic PR's job.

## `SPEC.md` — the outcome, the territory, the epics

Opens with **the outcome**: what is true when this project is done, and the read that tells you
whether you are getting there. Borrow the four-part shape `docs/objectives.md` uses at repo
altitude — *winning when · the read · now · kill line* — because a project with no finish line
cannot be finished and an epic cannot be tested against it.

Then **the territory** as one figure, then **the epics** as a live table, then **what this project
is not**.

> ```md
> # Streaming — a dropped connection is a non-event
>
> **Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)
>
> ## The outcome
>
> | | |
> |---|---|
> | **Winning when** | An app ships to phones without writing one line of reconnect defence, and a dropped connection produces no visible event |
> | **The read** | Apps in the corpus carrying hand-written duplicate defence. Four today, zero is done |
> | **Now** | 2 epics done · 1 in flight · 1 not started. Resume and heartbeats landed; policy defaults open |
> | **Kill line** | If apps turn out to *want* to own reconnect, this project is mis-shaped — what changes is the default, not the remaining epics |
>
> <img src="…/<sha>/spec/_projects/<slug>/figures/territory.svg" width="940" alt="The territory: resume, heartbeats and backoff inside the project; offline queueing and durable history outside it" />
>
> Inside the line is what an app gets for nothing. Outside it is a store, and this project never
> becomes one.
>
> ## The epics — as of 2026-09-17
>
> | Epic | Outcome it owns | State | Surface |
> |---|---|---|---|
> | [FIX-770](…) · resume | A reconnect replays, exactly once | **done** | [PR #1120](…) |
> | [FIX-812](…) · heartbeats | A dead connection is noticed | **in flight** | [PR #1244](…) |
> | FIX-XXX · policy defaults | One line overrides the default | *not filed* | — |
>
> 2 done · 1 in flight · 1 not filed. Epics are filed as the project reaches them; an unfiled one
> is a `FIX-XXX · working title` placeholder that keeps its title when the real id arrives.
>
> ```mermaid
> flowchart LR
>   R["FIX-770 · resume"] --> H["FIX-812 · heartbeats"]
>   H --> P["FIX-XXX · policy defaults"]
> ```
>
> Heartbeats needs resume's replay path. Policy defaults needs both, and is the one that could be cut.
>
> ## What this project is not
>
> - **Not an offline queue.** A stream that buffers while disconnected is a store with a worse API.
> - **Not a transport abstraction.** SSE is the Phase 1 transport and this project assumes it.
> ```

**Status lives here, once.** The epics table is the single live read; `PLAN.md` and the figures
point at it rather than repeating it. The dependency graph sits beside it as mermaid because it is
edited most — a project usually *causes* its later epics to be filed, so unfiled epics are dashed
placeholders ([`spec-figures.md`](spec-figures.md) → "The placeholder convention").

## `DECISIONS.md` — the calls that bind more than one epic

Same card shape as every altitude, numbered `PD-n`. The filter is the whole discipline: **a call
belongs here only if a second epic would otherwise have to make it again.** One-epic calls go in
that epic's `DECISIONS.md`, and a project-spec that absorbs them becomes a design nobody signed off.

Each card: the call, what it rejected, what it costs, and **which epics it binds**. Then **decided
once** — the running list of questions answered at project altitude, so a later epic reads the
answer instead of re-litigating it. This is the section that pays for the artifact.

> ```md
> ### PD-2 · The client is the only reconnect actor
>
> **Binds** FIX-770, FIX-812, and every later epic that touches the stream.
>
> The server never re-pushes on its own initiative. Rejected: server-side replay on silence,
> which is invisible to the client's sequence number and double-delivers under partition.
>
> **Costs** a server that notices a dead client can do nothing but drop it. Accepted — the
> alternative is two actors with one sequence space.
> ```

## `BUSINESS-RULES.md` — what every epic obeys

`PR-n`, one line each, in *when → then → checked where* form, each with exactly **one owner epic**.
An owner is the epic that implements and proves the rule; the others inherit it. A rule with two
owners is a seam; a rule with none is a wish.

Then **what no epic may do** — the short prohibition list, which is what a new epic's objective
gate is checked against.

> ```md
> | | Rule | Owner | Checked where |
> |---|---|---|---|
> | **PR-1** | When a client reconnects with a sequence number, then delivery resumes from it exactly once | FIX-770 | `goal:stream-resume` |
> | **PR-2** | When a connection is silent past one heartbeat, then the client — never the server — reconnects | FIX-812 | `goal:stream-heartbeat` |
>
> **No epic may** add a public config option to the stream surface, or persist an item past the
> session that produced it.
> ```

## `PLAN.md` — the arc

Sequencing at project altitude: **what order the epics run in, what each hands the next, and what
is deliberately not next.** No checks column — each epic's plan owns those. Its one figure is
**the arc**: a lane per epic against time, done and in-flight bars, a now line. It is redrawn
every refresh and it is the picture a person arriving cold wants first.

Also carries **what is deliberately not next**, one line each. A project that lists only what is
coming reads as if everything is coming.

## The PR body

*(Authored when the project PR opens; the as-of line and the figure pins refresh for the life of
the project, the rest when the outcome materially changes. Budget ~350 prose words above the fold
— **less than an epic's**. Rules: [`pr-reviewer-guidance.md`](pr-reviewer-guidance.md).)*

The outcome table from `SPEC.md`. **The territory**, pinned, with its sentence. **The arc**,
pinned, with its sentence — this is what a reader arriving mid-project wants first. **The epics**
in one line each with the as-of counts and a link to the live table. Then **Reviewers · look here**
at project altitude, the links line, and the collapsed contract.

**There is no *Sign off* block**, because there is no project gate. Where a live question needs a
human, it goes in the body as an ask in full six-part form
([`asking-for-decisions.md`](asking-for-decisions.md)) and the epic-lifecycle running at the time
carries it to them.

**The image line is raw HTML.** Write it exactly as
[`spec-figures.md`](spec-figures.md) → "In the PR body" specifies — plain double quotes around each
attribute, **no backticks anywhere in or around the line, and never inside a code fence.** Follow
that section's stored-body check. It does not get a second home here.

**Pin every image to the commit SHA** and use the raw-content URL — a branch URL is cached stale by
GitHub's image proxy and a blob URL does not render. Never rewrite a body a person has pasted an
image into, or hand-fixed. Return the new pins instead.

---

## How to review this

*(Paste verbatim into the project PR description's collapsed `<details>` block. Most review here is
automated reviewers we cannot instruct, and this text is identical on every project PR — so it sits
below the fold.)*

This is a **project-spec**: the standing outcome, the cross-epic decisions, and the live state of
one Linear project, in four documents. It is not an implementation plan, not any one epic's
objective, and not a design.

**In scope to challenge:**

- The outcome — is this what the project should be driving at, and would we know if we got there?
- **Whether the project overbuilds.** Each epic can earn its place while the whole is too much.
  That question can only be asked here.
- A decision in `DECISIONS.md` that binds several epics, or a rule in `BUSINESS-RULES.md` with no
  owner or two.
- A missing epic the outcome implies, or one listed that does not serve it.

**Out of scope — owned by the epic specs below it:**

- Any single epic's objective, issue division, or internals. Those are its epic PR.
- **The figures at the pixel level**, and **the status in the epics table**, which is refreshed as
  the project moves and is never a review finding.

Feedback in the second list is routed to the epic it concerns, not folded in here.

---

## What refreshes, and when

`project-agent` owns every edit, one bounded update per dispatch. The triggers are **epic-level
only** — this is the restraint that keeps the artifact cheap:

| Trigger | `SPEC.md` | `DECISIONS.md` | `PLAN.md` | The PR body |
|---|---|---|---|---|
| An epic is created under the project | Table row · graph node gets its id, solid border | — | Arc lane gets a bar | As-of line · arc pin |
| An epic's objective is approved | Table status | — | Arc bar starts | As-of line · arc pin |
| An epic wraps | Table status · graph border heavy | *Decided once*, if the epic settled one | Arc bar closes · now line | As-of line · arc pin |
| A cross-epic question is answered | — | The card or *decided once* · matrix if an owner moved | — | The affected block |
| The outcome itself changes | Outcome table · territory figure | The card · what it rejected | — | Blocks 1–3 · territory pin |

**Issue-level churn is not on this table and must never be added to it.** An issue opening,
merging, or stalling moves the *epic* PR. A project-spec that refreshed on issue events would spend
a worktree per issue transition and tell a reader nothing the epic PR does not already say.

### Why a dropped refresh is safe

Every status field here is **derived at read time** — from one query on the project **and the epic
PRs' states**, not from a counter this artifact increments. Both halves are required: an epic wraps
by closing its epic PR unmerged and its Linear state is untouched, so a Linear-only derivation
would regress every wrapped epic to *in flight*. Given both, a refresh that is skipped, raced, or
lost costs nothing: the next one recomputes the whole table from source and is correct.

**One dispatch is exempt, and it is the one that carries more than status.** An epic's wrap Update
also records the cross-epic decisions that epic settled, which are derivable from nothing and have
no guaranteed later dispatch to carry them. It retries rather than skipping. That property is what lets two concurrent epics under one project **skip rather than
queue** when they collide on the branch ([`orchestration.md`](orchestration.md) → "The
project-spec"), and it is why this artifact needs no lock, no lease, and no lifecycle.

A refresh that changes nothing is a real outcome: say so and exit rather than manufacturing a diff.

---

## Publishing and mirroring

The directory is committed to `project/<slug>` and opened as the never-merged project PR. The
Linear mirror is the **project's `content` field** — not a separate document — holding the four
files in reading order under their own H1s, figures linked to the branch and every cross-document
link rewritten to the same branch URL, re-mirrored on every refresh. Linear renders neither
`<details>` nor a repo-relative image, so the content carries links and the ordering carries the
fold.

**On the first build, absorb — never clobber.** Most Linear projects already carry hand-written
`content`, often several thousand words of it. Read it first, fold what is still true into the four
documents, and report what was moved and what was dropped as stale. Overwriting a human's project
description with a generated one is the single worst thing this agent can do, and it is
unrecoverable through the API.
